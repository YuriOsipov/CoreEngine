/**
 * External OIDC IdP config (Keycloak, Auth0, etc.).
 * When enabled, BFF acts as OIDC relying party: Authorization Code + PKCE,
 * then issues the normal CoreEngine BFF session (HS256 + opaque refresh).
 */

function envFlag(name: string, fallback = false): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase()
  if (!raw) return fallback
  return /^(1|true|yes|on)$/i.test(raw)
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export interface OidcConfig {
  enabled: boolean
  issuer: string
  /**
   * Optional base URL for server-side discovery/JWKS when the public issuer
   * is not reachable from the BFF (e.g. Docker → Keycloak service name).
   * Token `iss` is still validated against `issuer`.
   */
  internalIssuer: string | null
  clientId: string
  clientSecret: string
  /** BFF callback — registered at the IdP. */
  redirectUri: string
  /** Vue app origin for post-login redirect. */
  uiOrigin: string
  scopes: string
  displayName: string
  /** Create app_users when email is unknown (default off). */
  jitProvision: boolean
  /** backend_role_id for JIT users (required when jitProvision). */
  defaultRoleBackendId: string | null
  /**
   * Lowercased email domains allowed for email-link + JIT (e.g. `acme.com`).
   * Required (non-empty) when jitProvision is on.
   */
  allowedEmailDomains: string[]
  /** Optional audience / azp checks; empty = skip. */
  audience: string | null
}

/** Parse `OIDC_ALLOWED_EMAIL_DOMAINS` (comma-separated, optional leading `@`). */
export function parseOidcAllowedEmailDomains(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => part.trim().toLowerCase().replace(/^@+/, ''))
        .filter(Boolean),
    ),
  ]
}

/** True when `domains` is empty (no restriction) or email's domain is listed. */
export function isOidcEmailDomainAllowed(
  email: string,
  domains: readonly string[],
): boolean {
  if (!domains.length) return true
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const host = email.slice(at + 1).toLowerCase()
  if (!host) return false
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

let cached: OidcConfig | null = null

export function resetOidcConfigCache(): void {
  cached = null
}

export function readOidcConfig(): OidcConfig {
  if (cached) return cached
  const enabled = envFlag('OIDC_ENABLED')
  const issuer = trimSlash((process.env.OIDC_ISSUER || '').trim())
  const internalIssuer =
    trimSlash((process.env.OIDC_INTERNAL_ISSUER || '').trim()) || null
  const clientId = (process.env.OIDC_CLIENT_ID || '').trim()
  const clientSecret = (process.env.OIDC_CLIENT_SECRET || '').trim()
  const redirectUri = (process.env.OIDC_REDIRECT_URI || '').trim()
  const uiOrigin = trimSlash(
    (process.env.OIDC_UI_ORIGIN || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').trim(),
  )
  const scopes = (process.env.OIDC_SCOPES || 'openid profile email').trim()
  const displayName = (process.env.OIDC_DISPLAY_NAME || 'SSO').trim() || 'SSO'
  const jitProvision = envFlag('OIDC_JIT_PROVISION')
  const defaultRoleBackendId =
    (process.env.OIDC_DEFAULT_ROLE_BACKEND_ID || '').trim() || null
  const allowedEmailDomains = parseOidcAllowedEmailDomains(
    process.env.OIDC_ALLOWED_EMAIL_DOMAINS,
  )
  const audience = (process.env.OIDC_AUDIENCE || '').trim() || null

  cached = {
    enabled,
    issuer,
    internalIssuer,
    clientId,
    clientSecret,
    redirectUri,
    uiOrigin,
    scopes,
    displayName,
    jitProvision,
    defaultRoleBackendId,
    allowedEmailDomains,
    audience,
  }
  return cached
}

export function assertOidcConfigReady(): void {
  const cfg = readOidcConfig()
  if (!cfg.enabled) return
  const missing: string[] = []
  if (!cfg.issuer) missing.push('OIDC_ISSUER')
  if (!cfg.clientId) missing.push('OIDC_CLIENT_ID')
  if (!cfg.clientSecret) missing.push('OIDC_CLIENT_SECRET')
  if (!cfg.redirectUri) missing.push('OIDC_REDIRECT_URI')
  if (!cfg.uiOrigin) missing.push('OIDC_UI_ORIGIN')
  if (cfg.jitProvision && !cfg.defaultRoleBackendId) {
    missing.push('OIDC_DEFAULT_ROLE_BACKEND_ID (required when OIDC_JIT_PROVISION=true)')
  }
  if (cfg.jitProvision && cfg.allowedEmailDomains.length === 0) {
    missing.push(
      'OIDC_ALLOWED_EMAIL_DOMAINS (required when OIDC_JIT_PROVISION=true)',
    )
  }
  if (missing.length) {
    throw new Error(
      `OIDC_ENABLED=true but missing/invalid config: ${missing.join(', ')}`,
    )
  }
}

export function oidcDiscoveryUrl(issuer: string): string {
  return `${trimSlash(issuer)}/.well-known/openid-configuration`
}

export function isOidcEnabled(): boolean {
  return readOidcConfig().enabled
}
