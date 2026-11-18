import { timingSafeEqual } from 'node:crypto'
import { bearerToken } from '../auth/tokenClaims.js'
import { verifyAccessToken } from '../auth/jwt.js'
import { PASSWORD_CHANGE_REQUIRED, requireAuthenticatedUser } from '../auth/accessGuards.js'
import { readRolePreviewHeader } from '../auth/rolePreview.js'
import type { MeUser } from '../adapters/usersAdapter.js'

/** Outbound + inbound marker so n8n↔BFF loops can be detected. */
export const CRM_AUTOMATION_HEADER = 'x-crm-automation'
export const CRM_FLOW_SECRET_HEADER = 'x-crm-flow-secret'
export const CRM_SOURCE_HEADER = 'x-crm-source'

export type FlowTriggerAuthOk = {
  ok: true
  actorId: string | null
  via: 'jwt' | 'service_key' | 'open'
  /** Set when via === 'jwt' — DB-verified active user. */
  me: MeUser | null
}

export type FlowTriggerAuthFail = {
  ok: false
  status: number
  error: string
}

export type FlowTriggerAuthResult = FlowTriggerAuthOk | FlowTriggerAuthFail

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase()
  if (!raw) return defaultValue
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function flowsTriggerRequireAuth(): boolean {
  // Default on — local smoke scripts call runLocalFlow directly (no HTTP).
  return envFlag('FLOWS_TRIGGER_REQUIRE_AUTH', true)
}

/** Production: open flow triggers (REQUIRE_AUTH=false) are refused at boot. */
export function assertProductionFlowAuthConfig(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (flowsTriggerRequireAuth()) return
  throw new Error(
    'Refusing to start in production: FLOWS_TRIGGER_REQUIRE_AUTH=false opens /flows/trigger. ' +
      'Require JWT or FLOWS_TRIGGER_SERVICE_KEY.',
  )
}

export function flowsRejectAutomationReentry(): boolean {
  return envFlag('FLOWS_REJECT_AUTOMATION_REENTRY', true)
}

export function flowServiceKey(): string {
  return (process.env.FLOWS_TRIGGER_SERVICE_KEY || '').trim()
}

export function n8nWebhookSecret(): string {
  return (process.env.N8N_WEBHOOK_SECRET || '').trim()
}

/**
 * Explicit single-webhook URL (legacy seed / one-off hooks).
 * Prefer N8N_BASE_URL + per-key paths (`/webhook/ce-{key}`) for pack flows.
 */
export function n8nWebhookUrl(): string {
  return (process.env.N8N_WEBHOOK_URL || '').trim()
}

/** Origin for bundled n8n (e.g. http://n8n:5678). Falls back to N8N_WEBHOOK_URL origin. */
export function n8nBaseUrl(): string {
  const explicit = (process.env.N8N_BASE_URL || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const legacy = n8nWebhookUrl()
  if (!legacy) return ''
  try {
    return new URL(legacy).origin
  } catch {
    return ''
  }
}

/** Stable webhook path segment for a flow key: `ce-send_quote_pdf`. */
export function n8nWebhookPathForKey(flowKey: string): string {
  const sanitized = String(flowKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!sanitized) {
    throw new Error('Flow key is required for n8n webhook path')
  }
  return `ce-${sanitized}`
}

/** Full webhook URL: `{N8N_BASE_URL}/webhook/ce-{key}`. */
export function resolveN8nFlowUrl(flowKey: string): string {
  const base = n8nBaseUrl()
  if (!base) {
    throw new Error(
      'N8N_BASE_URL (or N8N_WEBHOOK_URL) is required to resolve n8n flow targets',
    )
  }
  return `${base}/webhook/${n8nWebhookPathForKey(flowKey)}`
}

/** True when destination is under the configured n8n base / legacy webhook origin. */
export function isN8nDestination(destination: URL): boolean {
  const base = n8nBaseUrl()
  if (base && sameOrigin(destination, base)) return true
  const legacy = n8nWebhookUrl()
  if (legacy && sameOrigin(destination, legacy)) return true
  return false
}

/**
 * Read automation header from a Fastify/Node header bag (lowercased keys preferred).
 */
export function readAutomationHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!headers) return ''
  const raw =
    headers[CRM_AUTOMATION_HEADER] ??
    headers['X-CRM-Automation'] ??
    headers['X-Crm-Automation']
  if (Array.isArray(raw)) return String(raw[0] || '').trim()
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * Reject n8n (or other automation) calling back into /flows/trigger to avoid loops.
 * GraphQL writes from n8n should use X-CRM-Automation: n8n; future event hooks skip those.
 */
