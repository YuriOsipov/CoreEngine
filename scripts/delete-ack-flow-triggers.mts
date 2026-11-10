import { pool, query } from '../crm-bff/src/db/pool.ts'

const rows = await query<{ key: string }>(
  `DELETE FROM public.app_flow_triggers
   WHERE lower(handler) = 'ack'
   RETURNING key`,
)
console.log(
  rows.length
    ? `Deleted ack flows: ${rows.map((r) => r.key).join(', ')}`
    : 'No ack flow rows to delete',
)
await pool.end()
