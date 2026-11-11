import { findOneRecord, updateRecord } from '../adapters/records/facade.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import { writeAuditEntry } from '../audit/auditService.js'
import { query } from '../db/pool.js'
import { assertFieldsEditable, redactRecordForMe } from '../services/fieldSecurity.js'
import { assertMeEntityPermission, resolveAppRoleId } from '../services/rolePermissions.js'
import { outboundHttpFlowHeaders } from './flowAuth.js'
import { applyHttpFlowAuthHeaders } from './httpFlowAuth.js'
import { assertOutboundUrlShape, guardedFlowFetch } from './outboundHttp.js'

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

/**
 * Who is running the flow.
 * - system: server-side callers (record automations, scheduler, service key)
 * - user: JWT caller of POST /flows/trigger — role + entity ACL enforced
 * - anonymous: FLOWS_TRIGGER_REQUIRE_AUTH=false — never allowed to write records
 */
export type FlowInvoker =
  | { kind: 'system' }
  | { kind: 'user'; me: MeUser }
  | { kind: 'anonymous' }

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
  const withAuth = applyHttpFlowAuthHeaders(headers, config.auth)
  let originalOrigin: string
  try {
    originalOrigin = assertOutboundUrlShape(url).origin
  } catch (error) {
    throw new LocalFlowError(400, `Flow "${key}": ${error instanceof Error ? error.message : error}`)
  }

  let upstream: Awaited<ReturnType<typeof guardedFlowFetch>>
  try {
    upstream = await guardedFlowFetch(
      url,
      { method, body: JSON.stringify(payload ?? {}) },
      // Configured auth + secrets never follow a redirect to another origin.
      (destination) =>
        destination.origin === originalOrigin
          ? outboundHttpFlowHeaders(withAuth, destination)
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new LocalFlowError(502, `Flow "${key}" request refused/failed: ${message}`)
  }

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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function isAdmin(me: MeUser): boolean {
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

/**
 * Per-flow gate: `config.allowedRoles` (app_roles id or backend_role_id).
 * Empty/missing → any active user; update_record still needs entity update ACL.
 */
async function assertFlowRoleAllowed(
  key: string,
  config: Record<string, unknown>,
  me: MeUser,
): Promise<void> {
  if (isAdmin(me)) return
  const allowed = stringList(config.allowedRoles)
  if (!allowed.length) return
  const roleRef = String(me.roleId || '').trim()
  const appRoleId = await resolveAppRoleId(roleRef)
  if (allowed.includes(roleRef) || (appRoleId && allowed.includes(appRoleId))) return
  throw new LocalFlowError(403, `Permission denied: flow "${key}"`)
}

/**
 * Patch a business record. Target comes from config and/or action payload
 * (`collection` / `recordId`). Patch fields: `config.patch` merged with
 * `payload.data` / `payload.patch` (payload wins on key clash).
 * For user callers, payload patch keys must be listed in `config.allowedFields`
 * (config.patch is admin-authored and always applied).
 */
async function runUpdateRecordHandler(
  key: string,
  config: Record<string, unknown>,
  payload: unknown,
  invoker: FlowInvoker,
): Promise<unknown> {
  if (invoker.kind === 'anonymous') {
    throw new LocalFlowError(401, `Flow "${key}" update_record requires authentication`)
  }
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

  if (invoker.kind === 'user') {
    const allowedFields = new Set(stringList(config.allowedFields))
    const rejected = Object.keys(payloadPatch).filter((field) => !allowedFields.has(field))
    if (rejected.length) {
      throw new LocalFlowError(
        403,
        `Flow "${key}" does not allow patching: ${rejected.join(', ')} (config.allowedFields)`,
      )
    }
    try {
      await assertMeEntityPermission(invoker.me, collection, 'update')
      await assertFieldsEditable(invoker.me, collection, Object.keys(payloadPatch))
    } catch (error) {
      throw new LocalFlowError(403, error instanceof Error ? error.message : 'Permission denied')
    }
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

  const actorUserId = invoker.kind === 'user' ? invoker.me.id : null
  let before: Record<string, unknown> | null = null
  try {
    before = await findOneRecord(collection, recordId, null)
  } catch {
    before = null
  }
  const updated = await updateRecord(collection, recordId, patch, null, { actorUserId })
  try {
    await writeAuditEntry({
      entityApiName: collection,
      recordId,
      action: 'UPDATE',
      before,
      after: updated,
      userId: actorUserId,
      comment: `flow:${key}`,
    })
  } catch (error) {
    console.warn(`[localFlows] audit write failed for flow "${key}"`, error)
  }
  return {
    collection,
    recordId,
    updated:
      invoker.kind === 'user'
        ? await redactRecordForMe(invoker.me, collection, updated)
        : updated,
  }
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
  invoker: FlowInvoker = { kind: 'system' },
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
      `Flow "${trimmed}" is not registered. Create it in Setup → Flows (handler http|update_record).`,
    )
  }

  if (!trigger.enabled) {
    throw new LocalFlowError(403, `Flow "${trimmed}" is disabled`)
  }

  if (invoker.kind === 'user') {
    await assertFlowRoleAllowed(trimmed, trigger.config ?? {}, invoker.me)
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
    const result = await runUpdateRecordHandler(
      trimmed,
      trigger.config ?? {},
      payload,
      invoker,
    )
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
