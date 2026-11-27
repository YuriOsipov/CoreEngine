import type { MeUser } from '../adapters/usersAdapter.js'
import { query } from '../db/pool.js'
import { resolveAppRoleId } from '../services/rolePermissions.js'
import {
  flowSyncRequested,
  outboundHttpFlowHeaders,
  resolveActivepiecesFlowUrl,
  resolveCustomFlowUrl,
  resolveN8nFlowUrl,
} from './flowAuth.js'
import {
  flowDebugRequested,
  flowDispatchContext,
  recordFlowDispatch,
  truncateFlowRequestBody,
} from './flowDispatchLog.js'
import { binaryFlowContract, isBinaryFlowContentType } from './httpFlowBody.js'
import { applyHttpFlowAuthHeaders } from './httpFlowAuth.js'
import { sanitizeFlowErrorMessage } from './flowErrorSanitize.js'
import { assertOutboundUrlShape, guardedFlowFetch } from './outboundHttp.js'

/** Product Setup supports http only; ack is internal/smoke. */
export type FlowHandlerKind = 'ack' | 'http'

export interface FlowTriggerRow {
  key: string
  enabled: boolean
  /** Runtime may still see legacy `update_record` rows until migrated. */
  handler: FlowHandlerKind | string
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
 * - system: trusted in-process callers (record automations, scheduler)
 * - service: HTTP FLOWS_TRIGGER_SERVICE_KEY
 * - user: JWT caller of POST /flows/trigger — role gate via config.allowedRoles
 * - anonymous: FLOWS_TRIGGER_REQUIRE_AUTH=false
 */
export type FlowInvoker =
  | { kind: 'system' }
  | { kind: 'service' }
  | { kind: 'user'; me: MeUser }
  | { kind: 'anonymous' }

export class LocalFlowError extends Error {
  status: number
  /** Upstream or BFF HTTP status to show in Setup → Runs. */
  httpStatus: number | null
  /** Truncated outbound JSON body (no auth headers). */
  requestBody: string | null

  constructor(
    status: number,
    message: string,
    extras?: { httpStatus?: number | null; requestBody?: string | null },
  ) {
    super(message)
    this.status = status
    this.httpStatus =
      typeof extras?.httpStatus === 'number' && Number.isFinite(extras.httpStatus)
        ? Math.trunc(extras.httpStatus)
        : status
    this.requestBody =
      typeof extras?.requestBody === 'string' && extras.requestBody
        ? extras.requestBody
        : null
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

function resolveHttpFlowUrl(key: string, config: Record<string, unknown>): string {
  const target = String(config.target || '')
    .trim()
    .toLowerCase()
  if (target === 'n8n') {
    try {
      return resolveN8nFlowUrl(key, config)
    } catch (error) {
      throw new LocalFlowError(
        500,
        `Flow "${key}" n8n target: ${error instanceof Error ? error.message : error}`,
      )
    }
  }
  if (target === 'activepieces') {
    try {
      return resolveActivepiecesFlowUrl(config)
    } catch (error) {
      throw new LocalFlowError(
        500,
        `Flow "${key}" activepieces target: ${error instanceof Error ? error.message : error}`,
      )
    }
  }
  const url = typeof config.url === 'string' ? config.url.trim() : ''
  if (!url) {
    throw new LocalFlowError(
      500,
      `Flow "${key}" http handler missing config.url (or set config.target=n8n|activepieces)`,
    )
  }
  return resolveCustomFlowUrl(url, config)
}

async function runHttpHandler(
  key: string,
  config: Record<string, unknown>,
  payload: unknown,
): Promise<unknown> {
  const url = resolveHttpFlowUrl(key, config)
  const requestBody = truncateFlowRequestBody(payload)

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
    throw new LocalFlowError(
      400,
      `Flow "${key}": ${error instanceof Error ? error.message : error}`,
      { httpStatus: 400, requestBody },
    )
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
    const top = error instanceof Error ? error.message : String(error)
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error && typeof error.cause === 'string'
          ? error.cause
          : ''
    const message = cause && cause !== top ? `${top} (${cause})` : top
    throw new LocalFlowError(502, `Flow "${key}" request refused/failed: ${message}`, {
      httpStatus: 502,
      requestBody,
    })
  }

  if (upstream.ok && isBinaryFlowContentType(upstream.headers.get('content-type'))) {
    const bytes = Buffer.from(await upstream.arrayBuffer())
    return binaryFlowContract({
      bytes,
      contentType: upstream.headers.get('content-type'),
      contentDisposition: upstream.headers.get('content-disposition'),
      url,
    })
  }

  const text = await upstream.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!upstream.ok) {
    const upstreamDetail =
      typeof json === 'object' &&
      json &&
      typeof (json as { error?: unknown }).error === 'string'
        ? String((json as { error: string }).error)
        : text.trim().slice(0, 500) || `upstream HTTP ${upstream.status}`
    const httpStatus =
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502
    throw new LocalFlowError(
      httpStatus,
      `HTTP ${upstream.status}: ${upstreamDetail}`,
      { httpStatus: upstream.status, requestBody },
    )
  }

