/**
 * Cross-platform kernel SQL migrate (Node + pg).
 * Used by Docker / Linux; Windows hosts can still use apply-registry-migration.ps1.
 *
 * Usage (repo root):
 *   npm run registry:migrate:node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config as loadEnv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const migrationsDir = resolve(repoRoot, 'supabase/migrations')

loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({ path: resolve(repoRoot, 'supabase/.env'), override: true })

function env(name: string, fallback = ''): string {
  return String(process.env[name] ?? fallback).trim()
}

const hostRaw = env('POSTGRES_HOST', 'localhost')
const host =
  hostRaw === 'host.docker.internal' && !env('RUNNING_IN_DOCKER')
    ? 'localhost'
    : hostRaw
const port = Number(env('POSTGRES_PORT', '5432') || 5432)
const database = env('POSTGRES_DB', 'coreengine')
const user = env('POSTGRES_BOOTSTRAP_USER') || env('POSTGRES_USER') || 'postgres'
const password =
  env('POSTGRES_BOOTSTRAP_PASSWORD') || env('POSTGRES_PASSWORD') || 'postgres'

const connectionString =
  env('DATABASE_URL') ||
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`

const client = new pg.Client({ connectionString })

async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await client.query(sql, params)
  const value = result.rows[0] ? Object.values(result.rows[0])[0] : null
  return value as T | null
}

async function main(): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  if (files.length === 0) {
    throw new Error(`No SQL files in ${migrationsDir}`)
  }

  await client.connect()
  console.log(`Applying ${files.length} migration(s) to ${host}:${port}/${database} as ${user}`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  const trackedCount = Number(
    (await scalar<string>('SELECT COUNT(*)::text FROM public.schema_migrations')) ?? '0',
  )
  const entitiesExist = await scalar<boolean>(
    `SELECT to_regclass('public.entities') IS NOT NULL`,
  )
  let entityCount = 0
  if (entitiesExist) {
    entityCount = Number(
      (await scalar<string>('SELECT COUNT(*)::text FROM public.entities')) ?? '0',
    )
  }

  if (trackedCount === 0 && entityCount > 0) {
    console.log('Recording previously applied migrations (existing database)')
    for (const filename of files) {
      if (filename === '202609180001_pm_task_to_stage.sql') continue
      await client.query(
        `INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
        [filename],
      )
    }
  }

  for (const filename of files) {
    const applied = await scalar<string>(
      `SELECT 1::text FROM public.schema_migrations WHERE filename = $1`,
      [filename],
    )
    if (applied === '1') {
      console.log(`skip ${filename}`)
      continue
    }
    console.log(`-> ${filename}`)
    const sql = readFileSync(resolve(migrationsDir, filename), 'utf8')
    await client.query(sql)
    await client.query(
      `INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [filename],
    )
  }

  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.end().catch(() => undefined)
  })
