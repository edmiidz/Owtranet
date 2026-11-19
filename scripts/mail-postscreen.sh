#!/bin/bash
# Put Postfix postscreen in front of inbound SMTP (port 25) with weighted DNS
# blocklist scoring, so known spam/phish senders are refused before they reach
# smtpd. Ports 587/465 (authenticated submission) are NOT affected.
#
# Optional, for self-hosted mail only. Run ON the mail server with sudo, starting
# with `log` and checking `report` before switching to `enforce`:
#   sudo bash /var/www/owtranet/scripts/mail-postscreen.sh <mode>
#
# Modes
#   log       install/refresh config, DNSBL + pregreet tests only LOG (nothing rejected)
#   enforce   same config, but clients scoring >= threshold get 550 at RCPT TO
#   report    summarise what postscreen flagged in /var/log/mail.log* (what
#             'enforce' would have / did reject) — run this before switching to enforce
#   status    show current postscreen settings
#   rollback  restore main.cf + master.cf from the newest backup taken by this script
#
# Scoring (threshold 3, POSTSCREEN_THRESHOLD to change). Weights were chosen by
# replaying a week of real inbound IPs: SpamCop alone lists some Google and
# SendGrid outbound IPs, so no single soft list may reject by itself.
#   Spamhaus ZEN  *3  only when SPAMHAUS_DQS_KEY is set: Spamhaus refuses the public
#                     zone through large cloud resolvers (e.g. AWS answers
#                     127.255.255.254). The free DQS tier is non-commercial only.
#   Barracuda     *2
#   SpamCop       *1
#   DNSWL         *-2 allowlist (any trust level), offsets SpamCop hits on Google/SendGrid
# A typical credential phish from a listed IP scores 3 without Spamhaus, 6 with it.
#
# Expects a stock Debian/Ubuntu master.cf (plain `smtp inet ... smtpd` plus the
# commented postscreen block); anything else stops with a message instead of guessing.
# Idempotent; every config-changing run backs up main.cf + master.cf first.

set -euo pipefail

MODE="${1:-}"
PF="${POSTFIX_DIR:-/etc/postfix}"   # override only to try the script on a copy
THRESHOLD="${POSTSCREEN_THRESHOLD:-3}"
BACKUP_ROOT="$PF/backup-postscreen"
MAIL_LOGS="${MAIL_LOGS:-/var/log/mail.log*}"   # override to test report against another log

usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ -n "$MODE" ] || usage

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

dnsbl_sites() {
  local sites=""
  if [ -n "${SPAMHAUS_DQS_KEY:-}" ]; then
    sites="${SPAMHAUS_DQS_KEY}.zen.dq.spamhaus.net=127.0.0.[2..11]*3, "
  fi
  sites+="b.barracudacentral.org=127.0.0.2*2, "
  sites+="bl.spamcop.net=127.0.0.2*1, "
  sites+="list.dnswl.org=127.0.[0..255].[0..3]*-2"
  echo "$sites"
}

backup() {
  local dir="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$dir"
  cp -p "$PF/main.cf" "$PF/master.cf" "$dir/"
  echo "💾 Backed up main.cf + master.cf → $dir"
}

enable_master_cf() {
  local m="$PF/master.cf"
  if grep -qE '^smtp[[:space:]]+inet[[:space:]].*[[:space:]]postscreen[[:space:]]*$' "$m"; then
    echo "✅ master.cf already routes port 25 through postscreen"
    return
  fi
  # Stock Debian master.cf: plain smtpd on :25 plus the commented postscreen block.
  grep -qE '^smtp[[:space:]]+inet[[:space:]]+n[[:space:]]+-[[:space:]]+y[[:space:]]+-[[:space:]]+-[[:space:]]+smtpd[[:space:]]*$' "$m" \
    || { echo "❌ master.cf: no plain 'smtp inet ... smtpd' line found — edit by hand" >&2; exit 1; }
  for svc in smtp smtpd dnsblog tlsproxy; do
    grep -qE "^#${svc}[[:space:]]" "$m" || { echo "❌ master.cf: commented '#${svc}' postscreen line missing — edit by hand" >&2; exit 1; }
  done
  sed -i -E \
    -e 's/^(smtp[[:space:]]+inet[[:space:]]+n[[:space:]]+-[[:space:]]+y[[:space:]]+-[[:space:]]+-[[:space:]]+smtpd[[:space:]]*)$/#\1   # replaced by postscreen (scripts\/mail-postscreen.sh)/' \
    -e 's/^#(smtp[[:space:]]+inet[[:space:]].*[[:space:]]postscreen[[:space:]]*)$/\1/' \
    -e 's/^#(smtpd[[:space:]]+pass[[:space:]].*)$/\1/' \
    -e 's/^#(dnsblog[[:space:]]+unix[[:space:]].*)$/\1/' \
    -e 's/^#(tlsproxy[[:space:]]+unix[[:space:]].*)$/\1/' \
    "$m"
  echo "🔧 master.cf: port 25 → postscreen; enabled smtpd pass, dnsblog, tlsproxy"
}

