# Backup and restore

Take a backup before every upgrade. The upgrade steps themselves are in [`upgrading.md`](./upgrading.md).

Back up three things:

1. **Postgres** — kernel tables (`public.*`) and business data (`crm_schema`). This is the install.
2. **Secrets** — repo-root `.env`, `supabase/.env`, and for the all-in-one stack `docker/supabase/.env`. Store them offline. They are not inside the database dump.
3. **Files** — all-in-one Storage files live in `docker/supabase/volumes/storage` (not in the SQL dump). The lightweight stack has no Storage service. If you run n8n (`--profile automation`), back up the Docker volume `coreengine_n8n` (or n8n’s own DB) separately; the templates in [`n8n/`](./n8n/) are already in git.

Do not copy `docker/supabase/volumes/db/data` or the Docker volume `coreengine_pg` while Postgres is running. Use `pg_dump`.

## Dump

Lightweight (`docker-compose.minimal.yml`), database name `coreengine`:

```bash
docker compose -f docker-compose.minimal.yml exec -T db \
  pg_dump -U postgres -d coreengine -Fc > coreengine-backup.dump
```

All-in-one (root `docker-compose.yml`), database name is often `postgres`, container `supabase-db`:

```bash
docker compose exec -T db \
  pg_dump -U postgres -d postgres -Fc > coreengine-backup.dump
```

Host install (client tools on PATH, same host/port/user as `.env`):

```bash
pg_dump -Fc -f coreengine-backup.dump
```

Confirm the archive lists the migration tracker:

```bash
pg_restore -l coreengine-backup.dump | grep schema_migrations
```

Stop the BFF (and web) before a dump you may need to restore cleanly, so writes are not in flight. A dump of a live database is still consistent for Postgres; stopping the app avoids a restore that is missing the last request.

Also copy `docker/supabase/volumes/storage` when you use the all-in-one file backend. Stop the `storage` service first if you need a quiet copy.

## Restore

Restoring **replaces** the target database. Practice on a scratch database first.

1. Stop BFF and web so nothing is connected.
2. Create an empty database (or drop and recreate the existing one only when you mean to replace it).
3. Restore with `--no-owner` so the dump’s role names do not have to match:

```bash
# Scratch drill (does not touch the live database name):
createdb coreengine_restore_smoke
pg_restore --no-owner --no-privileges -d coreengine_restore_smoke coreengine-backup.dump

# Replace a database you have already dropped and recreated empty:
pg_restore --no-owner --no-privileges -d coreengine coreengine-backup.dump
```

Docker equivalent (lightweight), after `createdb` inside the container:

```bash
docker compose -f docker-compose.minimal.yml exec -T db \
  pg_restore --no-owner --no-privileges -U postgres -d coreengine_restore_smoke \
  < coreengine-backup.dump
```

4. Point `.env` at that database if the name changed, then start the BFF from the **same git revision** the dump was taken on. Kernel migrations are forward-only: new code against an old dump is an upgrade ([`upgrading.md`](./upgrading.md)); old code against a newer dump is not supported.
5. `GET /health`, sign in, open one list and one record.
6. Put `docker/supabase/volumes/storage` back before you start Storage, or file rows in Postgres will point at missing objects.
7. Drop the scratch database when the drill is finished: `dropdb coreengine_restore_smoke`.

`pg_restore` can print “errors ignored” for objects that already exist in a non-empty database. Restore into an **empty** database.

## Check this runbook

On a machine with `pg_dump` and `pg_restore` at least as new as the server (on PATH, or `PG_DUMP` / `PG_RESTORE`, or the newest of `C:\Program Files\PostgreSQL\*\bin` and pgAdmin’s runtime on Windows) against the database in `.env`:

```bash
npm run registry:smoke-backup-restore
```

The script dumps that database, checks `schema_migrations` is in the archive, and — when the role can `CREATE DATABASE` — restores into `coreengine_restore_smoke`, compares migration counts, and drops the scratch database. It does not replace the live database. A role without `CREATEDB` still passes after the archive listing; use a superuser when you want the restore drill.
