/**
 * Create / refresh the least-privilege BFF DB role on an existing Postgres
 * (host Supabase / external DB). Mirrors docker/postgres-init/01-app-role.sh.
 *
 * Connects as the bootstrap role (POSTGRES_BOOTSTRAP_* / postgres), then creates
 * POSTGRES_APP_USER with NOSUPERUSER and ownership of the target database +
 * public / crm_schema (and app objects still owned by bootstrap).
 *
 * Usage (from crm-bff so `pg` resolves):
 *   npm run registry:ensure-app-role
 *
 * For first-time create on hosts where POSTGRES_BOOTSTRAP_USER is already the
 * app role, pass bootstrap explicitly:
 *   $env:POSTGRES_BOOTSTRAP_USER='postgres'; npm run registry:ensure-app-role
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config as loadEnv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({ path: resolve(repoRoot, 'supabase/.env'), override: true })

function env(name: string, fallback = ''): string {
  return String(process.env[name] ?? fallback).trim()
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`)
  }
  return `"${name}"`
}

const hostRaw = env('POSTGRES_HOST', 'localhost')
const host =
  hostRaw === 'host.docker.internal' && !env('RUNNING_IN_DOCKER')
    ? 'localhost'
    : hostRaw
const port = Number(env('POSTGRES_PORT', '5434') || 5434)
const database = env('POSTGRES_DB', 'kernel')
const bootstrapUser =
  env('POSTGRES_BOOTSTRAP_USER') || env('POSTGRES_USER') || 'postgres'
const bootstrapPassword =
  env('POSTGRES_BOOTSTRAP_PASSWORD') || env('POSTGRES_PASSWORD') || ''
const appUser = env('POSTGRES_APP_USER', 'coreengine_app')
const appPassword =
  env('POSTGRES_APP_PASSWORD') || env('POSTGRES_PASSWORD') || ''

if (!appPassword) {
  throw new Error('POSTGRES_APP_PASSWORD (or POSTGRES_PASSWORD) is required')
}
if (!bootstrapPassword) {
  throw new Error('POSTGRES_BOOTSTRAP_PASSWORD (or POSTGRES_PASSWORD) is required')
}
if (appUser === bootstrapUser || appUser === 'postgres') {
  throw new Error(
    `POSTGRES_APP_USER (${appUser}) must differ from the bootstrap/superuser role`,
  )
}

const appIdent = quoteIdent(appUser)
const dbIdent = quoteIdent(database)
const bootstrapIdent = quoteIdent(bootstrapUser)

const admin = new pg.Client({
  connectionString: `postgresql://${encodeURIComponent(bootstrapUser)}:${encodeURIComponent(bootstrapPassword)}@${host}:${port}/${database}`,
})

async function main(): Promise<void> {
  await admin.connect()
  console.log(
    `Ensuring app role ${appUser} on ${host}:${port}/${database} (bootstrap=${bootstrapUser})`,
  )

  const exists = await admin.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
    [appUser],
  )
  if (!exists.rows[0]?.exists) {
    await admin.query(
      `CREATE ROLE ${appIdent} LOGIN PASSWORD $1
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      [appPassword],
    )
    console.log(`  created role ${appUser}`)
  } else {
    await admin.query(
      `ALTER ROLE ${appIdent} WITH LOGIN PASSWORD $1
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      [appPassword],
    )
    console.log(`  refreshed role ${appUser} (password + flags)`)
  }

  // Non-superuser bootstraps need membership before ALTER … OWNER TO.
  await admin.query(`GRANT ${appIdent} TO ${bootstrapIdent}`)

  await admin.query(`ALTER DATABASE ${dbIdent} OWNER TO ${appIdent}`)
  await admin.query(`ALTER SCHEMA public OWNER TO ${appIdent}`)
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`)

  const crm = await admin.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.schemata WHERE schema_name = 'crm_schema'
     ) AS exists`,
  )
  if (crm.rows[0]?.exists) {
    await admin.query(`ALTER SCHEMA crm_schema OWNER TO ${appIdent}`)
  }

  try {
    await admin.query(`REASSIGN OWNED BY ${bootstrapIdent} TO ${appIdent}`)
  } catch (err) {
    console.warn(
      `  REASSIGN OWNED skipped: ${err instanceof Error ? err.message : err}`,
    )
  }

  // Tables/views first so identity-linked sequences follow; then leftover sequences.
  // Identifiers are validated by quoteIdent(); embed as literals (DO bodies ignore $1 params).
  await admin.query(
    `DO $reown$
     DECLARE r record;
     BEGIN
       FOR r IN
         SELECT n.nspname, c.relname, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles o ON o.oid = c.relowner
         WHERE n.nspname IN ('public', 'crm_schema')
           AND o.rolname = '${bootstrapUser.replace(/'/g, "''")}'
           AND c.relkind IN ('r','p','v','m','f')
       LOOP
         EXECUTE format(
           'ALTER %s %I.%I OWNER TO %I',
           CASE r.relkind
             WHEN 'v' THEN 'VIEW'
             WHEN 'm' THEN 'MATERIALIZED VIEW'
             WHEN 'f' THEN 'FOREIGN TABLE'
             ELSE 'TABLE'
           END,
           r.nspname, r.relname, '${appUser.replace(/'/g, "''")}'
         );
       END LOOP;
       FOR r IN
         SELECT n.nspname, c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles o ON o.oid = c.relowner
         WHERE n.nspname IN ('public', 'crm_schema')
           AND o.rolname = '${bootstrapUser.replace(/'/g, "''")}'
           AND c.relkind = 'S'
       LOOP
         BEGIN
           EXECUTE format(
             'ALTER SEQUENCE %I.%I OWNER TO %I',
             r.nspname, r.relname, '${appUser.replace(/'/g, "''")}'
           );
         EXCEPTION WHEN OTHERS THEN
           RAISE NOTICE 'skip sequence %.%: %', r.nspname, r.relname, SQLERRM;
         END;
       END LOOP;
     END
     $reown$`,
  )

  await admin.query(`GRANT CONNECT ON DATABASE ${dbIdent} TO ${appIdent}`)
  await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${appIdent}`)
  await admin.query(
    `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${appIdent}`,
  )
  await admin.query(
    `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${appIdent}`,
  )
  if (crm.rows[0]?.exists) {
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA crm_schema TO ${appIdent}`)
    await admin.query(
      `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA crm_schema TO ${appIdent}`,
    )
    await admin.query(
      `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA crm_schema TO ${appIdent}`,
    )
  }

  console.log('  ownership + grants applied')
  await admin.end()

  const probe = new pg.Client({
    connectionString: `postgresql://${encodeURIComponent(appUser)}:${encodeURIComponent(appPassword)}@${host}:${port}/${database}`,
  })
  await probe.connect()
  const who = await probe.query<{
    current_user: string
    rolsuper: boolean
  }>(
    `SELECT current_user,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper`,
  )
  await probe.end()
  const row = who.rows[0]
  if (!row || row.current_user !== appUser || row.rolsuper) {
    throw new Error(
      `Probe failed: expected ${appUser} NOSUPERUSER, got ${JSON.stringify(row)}`,
    )
  }
  console.log(`ok: connected as ${row.current_user} (superuser=${row.rolsuper})`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
