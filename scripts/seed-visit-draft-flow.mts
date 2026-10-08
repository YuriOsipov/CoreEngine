/**
 * Seed a product-style visit flow: update_record → status=draft.
 * Also attaches a Form Builder action on the visit entity layout
 * (keeps existing "Show payload" ack action).
 *
 * Usage (repo root):
 *   npm run registry:seed-visit-draft-flow
 *   npm run registry:seed-visit-draft-flow -- --dry-run
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'

const dryRun = process.argv.includes('--dry-run')
const FLOW_KEY = 'visit-set-draft'
const ACTION_ID = 'act_visit_set_draft'

if (!dryRun) {
  await query(
    `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
     VALUES ($1, 'update_record', true, $2, $3::jsonb)
     ON CONFLICT (key) DO UPDATE SET
       handler = EXCLUDED.handler,
       enabled = true,
       description = EXCLUDED.description,
       config = EXCLUDED.config,
       updated_at = now()`,
    [
      FLOW_KEY,
      'Set visit system status to draft (local update_record demo)',
      JSON.stringify({ patch: { status: 'draft' } }),
    ],
  )
}
console.log(`${dryRun ? 'dry-run' : 'upsert '} flow ${FLOW_KEY}`)

const rows = await query<{
  id: string
  payload: Record<string, unknown>
}>(
  `SELECT id::text AS id, payload
   FROM public.layout_settings
   WHERE entity_api_name = 'visit' AND group_key = 'entity'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1`,
)

const row = rows[0]
if (!row) {
  console.error('No visit/entity layout_settings row found')
  await pool.end()
  process.exit(1)
}

const payload = { ...row.payload }
const actions = Array.isArray(payload.actions) ? [...payload.actions] : []
const existingIdx = actions.findIndex(
  (entry) =>
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    ((entry as { id?: string }).id === ACTION_ID ||
      (entry as { flow?: { webhook?: string } }).flow?.webhook === FLOW_KEY),
)

const action = {
  id: ACTION_ID,
  name: 'set_draft',
  label: 'Set draft',
  displayType: 'detailButton',
  behavior: 'flow',
  flow: {
    method: 'POST',
    webhook: FLOW_KEY,
    confirmBeforeRun: true,
    successMessage: 'Visit set to draft.',
    refreshRecordAfterRun: true,
  },
  payload: {
    includeCollection: true,
    includeRecordId: true,
    includeRecord: false,
  },
}

if (existingIdx >= 0) {
  actions[existingIdx] = action
  console.log(`${dryRun ? 'dry-run' : 'replace'} layout action ${ACTION_ID}`)
} else {
  actions.push(action)
  console.log(`${dryRun ? 'dry-run' : 'append '} layout action ${ACTION_ID}`)
}

payload.actions = actions

if (!dryRun) {
  await query(
    `UPDATE public.layout_settings
     SET payload = $2::jsonb, updated_at = now()
     WHERE id = $1::uuid`,
    [row.id, JSON.stringify(payload)],
  )
}

console.log(
  JSON.stringify(
    {
      dryRun,
      flowKey: FLOW_KEY,
      layoutId: row.id,
      actionCount: actions.length,
    },
    null,
    2,
  ),
)

await pool.end()
