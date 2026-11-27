/**
 * Re-validate SSO users against the IdP on CoreEngine refresh.
 * Uses stored IdP access/refresh tokens from the CE refresh row.
 *
 * Transient IdP failures (429 / 5xx / network) throw so the BFF returns 503
 * and leaves the CE refresh row intact — never revoke or deactivate on outage.
 */
import { fetchOidcDiscovery } from './oidcDiscovery.js'
import { fetchOidcHttp } from './oidcFetch.js'
import { readOidcConfig } from './oidcConfig.js'

export function oidcCheckOnRefreshEnabled(): boolean {
  const cfg = readOidcConfig()
  if (!cfg.enabled) return false
  const raw = String(process.env.OIDC_CHECK_ON_REFRESH ?? 'true')
    .trim()
    .toLowerCase()
  if (!raw) return true
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off')
}

export function oidcDeactivateOnRejectEnabled(): boolean {
  const raw = String(process.env.OIDC_DEACTIVATE_ON_IDP_REJECT ?? 'false')
    .trim()
    .toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/** True for rate-limit / server errors that must not revoke CE sessions. */
export function isTransientIdpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

export class OidcIdpUnavailableError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`SSO temporarily unavailable (${status}): ${detail}`)
    this.name = 'OidcIdpUnavailableError'
    this.status = status
  }
}

type IdpHttpOutcome = 'ok' | 'reject' | 'unavailable'

function classifyIdpResponse(response: {
  ok?: boolean
  status?: number
}): IdpHttpOutcome {
  if (response.ok === true) return 'ok'
  const status = Number(response.status)
  if (Number.isFinite(status) && isTransientIdpStatus(status)) return 'unavailable'
  return 'reject'
}

async function userinfoOutcome(
  userinfoUrl: string,
  accessToken: string,
): Promise<{ outcome: IdpHttpOutcome; status: number }> {
  const response = await fetchOidcHttp(userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  return {
    outcome: classifyIdpResponse(response),
    status: Number(response.status) || (response.ok ? 200 : 0),
  }
}

async function refreshIdpAccessToken(refreshToken: string): Promise<
  | { outcome: 'ok'; access_token: string; refresh_token?: string }
  | { outcome: 'reject' }
  | { outcome: 'unavailable'; status: number }
> {
  const cfg = readOidcConfig()
  const discovery = await fetchOidcDiscovery()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  const response = await fetchOidcHttp(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  const classified = classifyIdpResponse(response)
  if (classified === 'unavailable') {
    return { outcome: 'unavailable', status: Number(response.status) || 503 }
  }
  if (classified !== 'ok') return { outcome: 'reject' }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const access =
    payload && typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!access) return { outcome: 'reject' }
  return {
    outcome: 'ok',
    access_token: access,
    refresh_token:
      payload && typeof payload.refresh_token === 'string'
        ? payload.refresh_token
        : undefined,
  }
}

export type OidcSessionCheckResult =
  | { ok: true; accessToken?: string; refreshToken?: string }
  | { ok: false; reason: string }

/**
 * Confirm the IdP still recognizes the SSO subject.
 * No stored IdP token → skip (cannot prove either way; CE is_active still applies).
 * Transient IdP failures throw {@link OidcIdpUnavailableError}.
 */
export async function assertOidcSessionStillValid(input: {
  oidcAccessToken?: string | null
  oidcRefreshToken?: string | null
}): Promise<OidcSessionCheckResult> {
  if (!oidcCheckOnRefreshEnabled()) return { ok: true }

  const access = String(input.oidcAccessToken || '').trim()
  const refresh = String(input.oidcRefreshToken || '').trim()
  if (!access && !refresh) return { ok: true }

  const discovery = await fetchOidcDiscovery()
  const userinfo = discovery.userinfo_endpoint
  if (!userinfo) {
    // IdP has no userinfo — cannot check; do not block refresh.
    return { ok: true }
  }

  if (access) {
    const accessCheck = await userinfoOutcome(userinfo, access)
    if (accessCheck.outcome === 'ok') {
      return { ok: true, accessToken: access, refreshToken: refresh || undefined }
    }
    if (accessCheck.outcome === 'unavailable') {
      throw new OidcIdpUnavailableError(accessCheck.status, 'userinfo')
    }
  }

  if (refresh) {
    const rotated = await refreshIdpAccessToken(refresh)
    if (rotated.outcome === 'unavailable') {
      throw new OidcIdpUnavailableError(rotated.status, 'token refresh')
    }
    if (rotated.outcome === 'ok') {
      const nextRefresh = rotated.refresh_token || refresh
      const nextCheck = await userinfoOutcome(userinfo, rotated.access_token)
      if (nextCheck.outcome === 'ok') {
        return {
          ok: true,
          accessToken: rotated.access_token,
          refreshToken: nextRefresh,
        }
      }
      if (nextCheck.outcome === 'unavailable') {
        throw new OidcIdpUnavailableError(nextCheck.status, 'userinfo after refresh')
      }
    }
    // Had an IdP refresh token and it (or subsequent userinfo) was rejected → revoke.
    return { ok: false, reason: 'IdP rejected SSO session (userinfo/refresh failed)' }
  }

  // Access expired/rejected and no IdP refresh token (common when scopes omit
  // offline_access on Auth0/Entra). Do not lock the user out — CE is_active
  // still applies; next SSO login can mint tokens with offline_access.
  console.warn(
    '[oidcSessionCheck] IdP access check failed with no refresh token; skipping revoke',
  )
  return { ok: true }
}
