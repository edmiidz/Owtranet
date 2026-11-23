#!/bin/bash
# Access test against a real server + MySQL (CI runs this; you can too).
#
# Starts server.js on a scratch database seeded with a few members and posts of
# every visibility, then checks that member and post reads need a signed-in
# user, and that a post is only returned to the members allowed to see it
# (the same rule as the forum: server/lib/postVisibility.js, plus co-editors).
#
# Needs: mysql client, node with this repo's node_modules, curl.
# Env:   DB_HOST (127.0.0.1) DB_PORT (3306) DB_USER (root) DB_PASSWORD
#        TEST_PORT (3917)
# Creates and drops the database owt_test_access.
#
#   DB_PASSWORD=secret test/db/access-test.sh

set -uo pipefail
cd "$(dirname "$0")/../.."

export DB_HOST="${DB_HOST:-127.0.0.1}" DB_PORT="${DB_PORT:-3306}" DB_USER="${DB_USER:-root}"
export MYSQL_PWD="${DB_PASSWORD:-}"
DB=owt_test_access
PORT="${TEST_PORT:-3917}"
M=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")
WORK=$(mktemp -d)
SECRET="access-test-$$-$RANDOM"
PID=

cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
  "${M[@]}" -e "DROP DATABASE IF EXISTS $DB" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

set -e
"${M[@]}" -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4"
"${M[@]}" $DB < db/schema.sql
"${M[@]}" $DB < db/seed.sql
"${M[@]}" $DB <<'SQL'
INSERT INTO users (id, email, password, name, intranet_username, role) VALUES
  (11, 'author@example.com',  'x', 'Author',   'author',  'user'),
  (12, 'granted@example.com', 'x', 'Granted',  'granted', 'user'),
  (13, 'other@example.com',   'x', 'Other',    'other',   'user'),
  (14, 'coed@example.com',    'x', 'Coeditor', 'coed',    'user');
INSERT INTO posts (id, user_id, title, content, slug, visibility) VALUES
  (101, 11, 'Everyone',    'c', 'everyone-101', 'all_members'),
  (102, 11, 'Author only', 'c', 'author-102',   'author_only'),
  (103, 11, 'Some',        'c', 'some-103',     'specific_members'),
  (104, 11, 'Legacy',      'c', 'legacy-104',   NULL);
INSERT INTO post_visibility (post_id, user_id, granted_by) VALUES (103, 12, 11);
INSERT INTO post_editors   (post_id, user_id, granted_by) VALUES (102, 14, 11);
INSERT INTO quicklinks (title, url, is_active) VALUES ('Docs', 'https://example.com', 1);
SQL
set +e

DB_NAME=$DB DB_PASSWORD="$MYSQL_PWD" JWT_SECRET="$SECRET" PORT=$PORT NODE_ENV=test \
  node server.js > "$WORK/server.log" 2>&1 &
PID=$!
for _ in $(seq 1 80); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/config/branding" && break
  sleep 0.25
done

token() { node -e "console.log(require('jsonwebtoken').sign({userId:$1,email:'$2',role:'user',intranet_username:'$3'},process.argv[1]))" "$SECRET"; }
AUTHOR=$(token 11 author@example.com author)
GRANTED=$(token 12 granted@example.com granted)
OTHER=$(token 13 other@example.com other)
COEDITOR=$(token 14 coed@example.com coed)

pass=0; fail=0
expect() { # expect <label> <status> <path> [token]
  local auth=()
  [ -n "${4:-}" ] && auth=(-H "Authorization: Bearer $4")
  local got
  got=$(curl -s -o "$WORK/body" -w '%{http_code}' ${auth[@]+"${auth[@]}"} "http://127.0.0.1:$PORT$3")
  if [ "$got" = "$2" ]; then
    pass=$((pass + 1)); echo "ok    $1 ($got)"
  else
    fail=$((fail + 1)); echo "FAIL  $1: expected $2, got $got: $(head -c 160 "$WORK/body")"
  fi
}

echo "== Member profiles"
expect "profile, signed out"            401 /api/users/author
expect "profile by id, signed out"      401 /api/users/id:11
expect "profile, invalid token"         403 /api/users/author not-a-token
expect "profile, signed in"             200 /api/users/author "$OTHER"
expect "profile by id, signed in"       200 /api/users/id:11 "$OTHER"
expect "member search, signed in"       200 "/api/users/search?q=Auth" "$OTHER"

echo "== Posts by id"
expect "everyone post, signed out"      401 /api/posts/id/101
expect "author-only post, signed out"   401 /api/posts/id/102
expect "everyone post, any member"      200 /api/posts/id/101 "$OTHER"
expect "legacy NULL post, any member"   200 /api/posts/id/104 "$OTHER"
expect "author-only post, author"       200 /api/posts/id/102 "$AUTHOR"
expect "author-only post, co-editor"    200 /api/posts/id/102 "$COEDITOR"
expect "author-only post, other member" 404 /api/posts/id/102 "$OTHER"
expect "specific post, granted member"  200 /api/posts/id/103 "$GRANTED"
expect "specific post, author"          200 /api/posts/id/103 "$AUTHOR"
expect "specific post, other member"    404 /api/posts/id/103 "$OTHER"
expect "missing post"                   404 /api/posts/id/999 "$OTHER"

echo "== Other member data"
expect "quick links, signed out"        401 /api/quicklinks
expect "quick links, signed in"         200 /api/quicklinks "$OTHER"
expect "GitHub issues, signed out"      401 /api/github/issues/author
expect "GitHub issues, signed in"       200 /api/github/issues/author "$OTHER"
expect "branding stays public"          200 /api/config/branding

echo
echo "passed $pass, failed $fail"
if [ "$fail" -ne 0 ]; then
  echo "--- server log (last 30 lines)"
  tail -30 "$WORK/server.log"
  exit 1
fi
