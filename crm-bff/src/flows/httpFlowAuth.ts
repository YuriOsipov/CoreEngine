/**
 * Optional outbound auth for handler=http flow triggers (stored in config.auth).
 */
export type HttpFlowAuthType = 'none' | 'bearer' | 'api_key' | 'basic'

export interface HttpFlowAuthConfig {
  type: HttpFlowAuthType
  /** Bearer token (without "Bearer " prefix). */
  token?: string
  /** Custom header name for api_key (default Authorization or X-API-Key). */
  headerName?: string
  headerValue?: string
  username?: string
  password?: string
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function parseHttpFlowAuth(raw: unknown): HttpFlowAuthConfig {
  const obj = asObject(raw)
  const typeRaw = String(obj.type || 'none')
    .trim()
    .toLowerCase()
  const type: HttpFlowAuthType =
    typeRaw === 'bearer' ||
    typeRaw === 'api_key' ||
    typeRaw === 'apikey' ||
    typeRaw === 'basic'
      ? typeRaw === 'apikey'
        ? 'api_key'
        : (typeRaw as HttpFlowAuthType)
      : 'none'

  if (type === 'none') return { type: 'none' }

  if (type === 'bearer') {
    const token = String(obj.token ?? '').trim()
    if (!token) throw new Error('bearer auth requires auth.token')
    return { type: 'bearer', token }
  }

  if (type === 'api_key') {
    const headerName =
      String(obj.headerName ?? obj.header_name ?? 'X-API-Key').trim() ||
      'X-API-Key'
    const headerValue = String(
      obj.headerValue ?? obj.header_value ?? obj.token ?? '',
    ).trim()
    if (!headerValue) throw new Error('api_key auth requires auth.headerValue')
    return { type: 'api_key', headerName, headerValue }
  }

  const username = String(obj.username ?? '').trim()
  const password = String(obj.password ?? '')
  if (!username) throw new Error('basic auth requires auth.username')
  return { type: 'basic', username, password }
}

/** Merge auth into outbound headers (does not remove unrelated headers). */
export function applyHttpFlowAuthHeaders(
  headers: Record<string, string>,
  authRaw: unknown,
): Record<string, string> {
  const auth = (() => {
    try {
      return parseHttpFlowAuth(authRaw)
    } catch {
      return { type: 'none' as const }
    }
  })()

  const next = { ...headers }
  if (auth.type === 'bearer' && auth.token) {
    next.Authorization = `Bearer ${auth.token}`
  } else if (auth.type === 'api_key' && auth.headerName && auth.headerValue) {
    next[auth.headerName] = auth.headerValue
  } else if (auth.type === 'basic' && auth.username != null) {
    const raw = `${auth.username}:${auth.password ?? ''}`
    next.Authorization = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
  }
  return next
}

/** Normalize auth for persistence (omit secrets fields when type=none). */
export function sanitizeHttpFlowAuth(raw: unknown): HttpFlowAuthConfig {
  return parseHttpFlowAuth(raw)
}
