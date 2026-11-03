#!/bin/bash
# Deploy an Owtranet instance from this clone to a server via rsync.
#
# Configure once in .deploy.env (gitignored) or the environment:
#   DEPLOY_HOST=203.0.113.10            # server IP / hostname (required)
#   DEPLOY_USER=ubuntu                  # SSH user that owns DEPLOY_PATH
#   DEPLOY_KEY=~/.ssh/id_ed25519        # SSH private key
#   DEPLOY_PATH=/var/www/owtranet       # app dir on the server
#   DEPLOY_PORT=3006                    # PORT the app listens on (for the smoke test)
#   PM2_APP=owtranet                    # main PM2 process name
#   PM2_EXTRA="owtranet-email-processor owtranet-scheduled-mail"   # also restarted
#   PM2_SUDO=1                          # 1 if PM2 runs under root (sudo pm2)
#
# What it does:
#   1. Refuses to deploy from a clone that is behind origin (it would roll back others' work)
#   2. Builds client/dist locally (small servers can run out of memory building Vite)
#   3. rsyncs client/dist and the backend paths below, then verifies server.js landed
#   4. Syntax-checks, restarts PM2, and runs scripts/smoke-test.sh
#
# It never touches .env, uploads/, logs/, node_modules/, server/data/ or
# ecosystem.config.js on the server. Run `npm install --omit=dev` on the server
# yourself when package.json dependencies change.
#
# Usage:
#   ./deploy.sh              # build + deploy everything + restart
#   ./deploy.sh --no-build   # deploy whatever is already in client/dist
#   ./deploy.sh --client     # frontend only (no backend, no restart)
#   ./deploy.sh --allow-stale

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$REPO_DIR/.deploy.env" ] && . "$REPO_DIR/.deploy.env"

DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST (in .deploy.env or the environment)}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/owtranet}"
DEPLOY_PORT="${DEPLOY_PORT:-3006}"
PM2_APP="${PM2_APP:-owtranet}"
PM2_EXTRA="${PM2_EXTRA:-}"
PM2="pm2"; [ "${PM2_SUDO:-1}" = "1" ] && PM2="sudo pm2"

SERVER_PATHS=(
  "server.js"
  "emailUtils.js"
  "email-receipt-processor.js"
  "package.json"
  "utils/"
  "api/"
  "scripts/"
  "server/"
  "mcp-webmail/"
)

SSH="ssh -i $DEPLOY_KEY -o ConnectTimeout=20"
TARGET="$DEPLOY_USER@$DEPLOY_HOST"

DO_BUILD=1; DO_SERVER=1; DO_RESTART=1; ALLOW_STALE=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --client)   DO_SERVER=0; DO_RESTART=0 ;;
    --allow-stale) ALLOW_STALE=1 ;;
    *) echo "Unknown arg: $arg"; exit 2 ;;
  esac
done

cd "$REPO_DIR"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if git fetch -q origin "$BRANCH" 2>/dev/null; then
  BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
  if [ "${BEHIND:-0}" -gt 0 ] && [ "$ALLOW_STALE" != "1" ]; then
    echo "❌ $BRANCH is $BEHIND commit(s) behind origin/$BRANCH — deploying would roll those back."
    echo "   git pull --rebase origin $BRANCH   (or --allow-stale)"
    exit 3
  fi
fi

if [ "$DO_BUILD" = "1" ]; then
  echo "🏗️  Building client..."
  ( cd client && npm run build )
fi

echo "📤 client/dist → $TARGET:$DEPLOY_PATH/client/dist"
rsync -az --delete -e "$SSH" client/dist/ "$TARGET:$DEPLOY_PATH/client/dist/"

if [ "$DO_SERVER" = "1" ]; then
  echo "📤 Backend: ${SERVER_PATHS[*]}"
  # One rsync per path: macOS's openrsync ignores `rsync -R` /./ markers.
  for p in "${SERVER_PATHS[@]}"; do
    p="${p%/}"
    [ -e "$p" ] || continue
    if [ -d "$p" ]; then
      EXCLUDES=(--exclude '.env' --exclude 'node_modules/')
      [ "$p" = "server" ] && EXCLUDES+=(--exclude '/data/')
      rsync -az --omit-dir-times -e "$SSH" "${EXCLUDES[@]}" "$p/" "$TARGET:$DEPLOY_PATH/$p/"
    else
      rsync -az -e "$SSH" "$p" "$TARGET:$DEPLOY_PATH/$p"
    fi
  done
  LOCAL_SUM=$(shasum -a 1 server.js | cut -d' ' -f1)
  REMOTE_SUM=$($SSH "$TARGET" "sha1sum $DEPLOY_PATH/server.js" | cut -d' ' -f1)
  if [ "$LOCAL_SUM" != "$REMOTE_SUM" ]; then
    echo "❌ server.js on the server does not match this clone — backend rsync failed."
    exit 5
  fi
fi

if [ "$DO_RESTART" = "1" ]; then
  echo "🧪 Syntax check + PM2 restart..."
  $SSH "$TARGET" "cd $DEPLOY_PATH \
    && node --check server.js \
    && node --check email-receipt-processor.js \
    && $PM2 restart $PM2_APP $PM2_EXTRA --update-env \
    && sleep 3 \
    && $PM2 logs $PM2_APP --lines 8 --nostream | tail -10"
  SSH_KEY="$DEPLOY_KEY" SERVER="$DEPLOY_HOST" SSH_USER="$DEPLOY_USER" \
    "$REPO_DIR/scripts/smoke-test.sh" "$DEPLOY_PATH" "$DEPLOY_PORT" || {
    echo "❌ Deployed, but the smoke test FAILED — fix or roll back."
    exit 4
  }
fi

echo "✅ Deploy complete."
