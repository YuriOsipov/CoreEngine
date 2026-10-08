import pg from 'pg'
import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')

loadEnv({ path: resolve(root, 'supabase/.env') })
loadEnv({ path: resolve(root, '.env') })
loadEnv({ path: resolve(__dirname, '../.env') })

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

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
})

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params)
  return result.rows
}
