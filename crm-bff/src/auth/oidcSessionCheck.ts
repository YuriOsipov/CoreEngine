/**
 * Re-validate SSO users against the IdP on CoreEngine refresh.
 * Uses stored IdP access/refresh tokens from the CE refresh row.
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

async function userinfoOk(userinfoUrl: string, accessToken: string): Promise<boolean> {
  const response = await fetchOidcHttp(userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  return response.ok
}

async function refreshIdpAccessToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token?: string
} | null> {
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
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const access =
    payload && typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!access) return null
  return {
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

  if (access && (await userinfoOk(userinfo, access))) {
    return { ok: true, accessToken: access, refreshToken: refresh || undefined }
  }

  if (refresh) {
    const rotated = await refreshIdpAccessToken(refresh)
    if (rotated) {
      const nextRefresh = rotated.refresh_token || refresh
      if (await userinfoOk(userinfo, rotated.access_token)) {
        return {
          ok: true,
          accessToken: rotated.access_token,
          refreshToken: nextRefresh,
        }
      }
    }
    // Had an IdP refresh token and it (or subsequent userinfo) failed → revoke.
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
