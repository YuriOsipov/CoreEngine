/**
 * Smoke visit-set-draft update_record flow; restores status afterward.
 *
 * Usage: npm run registry:smoke-visit-draft-flow
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { runLocalFlow } from '../crm-bff/src/flows/localFlows.ts'

const FLOW_KEY = 'visit-set-draft'

const rows = await query<{ record_id: string; status: string }>(
  `SELECT record_id, status
   FROM crm_schema.visit
   WHERE status = 'published'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1`,
)
const visit = rows[0]
if (!visit) {
  console.error('No published visit to smoke')
  await pool.end()
  process.exit(1)
}

const result = await runLocalFlow(FLOW_KEY, {
  collection: 'visit',
  recordId: visit.record_id,
})
if (!result.ok || result.handler !== 'update_record') {
  throw new Error(`unexpected result: ${JSON.stringify(result)}`)
}

const after = await query<{ status: string }>(
  `SELECT status FROM crm_schema.visit
   WHERE record_id = $1`,
  [visit.record_id],
)
if (after[0]?.status !== 'draft') {
  throw new Error(`expected draft, got ${after[0]?.status}`)
}
console.log(`ok: ${FLOW_KEY} visit/${visit.record_id} → draft`)

await runLocalFlow(FLOW_KEY, {
  collection: 'visit',
  recordId: visit.record_id,
  data: { status: 'published' },
})
// config.patch always merges status=draft — payload data wins on key clash per localFlows
// Wait - config.patch is merged first, then payload wins. So data.status published should win.
const restored = await query<{ status: string }>(
  `SELECT status FROM crm_schema.visit
   WHERE record_id = $1`,
  [visit.record_id],
)
if (restored[0]?.status !== 'published') {
  // Force restore if handler config forced draft
  await query(
    `UPDATE crm_schema.visit SET status = 'published', updated_at = now()
     WHERE record_id = $1`,
    [visit.record_id],
  )
  console.log('restored via SQL (payload override)')
} else {
  console.log('ok: restored published')
}

console.log(JSON.stringify({ ok: true, visitId: visit.record_id }, null, 2))
await pool.end()
