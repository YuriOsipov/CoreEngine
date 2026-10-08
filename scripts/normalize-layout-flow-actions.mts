/**
 * Persist Form Builder action cutover in layout_settings:
 * - behavior `directusFlow` → `flow`
 * - webhook absolute legacy URLs / `/flows/trigger/{key}` → bare trigger key
 *
 * Usage (repo root):
 *   npm run registry:normalize-layout-flows
 *   npm run registry:normalize-layout-flows -- --dry-run
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'

const dryRun = process.argv.includes('--dry-run')

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

function normalizeActions(actions: unknown): { next: unknown; changed: boolean } {
  if (!Array.isArray(actions)) return { next: actions, changed: false }

  let changed = false
  const next = actions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const action = { ...(entry as Record<string, unknown>) }
    let localChanged = false

    if (action.behavior === 'directusFlow') {
      action.behavior = 'flow'
      localChanged = true
    }

    const flow = action.flow
    if (flow && typeof flow === 'object' && !Array.isArray(flow)) {
      const flowObj = { ...(flow as Record<string, unknown>) }
      const webhook = typeof flowObj.webhook === 'string' ? flowObj.webhook : ''
      const key = flowTriggerKeyFromWebhook(webhook)
      if (key && key !== webhook) {
        flowObj.webhook = key
        action.flow = flowObj
        localChanged = true
      }
    }

    if (localChanged) changed = true
    return action
  })

  return { next, changed }
}

function normalizePayload(payload: unknown): { next: unknown; changed: boolean } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { next: payload, changed: false }
  }

  const root = { ...(payload as Record<string, unknown>) }
  const { next: actions, changed } = normalizeActions(root.actions)
  if (!changed) return { next: payload, changed: false }

  root.actions = actions
  return { next: root, changed: true }
}

const rows = await query<{
  id: string
  entity_api_name: string
  group_key: string
  payload: unknown
}>(
  `SELECT id::text AS id, entity_api_name, group_key, payload
   FROM public.layout_settings
   WHERE payload::text ILIKE '%directusFlow%'
      OR payload::text ILIKE '%/flows/trigger/%'
      OR payload::text ILIKE '%8055/flows%'`,
)

let updated = 0
for (const row of rows) {
  const { next, changed } = normalizePayload(row.payload)
  if (!changed) continue

  console.log(
    `${dryRun ? 'dry-run' : 'update '} ${row.entity_api_name}/${row.group_key} id=${row.id}`,
  )

  if (!dryRun) {
    await query(
      `UPDATE public.layout_settings
       SET payload = $2::jsonb, updated_at = now()
       WHERE id = $1::uuid`,
      [row.id, JSON.stringify(next)],
    )
  }
  updated += 1
}

console.log(
  JSON.stringify(
    {
      dryRun,
      candidates: rows.length,
      updatedOrWouldUpdate: updated,
    },
    null,
    2,
  ),
)

await pool.end()
