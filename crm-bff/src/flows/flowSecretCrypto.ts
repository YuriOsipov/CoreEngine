/**
 * At-rest encryption for Setup → External Flows custom-URL auth secrets.
 * Format: `flowv1:` + base64url(iv || tag || ciphertext) — AES-256-GCM.
 *
 * Key: `FLOWS_SECRET_ENCRYPTION_KEY` (raw or base64 32-byte), else SHA-256 of
 * `coreengine-flow-auth-at-rest:` + AUTH_JWT_SECRET.
 *
 * Prefer a dedicated `FLOWS_SECRET_ENCRYPTION_KEY` in production so rotating
 * `AUTH_JWT_SECRET` does not invalidate sealed flow auth.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const FLOW_SECRET_PREFIX = 'flowv1:'

function resolveKey(): Buffer {
  const dedicated = String(process.env.FLOWS_SECRET_ENCRYPTION_KEY || '').trim()
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
      'Cannot seal flow auth secrets: set FLOWS_SECRET_ENCRYPTION_KEY or AUTH_JWT_SECRET',
    )
  }
  return createHash('sha256')
    .update(`coreengine-flow-auth-at-rest:${jwt}`, 'utf8')
    .digest()
}

/** Encrypt a secret for DB storage. Empty → empty string. */
export function sealFlowSecret(plaintext: string | null | undefined): string {
  const value = String(plaintext ?? '')
  if (!value) return ''
  if (value.startsWith(FLOW_SECRET_PREFIX)) return value
  const key = resolveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return FLOW_SECRET_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64url')
}

/**
 * Decrypt a sealed secret. Legacy plaintext (no `flowv1:` prefix) is returned
 * as-is so rows written before encryption still work until the next save.
 */
export function openFlowSecret(sealed: string | null | undefined): string {
  const value = String(sealed ?? '')
  if (!value) return ''
  if (!value.startsWith(FLOW_SECRET_PREFIX)) return value
  try {
    const raw = Buffer.from(value.slice(FLOW_SECRET_PREFIX.length), 'base64url')
    if (raw.length < 12 + 16 + 1) {
      console.warn('[flowSecretCrypto] sealed flow secret too short; treating as empty')
      return ''
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
      '[flowSecretCrypto] failed to open sealed flow secret (key rotated or corrupt); treating as empty',
      error instanceof Error ? error.message : error,
    )
    return ''
  }
}

export function isSealedFlowSecret(value: string | null | undefined): boolean {
  return String(value ?? '').startsWith(FLOW_SECRET_PREFIX)
}
