#!/bin/bash
# Build a sideloadable Android APK — or a Play-Store AAB — on any Mac (Apple Silicon
# fine) without Android Studio open.
#
# One-time prerequisites:
#   Node >= 20.19 (RN 0.86 requires it; `nvm use 22`)
#   JDK 17                     export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
#   Android SDK 36             sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
#                              export ANDROID_HOME="$HOME/Library/Android/sdk"
#
# Usage:  ./scripts/build-android-apk.sh            → mobile/dist/intranet-<version>-<code>.apk
#         ./scripts/build-android-apk.sh --aab      → Play-Store bundle instead of APK
#         ./scripts/build-android-apk.sh --arm64    → arm64-v8a only (see below)
#         ./scripts/build-android-apk.sh --abi=arm64-v8a,armeabi-v7a
#         ./scripts/build-android-apk.sh --workers=1
#
# ABIs: the default builds all four (arm64-v8a, armeabi-v7a, x86, x86_64), which is what
# a Play release wants — x86 is what emulators run on. But since the LiveKit/WebRTC native
# modules landed, compiling all four at once can exhaust memory on a 16 GB Mac and the OOM
# killer takes the build out mid-compile. --arm64 covers every real phone since ~2015 and
# roughly quarters the native work (94 MB → 57 MB APK); it will NOT install on an x86
# emulator. --workers=1 trades wall-clock for a lower memory ceiling if that is not enough.
# This is passed to Gradle as -PreactNativeArchitectures rather than edited into
# android/gradle.properties, which prebuild regenerates and .gitignore excludes.
#
# Signing: with no keystore configured, Expo's generated project signs "release" with the
# DEBUG keystore. That is fine for sideloading to testers, but Google Play rejects it. For
# Play, source the upload keystore env first:
#     source ~/.config/intranet/upload-keystore.env
# which sets INTRANET_KEYSTORE / INTRANET_KEYSTORE_PASS / INTRANET_KEY_ALIAS / INTRANET_KEY_PASS.
# The script verifies afterwards that the artifact is genuinely signed with that key, so a
# silently-failed patch can never reach an upload.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ANDROID_HOME:?Set ANDROID_HOME (see header of this script)}"
TASK=assembleRelease; OUT_GLOB="android/app/build/outputs/apk/release/*.apk"; EXT=apk
ABIS=""; WORKERS="${GRADLE_WORKERS:-}"
for arg in "$@"; do
  case "$arg" in
    --aab)     TASK=bundleRelease; OUT_GLOB="android/app/build/outputs/bundle/release/*.aab"; EXT=aab ;;
    --arm64)   ABIS="arm64-v8a" ;;
    --abi=*)   ABIS="${arg#--abi=}" ;;
    --workers=*) WORKERS="${arg#--workers=}" ;;
    *) echo "unknown argument: $arg"; exit 1 ;;
  esac
done

echo "▶ npm install"; npm install --no-audit --no-fund --legacy-peer-deps >/dev/null
echo "▶ expo prebuild (android)"; npx expo prebuild --platform android --no-install >/dev/null

if [[ -n "${INTRANET_KEYSTORE:-}" ]]; then
  echo "▶ signing with upload keystore $INTRANET_KEYSTORE"
  [[ -f "$INTRANET_KEYSTORE" ]] || { echo "✖ keystore not found: $INTRANET_KEYSTORE"; exit 1; }
  cat > android/keystore.properties <<PROPS
storeFile=$INTRANET_KEYSTORE
storePassword=${INTRANET_KEYSTORE_PASS:?}
keyAlias=${INTRANET_KEY_ALIAS:-upload}
keyPassword=${INTRANET_KEY_PASS:?}
PROPS
  # Point the release buildType at a real signingConfig. Expo regenerates
  # android/app/build.gradle on every prebuild, so this patch is reapplied each run — and
  # it hard-fails rather than silently leaving the debug key in place if the template moves.
  python3 - <<'PY'
import re, sys, pathlib
p = pathlib.Path('android/app/build.gradle'); s = p.read_text()

