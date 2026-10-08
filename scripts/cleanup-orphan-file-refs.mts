/**
 * Delete orphan file-junction rows whose file_id is missing from public.files.
 *
 * Targets crm_schema.*_files tables (e.g. visit_files).
 * Default is dry-run; pass --apply to hard-delete.
 *
 * Usage:
 *   npm run registry:cleanup-orphan-file-refs
 *   npm run registry:cleanup-orphan-file-refs -- --apply
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { quoteIdent } from '../crm-bff/src/schema/crmStorage.ts'

const apply = process.argv.includes('--apply')

const entities = await query<{ api_name: string }>(
  `SELECT api_name
   FROM public.entities
   WHERE deleted_at IS NULL
     AND backend_target = 'SUPABASE'
     AND api_name LIKE '%\\_files' ESCAPE '\\'
   ORDER BY api_name`,
)

if (!entities.length) {
  console.log('No *_files junction entities in registry.')
  await pool.end()
  process.exit(0)
}

type OrphanRow = {
  entity_api_name: string
  record_id: string
  file_id: string
  parent_id: string | null
}

const orphans: OrphanRow[] = []
const presentEntities: string[] = []

for (const { api_name } of entities) {
  const exists = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`crm_schema.${api_name}`],
  )
  if (!exists[0]?.exists) continue
  presentEntities.push(api_name)

  const table = `crm_schema.${quoteIdent(api_name)}`
  const rows = await query<OrphanRow>(
    `SELECT $1::text AS entity_api_name,
            t.record_id,
            t.data->>'file_id' AS file_id,
            COALESCE(
              t.data->>'visit_id',
              t.data->>'parent_id',
              t.data->>'item_id'
            ) AS parent_id
     FROM ${table} t
     LEFT JOIN public.files f
       ON f.deleted_at IS NULL
      AND (f.id::text = t.data->>'file_id' OR f.backend_file_id = t.data->>'file_id')
     WHERE t.status <> 'archived'
       AND COALESCE(t.data->>'file_id', '') <> ''
       AND f.id IS NULL
     ORDER BY t.record_id`,
    [api_name],
  )
  orphans.push(...rows)
}

if (!presentEntities.length) {
  console.log('No crm_schema.*_files tables found.')
  await pool.end()
  process.exit(0)
}

console.log(
  JSON.stringify(
    {
      mode: apply ? 'apply' : 'dry-run',
      entities: presentEntities,
      orphanCount: orphans.length,
      orphans: orphans.slice(0, 50),
    },
    null,
    2,
  ),
)

if (!orphans.length) {
  console.log('No orphan file junction rows.')
  await pool.end()
  process.exit(0)
}

if (!apply) {
  console.log('Dry-run only. Re-run with --apply to hard-delete these junction rows.')
  await pool.end()
  process.exit(0)
}

let deleted = 0
for (const row of orphans) {
  const table = `crm_schema.${quoteIdent(row.entity_api_name)}`
  const result = await query(
    `DELETE FROM ${table}
     WHERE record_id = $1
     RETURNING record_id`,
    [row.record_id],
  )
  if (result.length) deleted += 1
}

console.log(`Deleted ${deleted} orphan junction row(s).`)
await pool.end()
