/**
 * Admin CRUD for public.app_flow_triggers (Setup → External Flows).
 */
import { query } from '../db/pool.js'
import { flowTriggerKeyFromWebhook } from './flowKey.js'
import { flowSyncRequested } from './flowAuth.js'
import {
  clearFlowDispatchSuccesses,
  flowDebugRequested,
} from './flowDispatchLog.js'
import {
  mergeHttpFlowAuth,
  redactHttpFlowAuthForAdmin,
  sealHttpFlowAuth,
} from './httpFlowAuth.js'
import { assertOutboundUrlShape } from './outboundHttp.js'
import type { FlowHandlerKind, FlowTriggerRow } from './localFlows.js'

export type FlowTriggerAdminRow = FlowTriggerRow & {
  updatedAt: string
  /** Latest app_flow_dispatches.started_at for this key (null if never run / table missing). */
  lastLaunchedAt: string | null
}

export interface UpsertFlowTriggerInput {
  /** Existing key when renaming is not supported — always the primary key. */
  key: string
  handler: string
  enabled?: boolean | null
  description?: string | null
  config?: Record<string, unknown> | null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function parseHandler(raw: string): FlowHandlerKind {
  const token = String(raw || '')
    .trim()
    .toLowerCase()
  // Product Flows UI only supports http (ack is internal/smoke only).
  if (token === 'http') {
    return 'http'
  }
  if (token === 'ack') {
    throw new Error(
      'Ack handler is not available in Setup → External Flows. Use HTTP.',
    )
  }
  if (token === 'update_record') {
    throw new Error(
      'Update record handler has been removed. Use HTTP (webhook) and update records from n8n/Activepieces or the API.',
    )
  }
  throw new Error(`Unsupported flow handler "${raw}". Use http.`)
}

function sanitizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
  return list.length ? list : undefined
}

