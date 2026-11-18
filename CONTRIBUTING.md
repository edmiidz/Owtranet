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
  update `db/schema.sql` in the same PR. CI applies new migrations twice to an
  older release's schema (`test/db/upgrade-test.sh`), so a migration that fails
  on re-run, or a `schema.sql` change with no migration, fails the build.
- **Note user-visible changes in `CHANGELOG.md`**, including any upgrade step
  (migration, env var, `npm install`).
- **Posts must use `server/lib/postVisibility.js`** for any new feature that
  lists posts, so the forum's permission rules apply everywhere.

## Issues, milestones and releases

Releases follow [semantic versioning](https://semver.org) and each one is a
GitHub milestone named after its version (`1.1.1`, `1.2.0`, …). There is also a
**Stable release** milestone for work that has to land before Owtranet leaves
pre-release.

- **Every issue gets a milestone** once it's clear when it should ship: bug
  fixes go to the next patch version, features to the next minor version. An
  issue with open decisions stays without a milestone until they're made.
- **`Closes #N` only when the PR fully resolves the issue.** If it is one step
  (a phase, a workaround, an interim policy), write `Refs #N` so the issue stays
  open. If the remaining work is a separate decision, open a new issue for it and
  link the two.
- **Big issues are split into issues that can each be finished**, rather than
  closed and reopened as phases land.
- **Cutting a release**: when the milestone has no open issues or PRs, add its
  section to `CHANGELOG.md` (with upgrade steps) and bump `package.json`
  `version` in one PR. After it merges, tag and publish
  (`gh release create vX.Y.Z --target main`) and close the milestone.

## Workflow

1. Fork, then branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Check your changes:
   ```bash
   node --check server.js
   npm test                        # unit tests
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
