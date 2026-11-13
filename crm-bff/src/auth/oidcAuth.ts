import { randomUUID } from 'node:crypto'
import { issueSession, type AuthSessionPayload } from './localAuth.js'
import { readOidcConfig } from './oidcConfig.js'
import { fetchOidcDiscovery } from './oidcDiscovery.js'
import { verifyOidcIdToken } from './oidcIdToken.js'
import { resolveUserFromOidcClaims } from './oidcLink.js'
import {
  generateOidcNonce,
  generateOidcState,
  generatePkcePair,
} from './oidcPkce.js'
import { fetchOidcHttp } from './oidcFetch.js'
import { oidcStateCookieMatches } from './oidcStateCookie.js'
import {
  storeOidcPending,
  storeOidcSessionTicket,
  takeOidcPending,
  takeOidcSessionTicket,
} from './oidcStateStore.js'

function safeRedirectPath(raw: string | null | undefined): string {
  const value = String(raw || '/').trim() || '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
    return '/'
  }
  return value
}

export function oidcStatusPayload(): {
  enabled: boolean
  displayName: string
} {
  const cfg = readOidcConfig()
  return {
    enabled: cfg.enabled,
    displayName: cfg.displayName,
  }
}

export async function buildOidcAuthorizeRedirect(input: {
  redirectPath?: string | null
}): Promise<
  | { ok: true; url: string; state: string }
  | { ok: false; status: number; error: string }
> {
  const cfg = readOidcConfig()
  if (!cfg.enabled) {
    return { ok: false, status: 404, error: 'OIDC SSO is not enabled' }
  }
  try {
    const discovery = await fetchOidcDiscovery()
    const { verifier, challenge } = generatePkcePair()
    const state = generateOidcState()
    const nonce = generateOidcNonce()
    const stored = storeOidcPending(state, {
      codeVerifier: verifier,
      nonce,
      redirectPath: safeRedirectPath(input.redirectPath),
    })
    if (!stored) {
      return {
        ok: false,
        status: 503,
        error: 'SSO temporarily unavailable (too many pending logins)',
      }
    }

    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('client_id', cfg.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', cfg.scopes)
    url.searchParams.set('redirect_uri', cfg.redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')

    return { ok: true, url: url.toString(), state }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OIDC authorize failed'
    return { ok: false, status: 502, error: message }
  }
}

async function exchangeAuthorizationCode(input: {
  code: string
  codeVerifier: string
}): Promise<{ id_token: string; access_token?: string }> {
  const cfg = readOidcConfig()
  const discovery = await fetchOidcDiscovery()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: input.codeVerifier,
  })
  const response = await fetchOidcHttp(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!response.ok) {
    const detail =
      payload && typeof payload.error_description === 'string'
        ? payload.error_description
        : payload && typeof payload.error === 'string'
          ? payload.error
          : `token endpoint HTTP ${response.status}`
    throw new Error(`OIDC token exchange failed: ${detail}`)
  }
  const idToken = typeof payload?.id_token === 'string' ? payload.id_token : ''
  if (!idToken) throw new Error('OIDC token response missing id_token')
  return {
    id_token: idToken,
    access_token:
      typeof payload?.access_token === 'string' ? payload.access_token : undefined,
  }
}

export async function completeOidcCallback(input: {
  code?: string | null
  state?: string | null
  stateCookie?: string | null
  error?: string | null
  errorDescription?: string | null
}): Promise<
  | { ok: true; uiRedirect: string }
  | { ok: false; status: number; error: string }
> {
  const cfg = readOidcConfig()
  if (!cfg.enabled) {
    return { ok: false, status: 404, error: 'OIDC SSO is not enabled' }
  }
  if (input.error) {
    return {
      ok: false,
      status: 401,
      error: input.errorDescription || input.error || 'OIDC login denied',
    }
  }
  const code = String(input.code || '').trim()
  const state = String(input.state || '').trim()
  if (!code || !state) {
    return { ok: false, status: 400, error: 'Missing OIDC code or state' }
  }

  // Login CSRF: state must match the HttpOnly cookie set on /auth/oidc/login.
  if (!oidcStateCookieMatches(state, input.stateCookie)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid or missing OIDC state cookie',
    }
  }

  const pending = takeOidcPending(state)
  if (!pending) {
    return { ok: false, status: 400, error: 'Invalid or expired OIDC state' }
  }

  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: pending.codeVerifier,
    })
    const claims = await verifyOidcIdToken(tokens.id_token, pending.nonce)
    const linked = await resolveUserFromOidcClaims(claims)
    if (!linked.ok) {
      return { ok: false, status: linked.status, error: linked.error }
    }

    // SSO users skip forced local password change — they may have no password.
    const session = await issueSession({
      id: linked.user.id,
      backend_user_id: linked.user.backend_user_id,
      role_backend_id: linked.user.role_backend_id,
      must_change_password: false,
    })

    const ticketId = randomUUID()
    const ticketStored = storeOidcSessionTicket(ticketId, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires: session.expires,
      id_token: tokens.id_token,
    })
    if (!ticketStored) {
      return {
        ok: false,
        status: 503,
        error: 'SSO temporarily unavailable (too many pending sessions)',
      }
    }

    const ui = new URL('/login/oidc/callback', `${cfg.uiOrigin}/`)
    ui.searchParams.set('ticket', ticketId)
    if (pending.redirectPath && pending.redirectPath !== '/') {
      ui.searchParams.set('redirect', pending.redirectPath)
    }
    return { ok: true, uiRedirect: ui.toString() }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OIDC callback failed'
    return { ok: false, status: 401, error: message }
  }
}

export function redeemOidcTicket(ticket: string):
  | { ok: true; session: AuthSessionPayload; idToken: string | null }
  | { ok: false; status: number; error: string } {
  const id = String(ticket || '').trim()
  if (!id) {
    return { ok: false, status: 400, error: 'ticket is required' }
  }
  const stored = takeOidcSessionTicket(id)
  if (!stored) {
    return { ok: false, status: 401, error: 'Invalid or expired SSO ticket' }
  }
  return {
    ok: true,
    idToken: stored.id_token ?? null,
    session: {
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      expires: stored.expires,
      ...(stored.must_change_password
        ? { must_change_password: true }
        : {}),
    },
  }
}

export async function buildOidcLogoutRedirect(input: {
  postLogoutRedirect?: string | null
  idTokenHint?: string | null
}): Promise<{ ok: true; url: string | null } | { ok: false; status: number; error: string }> {
  const cfg = readOidcConfig()
  if (!cfg.enabled) {
    return { ok: false, status: 404, error: 'OIDC SSO is not enabled' }
  }
  try {
    const discovery = await fetchOidcDiscovery()
    if (!discovery.end_session_endpoint) {
      return { ok: true, url: null }
    }
    const post =
      safeRedirectPath(input.postLogoutRedirect) === '/'
        ? `${cfg.uiOrigin}/login`
        : `${cfg.uiOrigin}${safeRedirectPath(input.postLogoutRedirect)}`
    const url = new URL(discovery.end_session_endpoint)
    url.searchParams.set('client_id', cfg.clientId)
    url.searchParams.set('post_logout_redirect_uri', post)
    const hint = String(input.idTokenHint || '').trim()
    if (hint) {
      url.searchParams.set('id_token_hint', hint)
    }
    return { ok: true, url: url.toString() }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OIDC logout failed'
    return { ok: false, status: 502, error: message }
  }
}
