#!/bin/bash
# Database install/upgrade test against a real MySQL server (CI runs this; you can too).
#
#   1. Fresh install: db/schema.sql into an empty DB → scripts/check-schema.js passes.
#   2. Upgrade: an older release's db/schema.sql (BASE_REF, default v1.0.0's commit)
#      → check-schema must FAIL and name the migrations to run → apply each of them
#      TWICE (migrations must be idempotent) → check-schema passes.
#   3. Runs test/db/gate-check.js (email notification rules) on the upgraded DB.
#
# Needs: mysql client, node with this repo's node_modules, git history for BASE_REF.
# Env:   DB_HOST (127.0.0.1) DB_PORT (3306) DB_USER (root) DB_PASSWORD
#        BASE_REF (586807e = v1.0.0)
# Creates and drops databases owt_test_fresh / owt_test_upgrade.
#
#   DB_PASSWORD=secret test/db/upgrade-test.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

export DB_HOST="${DB_HOST:-127.0.0.1}" DB_PORT="${DB_PORT:-3306}" DB_USER="${DB_USER:-root}"
export MYSQL_PWD="${DB_PASSWORD:-}"
BASE_REF="${BASE_REF:-586807e}"
M=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")

fresh_db() { "${M[@]}" -e "DROP DATABASE IF EXISTS $1; CREATE DATABASE $1 CHARACTER SET utf8mb4"; }
cleanup() { "${M[@]}" -e "DROP DATABASE IF EXISTS owt_test_fresh; DROP DATABASE IF EXISTS owt_test_upgrade" || true; }
trap cleanup EXIT

echo "== 1. Fresh install from db/schema.sql"
fresh_db owt_test_fresh
"${M[@]}" owt_test_fresh < db/schema.sql
DB_NAME=owt_test_fresh node scripts/check-schema.js

echo
echo "== 2. Upgrade from $BASE_REF"
fresh_db owt_test_upgrade
git show "$BASE_REF:db/schema.sql" | "${M[@]}" owt_test_upgrade
set +e
OUT=$(DB_NAME=owt_test_upgrade node scripts/check-schema.js 2>&1); CODE=$?
set -e
echo "$OUT"
MIGRATIONS=$(echo "$OUT" | grep -oE 'server/migrations/[A-Za-z0-9_.-]+\.sql' | awk '!seen[$0]++' || true)
if [ "$CODE" = "0" ]; then
  echo "(base schema already current: nothing to upgrade)"
elif [ "$CODE" != "1" ] || [ -z "$MIGRATIONS" ]; then
  echo "❌ check-schema should have exited 1 and named migrations (exit $CODE)"; exit 1
fi
for f in $MIGRATIONS; do
  for run in 1 2; do
    echo "-- applying $f (run $run)"
    "${M[@]}" owt_test_upgrade < "$f" >/dev/null
  done
done
DB_NAME=owt_test_upgrade node scripts/check-schema.js

echo
echo "== 3. Email notification rules on the upgraded database"
DB_NAME=owt_test_upgrade node test/db/gate-check.js

echo
echo "✅ install + upgrade test passed"
