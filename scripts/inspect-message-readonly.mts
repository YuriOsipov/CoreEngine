import { query, pool } from '../crm-bff/src/db/pool.ts'

const rows = await query<{
  id: string
  group_key: string
  sub_group: string | null
  name: string | null
  payload: Record<string, unknown>
}>(
  `SELECT id::text AS id,
          group_key,
          sub_group,
          payload->>'name' AS name,
          payload
   FROM public.layout_settings
   WHERE entity_api_name = 'message' AND group_key = 'entity'
   ORDER BY updated_at DESC NULLS LAST`,
)

for (const row of rows) {
  const sections = (row.payload?.sections as Array<Record<string, unknown>>) || []
  const fields: Array<Record<string, unknown>> = []
  for (const section of sections) {
    for (const group of (section.groups as Array<Record<string, unknown>>) || []) {
      for (const field of (group.fields as Array<Record<string, unknown>>) || []) {
        if (['subject', 'email', 'phone'].includes(String(field.field))) {
          fields.push({
            field: field.field,
            id: field.id,
            readonlyIf: field.readonlyIf ?? null,
          })
        }
      }
    }
  }
  console.log(
    JSON.stringify(
      { id: row.id, name: row.name, sub: row.sub_group, fields },
      null,
      2,
    ),
  )
}

await pool.end()
