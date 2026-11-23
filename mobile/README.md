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

`app.json` ships with neutral placeholder identifiers (`com.example.owtranet`,
`intranet.example.com`). Don't edit them to publish your own app: put your identifiers
and branding in a gitignored instance folder instead, so one checkout can build several
organisations' apps and the repo never carries anyone's bundle IDs or Firebase config.

```bash
cp -r instances/example instances/acme     # then edit instances/acme/instance.json
# optional: instances/acme/assets/*.png, instances/acme/google-services.json
OWTRANET_INSTANCE=acme npx expo config --type public | head   # check the resolved config
./scripts/build-ios.sh acme --upload                           # TestFlight
OWTRANET_INSTANCE=acme ./scripts/build-android-apk.sh --aab    # Play bundle
```

If your deployment already keeps its customisations in a private instance repository
(`INSTANCE_DIR`, see `../docs/PLUGINS.md`), put the folder there instead, e.g.
`my-intranet/instance/mobile/`, and pass its path: `OWTRANET_INSTANCE=../../my-intranet/instance/mobile`
(any value containing a `/` is taken as a path rather than a name under `instances/`).

`app.config.js` applies the instance on top of `app.json`. Field reference:
`instances/README.md`. Release steps (build numbers, iOS 27 scene life cycle, TestFlight):
`RELEASING.md`.

The server must match: set `IOS_APP_ID` (`<teamId>.<bundleId>`) and `ANDROID_PACKAGE` in
its `.env` so the universal-link files it serves line up with the app.

Without `OWTRANET_INSTANCE` you get the placeholder Owtranet app — fine for development
(`npx expo start`). Its icons in `assets/` are neutral placeholders, and with
`extra.defaultWorkspaceUrl` empty it asks for the community address on first launch. An
instance build preselects `https://<domain>` unless `defaultWorkspaceUrl` says otherwise.