  return json ?? { ok: true }
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
 * Empty/missing → any active user.
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
  const startedAt = new Date()
  const trimmed = key.trim()
  let debug = false
  try {
    const trigger = await resolveFlowTrigger(trimmed)
    debug = flowDebugRequested(trigger.config)
    const result = await executeLocalFlow(trigger, payload, invoker)
    if (debug) {
      const context = flowDispatchContext(payload)
      await recordFlowDispatch({
        flowKey: trimmed || '(missing)',
        source: context.source,
        collection: context.collection,
        recordId: context.recordId,
        status: 'success',
        httpStatus: 200,
        requestBody: truncateFlowRequestBody(payload),
        startedAt,
        finishedAt: new Date(),
        debug: true,
      })
    }
    return result
  } catch (error) {
    const message = sanitizeFlowErrorMessage(
      error instanceof Error ? error.message : String(error),
    )
    const context = flowDispatchContext(payload)
    const flowError = error instanceof LocalFlowError ? error : null
    await recordFlowDispatch({
      flowKey: trimmed || '(missing)',
      source: context.source,
      collection: context.collection,
      recordId: context.recordId,
      status: 'error',
      error: message,
      httpStatus: flowError?.httpStatus ?? flowError?.status ?? null,
      requestBody: flowError?.requestBody ?? truncateFlowRequestBody(payload),
      startedAt,
      finishedAt: new Date(),
      debug,
    })
    throw error
  }
}

async function resolveFlowTrigger(trimmed: string): Promise<FlowTriggerRow> {
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
      `External flow "${trimmed}" is not registered. Create it in Setup → External Flows (handler http).`,
    )
  }
  return trigger
}

async function executeLocalFlow(
  trigger: FlowTriggerRow,
  payload: unknown,
  invoker: FlowInvoker,
): Promise<LocalFlowResult> {
  const trimmed = trigger.key.trim()

  if (!trigger.enabled) {
    throw new LocalFlowError(403, `Flow "${trimmed}" is disabled`)
  }

  if (invoker.kind === 'user') {
    await assertFlowRoleAllowed(trimmed, trigger.config ?? {}, invoker.me)
  }

  const handler = String(trigger.handler || '')
    .trim()
    .toLowerCase()

  if (handler === 'ack') {
    return {
      ok: true,
      backend: 'local',
      key: trimmed,
      handler: 'ack',
      result: { received: payload ?? {} },
    }
  }

  if (handler === 'http') {
    const config = trigger.config ?? {}
    const result = await runHttpHandler(trimmed, config, payload)
    return {
      ok: true,
      backend: 'local',
      key: trimmed,
      handler: 'http',
      ...(flowSyncRequested(config) ? { sync: true } : {}),
      result,
    }
  }

  if (handler === 'update_record') {
    throw new LocalFlowError(
      410,
      `External flow "${trimmed}" uses the removed update_record handler. Edit it in Setup → External Flows and switch to HTTP.`,
    )
  }

  throw new LocalFlowError(500, `Flow "${trimmed}" has unsupported handler`)
}
