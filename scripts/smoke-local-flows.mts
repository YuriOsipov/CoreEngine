/**
 * Smoke-test local BFF flow handlers (ack + update_record) against Postgres.
 * Does not require a running BFF HTTP process — calls runLocalFlow directly.
 *
 * Usage (repo root):
 *   npm run registry:smoke-local-flows
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { runLocalFlow } from '../crm-bff/src/flows/localFlows.ts'

const SMOKE_KEY = '_smoke_update_record'
const SMOKE_NOTE = `__flow_smoke_${Date.now()}__`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const ack = await runLocalFlow('ack', { hello: 'world' })
assert(ack.ok && ack.handler === 'ack', 'ack handler failed')
console.log('ok: ack')

const visits = await query<{ record_id: string; note: string | null }>(
  `SELECT record_id, data->>'note' AS note
   FROM crm_schema.visit
   WHERE status = 'published'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1`,
)
const visit = visits[0]
assert(visit?.record_id, 'no published visit row to smoke-test update_record')

const previousNote = visit.note

await query(
  `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
   VALUES ($1, 'update_record', true, 'Ephemeral smoke trigger', '{}'::jsonb)
   ON CONFLICT (key) DO UPDATE SET
     handler = EXCLUDED.handler,
     enabled = true,
     config = EXCLUDED.config,
     updated_at = now()`,
  [SMOKE_KEY],
)

try {
  const updated = await runLocalFlow(SMOKE_KEY, {
    collection: 'visit',
    recordId: visit.record_id,
    data: { note: SMOKE_NOTE },
  })
  assert(updated.ok && updated.handler === 'update_record', 'update_record handler failed')

  const after = await query<{ note: string | null }>(
    `SELECT data->>'note' AS note
     FROM crm_schema.visit
     WHERE record_id = $1
     LIMIT 1`,
    [visit.record_id],
  )
  assert(after[0]?.note === SMOKE_NOTE, `visit note not patched (got ${after[0]?.note})`)
  console.log(`ok: update_record visit/${visit.record_id}`)
} finally {
  await runLocalFlow(SMOKE_KEY, {
    collection: 'visit',
    recordId: visit.record_id,
    data: { note: previousNote },
  }).catch(() => undefined)

  await query(`DELETE FROM public.app_flow_triggers WHERE key = $1`, [SMOKE_KEY])
}

console.log(JSON.stringify({ ok: true, visitId: visit.record_id }, null, 2))
await pool.end()
