#!/bin/bash
# Post-deploy smoke test for an intranet instance.
#
# Mints a short-lived admin JWT ON THE BOX (using that instance's JWT_SECRET and
# DB creds from its .env), then hits the read endpoints behind the main pages
# and asserts HTTP 200. Also reports any lines appended to the PM2 error log
# since the app restarted. Exit 1 on any failure so deploy scripts can go red.
#
# Both regressions this was written after (tasks list 500 on MySQL 8.4 numeric
# LIMIT bindings; DM send 500 from a renamed SQL column) would have failed here
# within seconds of the deploy instead of days later.
#
# Usage:
#   scripts/smoke-test.sh <app_dir> <port>
#   scripts/smoke-test.sh /var/www/owtranet 3006
#   SERVER=intranet.example.com scripts/smoke-test.sh /var/www/owtranet 3006
#
# Env: SERVER (required — host to SSH into), SSH_KEY (default ~/.ssh/id_rsa),
#      SSH_USER (default ubuntu)

set -uo pipefail

APP="${1:?usage: smoke-test.sh <app_dir> <port>}"
PORT="${2:?usage: smoke-test.sh <app_dir> <port>}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
SERVER="${SERVER:?set SERVER to the host to SSH into}"
SSH_USER="${SSH_USER:-ubuntu}"

# Read-only endpoints behind the pages people actually open. Add one here
# whenever a page ships that depends on a new list/detail endpoint.
ENDPOINTS=(
  "/api/auth/me"
  "/api/posts?limit=5"
  "/api/tasks?limit=5"
  "/api/tasks/activity?limit=5"
  "/api/messages/conversations"
  "/api/notifications"
  "/api/ledger"
  "/api/deliverables"
  "/api/investment-tracker/statistics"
  "/api/search?q=smoke"
  "/api/users/search?q=a"
  "/api/quicklinks"
)
# Deliberately NOT listed: /api/agreements/status (404 is a legitimate state when
# no agreement version is active). Only put endpoints here that must be 200 on
# a healthy instance regardless of data.

# Endpoints travel as one space-separated, shell-quoted string (no spaces in paths).
ENDPOINT_LIST="${ENDPOINTS[*]}"

ssh -i "$SSH_KEY" -o ConnectTimeout=20 "$SSH_USER@$SERVER" \
  "APP=$(printf '%q' "$APP") PORT=$(printf '%q' "$PORT") ENDPOINT_LIST=$(printf '%q' "$ENDPOINT_LIST") bash -s" <<'REMOTE'
set -uo pipefail
cd "$APP" || { echo "❌ app dir $APP missing"; exit 1; }
set -a; source .env; set +a

# Admin identity: lowest-id admin that can actually log in.
ADMIN_ID=$(mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e \
  "SELECT id FROM users WHERE role='admin' AND password_hash IS NOT NULL ORDER BY id LIMIT 1" 2>/dev/null)
if [ -z "$ADMIN_ID" ]; then
  ADMIN_ID=$(mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e \
    "SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1" 2>/dev/null)
fi
if [ -z "$ADMIN_ID" ]; then echo "❌ no admin user found in $DB_NAME"; exit 1; fi

TOKEN=$(node -e '
  const jwt = require("jsonwebtoken");
  console.log(jwt.sign({ userId: Number(process.argv[1]), email: "smoke@test", role: "admin" },
    process.env.JWT_SECRET, { expiresIn: "2m" }));
' "$ADMIN_ID")

# Wait for the app to accept connections (PM2 restart just happened).
for i in $(seq 1 15); do
  if curl -s -o /dev/null "http://localhost:$PORT/api/auth/me" -H "Authorization: Bearer $TOKEN"; then break; fi
  sleep 1
done

FAIL=0
echo "🧪 Smoke test $(basename "$APP") :$PORT as admin user $ADMIN_ID"
for ep in $ENDPOINT_LIST; do
  code=$(curl -s -o /tmp/smoke_body -w '%{http_code}' --max-time 15 \
    "http://localhost:$PORT$ep" -H "Authorization: Bearer $TOKEN")
  if [ "$code" = "200" ]; then
    printf '   ✅ %-45s 200\n' "$ep"
  else
    FAIL=1
    printf '   ❌ %-45s %s  %s\n' "$ep" "$code" "$(head -c 160 /tmp/smoke_body | tr '\n' ' ')"
  fi
done

# Error-log lines written since the app process started.
ERRLOG=$(ls -t logs/err-*.log 2>/dev/null | head -1)
STARTED=$(sudo pm2 jlist 2>/dev/null | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const app=(JSON.parse(d)||[]).find(p=>p.pm2_env&&p.pm2_env.pm_cwd===process.argv[1]&&!/email|approve|exchange|tracking|radio|push/.test(p.name));
    if(app) console.log(new Date(app.pm2_env.pm_uptime).toISOString().replace(/\.\d+Z$/,""));
  })' "$APP")
if [ -n "$ERRLOG" ] && [ -n "$STARTED" ]; then
  NEW=$(awk -v s="$STARTED" 'substr($0,1,19) >= s' "$ERRLOG" | grep -v "Using a password" | grep -cE "Error|error:" || true)
  if [ "$NEW" -gt 0 ]; then
    FAIL=1
    echo "   ❌ $NEW error line(s) in $ERRLOG since restart ($STARTED UTC):"
    awk -v s="$STARTED" 'substr($0,1,19) >= s' "$ERRLOG" | grep -E "Error|error:" | tail -5 | sed 's/^/      /'
  else
    echo "   ✅ no new errors in $ERRLOG since restart"
  fi
fi

if [ "$FAIL" = "1" ]; then echo "❌ SMOKE TEST FAILED"; exit 1; fi
echo "✅ Smoke test passed"
REMOTE
