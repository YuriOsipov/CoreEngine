import { afterEach, describe, expect, it } from 'vitest'
import { openOidcToken, sealOidcToken } from './oidcTokenCrypto.js'

describe('oidcTokenCrypto', () => {
  afterEach(() => {
    delete process.env.OIDC_TOKEN_ENCRYPTION_KEY
    delete process.env.AUTH_JWT_SECRET
  })

  it('round-trips with AUTH_JWT_SECRET-derived key', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    const sealed = sealOidcToken('idp-refresh-token')
    expect(sealed).toMatch(/^v1:/)
    expect(sealed).not.toContain('idp-refresh-token')
    expect(openOidcToken(sealed)).toBe('idp-refresh-token')
  })

  it('round-trips with dedicated OIDC_TOKEN_ENCRYPTION_KEY', () => {
    process.env.OIDC_TOKEN_ENCRYPTION_KEY = 'dedicated-passphrase-for-oidc-tokens'
    const sealed = sealOidcToken('access-xyz')
    expect(openOidcToken(sealed)).toBe('access-xyz')
  })

  it('passes through legacy plaintext', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    expect(openOidcToken('legacy-plaintext-token')).toBe('legacy-plaintext-token')
  })

  it('returns null for empty', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    expect(sealOidcToken('')).toBeNull()
    expect(openOidcToken(null)).toBeNull()
  })

  it('treats decrypt failure after key rotation as absent (no throw)', () => {
    process.env.AUTH_JWT_SECRET = 'original-jwt-secret-at-least-32-chars'
    const sealed = sealOidcToken('idp-token')
    process.env.AUTH_JWT_SECRET = 'rotated-jwt-secret-at-least-32-chars!'
    expect(openOidcToken(sealed)).toBeNull()
  })
})
