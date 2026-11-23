# Releasing the mobile app (TestFlight / Play)

Builds are per instance: identifiers and branding come from `instances/<name>/` (see
`instances/README.md`). Commands below use `acme` as the instance name.

## Version

Bump before every upload, in `instances/acme/instance.json` (Apple and Google reject a reused
build number):

- `version`: marketing version, e.g. `1.0.0`
- `buildNumber` (iOS) and `versionCode` (Android): integers, always increase

The build scripts run `expo prebuild` from that file every time, so there is nothing else to edit.

## iOS 27: UIScene life cycle (required, do not remove)

Apps built with Xcode 27 abort at launch on iOS 27 unless they adopt UIKit scenes
(`EXC_BREAKPOINT` in `___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`).
On Expo SDK 57 `plugins/with-uiscene-lifecycle.js` handles it (listed first in `app.json` →
`plugins`; needs `expo` ≥ 57.0.23):

- `AppDelegate.swift` conforms to `ExpoReactNativeFactoryProvider` and no longer creates the
  window or calls `startReactNative` (the scene delegate does).
- `Info.plist` has a `UIApplicationSceneManifest` → `EXExpoAppSceneDelegate`.

`npx expo prebuild` applies it. A manifest without the delegate change doesn't crash, but it
renders a black screen. Verify native changes on the **iOS 27 simulator**
(`xcrun simctl list runtimes`), not only on 26.x, before uploading. On Expo SDK 58+ delete the
plugin (SDK 58 adopts scenes natively and the plugin refuses to run).

## iOS

```bash
./scripts/build-ios.sh acme            # prebuild + archive → dist/<slug>-<version>-<build>.xcarchive
./scripts/build-ios.sh acme --upload   # … and upload to App Store Connect
```

This needs Xcode signed in to the instance's Apple Developer team (Xcode → Settings → Accounts),
and an app record for the bundle ID in App Store Connect.

The script wraps the command-line equivalent of Xcode's Archive → Distribute App flow. If you
prefer the GUI: `OWTRANET_INSTANCE=acme npx expo prebuild --platform ios`, then open
`ios/<AppName>.xcworkspace`, choose **Any iOS Device** → Product → **Archive** → Distribute App →
App Store Connect. `expo prebuild` resets the Run scheme to Debug, and a Debug build on a phone
shows "No script URL provided". Archives are always Release.

Export gotcha: Xcode's IPA packaging spawns `rsync -E` found via `PATH`. Homebrew's rsync
rejects `-E` and the export dies with `error: exportArchive Copy failed`. The script runs the
export with a system-only `PATH`, which uses `/usr/bin/rsync`.

### After the upload

- **"Upload Symbols Failed"** for `React.framework`, `ReactNativeDependencies.framework`,
  `hermesvm.framework` or WebRTC is a warning, not a failure: those frameworks ship without
  dSYMs.
- Apple emails "… has completed processing" a few minutes later.
- `ITSAppUsesNonExemptEncryption=false` is set in `app.json`, so the export-compliance question
  is skipped.
- TestFlight → add the build to an internal group (App Store Connect users, no review) or an
  external group (email invite; Apple reviews the first build, about a day).

## Android

```bash
OWTRANET_INSTANCE=acme ./scripts/build-android-apk.sh          # sideloadable APK
OWTRANET_INSTANCE=acme ./scripts/build-android-apk.sh --aab    # Play bundle (needs the upload keystore)
```

Prerequisites and signing are in the script header.

## What to test

- Sign in with email + password, or "Email me a one-time code".
- Home: badges, latest posts, pending agreements, quick links.
- Forum: browse, search, open a post, reply, vote, create a post with an attachment and a
  visibility setting.
- Radio: press play; it reads a greeting, then the newest stories, and loops. Lock the phone and
  check it keeps playing.
- Messages: DMs and group chat, send and receive.
- More: Members, Documents, Agreements (sign one), Expenses (snap a receipt → fields filled →
  submit), Investment tracker, Notifications, Profile.
- Call AI (if the instance has a voice agent): allow the microphone, talk, mute, hang up; check
  the audio continues with the screen locked.
- Share sheet: in Safari, tap Share → the app → post to the forum or send as a DM.
- Universal links: tap `https://<domain>/group-chat/General` in Messages/Notes. It should open
  the native screen.
- Push: background the app and have someone DM you. The banner arrives within ~20 s; tapping it
  opens the conversation.
