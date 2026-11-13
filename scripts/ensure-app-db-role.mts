/**
 * Create / refresh the least-privilege BFF DB role on an existing Postgres
 * (host Supabase / external DB / all-in-one Docker).
 *
 * Connects as the bootstrap role (POSTGRES_BOOTSTRAP_* / postgres), then creates
 * POSTGRES_APP_USER with NOSUPERUSER.
 *
 * Modes:
 * - Bare Postgres (minimal compose): mirrors docker/postgres-init/01-app-role.sh —
 *   owns database + public + crm_schema.
 * - Supabase (role `supabase_admin` present): supabase-safe grants only —
 *   USAGE/CREATE on public, own crm_schema; does NOT steal DB/public ownership.
 *
 * Usage (from crm-bff so `pg` resolves):
 *   npm run registry:ensure-app-role
 *
 * For first-time create on hosts where POSTGRES_BOOTSTRAP_USER is already the
 * app role, pass bootstrap explicitly:
 *   $env:POSTGRES_BOOTSTRAP_USER='postgres'; npm run registry:ensure-app-role
 *
 * Force mode: COREENGINE_APP_ROLE_MODE=supabase|full
 * Superuser: --as-superuser (or POSTGRES_SUPERUSER_PASSWORD when bootstrap is the app role)
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
// Resolve deps from crm-bff whether invoked from host or Docker (/app/scripts).
const require = createRequire(resolve(repoRoot, 'crm-bff/package.json'))
const pg = require('pg') as typeof import('pg')
const { config: loadEnv } = require('dotenv') as typeof import('dotenv')

loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({
  path: resolve(repoRoot, 'supabase/.env'),
  override: process.env.RUNNING_IN_DOCKER !== '1',
})

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
const appUser = env('POSTGRES_APP_USER', 'coreengine_app')
const appPassword =
  env('POSTGRES_APP_PASSWORD') || env('POSTGRES_PASSWORD') || ''

const asSuperuser =
  process.argv.includes('--as-superuser') ||
  ['1', 'true', 'yes'].includes(env('COREENGINE_ENSURE_AS_SUPERUSER').toLowerCase())

let bootstrapUser =
  env('POSTGRES_BOOTSTRAP_USER') || env('POSTGRES_USER') || 'postgres'
let bootstrapPassword =
  env('POSTGRES_BOOTSTRAP_PASSWORD') || env('POSTGRES_PASSWORD') || ''

// All-in-one Docker sets POSTGRES_BOOTSTRAP_* to the app role for the running BFF.
// Prefer an explicit superuser when ensuring the role.
const superPassword =
  env('POSTGRES_SUPERUSER_PASSWORD') || env('POSTGRES_PASSWORD') || ''
const preferSuper =
  asSuperuser || (Boolean(superPassword) && bootstrapUser === appUser)
if (preferSuper) {
  if (!superPassword && asSuperuser) {
    throw new Error(
      '--as-superuser requires POSTGRES_SUPERUSER_PASSWORD (Compose sets this from POSTGRES_PASSWORD)',
    )
  }
  bootstrapUser = env('POSTGRES_SUPERUSER') || 'postgres'
  bootstrapPassword = superPassword || bootstrapPassword
}

if (!appPassword) {
  throw new Error('POSTGRES_APP_PASSWORD (or POSTGRES_PASSWORD) is required')
}
if (!bootstrapPassword) {
  throw new Error(
    'POSTGRES_BOOTSTRAP_PASSWORD (or POSTGRES_SUPERUSER_PASSWORD / POSTGRES_PASSWORD) is required',
  )
}
if (appUser === bootstrapUser || appUser === 'postgres') {
  throw new Error(
    `POSTGRES_APP_USER (${appUser}) must differ from the bootstrap/superuser role`,
  )
}

const appIdent = quoteIdent(appUser)
const dbIdent = quoteIdent(database)

function makeAdminClient(user: string, password: string): InstanceType<typeof pg.Client> {
  return new pg.Client({
    connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
  })
}

async function main(): Promise<void> {
  let admin = makeAdminClient(bootstrapUser, bootstrapPassword)
  await admin.connect()

  // Supabase: `postgres` is not superuser; crm_schema tables are often owned by
  // supabase_admin. Reconnect as supabase_admin so ALTER OWNER / CREATE grants work.
  const bootstrapIsSuper = await admin.query<{ super: boolean }>(
    `SELECT COALESCE(
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
       false
     ) AS super`,
  )
  const hasSupabaseAdmin = await admin.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS exists`,
  )
  if (
    !bootstrapIsSuper.rows[0]?.super &&
    hasSupabaseAdmin.rows[0]?.exists &&
    bootstrapUser !== 'supabase_admin' &&
    superPassword
  ) {
    console.log(
      `  bootstrap ${bootstrapUser} is not superuser — reconnecting as supabase_admin`,
    )
    await admin.end()
    bootstrapUser = 'supabase_admin'
    bootstrapPassword = superPassword
    admin = makeAdminClient(bootstrapUser, bootstrapPassword)
    await admin.connect()
  }

  const bootstrapIdent = quoteIdent(bootstrapUser)

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

  const modeEnv = env('COREENGINE_APP_ROLE_MODE').toLowerCase()
  const supabasePresent = await admin.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS exists`,
  )
  const supabaseSafe =
    modeEnv === 'supabase' ||
    (modeEnv !== 'full' && Boolean(supabasePresent.rows[0]?.exists))

  if (supabaseSafe) {
    console.log('  mode=supabase-safe (will not alter database/public ownership)')
  } else {
    console.log('  mode=full (bare Postgres: own database + public)')
  }

  // Non-superuser bootstraps need membership before ALTER … OWNER TO.
  await admin.query(`GRANT ${appIdent} TO ${bootstrapIdent}`)

  if (!supabaseSafe) {
    await admin.query(`ALTER DATABASE ${dbIdent} OWNER TO ${appIdent}`)
    await admin.query(`ALTER SCHEMA public OWNER TO ${appIdent}`)
    await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
  }

  const crm = await admin.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.schemata WHERE schema_name = 'crm_schema'
     ) AS exists`,
  )
  if (crm.rows[0]?.exists) {
    await admin.query(`ALTER SCHEMA crm_schema OWNER TO ${appIdent}`)
  } else {
    await admin.query(`CREATE SCHEMA crm_schema AUTHORIZATION ${appIdent}`)
  }

  if (!supabaseSafe) {
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
  } else {
    // Supabase images often leave crm_schema tables owned by supabase_admin
    // (not bootstrap). DDL from the app role then fails with
    // "must be owner of table …". Reown anything in crm_schema not already ours.
    await admin.query(
      `DO $reown$
       DECLARE r record;
       BEGIN
         FOR r IN
           SELECT n.nspname, c.relname, c.relkind
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_roles o ON o.oid = c.relowner
           WHERE n.nspname = 'crm_schema'
             AND o.rolname <> '${appUser.replace(/'/g, "''")}'
             AND c.relkind IN ('r','p','v','m','f','S')
         LOOP
           BEGIN
             EXECUTE format(
               'ALTER %s %I.%I OWNER TO %I',
               CASE r.relkind
                 WHEN 'v' THEN 'VIEW'
                 WHEN 'm' THEN 'MATERIALIZED VIEW'
                 WHEN 'f' THEN 'FOREIGN TABLE'
                 WHEN 'S' THEN 'SEQUENCE'
                 ELSE 'TABLE'
               END,
               r.nspname, r.relname, '${appUser.replace(/'/g, "''")}'
             );
           EXCEPTION WHEN OTHERS THEN
             RAISE NOTICE 'skip %.%: %', r.nspname, r.relname, SQLERRM;
           END;
         END LOOP;
       END
       $reown$`,
    )
  }

  await admin.query(`GRANT CONNECT ON DATABASE ${dbIdent} TO ${appIdent}`)
  // CREATE SCHEMA (ddlSync ENSURE_SCHEMA) needs CREATE on the database, not only
  // USAGE/CREATE on existing schemas — otherwise Setup field save fails with
  // "permission denied for database …" when applyDdl is on.
  await admin.query(`GRANT CREATE ON DATABASE ${dbIdent} TO ${appIdent}`)
  await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${appIdent}`)
  if (!supabaseSafe) {
    await admin.query(
      `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${appIdent}`,
    )
    await admin.query(
      `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${appIdent}`,
    )
  }
  // Column defaults / legacy SQL may reference extensions.gen_random_uuid().
  const extensions = await admin.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'
     ) AS exists`,
  )
  if (extensions.rows[0]?.exists) {
    await admin.query(`GRANT USAGE ON SCHEMA extensions TO ${appIdent}`)
    await admin.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO ${appIdent}`,
    )
  }
  await admin.query(`GRANT USAGE, CREATE ON SCHEMA crm_schema TO ${appIdent}`)
  await admin.query(
    `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA crm_schema TO ${appIdent}`,
  )
  await admin.query(
    `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA crm_schema TO ${appIdent}`,
  )

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
