/**
 * Seed vertical pack flow keys that target the customer's n8n (`config.target=n8n`).
 * URLs are resolved at dispatch: `{N8N_BASE_URL}/webhook/ce-{key}`.
 * For sales, also upserts the Message create → dispatch_outbound_message automation.
 *
 * Usage (repo root):
 *   npm run registry:seed-n8n-pack-flows
 *   npm run registry:seed-n8n-pack-flows -- --pack=sales
 *   npm run registry:seed-n8n-pack-flows -- --pack=clinic --dry-run
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { n8nBaseUrl, n8nWebhookPathForKey } from '../crm-bff/src/flows/flowAuth.ts'
import {
  loadEntityAutomations,
  saveEntityAutomations,
  type EntityRecordAutomation,
} from '../crm-bff/src/schema/recordAutomations.ts'

const dryRun = process.argv.includes('--dry-run')

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1).trim() || null : null
}

type PackFlow = {
  key: string
  description: string
  packs: Array<'sales' | 'clinic'>
}

const PACK_FLOWS: PackFlow[] = [
  {
    key: 'dispatch_outbound_message',
    description:
      'Sales Message outbox: create → n8n channel switch → PATCH delivery_status',
    packs: ['sales'],
  },
  {
    key: 'send_quote_pdf',
    description:
      'Sales: generate quote PDF and write message.delivery_status (n8n template send-quote-pdf)',
    packs: ['sales'],
  },
  {
    key: 'send_opportunity_document',
    description:
      'Sales: generate opportunity document via n8n (generate-opportunity-document template)',
    packs: ['sales'],
  },
  {
    key: 'send_appointment_reminder',
    description:
      'Clinic: WhatsApp/email reminder stub; patches appointment.reminder_status',
    packs: ['clinic'],
  },
]

const MESSAGE_OUTBOX_AUTOMATIONS: EntityRecordAutomation[] = [
  {
    id: 'queue_outbound_message',
    name: 'Queue outbound message',
    enabled: true,
    sort: 10,
    triggers: ['create', 'update'],
    logic: 'and',
    conditions: [{ field: 'is_draft', operator: '_neq', value: true }],
    requireChanged: ['is_draft'],
    setFields: { delivery_status: 'queued', attempts: 0, sending_since: '$NULL' },
    actions: [],
  },
  {
    id: 'reset_outbound_attempts',
    name: 'Reset outbound attempts',
    enabled: true,
    sort: 15,
    triggers: ['update'],
    logic: 'and',
    conditions: [{ field: 'delivery_status', operator: '_eq', value: 'queued' }],
    requireChanged: ['delivery_status'],
    setFields: { attempts: 0, sending_since: '$NULL' },
    actions: [],
  },
  {
    id: 'dispatch_outbound_message',
    name: 'Dispatch outbound message',
    enabled: true,
    sort: 20,
    triggers: ['create', 'update'],
    logic: 'and',
    conditions: [
      { field: 'is_draft', operator: '_neq', value: true },
      { field: 'scheduled_send_at', operator: 'empty' },
    ],
    requireChanged: ['is_draft'],
    setFields: {},
    actions: [{ type: 'trigger_flow', flowKey: 'dispatch_outbound_message' }],
  },
]

const pack = (argValue('--pack') || 'all').toLowerCase() as
  | 'sales'
  | 'clinic'
  | 'all'

const selected = PACK_FLOWS.filter(
  (flow) => pack === 'all' || flow.packs.includes(pack as 'sales' | 'clinic'),
)

const base = n8nBaseUrl()
if (!base) {
  console.warn(
    'N8N_BASE_URL is not set — flows will be seeded with target=n8n but dispatch needs N8N_BASE_URL (or N8N_WEBHOOK_URL) at runtime.',
  )
} else {
  console.log(`n8n base: ${base}`)
}

for (const flow of selected) {
  const path = n8nWebhookPathForKey(flow.key)
  const resolved = base ? `${base}/webhook/${path}` : `(set N8N_BASE_URL)/webhook/${path}`
  const config = {
    target: 'n8n',
    method: 'POST',
    headers: { Accept: 'application/json' },
    auth: { type: 'none' },
  }
  if (dryRun) {
    console.log(`dry-run ${flow.key} → ${resolved}`)
    continue
  }
  await query(
    `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
     VALUES ($1, 'http', true, $2, $3::jsonb)
     ON CONFLICT (key) DO UPDATE SET
       handler = EXCLUDED.handler,
       enabled = true,
       description = EXCLUDED.description,
       config = EXCLUDED.config,
       updated_at = now()`,
    [flow.key, flow.description, JSON.stringify(config)],
  )
  console.log(`upsert ${flow.key} → ${resolved}`)
}

if (pack === 'sales' || pack === 'all') {
  if (dryRun) {
    console.log(
      'dry-run message automations queue_outbound_message + dispatch_outbound_message',
    )
    console.log('dry-run scheduled task dispatch-due-messages (every 5 min)')
  } else {
    const existing = await loadEntityAutomations('message')
    const byId = new Map(existing.map((rule) => [rule.id, rule]))
    for (const rule of MESSAGE_OUTBOX_AUTOMATIONS) {
      byId.set(rule.id, rule)
    }
    const merged = [...byId.values()]
    await saveEntityAutomations('message', merged)
    console.log(
      `upsert message automations (${MESSAGE_OUTBOX_AUTOMATIONS.length} pack → ${merged.length} total)`,
    )

    try {
      await query(
        `INSERT INTO public.app_scheduled_tasks (
           id, key, name, job_type, cron, schedule, timezone, enabled, params, description, next_run_at
         ) VALUES (
           gen_random_uuid(),
           'dispatch-due-messages',
           'Dispatch due messages',
           'dispatch_due_messages',
           '*/5 * * * *',
           $1::jsonb,
           'UTC',
           true,
           $2::jsonb,
           'Claim due Message rows and fire dispatch_outbound_message. Reclaims sending rows after staleMinutes and stops after maxAttempts.',
           now()
         )
         ON CONFLICT (key) DO UPDATE SET
           job_type = EXCLUDED.job_type,
           cron = EXCLUDED.cron,
           schedule = EXCLUDED.schedule,
           params = EXCLUDED.params,
           description = EXCLUDED.description,
           enabled = true,
           updated_at = now()`,
        [
          JSON.stringify({
            rules: [
              {
                interval: 'minutes',
                every: 5,
                minute: 0,
                hour: 0,
                weekdays: [1],
                dayOfMonth: 1,
                cron: '',
              },
            ],
          }),
          JSON.stringify({
            collection: 'message',
            connectionKey: 'dispatch_outbound_message',
            limit: 50,
            staleMinutes: 15,
            maxAttempts: 5,
          }),
        ],
      )
      console.log('upsert scheduled task dispatch-due-messages (*/5 * * * *)')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`skip scheduled task seed: ${message}`)
    }
  }
}

await pool.end()
console.log(
  dryRun
    ? `dry-run done (${selected.length} keys for pack=${pack})`
    : `seeded ${selected.length} n8n pack flow(s) for pack=${pack}`,
)
