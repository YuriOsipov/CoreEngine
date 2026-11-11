/**
 * Bearer header helpers. Do **not** use unsigned JWT payload decoding for auth —
 * forgeable claims must never establish identity or admin. Use `verifyAccessToken`.
 */

export function bearerToken(authorization: string | null | undefined): string | null {
  const raw = authorization?.trim()
  if (!raw) return null
  if (/^bearer\s+/i.test(raw)) return raw.replace(/^bearer\s+/i, '').trim() || null
  return raw
}
