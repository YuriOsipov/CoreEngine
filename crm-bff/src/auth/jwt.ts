import { createHmac, timingSafeEqual } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({ path: resolve(repoRoot, 'supabase/.env'), override: true })
loadEnv({ path: resolve(__dirname, '../../.env') })

export const BFF_JWT_ISS = 'crm-bff'
export const ACCESS_TTL_SEC = 15 * 60
/** Refresh tokens are opaque DB rows (not JWTs); see `localAuth.ts`. */
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60
const JWT_ALG = 'HS256'
const ACCESS_TOKEN_USE = 'access'
/** Reject trivially guessable signing secrets. */
const MIN_SECRET_LENGTH = 32

/**
 * Secrets shipped in example env files / docs. BFF refuses to start with these
 * so `cp .env*.example .env` cannot leave every deploy forgeable.
 */
export const KNOWN_INSECURE_JWT_SECRETS = new Set([
  'coreengine-docker-dev-jwt-secret-change-me',
  'coreengine-local-dev-jwt-secret-change-me',
  'helix-local-dev-jwt-secret-change-me',
])

export function isInsecureJwtSecret(secret: string): boolean {
  const trimmed = secret.trim()
  if (trimmed.length < MIN_SECRET_LENGTH) return true
  if (KNOWN_INSECURE_JWT_SECRETS.has(trimmed)) return true
  // Catch other "*change-me" placeholders copied from docs.
  if (/change-?me$/i.test(trimmed)) return true
  return false
}

export function authJwtSecret(): string {
  // Never read VITE_* — those are embedded in the browser bundle.
  const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || ''
  const trimmed = secret.trim()
  if (!trimmed) {
    throw new Error(
      'AUTH_JWT_SECRET / JWT_SECRET is required for BFF auth (run platform provision or set a unique ≥32 char secret)',
    )
  }
  if (isInsecureJwtSecret(trimmed)) {
    throw new Error(
      'AUTH_JWT_SECRET / JWT_SECRET is a known example/placeholder value — generate a unique secret (platform provision does this)',
    )
  }
  return trimmed
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlToBuf(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

function parseJsonPart(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(b64urlToBuf(part).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

export interface BffAccessClaims {
  id: string
  role: string | null
  /** Always false in verified claims — admin comes from app_users only. */
  admin_access: boolean
  iss: string
  iat: number
  exp: number
  token_use: typeof ACCESS_TOKEN_USE
}

export function signAccessToken(input: {
  id: string
  role?: string | null
}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: JWT_ALG, typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      id: input.id,
      role: input.role ?? null,
      token_use: ACCESS_TOKEN_USE,
      iss: BFF_JWT_ISS,
      iat: now,
      exp: now + ACCESS_TTL_SEC,
    }),
  )
  const data = `${header}.${payload}`
  const sig = createHmac('sha256', authJwtSecret()).update(data).digest()
  return `${data}.${b64url(sig)}`
}

export function verifyAccessToken(token: string): BffAccessClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const header = parseJsonPart(parts[0])
  if (!header) return null
  // Pin algorithm — reject "none", RS256 confusion, etc.
  if (header.alg !== JWT_ALG) return null
  if (header.typ != null && header.typ !== 'JWT') return null

  const data = `${parts[0]}.${parts[1]}`
  let expected: Buffer
  try {
    expected = createHmac('sha256', authJwtSecret()).update(data).digest()
  } catch {
    return null
  }
  let actual: Buffer
  try {
    actual = b64urlToBuf(parts[2])
  } catch {
    return null
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  const payload = parseJsonPart(parts[1])
  if (!payload) return null
  if (payload.iss !== BFF_JWT_ISS) return null
  // Access tokens only — refresh tokens are opaque DB secrets, not JWTs.
  if (payload.token_use !== ACCESS_TOKEN_USE) return null
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
  if (payload.exp * 1000 < Date.now()) return null
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) return null
  if (payload.id == null) return null

  return {
    id: String(payload.id),
    role: payload.role == null ? null : String(payload.role),
    admin_access: false,
    iss: BFF_JWT_ISS,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
    exp: payload.exp,
    token_use: ACCESS_TOKEN_USE,
  }
}
