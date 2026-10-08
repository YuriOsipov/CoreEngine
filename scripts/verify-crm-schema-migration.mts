/**
 * Post Option-C migration verification (counts + storage flags + FK list).
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { quoteIdent } from '../crm-bff/src/schema/crmStorage.ts'

const left = await query<{ count: string }>(
  `SELECT count(*)::text AS count FROM public.business_records`,
)

const entities = await query<{
  api_name: string
  storage: string | null
}>(
  `SELECT api_name, backend_config->>'storage' AS storage
   FROM public.entities
   WHERE deleted_at IS NULL AND backend_target = 'SUPABASE'
   ORDER BY api_name`,
)

const counts: Record<string, number | 'missing'> = {}
for (const row of entities) {
  const exists = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`crm_schema.${row.api_name}`],
  )
  if (!exists[0]?.exists) {
    counts[row.api_name] = 'missing'
    continue
  }
  const countRows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM crm_schema.${quoteIdent(row.api_name)}`,
  )
  counts[row.api_name] = Number(countRows[0]?.count ?? 0)
}

const fks = await query<{ table_name: string; conname: string }>(
  `SELECT c.conrelid::regclass::text AS table_name, c.conname
   FROM pg_constraint c
   JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE c.contype = 'f' AND n.nspname = 'crm_schema'
   ORDER BY 1, 2`,
)

console.log(
  JSON.stringify(
    {
      business_records_left: Number(left[0]?.count ?? 0),
      supabase_entities: entities.length,
      typed_entities: entities.filter((e) => e.storage === 'typed').length,
      counts,
      foreign_keys: fks,
    },
    null,
    2,
  ),
)

await pool.end()