configure_main_cf() {
  local action="$1"
  postconf -e \
    "postscreen_access_list = permit_mynetworks" \
    "postscreen_dnsbl_sites = $(dnsbl_sites)" \
    "postscreen_dnsbl_threshold = $THRESHOLD" \
    "postscreen_dnsbl_action = $action" \
    "postscreen_greet_action = $action"
  if [ -n "${SPAMHAUS_DQS_KEY:-}" ]; then
    # Keep the DQS key out of the 550 text sent to remote clients.
    printf '%s.zen.dq.spamhaus.net\tzen.spamhaus.org\n' "$SPAMHAUS_DQS_KEY" > "$PF/dnsbl_reply_map"
    chmod 640 "$PF/dnsbl_reply_map"; chgrp postfix "$PF/dnsbl_reply_map"
    postconf -e "postscreen_dnsbl_reply_map = texthash:$PF/dnsbl_reply_map"
  fi
  echo "🔧 main.cf: dnsbl/greet action = $action, threshold = $THRESHOLD"
  echo "   sites: $(postconf -h postscreen_dnsbl_sites | sed -E 's/[0-9a-z]{20,}\.zen/<DQS>.zen/')"
}

apply() {
  local action="$1"
  backup
  enable_master_cf
  configure_main_cf "$action"
  if ! postfix check; then
    echo "❌ postfix check failed — rolling back" >&2
    rollback
    exit 1
  fi
  postfix reload
  sleep 2
  if ss -ltnp | grep -q ':25 '; then
    echo "✅ Reloaded; port 25 listening"
  else
    echo "❌ port 25 not listening after reload — rolling back" >&2
    rollback
    exit 1
  fi
}

rollback() {
  local last
  last=$(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -1)
  [ -n "$last" ] || { echo "❌ no backup under $BACKUP_ROOT" >&2; exit 1; }
  cp -p "$last/main.cf" "$last/master.cf" "$PF/"
  postfix reload
  echo "↩️  Restored main.cf + master.cf from $last and reloaded"
}

report() {
  # Lines: postscreen 'DNSBL rank N for [ip]:port' (logged when N >= threshold),
  # 'PREGREET ...', plus smtpd 'client=host[ip]' and qmgr 'from=<...>' to name
  # what got through while in log mode.
  zcat -f $MAIL_LOGS 2>/dev/null | awk '
    /postscreen\[[0-9]+\]: DNSBL rank/ {
      match($0, /rank [0-9-]+/); r = substr($0, RSTART+5, RLENGTH-5) + 0
      match($0, /for \[[0-9a-fA-F:.]+\]/); ip = substr($0, RSTART+5, RLENGTH-6)
      hits[ip]++; if (r > rank[ip]) rank[ip] = r; next
    }
    /postfix\/smtpd\[[0-9]+\]: [0-9A-F]+: client=/ {
      split($0, a, ": "); qid = a[2]; sub(/.*client=/, "", $0)
      host = $0; ip = $0; sub(/\[.*/, "", host); sub(/^[^[]*\[/, "", ip); sub(/\].*/, "", ip)
      qip[qid] = ip; hostname[ip] = host; next
    }
    /postfix\/qmgr\[[0-9]+\]: [0-9A-F]+: from=</ {
      split($0, a, ": "); qid = a[2]
      if (qid in qip) { f = $0; sub(/.*from=</, "", f); sub(/>.*/, "", f)
        ip = qip[qid]; if (index(senders[ip], f) == 0 && length(senders[ip]) < 120) senders[ip] = senders[ip] (senders[ip] ? " " : "") f }
    }
    END {
      for (ip in hits)
        printf "%4d  x%-4d %-15s %-40s %s\n", rank[ip], hits[ip], ip, (hostname[ip] ? hostname[ip] : "(refused before smtpd)"), senders[ip]
    }' | sort -rn | { echo "rank  conns client-ip       rDNS (from smtpd)                        envelope senders"; cat; }
  echo
  echo "PREGREET (spoke before the banner — bots), distinct IPs: $(zcat -f $MAIL_LOGS 2>/dev/null \
    | grep -E 'postscreen\[[0-9]+\]: PREGREET' | grep -oE 'from \[[0-9a-fA-F:.]+\]' | sort -u | wc -l)"
  echo "Mode now: dnsbl_action=$(postconf -h postscreen_dnsbl_action) greet_action=$(postconf -h postscreen_greet_action)"
  echo "Every row scored >= $THRESHOLD, i.e. is refused with 550 under 'enforce'."
  echo "Check the rDNS + sender columns for anything legitimate before switching."
}

case "$MODE" in
  log)      apply ignore ;;
  enforce)  apply enforce ;;
  report)   report ;;
  status)   postconf postscreen_access_list postscreen_dnsbl_threshold postscreen_dnsbl_action postscreen_greet_action \
              | sed -E 's/[0-9a-z]{20,}\.zen/<DQS>.zen/'
            postconf -h postscreen_dnsbl_sites | sed -E 's/[0-9a-z]{20,}\.zen/<DQS>.zen/'
            grep -nE '^(smtp[[:space:]]+inet|smtpd[[:space:]]+pass|dnsblog|tlsproxy)' "$PF/master.cf" ;;
  rollback) rollback ;;
  *)        usage ;;
esac
