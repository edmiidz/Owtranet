/**
 * Instance plugins.
 *
 * A deployment keeps its own code outside this repository in an instance
 * directory (`INSTANCE_DIR`, see docs/PLUGINS.md). Every `plugins/*.js` file in
 * it is loaded at startup, in filename order, and handed a context with the
 * Express router, database pool, auth middleware and agent responder, so an
 * organisation can add routes, workers and integrations without forking core.
 *
 * INSTANCE_DIR unset (or no plugins/ folder) = nothing is loaded and the server
 * behaves exactly as before.
 *
 * A plugin that fails to load or register is logged and skipped so one bad
 * plugin cannot take the intranet down; set PLUGINS_STRICT=1 to make any
 * failure abort startup instead.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

function instanceDir() {
  const dir = process.env.INSTANCE_DIR;
  return dir ? path.resolve(dir) : null;
}

// `$INSTANCE_DIR/public` when it exists — served ahead of client/dist so an
// instance can override or add static assets (agent avatars, logos, …).
function instancePublicDir() {
  const dir = instanceDir();
  if (!dir) return null;
  const pub = path.join(dir, 'public');
  return fs.existsSync(pub) && fs.statSync(pub).isDirectory() ? pub : null;
}

function pluginFiles(dir) {
  const pluginsDir = path.join(dir, 'plugins');
  if (!fs.existsSync(pluginsDir)) return [];
  return fs.readdirSync(pluginsDir)
    .filter(f => f.endsWith('.js') && !f.startsWith('.') && !f.startsWith('_'))
    .sort()
    .map(f => path.join(pluginsDir, f));
}

function makeLogger(name) {
  const prefix = `[plugin:${name}]`;
  return {
    info: (...a) => console.log(prefix, ...a),
    warn: (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a)
  };
}

/**
 * Create the router plugins mount their routes on. server.js mounts it right
 * before the SPA catch-all at module load; plugins register later (after the
 * database is up) and their routes still resolve ahead of the catch-all.
 */
function createPluginRouter() {
  return express.Router();
}

/**
 * Load and register every plugin.
 * @param {object} base  { router, app, db, auth, agentResponder, config }
 * @returns {Promise<Array<{name: string, file: string, ok: boolean, error?: string}>>}
 */
async function loadPlugins(base, { dir = instanceDir(), strict = process.env.PLUGINS_STRICT === '1' } = {}) {
  const results = [];
  if (!dir) return results;

  for (const file of pluginFiles(dir)) {
    let name = path.basename(file, '.js');
    try {
      const mod = require(file);
      const register = typeof mod === 'function' ? mod : mod && mod.register;
      if (mod && typeof mod.name === 'string' && typeof mod !== 'function') name = mod.name;
      if (typeof register !== 'function') {
        throw new Error('module must export register(ctx) or { name, register }');
      }
      await register({ ...base, instanceDir: dir, log: makeLogger(name) });
      results.push({ name, file, ok: true });
      console.log(`Plugin loaded: ${name}`);
    } catch (error) {
      results.push({ name, file, ok: false, error: error.message });
      if (strict) {
        throw new Error(`Plugin ${name} (${file}) failed: ${error.message}`);
      }
      console.error(`Plugin ${name} (${file}) failed and was skipped:`, error);
    }
  }
  return results;
}

module.exports = { instanceDir, instancePublicDir, createPluginRouter, loadPlugins };
