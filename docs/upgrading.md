# Upgrading an existing CoreEngine install

Upgrades track **`main`** (or a release tag when one is published). There is no LTS channel yet — see [`SUPPORT.md`](../SUPPORT.md) and [`SECURITY.md`](../SECURITY.md).

## What an upgrade is

For an **already provisioned** database, upgrade means:

1. Back up Postgres, Storage volumes if you use the all-in-one stack, and — if you run n8n — the `coreengine_n8n` volume plus `N8N_ENCRYPTION_KEY`
2. Pull the new code
3. Apply **kernel SQL** with `registry:migrate` / `registry:migrate:node` (idempotent via `public.schema_migrations`)
4. Rebuild / restart BFF (and optional web) containers or processes
5. Optionally re-apply or export domain packs if the release notes say so

**Do not** re-run `platform:provision` on a live customer DB as your default upgrade step. Provision is for **new** databases (JWT secret + migrate + admin password + packs). On an existing install, prefer **migrate-only**, then restart.

## Backup first

Full dump, restore, secrets, Storage, and n8n volume notes: [`backup-restore.md`](./backup-restore.md).

```bash
# Lightweight (docker-compose.minimal.yml) example — adjust names/ports for your .env
docker compose -f docker-compose.minimal.yml exec -T db \
  pg_dump -U postgres -d coreengine -Fc > coreengine-backup.dump
```

Keep a copy of `.env` and `supabase/.env` / `docker/supabase/.env` offline. They are not in the dump.

## Lightweight compose (`docker-compose.minimal.yml`)

```bash
git pull
docker compose -f docker-compose.minimal.yml build bff
docker compose -f docker-compose.minimal.yml run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/apply-registry-migration.mts
docker compose -f docker-compose.minimal.yml up -d bff
# If you use the UI profile:
# docker compose -f docker-compose.minimal.yml --profile ui up -d --build web
```

## All-in-one compose (root `docker-compose.yml`)

```bash
git pull
docker compose build bff
docker compose run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/apply-registry-migration.mts
docker compose up -d bff
```

Vendored Supabase images are pinned under [`docker/supabase/VENDOR.md`](../docker/supabase/VENDOR.md). Bumping that pin is a **separate** ops decision from CoreEngine kernel migrate (read the vendor notes before changing Postgres major versions).

## Local npm install

```bash
git pull
npm install
npm run bff:install
npm run registry:migrate:node   # or: npm run registry:migrate (Windows + psql)
# restart: npm run bff:dev / npm run dev
```

## Domain packs

| Situation | Command |
|-----------|---------|
| Apply a pack onto an existing kernel | `npm run platform:apply-pack -- <id>` |
| Export live Setup back to `supabase/domains/<id>` | `npm run platform:export-pack -- <id>` |

Pack apply is additive registry seed — review pack release notes before re-applying on production. Custom objects you created in Setup are not deleted by migrate; pack re-apply may upsert seeded entities/roles/layouts.

## Custom UI extensions

Keep vertical UI in a **sibling package** and wire it from gitignored `src/extensions/register.local.ts` so CoreEngine upgrades do not overwrite your imports — see [`docs/custom-blocks.md`](custom-blocks.md).

## Deployment notes (proxy, SSO secrets, pooling)

- Behind a TLS-terminating reverse proxy, set **`TRUST_PROXY`** (e.g. `loopback,uniquelocal`) so OIDC cookies get `Secure` from `X-Forwarded-Proto`. Without it, state / id-token cookies are issued without `Secure` even when users hit HTTPS.
- For SSO with `OIDC_CHECK_ON_REFRESH`, set a dedicated **`OIDC_TOKEN_ENCRYPTION_KEY`** in production. Falling back to a hash of `AUTH_JWT_SECRET` couples IdP-token seals to JWT rotation.
- **Advisory locks and pooling.** Scheduled tasks take a session-level `pg_try_advisory_lock` on a checked-out pool client and hold that client until the task run finishes. Point `DATABASE_URL` at Postgres directly (Compose does this) or at a pooler in **session** mode. **PgBouncer in transaction mode breaks these locks:** the server connection is returned after each transaction, so lock and unlock can land on different backends, the mutex does not hold across BFF instances, and a lock can stick on a recycled server session. Supavisor's transaction port does the same — do not send the BFF through it. A held lock also keeps one BFF pool connection for the whole run (node-pg's default pool size is 10). Size that pool and Postgres `max_connections` for API traffic plus in-flight tasks, and leave `TASK_SCHEDULER_ENABLED=true` on only one BFF.

## Prove the migrate is safe to re-run

`npm run registry:smoke-upgrade` runs the node migrate command twice against the database in `.env` / `supabase/.env`, then requires `public.app_flow_dispatches` and `GET /health` (default `http://127.0.0.1:4000/health`, override with `BFF_HEALTH_URL`).

The first pass applies any pending kernel SQL. The second pass must apply nothing. That is the upgrade path in this guide, exercised on the configured database — point `.env` at a copy if you are not ready to migrate production. It does not restore data.

```bash
npm run registry:smoke-upgrade
```

Archive and optional scratch-database restore (needs `pg_dump` / `pg_restore` on PATH):

```bash
npm run registry:smoke-backup-restore
```

## After upgrade smoke checks

1. `GET http://localhost:4000/health`
2. Sign in as admin (or SSO)
3. Open one list + one record detail for a pack object you care about
4. If you use server document generate, run one generate smoke (real PDF uses published `@docengine/pdf-renderer@0.0.105`, or `npm run docengine:use-local`)

## Rollback

1. Stop BFF / web
2. Restore the Postgres dump taken before upgrade
3. Check out the previous git revision / image tag
4. Start services again

Kernel migrations are forward-only in the tracker; rolling back code without restoring the DB can leave schema ahead of the app.
