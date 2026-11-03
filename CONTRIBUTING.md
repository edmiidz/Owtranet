# Contributing to Owtranet

Thanks for helping. This is the upstream repository: features and fixes for
every Owtranet deployment land here first.

## Ground rules

- **Keep it instance-neutral.** No organisation names, domains, people, IDs or
  credentials in code, docs, seeds or tests. Anything that differs between
  deployments belongs in `.env` (document it in `.env.example`) or in the
  database (admin UI). Use `example.com` and `intranet.example.com` in examples.
- **Never commit secrets.** That includes `.env`, `.deploy.env`, keys, service
  account JSON and real API tokens.
- **Schema changes** add an idempotent migration in `server/migrations/` and
  update `db/schema.sql` in the same PR.
- **Posts must use `server/lib/postVisibility.js`** for any new feature that
  lists posts, so the forum's permission rules apply everywhere.

## Workflow

1. Fork, then branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Check your changes:
   ```bash
   node --check server.js
   cd client && npm run build      # TypeScript + Vite
   cd mobile && npx tsc --noEmit   # if you touched the app
   ```
3. Open a PR describing what changed and how you tested it. Mention any new env
   vars or migrations.

Commit messages follow `type: description` (`feat`, `fix`, `docs`, `refactor`,
`chore`, `test`). If a fix repairs something that used to work, add a
`Regression-Of: <commit>` trailer.

By contributing you agree that your contributions are licensed under the MIT
License.
