import { updateRecord } from '../adapters/recordsAdapter.js'
import { query } from '../db/pool.js'
import { outboundHttpFlowHeaders } from './flowAuth.js'

export type FlowHandlerKind = 'ack' | 'http' | 'update_record'

export interface FlowTriggerRow {
  key: string
  enabled: boolean
  handler: FlowHandlerKind
  config: Record<string, unknown>
  description: string | null
}

export interface LocalFlowResult {
  ok: true
  backend: 'local'
  key: string
  handler: FlowHandlerKind
  result?: unknown
}

export class LocalFlowError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'LocalFlowError'
  }
}

export async function loadFlowTrigger(key: string): Promise<FlowTriggerRow | null> {
  const rows = await query<FlowTriggerRow>(
    `SELECT key, enabled, handler, COALESCE(config, '{}'::jsonb) AS config, description
     FROM public.app_flow_triggers
     WHERE key = $1
     LIMIT 1`,
    [key],
  )
  return rows[0] ?? null
}

async function runHttpHandler(
  key: string,
  config: Record<string, unknown>,
  payload: unknown,
): Promise<unknown> {
  const url = typeof config.url === 'string' ? config.url.trim() : ''
  if (!url) {
    throw new LocalFlowError(500, `Flow "${key}" http handler missing config.url`)
  }

  const method =
    typeof config.method === 'string' && config.method.trim()
      ? config.method.trim().toUpperCase()
      : 'POST'

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
    for (const [headerKey, value] of Object.entries(config.headers as Record<string, unknown>)) {
      if (typeof value === 'string') headers[headerKey] = value
    }
  }
  const outboundHeaders = outboundHttpFlowHeaders(headers)

  const upstream = await fetch(url, {
    method,
    headers: outboundHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(payload ?? {}),
  })

  const text = await upstream.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!upstream.ok) {
    const message =
      typeof json === 'object' &&
      json &&
      typeof (json as { error?: unknown }).error === 'string'
        ? String((json as { error: string }).error)
        : `Flow "${key}" upstream HTTP ${upstream.status}`
    throw new LocalFlowError(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, message)
  }

  return json ?? { ok: true }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * Patch a business record. Target comes from config and/or action payload
 * (`collection` / `recordId`). Patch fields: `config.patch` merged with
 * `payload.data` / `payload.patch` (payload wins on key clash).
 */
async function runUpdateRecordHandler(
  key: string,
  config: Record<string, unknown>,
  payload: unknown,
): Promise<unknown> {
  const body = asObject(payload)
  const collection =
    (typeof config.collection === 'string' && config.collection.trim()) ||
    (typeof body.collection === 'string' && body.collection.trim()) ||
    ''
  const recordId =
    (typeof config.recordId === 'string' && config.recordId.trim()) ||
    (typeof body.recordId === 'string' && body.recordId.trim()) ||
    (typeof body.id === 'string' && body.id.trim()) ||
    ''

  if (!collection || !recordId) {
    throw new LocalFlowError(
      400,
      `Flow "${key}" update_record requires collection and recordId (config or payload)`,
    )
  }

  const configPatch = asObject(config.patch)
  const payloadPatch = {
    ...asObject(body.patch),
    ...asObject(body.data),
  }
  const patch = { ...configPatch, ...payloadPatch }
  delete patch.id
  delete patch.collection
  delete patch.recordId

  if (!Object.keys(patch).length) {
    throw new LocalFlowError(
      400,
      `Flow "${key}" update_record requires a non-empty patch (config.patch and/or payload.data)`,
    )
  }

  const updated = await updateRecord(collection, recordId, patch)
  return { collection, recordId, updated }
}

/**
 * Built-in keys that work even before migration rows exist.
 */
function builtinTrigger(key: string): FlowTriggerRow | null {
  if (key === 'noop' || key === 'ack') {
    return {
      key,
      enabled: true,
      handler: 'ack',
      config: {},
      description: 'Built-in acknowledge handler',
    }
  }
  return null
}

export async function runLocalFlow(
  key: string,
  payload: unknown,
): Promise<LocalFlowResult> {
  const trimmed = key.trim()
  if (!trimmed) {
    throw new LocalFlowError(400, 'flow trigger key is required')
  }

  let trigger: FlowTriggerRow | null = null
  try {
    trigger = await loadFlowTrigger(trimmed)
  } catch (error) {
    // Table missing before migrate — still allow built-ins.
    const message = error instanceof Error ? error.message : String(error)
    if (!/app_flow_triggers/i.test(message) && !/does not exist/i.test(message)) {
      throw error
    }
  }

  trigger = trigger ?? builtinTrigger(trimmed)
  if (!trigger) {
    throw new LocalFlowError(
      404,
      `Flow "${trimmed}" is not registered. Insert into public.app_flow_triggers (handler ack|http|update_record).`,
    )
  }

  if (!trigger.enabled) {
    throw new LocalFlowError(403, `Flow "${trimmed}" is disabled`)
  }

  if (trigger.handler === 'ack') {
    return {
      ok: true,
      backend: 'local',
      key: trimmed,
      handler: 'ack',
      result: { received: payload ?? {} },
    }
  }

  if (trigger.handler === 'http') {
    const result = await runHttpHandler(trimmed, trigger.config ?? {}, payload)
    return {
      ok: true,
      backend: 'local',
      key: trimmed,
      handler: 'http',
      result,
    }
  }

  if (trigger.handler === 'update_record') {
    const result = await runUpdateRecordHandler(trimmed, trigger.config ?? {}, payload)
    return {
      ok: true,
      backend: 'local',
      key: trimmed,
      handler: 'update_record',
      result,
    }
  }

  throw new LocalFlowError(500, `Flow "${trimmed}" has unsupported handler`)
}
