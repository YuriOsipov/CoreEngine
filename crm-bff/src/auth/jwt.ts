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
/** Refresh tokens always live 30 days; access JWTs stay short-lived. */
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60

export function authJwtSecret(): string {
  const secret =
    process.env.AUTH_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.VITE_AUTH_JWT_SECRET ||
    ''
  if (!secret.trim()) {
    throw new Error('AUTH_JWT_SECRET / JWT_SECRET is required for BFF auth')
  }
  return secret.trim()
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

export interface BffAccessClaims {
  id: string
  role: string | null
  admin_access: boolean
  iss: string
  iat: number
  exp: number
}

export function signAccessToken(input: {
  id: string
  role?: string | null
  adminAccess?: boolean
}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      id: input.id,
      role: input.role ?? null,
      admin_access: input.adminAccess === true,
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
  const data = `${parts[0]}.${parts[1]}`
  const expected = createHmac('sha256', authJwtSecret()).update(data).digest()
  let actual: Buffer
  try {
    actual = b64urlToBuf(parts[2])
  } catch {
    return null
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')) as Partial<BffAccessClaims>
    if (payload.iss !== BFF_JWT_ISS) return null
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    if (payload.id == null) return null
    return {
      id: String(payload.id),
      role: payload.role == null ? null : String(payload.role),
      admin_access: payload.admin_access === true,
      iss: BFF_JWT_ISS,
      iat: Number(payload.iat ?? 0),
      exp: payload.exp,
    }
  } catch {
    return null
  }
}
