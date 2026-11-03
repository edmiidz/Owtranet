// Adopt the UIKit scene life cycle on iOS (required by the iOS 27 SDK).
//
// Apps built with Xcode 27 abort at launch on iOS 27 unless they adopt UIScene:
//   EXC_BREAKPOINT in ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
// (TestFlight crash feedback on build 11, 2026-09-20/21). Expo SDK 57 still starts
// React Native from the AppDelegate; the runtime fix (`ExpoAppSceneDelegate` +
// `ExpoReactNativeFactoryProvider`) was backported in expo@57.0.23 (expo/expo#50191)
// and is driven by the opt-in plugin `@config-plugins/expo-uiscene-lifecycle`
// (expo/config-plugins#326). That plugin is not on npm yet, so this is a local port
// of it (MIT, 650 Industries). Remove it — and this file — on Expo SDK 58+, which
// ships the scene life cycle natively.
//
// What it does (mirrors the upstream plugin exactly):
//   1. AppDelegate.swift: conform to ExpoReactNativeFactoryProvider and drop the
//      legacy `window = UIWindow(...)` + `factory.startReactNative(...)` block —
//      the scene delegate now creates the window from the UIWindowScene and starts RN.
//   2. Info.plist: add a UIApplicationSceneManifest pointing at EXExpoAppSceneDelegate.
// A manifest without the delegate change is NOT enough: the app survives but renders black.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const PLUGIN_NAME = 'with-uiscene-lifecycle';
const MINIMUM_EXPO_VERSION = [57, 0, 23];
const ORIGINAL_APP_DELEGATE = 'class AppDelegate: ExpoAppDelegate {';
const SCENE_APP_DELEGATE = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';
const FACTORY_ASSIGNMENT = '    reactNativeFactory = factory';
const PLATFORM_GUARD_OPEN = '#if os(iOS) || os(tvOS)\n';
const PLATFORM_GUARD_CLOSE = '#endif\n';
const LEGACY_STARTUP = `    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
`;

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
      },
    ],
  },
};

function assertSdk57(sdkVersion) {
  // `config.sdkVersion` is the SDK line ("57.0.0"); the backport is gated on the
  // installed `expo` package's patch version, so read that.
  let expoVersion = sdkVersion;
  try {
    expoVersion = require('expo/package.json').version;
  } catch {}
  const parts = String(expoVersion || '').split('.').map(Number);
  const tooOld =
    parts.length < 3 ||
    parts.some(Number.isNaN) ||
    parts[0] < MINIMUM_EXPO_VERSION[0] ||
    (parts[0] === MINIMUM_EXPO_VERSION[0] &&
      (parts[1] < MINIMUM_EXPO_VERSION[1] ||
        (parts[1] === MINIMUM_EXPO_VERSION[1] && parts[2] < MINIMUM_EXPO_VERSION[2])));
  if (tooOld || parts[0] >= 58) {
    throw new Error(
      `${PLUGIN_NAME} supports Expo ${MINIMUM_EXPO_VERSION.join('.')} through SDK 57 only ` +
        `(installed expo ${JSON.stringify(expoVersion ?? 'unknown')}). On SDK 58+ delete this plugin.`
    );
  }
}

function isOwnedManifest(manifest) {
  return JSON.stringify(manifest) === JSON.stringify(SCENE_MANIFEST);
}

function updateAppDelegate(contents, enabled) {
  const isEnabled = contents.includes(SCENE_APP_DELEGATE);
  if (enabled === isEnabled) return contents;

  if (enabled) {
    const startup = `\n${LEGACY_STARTUP}`;
    if (!contents.includes(ORIGINAL_APP_DELEGATE) || !contents.includes(startup)) {
      throw new Error(`${PLUGIN_NAME} requires the standard Expo SDK 57 Swift AppDelegate.`);
    }
    // The SDK 57 template wraps the startup block in `#if os(iOS) || os(tvOS)` … `#endif`;
    // remove the now-empty guard along with it (upstream leaves `#if …#endif` on one line).
    const guarded = `\n${PLATFORM_GUARD_OPEN}${LEGACY_STARTUP}${PLATFORM_GUARD_CLOSE}`;
    if (contents.includes(guarded)) {
      return contents.replace(ORIGINAL_APP_DELEGATE, SCENE_APP_DELEGATE).replace(guarded, '');
    }
    return contents.replace(ORIGINAL_APP_DELEGATE, SCENE_APP_DELEGATE).replace(startup, '');
  }

  // Disable: put the template's guarded startup block back.
  return contents
    .replace(SCENE_APP_DELEGATE, ORIGINAL_APP_DELEGATE)
    .replace(
      `${FACTORY_ASSIGNMENT}\n\n`,
      `${FACTORY_ASSIGNMENT}\n\n${PLATFORM_GUARD_OPEN}${LEGACY_STARTUP}${PLATFORM_GUARD_CLOSE}\n`
    );
}

const withUISceneLifecycle = (config, options) => {
  assertSdk57(config.sdkVersion);
  const enabled = !(options && options.enabled === false);

  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(`${PLUGIN_NAME} requires the standard Expo SDK 57 Swift AppDelegate.`);
    }
    cfg.modResults.contents = updateAppDelegate(cfg.modResults.contents, enabled);
    return cfg;
  });

  return withInfoPlist(config, (cfg) => {
    const manifest = cfg.modResults.UIApplicationSceneManifest;
    if (enabled) {
      if (manifest !== undefined && !isOwnedManifest(manifest)) {
        throw new Error(
          `${PLUGIN_NAME} cannot enable because UIApplicationSceneManifest is already declared by the app.`
        );
      }
      cfg.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    } else if (isOwnedManifest(manifest)) {
      delete cfg.modResults.UIApplicationSceneManifest;
    }
    return cfg;
  });
};

module.exports = withUISceneLifecycle;