function sanitizeConfig(
  handler: FlowHandlerKind,
  config: Record<string, unknown>,
  existingConfig: Record<string, unknown> = {},
): Record<string, unknown> {
  const allowedRoles = sanitizeStringList(config.allowedRoles)
  const access = allowedRoles ? { allowedRoles } : {}
  if (handler === 'http') {
    const target = String(config.target || '')
      .trim()
      .toLowerCase()
    const methodRaw =
      typeof config.method === 'string' && config.method.trim()
        ? config.method.trim().toUpperCase()
        : 'POST'
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(
      methodRaw,
    )
      ? methodRaw
      : 'POST'
    const headersIn =
      config.headers &&
      typeof config.headers === 'object' &&
      !Array.isArray(config.headers)
        ? (config.headers as Record<string, unknown>)
        : {}
    const headers: Record<string, string> = { Accept: 'application/json' }
    for (const [headerKey, value] of Object.entries(headersIn)) {
      if (typeof value === 'string' && headerKey.trim()) {
        headers[headerKey.trim()] = value
      }
    }

    const sync = flowSyncRequested(config) ? { sync: true as const } : {}
    const debug = flowDebugRequested(config) ? { debug: true as const } : {}

    // Customer's n8n: resolve URL at dispatch from N8N_BASE_URL + ce-{key} (no raw URL in Setup).
    if (target === 'n8n') {
      return {
        target: 'n8n',
        ...sync,
        ...debug,
        method,
        headers,
        auth: { type: 'none' },
        ...access,
      }
    }

    // Customer's Activepieces: resolve from ACTIVEPIECES_BASE_URL + config.flowId.
    if (target === 'activepieces') {
      const flowId = String(config.flowId || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
      if (!flowId || !/^[A-Za-z0-9_-]+$/.test(flowId)) {
        throw new Error(
          'http flow target=activepieces requires config.flowId (Catch Webhook Live URL id)',
        )
      }
      return {
        target: 'activepieces',
        flowId,
        ...sync,
        ...debug,
        method,
        headers,
        auth: { type: 'none' },
        ...access,
      }
    }

    const url = typeof config.url === 'string' ? config.url.trim() : ''
    if (!url) {
      throw new Error(
        'http flow requires config.url, or set config.target to "n8n" or "activepieces"',
      )
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('http flow config.url must be an absolute http(s) URL')
    }
    assertOutboundUrlShape(url)
    const merged = mergeHttpFlowAuth(config.auth, existingConfig.auth)
    const auth = sealHttpFlowAuth(merged)
    return auth.type === 'none'
      ? { url, ...sync, ...debug, method, headers, auth: { type: 'none' }, ...access }
      : { url, ...sync, ...debug, method, headers, auth, ...access }
  }

  return { ...access }
}

function redactConfigForAdmin(config: Record<string, unknown>): Record<string, unknown> {
  if (!('auth' in config)) return config
  return { ...config, auth: redactHttpFlowAuthForAdmin(config.auth) }
}

function mapRow(row: Record<string, unknown>): FlowTriggerAdminRow {
  const handlerRaw = String(row.handler || 'http')
    .trim()
    .toLowerCase()
  // Preserve legacy update_record in list so admins can migrate/delete the row.
  const handler: string =
    handlerRaw === 'http' || handlerRaw === 'ack' || handlerRaw === 'update_record'
      ? handlerRaw
      : 'http'
  return {
    key: String(row.key),
    enabled: row.enabled !== false,
    handler,
    config: redactConfigForAdmin(asObject(row.config)),
    description:
      row.description == null || row.description === ''
        ? null
        : String(row.description),
    updatedAt: row.updated_at
      ? new Date(String(row.updated_at)).toISOString()
      : new Date().toISOString(),
    lastLaunchedAt: row.last_launched_at
      ? new Date(String(row.last_launched_at)).toISOString()
      : null,
  }
}

export async function listFlowTriggers(): Promise<FlowTriggerAdminRow[]> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT t.key, t.enabled, t.handler, COALESCE(t.config, '{}'::jsonb) AS config,
              t.description, t.updated_at,
              d.last_launched_at
       FROM public.app_flow_triggers t
       LEFT JOIN (
         SELECT flow_key, max(started_at) AS last_launched_at
         FROM public.app_flow_dispatches
         GROUP BY flow_key
       ) d ON d.flow_key = t.key
       WHERE lower(t.handler) <> 'ack'
       ORDER BY t.key ASC`,
    )
    return rows.map(mapRow)
  } catch (error) {
    // Dispatches table missing before migrate — still list triggers.
    const message = error instanceof Error ? error.message : String(error)
    if (!/app_flow_dispatches/i.test(message) && !/does not exist/i.test(message)) {
      throw error
    }
    const rows = await query<Record<string, unknown>>(
      `SELECT key, enabled, handler, COALESCE(config, '{}'::jsonb) AS config,
              description, updated_at
       FROM public.app_flow_triggers
       WHERE lower(handler) <> 'ack'
       ORDER BY key ASC`,
    )
    return rows.map(mapRow)
  }
}

export async function upsertFlowTrigger(
  input: UpsertFlowTriggerInput,
): Promise<FlowTriggerAdminRow> {
  const key = flowTriggerKeyFromWebhook(String(input.key || ''))
  if (!key) {
    throw new Error(
      'Flow key is required (e.g. test_hook). Do not paste an external URL as the key.',
    )
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(key)) {
    throw new Error(
      'Flow key must be 1–64 chars: letters, numbers, underscore, hyphen.',
    )
  }

  const handler = parseHandler(input.handler)
  let existingConfig: Record<string, unknown> = {}
  try {
    const existingRows = await query<Record<string, unknown>>(
      `SELECT COALESCE(config, '{}'::jsonb) AS config
       FROM public.app_flow_triggers
       WHERE key = $1
       LIMIT 1`,
      [key],
    )
    existingConfig = asObject(existingRows[0]?.config)
  } catch {
    existingConfig = {}
  }
  const config = sanitizeConfig(handler, asObject(input.config), existingConfig)
  const enabled = input.enabled !== false
  const description =
    typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : null

  await query(
    `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (key) DO UPDATE SET
       handler = EXCLUDED.handler,
       enabled = EXCLUDED.enabled,
       description = EXCLUDED.description,
       config = EXCLUDED.config,
       updated_at = now()`,
    [key, handler, enabled, description, JSON.stringify(config)],
  )

  if (!flowDebugRequested(config)) {
    await clearFlowDispatchSuccesses(key)
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT key, enabled, handler, COALESCE(config, '{}'::jsonb) AS config,
            description, updated_at
     FROM public.app_flow_triggers
     WHERE key = $1
     LIMIT 1`,
    [key],
  )
  const row = rows[0]
  if (!row) throw new Error(`Flow "${key}" was not saved`)
  return mapRow(row)
}

export async function deleteFlowTrigger(key: string): Promise<boolean> {
  const trimmed = flowTriggerKeyFromWebhook(String(key || ''))
  if (!trimmed) return false
  const rows = await query<{ key: string }>(
    `DELETE FROM public.app_flow_triggers
     WHERE key = $1
     RETURNING key`,
    [trimmed],
  )
  return rows.length > 0
}
