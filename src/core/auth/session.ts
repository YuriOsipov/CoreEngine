import { featureFlags } from '@/core/graphql/featureFlags'
import { clearCurrentUserCache } from '@/core/currentUser'
import { clearEntityPermissionsCache } from '@/core/entityPermissions'
import { clearRolePreviewOverride } from '@/core/rolePreview'

const ACCESS_TOKEN_KEY = 'crm.auth.access_token'
const REFRESH_TOKEN_KEY = 'crm.auth.refresh_token'
const EXPIRES_AT_KEY = 'crm.auth.expires_at'

function bffBaseUrl(): string {
  const graphqlUrl =
    (import.meta.env.VITE_GRAPHQL_URL as string | undefined)?.replace(/\/$/, '') ||
    'http://localhost:4000/graphql'
  return graphqlUrl.replace(/\/graphql\/?$/i, '') || 'http://localhost:4000'
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface AuthSessionResponse {
  access_token: string
  refresh_token: string
  expires: number
}

function browserStores(): { session: Storage; local: Storage } | null {
  if (typeof window === 'undefined') return null
  return { session: window.sessionStorage, local: window.localStorage }
}

function clearTokenKeys(store: Storage): void {
  store.removeItem(ACCESS_TOKEN_KEY)
  store.removeItem(REFRESH_TOKEN_KEY)
  store.removeItem(EXPIRES_AT_KEY)
}

function readFromStore(store: Storage): AuthSession | null {
  const accessToken = store.getItem(ACCESS_TOKEN_KEY)?.trim() || ''
  const refreshToken = store.getItem(REFRESH_TOKEN_KEY)?.trim() || ''
  const expiresAt = Number(store.getItem(EXPIRES_AT_KEY) || 0)
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken, expiresAt }
}

function writeToStore(store: Storage, session: AuthSession): void {
  store.setItem(ACCESS_TOKEN_KEY, session.accessToken)
  store.setItem(REFRESH_TOKEN_KEY, session.refreshToken)
  store.setItem(EXPIRES_AT_KEY, String(session.expiresAt))
}

export function canUseBffAuth(): boolean {
  const mode = import.meta.env.VITE_AUTH_MODE
  if (mode === 'bff') return true
  // Legacy `directus` auth mode is retired — treat like `none`.
  if (mode === 'directus' || mode === 'none') return false
  // Default: BFF session when GraphQL is on and no static legacy token.
  const staticToken = (import.meta.env.VITE_DIRECTUS_TOKEN as string | undefined)?.trim()
  return featureFlags.layoutsFromGraphQL && !staticToken
}

export function readAuthSession(): AuthSession | null {
  const stores = browserStores()
  if (!stores) return null
  const local = readFromStore(stores.local)
  if (local) return local
  // Promote legacy tab-only sessions into localStorage (30-day persistence).
  const session = readFromStore(stores.session)
  if (session) {
    writeToStore(stores.local, session)
    clearTokenKeys(stores.session)
  }
  return session
}

export function hasAuthSession(): boolean {
  return Boolean(readAuthSession()?.accessToken)
}

if (typeof window !== 'undefined') {
  readAuthSession()
}

export function clearAuthSession(): void {
  const stores = browserStores()
  if (stores) {
    clearTokenKeys(stores.session)
    clearTokenKeys(stores.local)
    stores.local.removeItem('crm.auth.persistent')
  }
  clearRolePreviewOverride()
  clearCurrentUserCache()
  clearEntityPermissionsCache()
}

export function writeAuthSession(session: AuthSessionResponse): AuthSession {
  const expiresMs =
    typeof session.expires === 'number' && Number.isFinite(session.expires)
      ? session.expires * 1000
      : 15 * 60 * 1000
  const next: AuthSession = {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: Date.now() + expiresMs,
  }
  const stores = browserStores()
  if (stores) {
    writeToStore(stores.local, next)
    clearTokenKeys(stores.session)
  }
  // New login must not inherit another user's "View as role" override.
  clearRolePreviewOverride()
  clearCurrentUserCache()
  clearEntityPermissionsCache()
  return next
}

