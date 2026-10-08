/**
 * Decode an opaque JWT access/static token without verifying the signature.
 * Used to extract `id` so `me` can be served from `app_users` without a
 * remote /users/me round-trip. Expired tokens are treated as empty.
 */
export interface JwtTokenClaims {
  id: string | null
  role: string | null
  adminAccess: boolean
  exp: number | null
}

export function bearerToken(authorization: string | null | undefined): string | null {
  const raw = authorization?.trim()
  if (!raw) return null
  if (/^bearer\s+/i.test(raw)) return raw.replace(/^bearer\s+/i, '').trim() || null
  return raw
}

export function decodeJwtClaims(token: string | null | undefined): JwtTokenClaims | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    )
    const payload = JSON.parse(json) as {
      id?: unknown
      role?: unknown
      admin_access?: unknown
      exp?: unknown
    }
    const exp =
      typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null
    if (exp != null && exp * 1000 < Date.now()) return null

    const id = payload.id == null ? null : String(payload.id)
    const role = payload.role == null ? null : String(payload.role)
    return {
      id,
      role,
      adminAccess: payload.admin_access === true,
      exp,
    }
  } catch {
    return null
  }
}
