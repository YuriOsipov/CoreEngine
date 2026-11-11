import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BFF_JWT_ISS,
  isInsecureJwtSecret,
  signAccessToken,
  verifyAccessToken,
} from './jwt.js'

const TEST_SECRET = 'test-bff-secret-at-least-32-chars!!'

function b64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function tokenWithHeader(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
): string {
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const data = `${h}.${p}`
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

describe('verifyAccessToken', () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = TEST_SECRET
    delete process.env.VITE_AUTH_JWT_SECRET
  })

  it('accepts a signed HS256 access token and ignores admin claims', () => {
    const token = signAccessToken({ id: 'u1', role: 'r1' })
    const claims = verifyAccessToken(token)
    expect(claims).toMatchObject({
      id: 'u1',
      role: 'r1',
      iss: BFF_JWT_ISS,
      token_use: 'access',
      admin_access: false,
    })
    expect(claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects alg=none and non-HS256 headers', () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      id: 'u1',
      role: null,
      token_use: 'access',
      iss: BFF_JWT_ISS,
      iat: now,
      exp: now + 3600,
    }
    const noneToken = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(
      JSON.stringify(payload),
    )}.`
    expect(verifyAccessToken(noneToken)).toBeNull()

    const rsToken = tokenWithHeader({ alg: 'RS256', typ: 'JWT' }, payload)
    expect(verifyAccessToken(rsToken)).toBeNull()
  })

  it('rejects tokens without token_use=access (refresh JWTs cannot masquerade)', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = tokenWithHeader(
      { alg: 'HS256', typ: 'JWT' },
      {
        id: 'u1',
        token_use: 'refresh',
        iss: BFF_JWT_ISS,
        iat: now,
        exp: now + 30 * 24 * 3600,
      },
    )
    expect(verifyAccessToken(token)).toBeNull()
  })

  it('rejects expired tokens', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = tokenWithHeader(
      { alg: 'HS256', typ: 'JWT' },
      {
        id: 'u1',
        token_use: 'access',
        iss: BFF_JWT_ISS,
        iat: now - 120,
        exp: now - 60,
      },
    )
    expect(verifyAccessToken(token)).toBeNull()
  })

  it('refuses known example/placeholder secrets', () => {
    expect(isInsecureJwtSecret('coreengine-local-dev-jwt-secret-change-me')).toBe(
      true,
    )
    expect(isInsecureJwtSecret('coreengine-docker-dev-jwt-secret-change-me')).toBe(
      true,
    )
    expect(isInsecureJwtSecret(TEST_SECRET)).toBe(false)
  })

  it('does not use VITE_AUTH_JWT_SECRET as the signing secret', async () => {
    delete process.env.AUTH_JWT_SECRET
    delete process.env.JWT_SECRET
    process.env.VITE_AUTH_JWT_SECRET = `${TEST_SECRET}-vite-only`
    const { authJwtSecret } = await import('./jwt.js')
    expect(() => authJwtSecret()).toThrow(/AUTH_JWT_SECRET/)
  })
})
