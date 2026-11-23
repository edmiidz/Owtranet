#!/bin/bash
# Archive the iOS app for an instance and (optionally) upload it to App Store Connect,
# from the command line — no Xcode GUI.
#
# Usage:  ./scripts/build-ios.sh <instance>            → archive only (dist/<slug>-<version>-<build>.xcarchive)
#         ./scripts/build-ios.sh <instance> --upload   → archive + upload to App Store Connect / TestFlight
#         ./scripts/build-ios.sh <instance> --no-prebuild   reuse the existing ios/ project
#
# <instance> is a folder name under instances/ or a path to an instance folder kept elsewhere
# (see instances/README.md). Bump `buildNumber` in its instance.json before every upload:
# Apple rejects a reused build number.
#
# Prerequisites: Xcode signed in to the instance's Apple Developer team (Settings → Accounts),
# CocoaPods, Node >= 20.19.
#
# What the upload produces: a build in App Store Connect → TestFlight, processed in a few
# minutes. It is NOT added to any tester group or submitted for review by this script.
set -euo pipefail
cd "$(dirname "$0")/.."

INSTANCE="${1:-}"; shift || true
[[ -n "$INSTANCE" ]] || { echo "usage: $0 <instance> [--upload] [--no-prebuild]"; exit 1; }
if [[ "$INSTANCE" == */* ]]; then INSTANCE_JSON="$INSTANCE/instance.json"; else INSTANCE_JSON="instances/$INSTANCE/instance.json"; fi
[[ -f "$INSTANCE_JSON" ]] || { echo "✖ $INSTANCE_JSON not found"; exit 1; }
UPLOAD=0; PREBUILD=1
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    --no-prebuild) PREBUILD=0 ;;
    *) echo "unknown argument: $arg"; exit 1 ;;
  esac
done
export OWTRANET_INSTANCE="$INSTANCE"

CFG=$(npx expo config --type public --json 2>/dev/null)
read -r NAME SLUG VERSION BUILD TEAM BUNDLE < <(node -e '
  const c = JSON.parse(require("fs").readFileSync(0));
  console.log(c.name.replace(/[^A-Za-z0-9]/g, ""), c.slug, c.version, c.ios.buildNumber,
              c.ios.appleTeamId || "-", c.ios.bundleIdentifier)' <<<"$CFG")
[[ "$TEAM" != "-" ]] || { echo "✖ set appleTeamId in $INSTANCE_JSON"; exit 1; }
echo "▶ $BUNDLE $VERSION ($BUILD), team $TEAM"

if [[ $PREBUILD == 1 ]]; then
  echo "▶ npm install"; npm install --no-audit --no-fund >/dev/null
  # The Xcode project is named after the app; a different instance means a fresh ios/.
  ARGS=(--platform ios)
  if [[ -d ios && "$(cat ios/.owtranet-instance 2>/dev/null)" != "$INSTANCE" ]]; then ARGS+=(--clean); fi
  echo "▶ expo prebuild (ios, instance $INSTANCE)"; npx expo prebuild "${ARGS[@]}" >/dev/null
  printf '%s' "$INSTANCE" > ios/.owtranet-instance
fi

WS="ios/$NAME.xcworkspace"; SCHEME="$NAME"
[[ -d "$WS" ]] || { echo "✖ $WS not found (prebuild names the project after the app name)"; exit 1; }

# The archive and the build number must agree with instance.json, not with a stale Info.plist.
PLIST="ios/$NAME/Info.plist"
CUR=$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$PLIST")
[[ "$CUR" == "$BUILD" ]] || { echo "✖ $PLIST has build $CUR, instance.json says $BUILD — rerun without --no-prebuild"; exit 1; }

mkdir -p dist
ARCHIVE="dist/${SLUG}-${VERSION}-${BUILD}.xcarchive"
rm -rf "$ARCHIVE"
echo "▶ xcodebuild archive → $ARCHIVE (several minutes)"
xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates -quiet archive

if [[ $UPLOAD == 0 ]]; then
  echo "✅ $ARCHIVE"
  echo "   Upload later with: $0 $INSTANCE --upload --no-prebuild   (or Xcode → Organizer → Distribute App)"
  exit 0
fi

EXPORT_OPTS=$(mktemp -t exportoptions).plist
sed "s/YOUR_APPLE_TEAM_ID/$TEAM/" ExportOptions.plist > "$EXPORT_OPTS"
echo "▶ upload to App Store Connect"
# Xcode's IPA packaging spawns `rsync -E` found via PATH. Homebrew's rsync rejects -E and the
# export dies with "exportArchive Copy failed", so run the export with a system-only PATH.
env PATH=/usr/bin:/bin:/usr/sbin:/sbin xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTS" -exportPath "dist/export-$SLUG-$BUILD" -allowProvisioningUpdates
rm -f "$EXPORT_OPTS"
echo "✅ uploaded $BUNDLE $VERSION ($BUILD). App Store Connect emails when processing finishes;"
echo "   \"Upload Symbols Failed\" for React/hermesvm/WebRTC frameworks is a harmless warning."
echo "   Next: TestFlight → add the build to a tester group."
