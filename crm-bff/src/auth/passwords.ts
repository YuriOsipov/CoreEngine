import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { isInsecurePassword } from './insecurePasswords.js'

const KEY_LEN = 64
export const MIN_PASSWORD_LENGTH = 8
/** Upper bound so hashing cost / request size cannot be abused. */
export const MAX_PASSWORD_LENGTH = 256

/**
 * OWASP-equivalent scrypt setting (N=2^15, r=8, p=3): same work as N=2^17/p=1
 * but 32 MiB per hash instead of 128 MiB, so concurrent logins stay bounded.
 */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const
/** Node's implicit defaults used by legacy `scrypt:<salt>:<key>` hashes. */
const LEGACY_SCRYPT_PARAMS = { N: 2 ** 14, r: 8, p: 1 } as const

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  const options: ScryptOptions = {
    ...params,
    maxmem: 256 * params.N * params.r + 32 * 1024 * 1024,
  }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, options, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

/**
 * Policy for any newly chosen password (self-service or admin-set).
 * Returns an error message, or null when acceptable.
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
  }
  if (isInsecurePassword(password)) {
    return 'Password is a known insecure / example value — choose a unique password'
  }
  return null
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
  const salt = randomBytes(16)
  const { N, r, p } = SCRYPT_PARAMS
  const key = await scryptAsync(password, salt, KEY_LEN, SCRYPT_PARAMS)
  return `scrypt$${N}$${r}$${p}:${salt.toString('base64url')}:${key.toString('base64url')}`
}

function parseStoredHash(
  stored: string,
): { params: { N: number; r: number; p: number }; salt: Buffer; key: Buffer } | null {
  const parts = stored.split(':')
  if (parts.length !== 3) return null
  const [scheme, saltRaw, keyRaw] = parts as [string, string, string]
  let params: { N: number; r: number; p: number }
  if (scheme === 'scrypt') {
    params = LEGACY_SCRYPT_PARAMS
  } else {
    const match = /^scrypt\$(\d+)\$(\d+)\$(\d+)$/.exec(scheme)
    if (!match) return null
    params = { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) }
    // Refuse attacker-inflated params from a tampered row.
    if (params.N > 2 ** 20 || params.r > 32 || params.p > 16) return null
  }
  return {
    params,
    salt: Buffer.from(saltRaw, 'base64url'),
    key: Buffer.from(keyRaw, 'base64url'),
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false
  const parsed = parseStoredHash(stored)
  if (!parsed) return false
  try {
    const actual = await scryptAsync(
      password,
      parsed.salt,
      parsed.key.length || KEY_LEN,
      parsed.params,
    )
    if (actual.length !== parsed.key.length) return false
    return timingSafeEqual(actual, parsed.key)
  } catch {
    return false
  }
}

/** True when a stored hash uses weaker params than the current policy. */
export function passwordNeedsRehash(stored: string): boolean {
  const parsed = parseStoredHash(stored)
  if (!parsed) return false
  return (
    parsed.params.N < SCRYPT_PARAMS.N ||
    parsed.params.r < SCRYPT_PARAMS.r ||
    parsed.params.p < SCRYPT_PARAMS.p
  )
}

let dummyHashPromise: Promise<string> | null = null

/**
 * Burn the same scrypt cost as a real verify so unknown / inactive accounts
 * are indistinguishable by response time.
 */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword(randomBytes(24).toString('base64url'))
  await verifyPassword(password, await dummyHashPromise)
}
