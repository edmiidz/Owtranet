# Upgrading an instance with Claude Code

Paste the prompt below into Claude Code, started in the repository you deploy
your instance from. It works for every common setup:

- a clone of this repository
- an "overlay" repository that pins Owtranet as a git submodule
- Docker Compose
- an older fork with its own history, where it plans a port instead of a merge

It brings the instance to the latest release, applies only the database
migrations your database actually needs, and checks the result.

Read [CHANGELOG.md](../CHANGELOG.md) for what each release changes.

---

```text
Upgrade this Owtranet instance to the latest release of https://github.com/edmiidz/Owtranet.

Context: Owtranet ships releases as git tags (vX.Y.Z) with notes in CHANGELOG.md.
Each release lists its upgrade steps. scripts/check-schema.js compares the
instance database with db/schema.sql and names each migration file the database
still needs. deploy.sh runs that check before restarting and the smoke test after.

1. Work out the setup and the current version. Tell me what you find before
   changing anything:
   - Overlay repo: an `owtranet/` (or similar) git submodule pointing at
     github.com/edmiidz/Owtranet. Current version = the pinned commit. If that commit is not
     in github.com/edmiidz/Owtranet (it may be from a pre-release history), say so; the fix
     is still to move the pin to the latest tag.
   - Clone/fork that tracks github.com/edmiidz/Owtranet: current version = package.json
     "version" and the nearest tag.
   - Docker Compose install: same as a clone; the app runs in the `app`
     container and MySQL in `db`.
   - Divergent fork: its own history, no common ancestor with github.com/edmiidz/Owtranet
     (e.g. forked before the public release). Do NOT merge or overwrite. Skip to
     step 7.
   Latest version = the newest vX.Y.Z tag on github.com/edmiidz/Owtranet.

2. Read CHANGELOG.md on the latest tag. List every "Upgrade steps" item between
   the current and latest versions: migrations, workers to stop first, new or
   changed .env settings, PM2 workers. Show me that list.

3. Before touching the database, take a backup and tell me where it is:
   mysqldump --single-transaction <db> > owtranet-backup-<date>.sql
   (in Docker: docker compose exec -T db sh -c 'mysqldump --single-transaction
   -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' > backup.sql)

4. Update the code to the latest tag, not to an arbitrary main commit:
   - Overlay: check out the tag inside the submodule, commit the new pin
     ("chore: bump Owtranet to vX.Y.Z"). Keep instance files where they are.
   - Clone: fetch tags, then merge or check out the tag. If local commits
     conflict, stop and show me the conflicts.
   - Docker: git pull, then docker compose up -d --build.

5. Bring the database up to date. On the server, in the app directory
   (Docker: docker compose exec -T app node scripts/check-schema.js):
     node scripts/check-schema.js
   - Do anything step 2 says must happen first (e.g. stop a worker).
   - Apply each migration file it names, in the order shown.
   - Re-run until it prints ✅.
   If it lists anything under "Not added by any migration file", stop and ask
   me. Never hand-write DDL to make it pass.

6. Deploy and verify:
   - ./deploy.sh (or the overlay's deploy script, or the Docker rebuild above).
   - Don't use --skip-schema-check or --allow-stale, and don't skip the smoke
     test, to get a deploy through. If something fails, stop and report it.
   - Confirm: the smoke test passed and prints the new version; the server log
     has no "SCHEMA OUT OF DATE"; the site loads and you can sign in.
   - Re-start any worker you stopped, and add new optional settings only if I
     ask for them.

7. Divergent fork only: write a porting plan instead of upgrading.
   - Compare the fork with the latest tag.
   - For each CHANGELOG item since the fork point, say whether the fork already
     has it, needs it, or conflicts with local changes.
   - Propose PRs in this repo, one per item or small group, starting with bug
     fixes and the upgrade tooling (scripts/check-schema.js,
     server/lib/schemaCheck.js, the deploy.sh checks).
   - Don't open them until I agree.

Rules throughout:
- Ask before restarting production or applying migrations unless I have already
  told you to go ahead for this upgrade.
- Never commit or print secrets (.env, keys, tokens).
- Instance-specific settings stay in this instance (.env, database, overlay
  files).
- Generic fixes you find go upstream as a PR to github.com/edmiidz/Owtranet, with no
  instance names, domains or people in them.

Finish with a short report:
- version before → after
- migrations applied
- backup location
- settings or workers changed
- anything that still needs my attention
```

---

**Upgrading by hand?** Follow the same steps in
[README → Upgrading an existing instance](../README.md#upgrading-an-existing-instance).
