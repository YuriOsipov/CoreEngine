import pg from 'pg'
import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// crm-bff/src/db -> repo root (Helix), not crm-bff/
const repoRoot = resolve(__dirname, '../../..')

loadEnv({ path: resolve(repoRoot, '.env') })
// Customer DB settings in supabase/.env must win over defaults / root .env.
loadEnv({ path: resolve(repoRoot, 'supabase/.env'), override: true })
loadEnv({ path: resolve(__dirname, '../../.env') })

const host =
  process.env.POSTGRES_HOST === 'host.docker.internal'
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
