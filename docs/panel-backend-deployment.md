# Panel backend deployment

The remote panel runs the API through PM2 as `finapi`, with working directory
`/home/container/vendor/finapi` and interpreter
`/home/container/bin/finapi-venv/bin/python`. Backend source is not executed from
the development VPS checkout. Updating an APK does not update this service.

## Existing SQLite installations

The inspected legacy deployment used SQLite with `ENVIRONMENT=production`.
Preserve its database during an application update; do not silently switch to
another database or downgrade the environment to development to bypass guards.
For this deployment only, the environment explicitly sets:

```dotenv
ENVIRONMENT=production
DATABASE_PATH=/home/container/vendor/finapi/bot04.sqlite3
ALLOW_SQLITE_IN_PRODUCTION=1
```

Without that opt-in, production still requires `DATABASE_URL`. With opt-in, the
SQLite path must be absolute and point to an existing file. This avoids creating
a new empty database because of a changed working directory. PostgreSQL remains
the normal production configuration; no data-store migration was performed.

## Update procedure

1. Inspect startup/dependency hooks without exposing environment values. Schedule
   downtime for the whole container if the panel cannot stop only `finapi`.
2. Stop the container gracefully. Archive `vendor/finapi`, including `.env`, source,
   database and any journal/WAL companions. Retain a restricted backup off-panel
   and a panel copy. Validate the snapshot before replacing source.
3. Upload only backend/runtime source and requirements. Preserve the live database
   and credentials. Verify all uploaded source hashes. The runner's dependency
   hook installs changed requirements using the existing virtual environment.
4. Start the container and inspect actual Uvicorn startup logs, not only the panel
   running indicator. Application startup applies the schema migrations.
5. Verify health, protected endpoint registration without credentials, database
   integrity and preservation of existing rows. Never test account deletion on
   a real user just to prove the endpoint exists.

`deployment.json` beside the backend records the deployed source revision and
file hashes; the source directory is a vendored copy and has no `.git` metadata.
Backups and production credentials are never committed to this repository.

## Verified update, 2026-11-10

- Forty-eight backend/dependency files uploaded and hash-verified.
- Dependency marker matches the new requirements; Uvicorn startup completed.
- Public health returned HTTP 200. Account deletion, password change, transaction
  history and recurring endpoints returned HTTP 401 without authentication,
  confirming registration without executing user mutations.
- Production OpenAPI remained hidden (HTTP 404).
- SQLite integrity check passed. Existing user, transaction, category, debt and
  debt-payment row counts matched the stable pre-update backup.
- New account-security, recurring and transaction-audit tables are present.
- Local regression verification used isolated test databases, never the live
  panel database. Real Google authentication and SMTP require their separate
  environment configuration and device/delivery acceptance checks.

## Rollback boundary

Restore application source and the matching pre-migration database together only
while the service is stopped. Restoring a snapshot after users have resumed work
loses subsequent writes; obtain an explicit recovery decision before doing so.
Never overwrite the current database as an automatic error-handling shortcut.
