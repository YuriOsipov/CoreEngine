import pg from 'pg'
import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// crm-bff/src/db -> repo root (CoreEngine), not crm-bff/
const repoRoot = resolve(__dirname, '../../..')

loadEnv({ path: resolve(repoRoot, '.env') })
// Customer DB settings in supabase/.env must win over defaults / root .env on the host.
// In Docker, compose `environment:` (POSTGRES_HOST=db, …) must not be clobbered by
// a host-oriented supabase/.env (localhost:5434 / kernel).
loadEnv({
  path: resolve(repoRoot, 'supabase/.env'),
  override: process.env.RUNNING_IN_DOCKER !== '1',
})
loadEnv({ path: resolve(__dirname, '../../.env') })

const host =
  process.env.POSTGRES_HOST === 'host.docker.internal' &&
  !process.env.RUNNING_IN_DOCKER
    ? 'localhost'
    : process.env.POSTGRES_HOST || 'localhost'
const port = Number(process.env.POSTGRES_PORT || 5434)
const database = process.env.POSTGRES_DB || 'supabase'
const user = process.env.POSTGRES_BOOTSTRAP_USER || 'postgres'
const password =
  process.env.POSTGRES_BOOTSTRAP_PASSWORD ||
  process.env.POSTGRES_PASSWORD ||
  '1'

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`

export const pool = new pg.Pool({ connectionString })

// One-line boot hint so a wrong DB is obvious in the terminal.
void pool
  .query<{ db: string }>('select current_database() as db')
  .then((r) => {
    console.info(`[crm-bff] postgres database: ${r.rows[0]?.db ?? '?'}`)
  })
  .catch((err) => {
    console.error('[crm-bff] postgres connection failed:', err instanceof Error ? err.message : err)
  })

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params)
  return result.rows
}

type QueryFn = typeof query

/** Run work in a single Postgres transaction (BEGIN / COMMIT / ROLLBACK). */
export async function withTransaction<T>(fn: (query: QueryFn) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  const txQuery: QueryFn = async (text, params) => {
    const result = await client.query(text, params)
    return result.rows
  }
  try {
    await client.query('BEGIN')
    const value = await fn(txQuery)
    await client.query('COMMIT')
    return value
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore rollback errors */
    }
    throw error
  } finally {
    client.release()
  }
}
