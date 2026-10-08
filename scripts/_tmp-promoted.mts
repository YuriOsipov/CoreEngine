import { pool } from '../crm-bff/src/db/pool.ts'
import { resolveRecordRelation, coercePromotedValue } from '../crm-bff/src/schema/crmStorage.ts'
import { query } from '../crm-bff/src/db/pool.ts'

const relation = await resolveRecordRelation('visit')
console.log(
  'promoted:',
  relation.promoted.map((p, i) => `${i}:${p.apiName}:${p.pgType}`).join(' | '),
)

const rows = await query<{ data: Record<string, unknown>; status: string }>(
  `SELECT data, status FROM crm_schema.visit WHERE record_id = '70' LIMIT 1`,
)
const current = rows[0]?.data ?? {}
const merged = { ...current, note: 'test-note' }
delete (merged as { id?: unknown }).id
delete (merged as { status?: unknown }).status

const values = relation.promoted.map((f) => ({
  api: f.apiName,
  raw: merged[f.apiName],
  coerced: coercePromotedValue(f, merged[f.apiName]),
}))
console.log(JSON.stringify(values, null, 2))

// Show FK def
const fks = await query(
  `SELECT pg_get_constraintdef(oid) AS def
   FROM pg_constraint
   WHERE conname = 'fk_visit_facility'`,
)
console.log('fk', fks[0])

await pool.end()
