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
  if (!flowsTriggerRequireAuth()) {
    throw new Error(
      'Refusing to start in production: FLOWS_TRIGGER_REQUIRE_AUTH=false opens /flows/trigger. ' +
        'Require JWT or FLOWS_TRIGGER_SERVICE_KEY.',
    )
  }
  if (n8nBaseUrl() && !n8nWebhookSecret()) {
    throw new Error(
      'Refusing to start in production: N8N_BASE_URL (or N8N_WEBHOOK_URL) is set without N8N_WEBHOOK_SECRET. ' +
        'n8n webhooks must check X-CRM-Flow-Secret so only the BFF can call /webhook/ce-{key}.',
    )
  }
  if (activepiecesBaseUrl() && !activepiecesWebhookSecret()) {
    throw new Error(
      'Refusing to start in production: ACTIVEPIECES_BASE_URL is set without ACTIVEPIECES_WEBHOOK_SECRET (or N8N_WEBHOOK_SECRET fallback). ' +
        'Activepieces Catch Webhook must check X-CRM-Flow-Secret so only the BFF can call /api/v1/webhooks/{flowId}.',
    )
  }
}

/** Dev/staging hint when n8n is configured without the shared webhook secret. */
export function warnIfN8nWebhookSecretMissing(log: { warn: (msg: string) => void }): void {
  if (!n8nBaseUrl() || n8nWebhookSecret()) return
  log.warn(
    'N8N_BASE_URL is set but N8N_WEBHOOK_SECRET is empty — /webhook/ce-{key} templates cannot authenticate BFF calls. Set a shared secret (see docs/n8n/README.md).',
  )
}

/** Dev/staging hint when Activepieces is configured without a webhook secret. */
export function warnIfActivepiecesWebhookSecretMissing(log: {
  warn: (msg: string) => void
}): void {
  if (!activepiecesBaseUrl() || activepiecesWebhookSecret()) return
  log.warn(
    'ACTIVEPIECES_BASE_URL is set but ACTIVEPIECES_WEBHOOK_SECRET (and N8N_WEBHOOK_SECRET fallback) is empty — Catch Webhook cannot authenticate BFF calls. Set a shared secret (see docs/activepieces/README.md).',
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

/** Origin for the customer's n8n (e.g. http://n8n:5678). Falls back to N8N_WEBHOOK_URL origin. */
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

/** Origin for the customer's Activepieces (e.g. http://activepieces:80). */
export function activepiecesBaseUrl(): string {
  return (process.env.ACTIVEPIECES_BASE_URL || '').trim().replace(/\/+$/, '')
}

/**
 * Shared secret for Activepieces Catch Webhook Header Auth.
 * Falls back to N8N_WEBHOOK_SECRET so one value can cover both engines.
 */
export function activepiecesWebhookSecret(): string {
  const explicit = (process.env.ACTIVEPIECES_WEBHOOK_SECRET || '').trim()
  if (explicit) return explicit
  return n8nWebhookSecret()
}

/**
 * Sanitize Activepieces flow id (last segment of Catch Webhook Live URL).
 * Allows URL-safe chars used by Activepieces flow ids.
 */
export function sanitizeActivepiecesFlowId(raw: unknown): string {
  const id = String(raw || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (!id) {
    throw new Error('Activepieces flowId is required (Catch Webhook Live URL last segment)')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(
      'Activepieces flowId must be alphanumeric with _ or - (paste the Live URL id only)',
    )
  }
  return id
}

/**
 * Full webhook URL: `{ACTIVEPIECES_BASE_URL}/api/v1/webhooks/{flowId}` (+ `/sync` when requested).
 * Activepieces does not support n8n-style `/webhook/ce-{key}` paths — store flowId on the trigger.
 */
export function resolveActivepiecesFlowUrl(config: Record<string, unknown>): string {
  const base = activepiecesBaseUrl()
  if (!base) {
    throw new Error('ACTIVEPIECES_BASE_URL is required to resolve activepieces flow targets')
  }
  const flowId = sanitizeActivepiecesFlowId(config.flowId)
  const sync =
    config.sync === true ||
    String(config.sync || '')
      .trim()
      .toLowerCase() === 'true'
  return `${base}/api/v1/webhooks/${flowId}${sync ? '/sync' : ''}`
}

/** True when destination is under the configured Activepieces base. */
export function isActivepiecesDestination(destination: URL): boolean {
  const base = activepiecesBaseUrl()
  return Boolean(base && sameOrigin(destination, base))
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
 * Headers merged into every outbound http flow call.
 * Shared webhook secrets are attached only when the destination matches the
 * configured n8n or Activepieces origin (never on arbitrary Custom URL hosts).
 */
export function outboundHttpFlowHeaders(
  configHeaders: Record<string, string>,
  destination: URL,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...configHeaders,
    [CRM_SOURCE_HEADER]: configHeaders[CRM_SOURCE_HEADER] || 'bff-flow',
  }
  if (!headers[CRM_FLOW_SECRET_HEADER]) {
    if (isN8nDestination(destination)) {
      const secret = n8nWebhookSecret()
      if (secret) headers[CRM_FLOW_SECRET_HEADER] = secret
    } else if (isActivepiecesDestination(destination)) {
      const secret = activepiecesWebhookSecret()
      if (secret) headers[CRM_FLOW_SECRET_HEADER] = secret
    }
  }
  return headers
}
