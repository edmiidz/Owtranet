/**
 * Optional per-organisation build configuration.
 *
 * `app.json` holds the neutral placeholder identifiers. An organisation that publishes
 * its own build keeps its identifiers and branding in a folder OUTSIDE this repository
 * (for example in its private instance repo) and points OWTRANET_INSTANCE at it:
 *
 *   OWTRANET_INSTANCE=/path/to/my-intranet/mobile-instance npx expo config --type public
 *   ./scripts/build-ios.sh /path/to/my-intranet/mobile-instance [--upload]
 *
 * The folder holds instance.json (see README.md, "Publishing your own build") and,
 * optionally, assets/*.png and google-services.json. Without OWTRANET_INSTANCE the
 * defaults in app.json are used unchanged.
 */
const fs = require('fs');
const path = require('path');

const ASSET_FILES = {
  icon: 'icon.png',
  splash: 'splash-icon.png',
  favicon: 'favicon.png',
  notification: 'notification-icon.png',
  androidForeground: 'android-icon-foreground.png',
  androidBackground: 'android-icon-background.png',
  androidMonochrome: 'android-icon-monochrome.png',
};

function loadInstance(value) {
  const dir = path.resolve(__dirname, value);
  const file = path.join(dir, 'instance.json');
  if (!fs.existsSync(file)) {
    throw new Error(`OWTRANET_INSTANCE=${value} but ${file} does not exist (see README.md, "Publishing your own build")`);
  }
  // Expo resolves asset paths against the project root; absolute paths work from anywhere.
  return { dir, rel: dir, inst: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

/** Use <instance>/assets/<file> when present, otherwise the default asset. */
function asset(instanceRel, instanceDir, file, fallback) {
  return fs.existsSync(path.join(instanceDir, 'assets', file)) ? `${instanceRel}/assets/${file}` : fallback;
}

function withPluginOptions(plugins, pluginName, patch) {
  return plugins.map((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    if (name !== pluginName) return p;
    const opts = Array.isArray(p) ? p[1] || {} : {};
    return [name, { ...opts, ...patch }];
  });
}

module.exports = ({ config }) => {
  const name = process.env.OWTRANET_INSTANCE;
  if (!name) return config;

  const { dir, rel, inst } = loadInstance(name);
  const required = ['name', 'bundleIdentifier', 'domain'];
  for (const key of required) {
    if (!inst[key]) throw new Error(`${path.join(dir, 'instance.json')} is missing "${key}"`);
  }

  const domain = inst.domain;
  const a = (key, fallback) => asset(rel, dir, ASSET_FILES[key], fallback);

  const ios = {
    ...config.ios,
    bundleIdentifier: inst.bundleIdentifier,
    buildNumber: String(inst.buildNumber ?? config.ios.buildNumber),
    associatedDomains: [`applinks:${domain}`],
  };
  if (inst.appleTeamId) ios.appleTeamId = inst.appleTeamId;

  const android = {
    ...config.android,
    package: inst.androidPackage || inst.bundleIdentifier,
    versionCode: Number(inst.versionCode ?? config.android.versionCode),
    adaptiveIcon: {
      ...config.android.adaptiveIcon,
      foregroundImage: a('androidForeground', config.android.adaptiveIcon.foregroundImage),
      backgroundImage: a('androidBackground', config.android.adaptiveIcon.backgroundImage),
      monochromeImage: a('androidMonochrome', config.android.adaptiveIcon.monochromeImage),
      backgroundColor: inst.backgroundColor || config.android.adaptiveIcon.backgroundColor,
    },
    intentFilters: (config.android.intentFilters || []).map((f) => ({
      ...f,
      data: (f.data || []).map((d) => (d.host ? { ...d, host: domain } : d)),
    })),
  };
  if (fs.existsSync(path.join(dir, 'google-services.json'))) {
    android.googleServicesFile = `${rel}/google-services.json`;
  }

  let plugins = withPluginOptions(config.plugins || [], 'expo-share-intent', {
    iosShareExtensionName: inst.shareExtensionName || `${inst.name} Share`,
  });
  plugins = withPluginOptions(plugins, 'expo-notifications', {
    icon: a('notification', './assets/notification-icon.png'),
    ...(inst.accentColor ? { color: inst.accentColor } : {}),
  });

  return {
    ...config,
    name: inst.name,
    slug: inst.slug || config.slug,
    version: inst.version || config.version,
    icon: a('icon', config.icon),
    splash: {
      ...config.splash,
      image: a('splash', config.splash.image),
      backgroundColor: inst.backgroundColor || config.splash.backgroundColor,
    },
    web: { ...config.web, favicon: a('favicon', config.web.favicon) },
    ios,
    android,
    plugins,
    extra: {
      ...config.extra,
      instance: path.basename(dir),
      // Empty means the app asks for the community address on first launch.
      defaultWorkspaceUrl: inst.defaultWorkspaceUrl ?? (config.extra && config.extra.defaultWorkspaceUrl) ?? '',
      eas: { ...(config.extra && config.extra.eas), projectId: inst.easProjectId || '' },
    },
  };
};