const ACCESS_SKEW_MS = 30_000

/** In-tab single-flight; cross-tab uses `navigator.locks` when available. */
let refreshInFlight: Promise<AuthSession> | null = null

class AuthRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthRequestError'
    this.status = status
  }
}

function sessionStillFresh(session: AuthSession, skewMs = ACCESS_SKEW_MS): boolean {
  return session.expiresAt > Date.now() + skewMs
}

/**
 * Refresh access JWT. Survives BFF restarts: refresh rows live in Postgres and
 * signing uses JWT_SECRET from env — neither is process memory.
 */
async function runRefresh(session: AuthSession): Promise<AuthSession> {
  const attempt = async (): Promise<AuthSession> => {
    // Another tab may have already rotated while we waited for the lock.
    const current = readAuthSession()
    if (current && current.refreshToken !== session.refreshToken) {
      if (sessionStillFresh(current) || current.expiresAt > Date.now()) {
        return current
      }
    }
    const refreshToken = current?.refreshToken || session.refreshToken
    return refreshAuthSession(refreshToken)
  }

  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('crm-auth-refresh', attempt)
  }
  return attempt()
}

export async function getSessionAccessToken(): Promise<string | null> {
  const session = readAuthSession()
  if (!session) return null

  if (sessionStillFresh(session)) {
    return session.accessToken
  }

  try {
    if (!refreshInFlight) {
      refreshInFlight = runRefresh(session).finally(() => {
        refreshInFlight = null
      })
    }
    const refreshed = await refreshInFlight
    return refreshed.accessToken
  } catch (err) {
    const latest = readAuthSession()
    // Losing refresh race: peer already wrote a newer session — keep it.
    if (latest && latest.refreshToken !== session.refreshToken) {
      if (sessionStillFresh(latest) || latest.expiresAt > Date.now()) {
        return latest.accessToken
      }
    }

    const status = err instanceof AuthRequestError ? err.status : 0
    // BFF restart / network blip: keep localStorage so the next call can retry.
    if (status === 0 || status >= 500) {
      return session.expiresAt > Date.now() ? session.accessToken : null
    }

    // Definitive auth rejection for the same refresh token still in storage.
    if (!latest || latest.refreshToken === session.refreshToken) {
      clearAuthSession()
    }
    return null
  }
}

/**
 * Token for BFF Authorization — optional static `VITE_DIRECTUS_TOKEN`, else
 * session JWT (with refresh).
 */
export async function getAccessToken(): Promise<string | null> {
  const staticToken = (import.meta.env.VITE_DIRECTUS_TOKEN as string | undefined)?.trim()
  if (staticToken) return staticToken
  return getSessionAccessToken()
}

async function authRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${bffBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | { error?: string }
    | null
  if (!response.ok) {
    throw new AuthRequestError(
      (payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : null) || `Auth HTTP ${response.status}`,
      response.status,
    )
  }
  return payload as T
}

export async function loginWithBff(input: {
  email: string
  password: string
}): Promise<AuthSession> {
  const session = await authRequest<AuthSessionResponse>('/auth/login', {
    email: input.email,
    password: input.password,
  })
  return writeAuthSession(session)
}

export async function refreshAuthSession(
  refreshToken: string,
): Promise<AuthSession> {
  const session = await authRequest<AuthSessionResponse>('/auth/refresh', {
    refresh_token: refreshToken,
  })
  return writeAuthSession(session)
}

export async function logoutWithBff(): Promise<void> {
  const session = readAuthSession()
  try {
    if (session?.refreshToken) {
      await authRequest<{ ok: boolean }>('/auth/logout', {
        refresh_token: session.refreshToken,
      })
    }
  } finally {
    clearAuthSession()
  }
}
