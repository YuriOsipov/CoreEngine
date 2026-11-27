import { query } from '../db/pool.js'
import { normalizeMigrationList } from './kernel.js'

export async function readKernelMigrations(): Promise<string[]> {
  const rows = await query<{ filename: string }>(
    `SELECT filename FROM public.schema_migrations ORDER BY filename`,
  )
  return normalizeMigrationList(rows.map((row) => row.filename))
}