if 'signingConfigs.release' not in s:
    # 1. add a release signingConfig that reads keystore.properties
    block = """        release {
            def kp = new Properties()
            kp.load(new FileInputStream(rootProject.file("keystore.properties")))
            storeFile file(kp.storeFile)
            storePassword kp.storePassword
            keyAlias kp.keyAlias
            keyPassword kp.keyPassword
        }
"""
    s, n = re.subn(r'(signingConfigs \{\n(?:.*\n)*?    \}\n)',
                   lambda m: m.group(1)[:-len('    }\n')] + block + '    }\n', s, count=1)
    if n != 1:
        sys.exit('✖ could not insert release signingConfig into build.gradle')

    # 2. repoint ONLY the release buildType (the debug buildType keeps the debug key).
    #    Anchor inside buildTypes { … }: signingConfigs now also contains a `release {`
    #    block, and searching the whole file would match that one instead.
    bt = s.find('buildTypes {')
    if bt == -1:
        sys.exit('✖ could not find buildTypes in build.gradle')
    rel = s.find('release {', bt)
    if rel == -1:
        sys.exit('✖ could not find the release buildType in build.gradle')
    head, tail = s[:rel], s[rel:]
    tail, n = re.subn(r'signingConfig signingConfigs\.debug',
                      'signingConfig signingConfigs.release', tail, count=1)
    if n != 1:
        sys.exit('✖ release buildType did not reference signingConfigs.debug as expected')
    s = head + tail
    p.write_text(s)
print('  build.gradle patched: release -> signingConfigs.release')
PY
else
  echo "▶ no INTRANET_KEYSTORE set — release will be signed with the DEBUG key (sideload only, Play will reject)"
fi

echo "▶ gradle $TASK (first run downloads Gradle + deps, several minutes)"
GRADLE_ARGS=("$TASK" -q)
if [[ -n "$ABIS" ]]; then
  echo "  ABIs: $ABIS"
  GRADLE_ARGS+=("-PreactNativeArchitectures=$ABIS")
fi
if [[ -n "$WORKERS" ]]; then
  echo "  workers: $WORKERS"
  GRADLE_ARGS+=("--no-parallel" "--max-workers=$WORKERS")
fi
( cd android && ./gradlew "${GRADLE_ARGS[@]}" )

VERSION=$(node -p "require('./app.json').expo.version"); CODE=$(node -p "require('./app.json').expo.android.versionCode")
mkdir -p dist; OUT="dist/intranet-${VERSION}-${CODE}.${EXT}"; cp $OUT_GLOB "$OUT"

# Verify what actually signed it — never trust the patch silently.
#
# APKs and AABs need different tools. Gradle signs APKs with the v2/v3 schemes and no
# v1 JAR signature, so `keytool -printcert -jarfile` prints NOTHING for them — which would
# make a naive "grep for CN=Android Debug" pass silently on an unverified artifact. Use
# apksigner for APKs (reads v2/v3) and keytool for AABs (which are JAR-signed).
echo "▶ verifying signature"
if [[ "$EXT" == "apk" ]]; then
  # Pick the newest build-tools: the oldest installed versions predate apksigner entirely,
  # and a bare glob would run one of those and silently produce nothing.
  APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)
  [[ -x "$APKSIGNER" ]] || { echo "✖ apksigner not found under $ANDROID_HOME/build-tools"; exit 1; }
  SIGNER=$("$APKSIGNER" verify --print-certs "$OUT" 2>/dev/null \
           | grep -m1 "Signer #1 certificate DN:" || true)
else
  SIGNER=$("${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}/bin/keytool" -printcert -jarfile "$OUT" 2>/dev/null \
           | grep -m1 "Owner:" || true)
fi
[[ -z "$SIGNER" ]] && { echo "✖ could not read the signing certificate from $OUT — refusing to call it verified."; exit 1; }
echo "  $SIGNER"
if [[ -n "${INTRANET_KEYSTORE:-}" ]]; then
  if grep -q "CN=Android Debug" <<<"$SIGNER"; then
    echo "✖ artifact is DEBUG-signed despite INTRANET_KEYSTORE being set — Play would reject this."; exit 1
  fi
  echo "  ✓ signed with the upload key"
else
  grep -q "CN=Android Debug" <<<"$SIGNER" && echo "  (debug-signed, as expected for sideloading)"
fi

echo "✅ $OUT"
if [[ "$EXT" == "apk" ]]; then
  echo "   Install on a phone: adb install -r $OUT   (or AirDrop/email the file and open it)"
else
  echo "   Upload to Play Console → Testing → Internal testing → Create new release."
fi
