/**
 * At-rest encryption for IdP access/refresh tokens on CE refresh rows.
 * Format: `v1:` + base64url(iv || tag || ciphertext) — AES-256-GCM.
 *
 * Key: `OIDC_TOKEN_ENCRYPTION_KEY` (raw or base64 32-byte), else SHA-256 of
 * `coreengine-oidc-at-rest:` + AUTH_JWT_SECRET.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'v1:'

function resolveKey(): Buffer {
  const dedicated = String(process.env.OIDC_TOKEN_ENCRYPTION_KEY || '').trim()
  if (dedicated) {
    try {
      const asB64 = Buffer.from(dedicated, 'base64')
      if (asB64.length === 32) return asB64
    } catch {
      // fall through — treat as passphrase
    }
    return createHash('sha256').update(dedicated, 'utf8').digest()
  }
  const jwt =
    String(process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || '').trim()
  if (!jwt) {
    throw new Error(
      'Cannot seal IdP tokens: set OIDC_TOKEN_ENCRYPTION_KEY or AUTH_JWT_SECRET',
    )
  }
  return createHash('sha256')
    .update(`coreengine-oidc-at-rest:${jwt}`, 'utf8')
    .digest()
}

/** Encrypt a token for DB storage. Empty → null. */
export function sealOidcToken(plaintext: string | null | undefined): string | null {
  const value = String(plaintext || '').trim()
  if (!value) return null
  const key = resolveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64url')
}

/**
 * Decrypt a sealed token. Legacy plaintext (no `v1:` prefix) is returned as-is
 * so rows written before encryption still work until the next refresh rotate.
 *
 * Decrypt failures (wrong/rotated key, corrupt blob) return null so refresh
 * does not 500 — IdP tokens are treated as absent (same as no offline_access).
 * Prefer a dedicated `OIDC_TOKEN_ENCRYPTION_KEY` in production so rotating
 * `AUTH_JWT_SECRET` does not invalidate sealed IdP tokens.
 */
export function openOidcToken(sealed: string | null | undefined): string | null {
  const value = String(sealed || '').trim()
  if (!value) return null
  if (!value.startsWith(PREFIX)) return value
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64url')
    if (raw.length < 12 + 16 + 1) {
      console.warn('[oidcTokenCrypto] sealed IdP token too short; treating as absent')
      return null
    }
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const enc = raw.subarray(28)
    const key = resolveKey()
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch (error) {
    console.warn(
      '[oidcTokenCrypto] failed to open sealed IdP token (key rotated or corrupt); treating as absent',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}
