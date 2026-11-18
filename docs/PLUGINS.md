# Instance plugins

Owtranet is the shared upstream. A deployment that needs its own features,
integrations or assets keeps them in an **instance directory** outside this
repository and points `INSTANCE_DIR` at it. Core code is never edited per
deployment; if a plugin needs something core does not expose, add the
extension point here upstream.

## Recommended layout

Keep each deployment in its own private repository, with Owtranet pinned as a
git submodule:

```
my-intranet/                 (private)
├── owtranet/                git submodule → Owtranet, pinned commit
├── instance/
│   ├── plugins/             *.js, loaded in filename order
│   ├── public/              static files served ahead of client/dist
│   └── …                    env template, PM2 config, seeds, org docs
└── deploy.sh                wraps owtranet/deploy.sh
```

With `INSTANCE_DIR=/path/to/my-intranet/instance` in `.env`. Leaving
`INSTANCE_DIR` unset loads nothing; behaviour is unchanged.

## Writing a plugin

A plugin is a CommonJS module exporting either `register(ctx)` or
`{ name, register }`. `register` may be async.

```js
module.exports = {
  name: 'hello',
  register({ router, auth, config, log }) {
    router.get('/api/plugins/hello', auth.authenticateToken, (req, res) => {
      res.json({ message: `Hello from ${config.COMPANY_NAME}` });
    });
  }
};
```

See `examples/instance/plugins/hello.js`.

### `ctx`

| Field | What it is |
|---|---|
| `router` | Express router mounted after the built-in API routes and **before** the SPA catch-all. Put routes here. |
| `app` | The Express app, for anything a router can't do. Routes added to `app` land *after* the catch-all and will not be reached. |
| `db` | The mysql2 pool (`execute`, `query`). Raw SQL, parameterised. |
| `auth` | `{ authenticateToken, authenticateApiToken, requireAdmin }` — the same middleware core uses. |
| `agentResponder` | The AI agent responder (`handleMentions`, `handleDirectMessage`, `handleGroupMention`). |
| `config` | `COMPANY_NAME`, `COMPANY_SHORT_NAME`, `COMPANY_EMAIL_DOMAIN`, `SITE_NAME`, `SITE_TEAM`, `BASE_URL`, `BASE_CURRENCY`, `MAIL_SYSTEM_ADDRESS`, `PORT`. |
| `helpers` | `{ markdownToHtml }`. |
| `instanceDir` | Absolute path of `INSTANCE_DIR`, for reading the plugin's own files. |
| `log` | `info` / `warn` / `error`, prefixed with `[plugin:<name>]`. |

Plugins can also read their own settings from `process.env`; document them in
the instance's env template, not in this repository's `.env.example`.

## Load order and timing

- Files in `$INSTANCE_DIR/plugins/` ending in `.js` load in sorted filename
  order. Names starting with `_` or `.` are skipped, so helpers can live
  alongside (`_shared.js`). Prefix with numbers (`10-…`, `20-…`) when order matters.
- Plugins register in `startServer()`, after the database connects and before
  the server starts listening.
- Background work (timers, pollers) is fine to start from `register`; standalone
  daemons belong in the instance's PM2 config instead.

## Failure behaviour

A plugin that throws while loading or registering is logged and skipped; the
intranet still starts. Set `PLUGINS_STRICT=1` to make any plugin failure abort
startup instead (recommended once a deployment's plugins are stable, so a broken
deploy fails loudly).

## Static files

If `$INSTANCE_DIR/public` exists it is served before `client/dist`, so a file
there overrides a built one at the same path (e.g. `public/ai-agents/<handle>.svg`
for agent avatars).
