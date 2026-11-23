# Mobile app instances

Each organisation that publishes its own build of the app keeps its identifiers
and branding in `instances/<name>/`. Everything here except this README and
`example/` is **gitignored**: bundle IDs, Apple team IDs, icons and
`google-services.json` belong to the instance, not to the codebase.

```
instances/<name>/
  instance.json          identifiers, version, build numbers (copy example/instance.json)
  assets/                optional: any of icon.png, splash-icon.png, favicon.png,
                         notification-icon.png, android-icon-{foreground,background,monochrome}.png
                         (missing files fall back to ../assets/)
  google-services.json   optional: Firebase config for Android push
```

`instance.json` fields:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | App name on the home screen (also names the Xcode project) |
| `bundleIdentifier` | yes | iOS bundle ID; also the Android package unless `androidPackage` is set |
| `domain` | yes | Intranet host for universal links / Android App Links, e.g. `intranet.example.com` |
| `slug` | | Expo slug |
| `androidPackage` | | Android package if it differs from the bundle ID |
| `appleTeamId` | | Apple Developer team ID (signing and export) |
| `defaultWorkspaceUrl` | | Workspace preselected on the login screen (default `https://<domain>`) |
| `version` | | Marketing version, e.g. `1.0.0` |
| `buildNumber` / `versionCode` | | iOS build number / Android version code; must increase with every store upload |
| `shareExtensionName` | | iOS share-sheet label (default `<name> Share`) |
| `backgroundColor`, `accentColor` | | Splash/adaptive-icon background, notification tint |
| `easProjectId` | | Only if you build with EAS |

The server must agree with these identifiers: set `IOS_APP_ID` (`<appleTeamId>.<bundleIdentifier>`)
and `ANDROID_PACKAGE` in the server's `.env` so the universal-link files it serves match.

Build with `OWTRANET_INSTANCE=<name>` set — `../scripts/build-ios.sh <name>` and
`../scripts/build-android-apk.sh` (with `OWTRANET_INSTANCE` exported) do this for you.
Keep a backup of your instance folder somewhere private; it is not in git. Better still, keep
it in your private instance repository (the one `INSTANCE_DIR` points into, see
`../../docs/PLUGINS.md`), e.g. `my-intranet/instance/mobile/`, and pass the path instead of a
name: `OWTRANET_INSTANCE=/path/to/my-intranet/instance/mobile` (relative paths are resolved
from `mobile/`). Any value containing `/` is treated as a path.
