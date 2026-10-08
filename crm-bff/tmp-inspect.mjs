import { query } from './src/db/pool.js'

const entity = await query(
  `SELECT id::text AS id, api_name, label, hidden, deleted_at::text AS deleted_at
   FROM public.entities WHERE api_name = 'test'`,
)
console.log('entity', entity)

const fields = await query(
  `SELECT api_name, field_type, is_system, readonly, is_unique, is_indexed,
          options
   FROM public.fields
   WHERE entity_id = $1::uuid
   ORDER BY sort, api_name`,
  [entity[0]?.id],
)
console.log(
  'fields',
  fields.map((f) => ({
    api_name: f.api_name,
    type: f.field_type,
    system: f.is_system,
    unique: f.is_unique,
    indexed: f.is_indexed,
    compute: f.options?.computeMode,
  })),
)

const tables = await query(
  `SELECT 1 AS ok FROM information_schema.tables
   WHERE table_schema = 'crm_schema' AND table_name = 'test'`,
)
console.log('crm_schema.test exists?', tables.length > 0)

process.exit(0)
