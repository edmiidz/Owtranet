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
- `expo.extra.defaultWorkspaceUrl`, and `expo.extra.eas.projectId` if you build with EAS
- `teamID` in `ExportOptions.plist` (only used for local `xcodebuild -exportArchive`)

**Android push (FCM):** add your own Firebase project's `google-services.json` to
`mobile/` and set `"googleServicesFile": "./google-services.json"` under
`expo.android` in `app.json`. It is not committed; without it the app builds and runs,
push registration is simply skipped on Android.

The icons in `assets/` are neutral placeholders — replace them with your brand.
