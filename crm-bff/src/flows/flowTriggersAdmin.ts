/**
 * Admin CRUD for public.app_flow_triggers (Setup → Flows).
 */
import { query } from '../db/pool.js'
import { flowTriggerKeyFromWebhook } from './flowKey.js'
import { sanitizeHttpFlowAuth } from './httpFlowAuth.js'
import { assertOutboundUrlShape } from './outboundHttp.js'
import type { FlowHandlerKind, FlowTriggerRow } from './localFlows.js'

export type FlowTriggerAdminRow = FlowTriggerRow & {
  updatedAt: string
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
  // Product Flows UI only supports http + update_record (ack is internal/smoke only).
  if (token === 'http' || token === 'update_record') {
    return token
  }
  if (token === 'ack') {
    throw new Error(
      'Ack handler is not available in Setup → Flows. Use HTTP or Update record.',
    )
  }
  throw new Error(
    `Unsupported flow handler "${raw}". Use http or update_record.`,
  )
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
): Record<string, unknown> {
  const allowedRoles = sanitizeStringList(config.allowedRoles)
  const access = allowedRoles ? { allowedRoles } : {}
  if (handler === 'http') {
    const url = typeof config.url === 'string' ? config.url.trim() : ''
    if (!url) {
      throw new Error('http flow requires config.url')
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('http flow config.url must be an absolute http(s) URL')
    }
    assertOutboundUrlShape(url)
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
    const auth = sanitizeHttpFlowAuth(config.auth)
    return auth.type === 'none'
      ? { url, method, headers, auth: { type: 'none' }, ...access }
      : { url, method, headers, auth, ...access }
  }

  // update_record — keep collection / recordId / patch / allowedFields if present
  const out: Record<string, unknown> = { ...access }
  const allowedFields = sanitizeStringList(config.allowedFields)
  if (allowedFields) out.allowedFields = allowedFields
  if (typeof config.collection === 'string' && config.collection.trim()) {
    out.collection = config.collection.trim()
  }
  if (typeof config.recordId === 'string' && config.recordId.trim()) {
    out.recordId = config.recordId.trim()
  }
  if (config.patch && typeof config.patch === 'object' && !Array.isArray(config.patch)) {
    out.patch = config.patch
  }
  return out
}

function mapRow(row: Record<string, unknown>): FlowTriggerAdminRow {
  const handlerRaw = String(row.handler || 'http')
    .trim()
    .toLowerCase()
  const handler: FlowHandlerKind =
    handlerRaw === 'update_record'
      ? 'update_record'
      : handlerRaw === 'http'
        ? 'http'
        : handlerRaw === 'ack'
          ? 'ack'
          : 'http'
  return {
    key: String(row.key),
    enabled: row.enabled !== false,
    handler,
    config: asObject(row.config),
    description:
      row.description == null || row.description === ''
        ? null
        : String(row.description),
    updatedAt: row.updated_at
      ? new Date(String(row.updated_at)).toISOString()
      : new Date().toISOString(),
  }
}

export async function listFlowTriggers(): Promise<FlowTriggerAdminRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT key, enabled, handler, COALESCE(config, '{}'::jsonb) AS config,
            description, updated_at
     FROM public.app_flow_triggers
     WHERE lower(handler) <> 'ack'
     ORDER BY key ASC`,
  )
  return rows.map(mapRow)
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
  const config = sanitizeConfig(handler, asObject(input.config))
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
