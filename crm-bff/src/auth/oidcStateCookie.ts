import { createHash, timingSafeEqual } from 'node:crypto'

/** Binds OIDC `state` to the browser that started `/auth/oidc/login` (login CSRF). */
export const OIDC_STATE_COOKIE = 'ce_oidc_state'
/** Stores IdP ID token for RP-initiated logout (`id_token_hint`). */
export const OIDC_ID_TOKEN_COOKIE = 'ce_oidc_id_token'
const COOKIE_MAX_AGE_SEC = 10 * 60
/** Align with typical SSO browser session; cookie is cleared on IdP logout. */
const ID_TOKEN_COOKIE_MAX_AGE_SEC = 12 * 60 * 60
/** Browsers reject oversized cookies; skip hint rather than breaking Set-Cookie. */
const ID_TOKEN_COOKIE_MAX_CHARS = 3500

export function hashOidcState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

export function readRequestCookie(
  cookieHeader: string | string[] | undefined,
  name: string,
): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader
  if (!raw) return null
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    if (key !== name) continue
    return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

export function oidcStateCookieMatches(
  state: string,
  cookieValue: string | null | undefined,
): boolean {
  if (!cookieValue) return false
  const expected = hashOidcState(state)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(cookieValue, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function buildOidcStateSetCookie(
  state: string,
  options: { secure: boolean },
): string {
  const parts = [
    `${OIDC_STATE_COOKIE}=${encodeURIComponent(hashOidcState(state))}`,
    'Path=/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildOidcStateClearCookie(options: { secure: boolean }): string {
  const parts = [
    `${OIDC_STATE_COOKIE}=`,
    'Path=/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildOidcIdTokenSetCookie(
  idToken: string,
  options: { secure: boolean },
): string | null {
  const value = String(idToken || '').trim()
  if (!value || value.length > ID_TOKEN_COOKIE_MAX_CHARS) return null
  const parts = [
    `${OIDC_ID_TOKEN_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ID_TOKEN_COOKIE_MAX_AGE_SEC}`,
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildOidcIdTokenClearCookie(options: { secure: boolean }): string {
  const parts = [
    `${OIDC_ID_TOKEN_COOKIE}=`,
    'Path=/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}
