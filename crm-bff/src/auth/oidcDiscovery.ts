import { oidcDiscoveryUrl, readOidcConfig } from './oidcConfig.js'

export interface OidcDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  end_session_endpoint?: string
  userinfo_endpoint?: string
}

let discoveryCache: { at: number; doc: OidcDiscoveryDocument } | null = null
const DISCOVERY_TTL_MS = 60 * 60_000

export function resetOidcDiscoveryCache(): void {
  discoveryCache = null
}

function rewriteInternalUrl(url: string, publicIssuer: string, internalIssuer: string): string {
  if (!url.startsWith(publicIssuer)) return url
  return `${internalIssuer}${url.slice(publicIssuer.length)}`
}

export async function fetchOidcDiscovery(): Promise<OidcDiscoveryDocument> {
  const cfg = readOidcConfig()
  if (!cfg.issuer) throw new Error('OIDC_ISSUER is not configured')

  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.doc
  }

  const fetchBase = cfg.internalIssuer || cfg.issuer
  const url = oidcDiscoveryUrl(fetchBase)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (${response.status}) at ${url}`)
  }
  const json = (await response.json()) as Record<string, unknown>
  const issuer = typeof json.issuer === 'string' ? json.issuer.replace(/\/+$/, '') : ''
  let authorization_endpoint =
    typeof json.authorization_endpoint === 'string' ? json.authorization_endpoint : ''
  let token_endpoint =
    typeof json.token_endpoint === 'string' ? json.token_endpoint : ''
  let jwks_uri = typeof json.jwks_uri === 'string' ? json.jwks_uri : ''
  let end_session_endpoint =
    typeof json.end_session_endpoint === 'string'
      ? json.end_session_endpoint
      : undefined
  const userinfo_endpoint =
    typeof json.userinfo_endpoint === 'string' ? json.userinfo_endpoint : undefined
  if (!issuer || !authorization_endpoint || !token_endpoint || !jwks_uri) {
    throw new Error('OIDC discovery document missing required endpoints')
  }
  // Public issuer must match token `iss`. Internal fetch may advertise a different host.
  if (issuer !== cfg.issuer && issuer !== cfg.internalIssuer) {
    throw new Error(
      `OIDC discovery issuer mismatch: expected ${cfg.issuer}, got ${issuer}`,
    )
  }
  if (cfg.internalIssuer) {
    // Browser authorize/logout stay on the public issuer host.
    authorization_endpoint = rewriteInternalUrl(
      authorization_endpoint,
      cfg.internalIssuer,
      cfg.issuer,
    )
    if (end_session_endpoint) {
      end_session_endpoint = rewriteInternalUrl(
        end_session_endpoint,
        cfg.internalIssuer,
        cfg.issuer,
      )
    }
    // Server-side token + JWKS use the internal host.
    token_endpoint = rewriteInternalUrl(
      token_endpoint,
      cfg.issuer,
      cfg.internalIssuer,
    )
    jwks_uri = rewriteInternalUrl(jwks_uri, cfg.issuer, cfg.internalIssuer)
  }
  const doc: OidcDiscoveryDocument = {
    issuer: cfg.issuer,
    authorization_endpoint,
    token_endpoint,
    jwks_uri,
    end_session_endpoint,
    userinfo_endpoint,
  }
  discoveryCache = { at: Date.now(), doc }
  return doc
}
