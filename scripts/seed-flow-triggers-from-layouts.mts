/**
 * Harvest Form Builder flow webhooks (behavior `flow` / legacy `directusFlow`)
 * from layout_settings and register them in public.app_flow_triggers as local `ack` handlers.
 *
 * Usage (repo root):
 *   npm run registry:seed-flow-triggers
 *   npm run registry:seed-flow-triggers -- --dry-run
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'

const dryRun = process.argv.includes('--dry-run')

/** Same rules as src/core/graphql/flowsProxy.ts flowTriggerKeyFromWebhook */
function flowTriggerKeyFromWebhook(webhook: string): string {
  const trimmed = webhook.trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const match = url.pathname.match(/\/flows\/trigger\/([^/?#]+)/i)
      return match?.[1] ? decodeURIComponent(match[1]) : ''
    } catch {
      return ''
    }
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const match = path.match(/\/flows\/trigger\/([^/?#]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1])

  return trimmed.replace(/^\/+/, '')
}

function collectWebhooks(node: unknown, into: Set<string>): void {
  if (node == null) return
  if (Array.isArray(node)) {
    for (const entry of node) collectWebhooks(entry, into)
    return
  }
  if (typeof node !== 'object') return

  const record = node as Record<string, unknown>
  const flow = record.flow
  if (flow && typeof flow === 'object' && !Array.isArray(flow)) {
    const webhook = (flow as { webhook?: unknown }).webhook
    if (typeof webhook === 'string') {
      const key = flowTriggerKeyFromWebhook(webhook)
      if (key) into.add(key)
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectWebhooks(value, into)
  }
}

const rows = await query<{
  entity_api_name: string
  group_key: string
  payload: unknown
}>(
  `SELECT entity_api_name, group_key, payload
   FROM public.layout_settings
   WHERE payload::text ILIKE '%webhook%'`,
)

const found = new Set<string>()
for (const row of rows) {
  collectWebhooks(row.payload, found)
}

const keys = [...found].sort()
console.log(`layouts_scanned=${rows.length} keys_found=${keys.length}`)
if (keys.length === 0) {
  console.log('No flow webhook keys in layout_settings; nothing to seed.')
  await pool.end()
  process.exit(0)
}

let already = 0
let inserted = 0

for (const key of keys) {
  const existing = await query<{ key: string }>(
    `SELECT key FROM public.app_flow_triggers WHERE key = $1 LIMIT 1`,
    [key],
  )
  if (existing[0]) {
    already += 1
    console.log(`exists  ${key}`)
    continue
  }

  if (dryRun) {
    inserted += 1
    console.log(`dry-run ${key}`)
    continue
  }

  await query(
    `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
     VALUES ($1, 'ack', true, $2, '{}'::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [key, `Seeded from layout_settings (ack stub; replace with http if needed)`],
  )
  inserted += 1
  console.log(`insert  ${key}`)
}

console.log(
  JSON.stringify(
    {
      dryRun,
      keysFound: keys.length,
      alreadyPresent: already,
      insertedOrWouldInsert: inserted,
      keys,
    },
    null,
    2,
  ),
)

await pool.end()