export function assertNotAutomationReentry(
  headers: Record<string, string | string[] | undefined> | undefined,
): FlowTriggerAuthFail | null {
  if (!flowsRejectAutomationReentry()) return null
  const automation = readAutomationHeader(headers)
  if (!automation) return null
  return {
    ok: false,
    status: 409,
    error:
      `Flow trigger refused: ${CRM_AUTOMATION_HEADER}=${automation} ` +
      '(set FLOWS_REJECT_AUTOMATION_REENTRY=false to allow re-entry)',
  }
}

/**
 * Authorize POST /flows/trigger/:key.
 * - JWT Bearer (CRM UI / automation user)
 * - or FLOWS_TRIGGER_SERVICE_KEY as Bearer / X-CRM-Flow-Secret
 * - or open when FLOWS_TRIGGER_REQUIRE_AUTH=false
 */
export async function authorizeFlowTrigger(input: {
  authorizationHeader: string | undefined
  headers?: Record<string, string | string[] | undefined>
}): Promise<FlowTriggerAuthResult> {
  const reentry = assertNotAutomationReentry(input.headers)
  if (reentry) return reentry

  const requireAuth = flowsTriggerRequireAuth()
  const token = bearerToken(input.authorizationHeader)
  const serviceKey = flowServiceKey()

  const secretHeaderRaw =
    input.headers?.[CRM_FLOW_SECRET_HEADER] ??
    input.headers?.['X-CRM-Flow-Secret']
  const secretHeader = Array.isArray(secretHeaderRaw)
    ? String(secretHeaderRaw[0] || '').trim()
    : typeof secretHeaderRaw === 'string'
      ? secretHeaderRaw.trim()
      : ''

  if (serviceKey) {
    if (token && safeEqualString(token, serviceKey)) {
      return { ok: true, actorId: null, via: 'service_key', me: null }
    }
    if (secretHeader && safeEqualString(secretHeader, serviceKey)) {
      return { ok: true, actorId: null, via: 'service_key', me: null }
    }
  }

  if (token && verifyAccessToken(token)?.id) {
    // Signature alone is not enough: deactivated / deleted users and pending
    // password changes must be refused like every other authenticated route.
    try {
      const me = await requireAuthenticatedUser({
        authorization: `Bearer ${token}`,
        rolePreview: readRolePreviewHeader(
          (input.headers ?? {}) as Record<string, unknown>,
        ),
      })
      return { ok: true, actorId: me.id, via: 'jwt', me }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      return message === PASSWORD_CHANGE_REQUIRED
        ? { ok: false, status: 403, error: PASSWORD_CHANGE_REQUIRED }
        : { ok: false, status: 401, error: 'Authentication required' }
    }
  }

  if (!requireAuth) {
    return { ok: true, actorId: null, via: 'open', me: null }
  }

  return {
    ok: false,
    status: 401,
    error:
      'Flow trigger requires Authorization Bearer (JWT or FLOWS_TRIGGER_SERVICE_KEY)',
  }
}

function sameOrigin(url: URL, other: string): boolean {
  try {
    return new URL(other).origin === url.origin
  } catch {
    return false
  }
}

/**
 * Headers merged into every outbound http flow call. N8N_WEBHOOK_SECRET is only
 * attached when the destination is under N8N_BASE_URL / N8N_WEBHOOK_URL.
 */
export function outboundHttpFlowHeaders(
  configHeaders: Record<string, string>,
  destination: URL,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...configHeaders,
    [CRM_SOURCE_HEADER]: configHeaders[CRM_SOURCE_HEADER] || 'bff-flow',
  }
  const secret = n8nWebhookSecret()
  if (secret && !headers[CRM_FLOW_SECRET_HEADER] && isN8nDestination(destination)) {
    headers[CRM_FLOW_SECRET_HEADER] = secret
  }
  return headers
}
