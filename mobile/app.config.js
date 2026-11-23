/**
 * Per-instance build configuration.
 *
 * `app.json` holds the neutral Owtranet defaults. To build the app for a specific
 * organisation, create `instances/<name>/instance.json` (gitignored — see
 * instances/README.md) and set OWTRANET_INSTANCE=<name> when running Expo:
 *
 *   OWTRANET_INSTANCE=acme npx expo prebuild --platform ios --clean
 *   ./scripts/build-ios.sh acme            # prebuild + archive (+ --upload)
 *
 * Without OWTRANET_INSTANCE the defaults in app.json are used unchanged.
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

/**
 * OWTRANET_INSTANCE is either a folder name under instances/ ("acme") or, if it contains
 * a slash, a path to an instance folder kept elsewhere (e.g. in a private instance repo
 * next to INSTANCE_DIR — see ../docs/PLUGINS.md), relative to this directory or absolute.
 */
function resolveInstanceDir(value) {
  if (value.includes('/')) return path.resolve(__dirname, value);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
    throw new Error(`OWTRANET_INSTANCE must be a folder name under instances/ or a path, got "${value}"`);
  }
  return path.join(__dirname, 'instances', value);
}

function loadInstance(value) {
  const dir = resolveInstanceDir(value);
  const file = path.join(dir, 'instance.json');
  if (!fs.existsSync(file)) {
    throw new Error(`OWTRANET_INSTANCE=${value} but ${file} does not exist (copy instances/example/instance.json)`);
  }
  // Expo resolves asset paths against the project root; keep in-repo ones relative.
  const inside = !path.relative(__dirname, dir).startsWith('..');
  const rel = inside ? `./${path.relative(__dirname, dir).split(path.sep).join('/')}` : dir;
  return { dir, rel, inst: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

/** Use instances/<name>/assets/<file> when present, otherwise the default asset. */
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
      defaultWorkspaceUrl: inst.defaultWorkspaceUrl || `https://${domain}`,
      eas: { ...(config.extra && config.extra.eas), projectId: inst.easProjectId || '' },
    },
  };
};
