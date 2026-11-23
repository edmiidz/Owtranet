#!/bin/bash
# Upload an Android build to Firebase App Distribution (free tester distribution, the
# Android counterpart of TestFlight) and optionally send it to a tester group.
#
# Usage:  ./scripts/distribute-android.sh dist/intranet-1.0.0-14.apk notes.txt          → upload only
#         ./scripts/distribute-android.sh dist/intranet-1.0.0-14.apk notes.txt --send   → + email testers
#
# Configuration (environment, e.g. in a file you `source` first; nothing is hardcoded):
#   FIREBASE_ANDROID_APP_ID   required. Firebase console → Project settings → Your apps,
#                             "App ID", e.g. 1:123456789012:android:0123456789abcdef
#   FIREBASE_TESTER_GROUP     tester group alias for --send (default: testers)
#   FIREBASE_PROJECT_NUMBER   optional; read from the app id when unset
#
# Auth: `gcloud auth print-access-token` for an account with access to the Firebase
# project. The script calls the App Distribution REST API directly, so the firebase CLI
# does not need to be installed or logged in. Needs curl and python3.
#
# Uploading alone notifies nobody: the release waits in the console until distributed.
# Testers install through the Firebase App Tester app / the invite email. Build the APK
# first with ./scripts/build-android-apk.sh, signed with your upload key so it installs
# over earlier builds.
set -euo pipefail
cd "$(dirname "$0")/.."

USAGE="usage: $0 <apk|aab> <release-notes-file> [--send]"
APP_ID="${FIREBASE_ANDROID_APP_ID:?Set FIREBASE_ANDROID_APP_ID (see the header of this script)}"
PROJECT_NUMBER="${FIREBASE_PROJECT_NUMBER:-$(cut -d: -f2 <<<"$APP_ID")}"
GROUP="${FIREBASE_TESTER_GROUP:-testers}"
API="https://firebaseappdistribution.googleapis.com"
[[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]] || { echo "✖ could not read a project number from FIREBASE_ANDROID_APP_ID=$APP_ID"; exit 1; }

BINARY="${1:?$USAGE}"
NOTES_FILE="${2:?$USAGE}"
SEND="${3:-}"
[[ -f "$BINARY" ]] || { echo "✖ not found: $BINARY"; exit 1; }
[[ -f "$NOTES_FILE" ]] || { echo "✖ not found: $NOTES_FILE"; exit 1; }
[[ -z "$SEND" || "$SEND" == "--send" ]] || { echo "$USAGE"; exit 1; }

TOKEN=$(gcloud auth print-access-token)
H=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_NUMBER")

echo "▶ uploading $BINARY ($(du -h "$BINARY" | cut -f1))"
OP=$(curl -sf "${H[@]}" -H "X-Goog-Upload-Protocol: raw" -H "X-Goog-Upload-File-Name: $(basename "$BINARY")" \
  --data-binary @"$BINARY" "$API/upload/v1/projects/$PROJECT_NUMBER/apps/$APP_ID/releases:upload" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')

# The upload returns a long-running operation; poll it (up to 5 minutes) for the release.
DONE=""
for _ in $(seq 1 60); do
  RESP=$(curl -sf "${H[@]}" "$API/v1/$OP")
  if python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin).get("done") else 1)' <<<"$RESP"; then DONE=1; break; fi
  sleep 5
done
[[ -n "$DONE" ]] || { echo "✖ upload still processing after 5 minutes; check the Firebase console"; exit 1; }
RELEASE=$(python3 -c '
import json,sys
d=json.load(sys.stdin)
if "error" in d: sys.exit("✖ upload failed: %s" % d["error"])
r=d["response"]; print(r["result"], file=sys.stderr); print(r["release"]["name"])' <<<"$RESP")

echo "▶ setting release notes"
python3 -c 'import json,sys;print(json.dumps({"releaseNotes":{"text":open(sys.argv[1]).read().strip()}}))' "$NOTES_FILE" \
  | curl -sf "${H[@]}" -H "Content-Type: application/json" -X PATCH --data @- \
      "$API/v1/$RELEASE?updateMask=release_notes.text" >/dev/null

if [[ "$SEND" == "--send" ]]; then
  echo "▶ distributing to group '$GROUP'"
  python3 -c 'import json,sys;print(json.dumps({"groupAliases":[sys.argv[1]]}))' "$GROUP" \
    | curl -sf "${H[@]}" -H "Content-Type: application/json" -X POST --data @- "$API/v1/$RELEASE:distribute" >/dev/null
  echo "  testers in '$GROUP' are being emailed"
else
  echo "  not distributed: re-run with --send, or use Distribute in the console"
fi

curl -sf "${H[@]}" "$API/v1/$RELEASE" | python3 -c '
import json,sys;r=json.load(sys.stdin)
print("✅ build %s (%s)\n   console: %s\n   testers: %s" % (r["buildVersion"], r["displayVersion"], r["firebaseConsoleUri"], r["testingUri"]))'
