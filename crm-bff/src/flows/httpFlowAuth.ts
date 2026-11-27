/**
 * Optional outbound auth for handler=http flow triggers (stored in config.auth).
 * Secret fields are AES-GCM sealed at rest (`flowv1:…`); opened only at dispatch.
 */
import {
  isSealedFlowSecret,
  openFlowSecret,
  sealFlowSecret,
} from './flowSecretCrypto.js'

export type HttpFlowAuthType = 'none' | 'bearer' | 'api_key' | 'basic'

export interface HttpFlowAuthConfig {
  type: HttpFlowAuthType
  /** Bearer token (without "Bearer " prefix). May be sealed `flowv1:…` at rest. */
  token?: string
  /** Custom header name for api_key (default Authorization or X-API-Key). */
  headerName?: string
  headerValue?: string
  username?: string
  password?: string
  /** Admin list only — secret present but value omitted. */
  tokenSet?: boolean
  headerValueSet?: boolean
  passwordSet?: boolean
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function secretPresent(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

/**
 * Parse auth for persistence / merge. Empty secrets are allowed so an edit can
 * keep the previously sealed value.
 */
export function parseHttpFlowAuthInput(raw: unknown): HttpFlowAuthConfig {
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
    return { type: 'bearer', token: String(obj.token ?? '') }
  }

  if (type === 'api_key') {
    const headerName =
      String(obj.headerName ?? obj.header_name ?? 'X-API-Key').trim() ||
      'X-API-Key'
    const headerValue = String(
      obj.headerValue ?? obj.header_value ?? obj.token ?? '',
    )
    return { type: 'api_key', headerName, headerValue }
  }

  return {
    type: 'basic',
    username: String(obj.username ?? '').trim(),
    password: String(obj.password ?? ''),
  }
}

/** Strict parse after merge/seal — requires secret material for the chosen type. */
export function parseHttpFlowAuth(raw: unknown): HttpFlowAuthConfig {
  const auth = parseHttpFlowAuthInput(raw)
  if (auth.type === 'none') return auth
  if (auth.type === 'bearer') {
    if (!secretPresent(auth.token)) throw new Error('bearer auth requires auth.token')
    return auth
  }
  if (auth.type === 'api_key') {
    if (!secretPresent(auth.headerValue)) {
      throw new Error('api_key auth requires auth.headerValue')
    }
    return auth
  }
  if (!secretPresent(auth.username)) throw new Error('basic auth requires auth.username')
  return auth
}

/** Keep previous sealed secrets when the admin left the field blank on edit. */
export function mergeHttpFlowAuth(
  incomingRaw: unknown,
  existingRaw: unknown,
): HttpFlowAuthConfig {
  const incoming = parseHttpFlowAuthInput(incomingRaw)
  const existing = parseHttpFlowAuthInput(existingRaw)
  if (incoming.type === 'none') return { type: 'none' }

  if (incoming.type === 'bearer') {
    const token =
      String(incoming.token || '').trim() || String(existing.token || '')
    return { type: 'bearer', token }
  }

  if (incoming.type === 'api_key') {
    const headerName =
      String(incoming.headerName || '').trim() ||
      String(existing.headerName || '').trim() ||
      'X-API-Key'
    const headerValue =
      String(incoming.headerValue || '') || String(existing.headerValue || '')
    return { type: 'api_key', headerName, headerValue }
  }

  return {
    type: 'basic',
    username:
      String(incoming.username || '').trim() ||
      String(existing.username || '').trim(),
    password: String(incoming.password ?? '') || String(existing.password ?? ''),
  }
}

/** Seal secret fields for jsonb persistence. */
export function sealHttpFlowAuth(raw: unknown): HttpFlowAuthConfig {
  const auth = parseHttpFlowAuth(raw)
  if (auth.type === 'none') return { type: 'none' }
  if (auth.type === 'bearer') {
    return { type: 'bearer', token: sealFlowSecret(auth.token) }
  }
  if (auth.type === 'api_key') {
    return {
      type: 'api_key',
      headerName: auth.headerName || 'X-API-Key',
      headerValue: sealFlowSecret(auth.headerValue),
    }
  }
  return {
    type: 'basic',
    username: auth.username,
    password: sealFlowSecret(auth.password),
  }
}

/** Open sealed secrets for the outbound request. */
export function openHttpFlowAuth(raw: unknown): HttpFlowAuthConfig {
  const auth = parseHttpFlowAuthInput(raw)
  if (auth.type === 'none') return { type: 'none' }
  if (auth.type === 'bearer') {
    return { type: 'bearer', token: openFlowSecret(auth.token) }
  }
  if (auth.type === 'api_key') {
    return {
      type: 'api_key',
      headerName: auth.headerName || 'X-API-Key',
      headerValue: openFlowSecret(auth.headerValue),
    }
  }
  return {
    type: 'basic',
    username: auth.username,
    password: openFlowSecret(auth.password),
  }
}

/** Admin GraphQL/list shape — never returns plaintext or sealed blobs. */
export function redactHttpFlowAuthForAdmin(raw: unknown): HttpFlowAuthConfig {
  const auth = parseHttpFlowAuthInput(raw)
  if (auth.type === 'none') return { type: 'none' }
  if (auth.type === 'bearer') {
    const set = secretPresent(auth.token) || isSealedFlowSecret(auth.token)
    return { type: 'bearer', token: '', tokenSet: set }
  }
  if (auth.type === 'api_key') {
    const set =
      secretPresent(auth.headerValue) || isSealedFlowSecret(auth.headerValue)
    return {
      type: 'api_key',
      headerName: auth.headerName || 'X-API-Key',
      headerValue: '',
      headerValueSet: set,
    }
  }
  return {
    type: 'basic',
    username: auth.username || '',
    password: '',
    passwordSet: secretPresent(auth.password) || isSealedFlowSecret(auth.password),
  }
}

/** Merge auth into outbound headers (opens sealed values). */
export function applyHttpFlowAuthHeaders(
  headers: Record<string, string>,
  authRaw: unknown,
): Record<string, string> {
  const auth = (() => {
    try {
      return openHttpFlowAuth(authRaw)
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
  return sealHttpFlowAuth(raw)
}
