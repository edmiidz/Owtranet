# Owtranet mobile app

Expo (React Native + TypeScript, expo-router) client for the intranet platform.
See `../docs/MOBILE_APP.md` for the full architecture, API and deployment notes.

```bash
npm install
npx expo start          # then press i / a, or scan with Expo Go
npx tsc --noEmit        # type-check
```

Sign in with your intranet email/username + password (or an emailed one-time code).
Tap **Change workspace** on the login screen to point the app at another instance
(e.g. `https://intranet.example.com`).

Structure:

```
app/                     expo-router screens (file = route)
  (auth)/login, agreement
  (app)/(tabs)/          Home · Forum · Radio · Messages · More
  (app)/forum, messages, groups, members, agreements, ledger, investments, …
src/api/                 axios client + typed endpoint wrappers (mirrors client/src/utils/api.ts)
src/stores/              zustand: auth (SecureStore), badges, radio player (expo-speech)
src/components/          small UI kit + markdown renderer
src/lib/                 push registration, formatting, file helpers
```

## Configuring for your own instance

`app.json` ships with placeholder identifiers — change them before building:

- `expo.ios.bundleIdentifier` / `expo.android.package` (default `com.example.owtranet`)
- `expo.ios.associatedDomains` and the Android `intentFilters` host (default
  `intranet.example.com`) — must match the server's `IOS_APP_ID` / `ANDROID_PACKAGE`
  env so the universal-link files it serves line up
- `expo.extra.defaultWorkspaceUrl` (optional — leave empty and the app asks for the community address on first launch), and `expo.extra.eas.projectId` if you build with EAS
- `teamID` in `ExportOptions.plist` (only used for local `xcodebuild -exportArchive`)

**Android push (FCM):** add your own Firebase project's `google-services.json` to
`mobile/` and set `"googleServicesFile": "./google-services.json"` under
`expo.android` in `app.json`. It is not committed; without it the app builds and runs,
push registration is simply skipped on Android.

The icons in `assets/` are neutral placeholders — replace them with your brand.

## Publishing your own build

The project does not publish this app to the stores. To publish or sideload it for your
organisation you need your own bundle ID / package, Apple team, and push credentials
(APNs key on the server, `google-services.json` for Android). You can edit `app.json` as
above, or keep everything in a folder **outside this repository** (for example in your
private instance repo, next to `INSTANCE_DIR`; see `../docs/PLUGINS.md`) and point
`OWTRANET_INSTANCE` at it. `app.config.js` then applies it on top of `app.json`:

```
my-intranet/mobile-instance/
  instance.json          required (below)
  assets/                optional: icon.png, splash-icon.png, favicon.png, notification-icon.png,
                         android-icon-{foreground,background,monochrome}.png
  google-services.json   optional: Firebase config for Android push
```

```json
{
  "name": "Acme Intranet",
  "bundleIdentifier": "com.example.acme.intranet",
  "appleTeamId": "ABCDE12345",
  "domain": "intranet.example.com",
  "version": "1.0.0",
  "buildNumber": 1,
  "versionCode": 1
}
```

| Field | Meaning |
|---|---|
| `name` (required) | App name; also names the Xcode project |
| `bundleIdentifier` (required) | iOS bundle ID; also the Android package unless `androidPackage` is set |
| `domain` (required) | Host for universal links / Android App Links |
| `appleTeamId` | Apple Developer team (needed by `build-ios.sh`) |
| `buildNumber` / `versionCode` | Must increase with every store upload |
| `version`, `slug`, `androidPackage`, `shareExtensionName`, `backgroundColor`, `accentColor`, `easProjectId` | Optional overrides |
| `defaultWorkspaceUrl` | Community preselected at sign-in; leave it out to ask on first launch |

```bash
OWTRANET_INSTANCE=/path/to/mobile-instance npx expo config --type public   # check
./scripts/build-ios.sh /path/to/mobile-instance            # archive → dist/
./scripts/build-ios.sh /path/to/mobile-instance --upload   # … and upload to TestFlight
OWTRANET_INSTANCE=/path/to/mobile-instance ./scripts/build-android-apk.sh
```

Set the server's `IOS_APP_ID` (`<teamId>.<bundleId>`) and `ANDROID_PACKAGE` to match, so
the universal-link files it serves name your app. An app opens web links only for the
domains it was built with; other communities' links still work inside the app but open in
the browser when tapped elsewhere.
