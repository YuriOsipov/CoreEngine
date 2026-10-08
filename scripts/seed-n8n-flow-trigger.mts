/**
 * Seed an http flow trigger that forwards CRM actions to n8n.
 *
 * Requires N8N_WEBHOOK_URL in env (optional N8N_WEBHOOK_SECRET is injected
 * at runtime by the BFF http handler — do not bake secrets into DB config).
 *
 * Usage (repo root):
 *   npm run registry:seed-n8n-flow-trigger
 *   npm run registry:seed-n8n-flow-trigger -- --dry-run
 *   npm run registry:seed-n8n-flow-trigger -- --key=visit-to-n8n --entity=visit
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { n8nWebhookUrl } from '../crm-bff/src/flows/flowAuth.ts'

const dryRun = process.argv.includes('--dry-run')

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1).trim() || null : null
}

const FLOW_KEY = argValue('--key') || 'n8n-webhook'
const ENTITY = argValue('--entity') || 'visit'
const ACTION_ID = `act_${FLOW_KEY.replace(/[^a-zA-Z0-9_]/g, '_')}`
const webhookUrl = n8nWebhookUrl()

if (!webhookUrl) {
  console.error(
    'N8N_WEBHOOK_URL is required (e.g. https://n8n.example/webhook/crm-flow)',
  )
  await pool.end()
  process.exit(1)
}

const config = {
  url: webhookUrl,
  method: 'POST',
  headers: {
    Accept: 'application/json',
  },
}

if (!dryRun) {
  await query(
    `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
     VALUES ($1, 'http', true, $2, $3::jsonb)
     ON CONFLICT (key) DO UPDATE SET
       handler = EXCLUDED.handler,
       enabled = true,
       description = EXCLUDED.description,
       config = EXCLUDED.config,
       updated_at = now()`,
    [
      FLOW_KEY,
      `Forward payload to n8n webhook (${webhookUrl})`,
      JSON.stringify(config),
    ],
  )
}
console.log(`${dryRun ? 'dry-run' : 'upsert '} flow ${FLOW_KEY} → ${webhookUrl}`)

const rows = await query<{
  id: string
  payload: Record<string, unknown>
}>(
  `SELECT id::text AS id, payload
   FROM public.layout_settings
   WHERE entity_api_name = $1 AND group_key = 'entity'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1`,
  [ENTITY],
)

const row = rows[0]
if (!row) {
  console.warn(
    `No ${ENTITY}/entity layout_settings row — flow trigger seeded; add a Form Builder action manually (webhook=${FLOW_KEY}).`,
  )
  await pool.end()
  process.exit(0)
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
  name: 'send_to_n8n',
  label: 'Send to n8n',
  displayType: 'detailButton',
  behavior: 'flow',
  flow: {
    method: 'POST',
    webhook: FLOW_KEY,
    confirmBeforeRun: true,
    successMessage: 'Sent to n8n.',
    refreshRecordAfterRun: false,
  },
  payload: {
    includeCollection: true,
    includeRecordId: true,
    includeRecord: true,
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
      entity: ENTITY,
      layoutId: row.id,
      actionCount: actions.length,
      note: 'Outbound X-CRM-Flow-Secret comes from N8N_WEBHOOK_SECRET at runtime',
    },
    null,
    2,
  ),
)

await pool.end()
