import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { readOidcConfig } from './oidcConfig.js'
import { fetchOidcDiscovery } from './oidcDiscovery.js'

export interface OidcIdClaims {
  iss: string
  sub: string
  email: string
  emailVerified: boolean
  givenName: string | null
  familyName: string | null
  nonce: string | null
}

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwksFor(uri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksByUri.get(uri)
  if (!set) {
    set = createRemoteJWKSet(new URL(uri))
    jwksByUri.set(uri, set)
  }
  return set
}

export function resetOidcJwksCache(): void {
  jwksByUri.clear()
}

function strClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function boolClaim(payload: JWTPayload, key: string): boolean {
  const value = payload[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return false
}

/**
 * Verify IdP ID token (RS/ES via JWKS). Does not establish CoreEngine admin —
 * that still comes from app_users after identity link.
 */
export async function verifyOidcIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<OidcIdClaims> {
  const cfg = readOidcConfig()
  const discovery = await fetchOidcDiscovery()
  const jwks = jwksFor(discovery.jwks_uri)

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: cfg.issuer,
    audience: cfg.audience || cfg.clientId,
    algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
  })

  const audiences = Array.isArray(payload.aud)
    ? payload.aud.map(String)
    : payload.aud != null
      ? [String(payload.aud)]
      : []
  const azp = strClaim(payload, 'azp')
  // OIDC Core: multi-audience tokens must carry azp naming the authorized party.
  if (audiences.length > 1) {
    if (!azp) throw new Error('OIDC id_token missing azp for multi-audience token')
    if (azp !== cfg.clientId) throw new Error('OIDC id_token azp mismatch')
  } else if (azp && azp !== cfg.clientId) {
    throw new Error('OIDC id_token azp mismatch')
  }

  const sub = strClaim(payload, 'sub')
  if (!sub) throw new Error('OIDC id_token missing sub')

  const nonce = strClaim(payload, 'nonce')
  if (!nonce || nonce !== expectedNonce) {
    throw new Error('OIDC id_token nonce mismatch')
  }

  const email = strClaim(payload, 'email')
  if (!email) throw new Error('OIDC id_token missing email')

  // Email linking / JIT require a positively verified address — missing is not verified.
  if (payload.email_verified === undefined) {
    throw new Error('OIDC id_token missing email_verified')
  }
  const emailVerified = boolClaim(payload, 'email_verified')
  if (!emailVerified) {
    throw new Error('OIDC email is not verified')
  }

  return {
    iss: cfg.issuer,
    sub,
    email,
    emailVerified: true,
    givenName: strClaim(payload, 'given_name'),
    familyName: strClaim(payload, 'family_name'),
    nonce,
  }
}
