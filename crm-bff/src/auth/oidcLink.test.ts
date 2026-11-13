import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

import { resolveUserFromOidcClaims } from './oidcLink.js'
import { resetOidcConfigCache } from './oidcConfig.js'

const claims = {
  iss: 'http://localhost:8081/realms/coreengine',
  sub: 'idp-sub-1',
  email: 'admin@example.com',
  emailVerified: true,
  givenName: 'Platform',
  familyName: 'Admin',
  nonce: 'n',
}

describe('resolveUserFromOidcClaims', () => {
  beforeEach(() => {
    query.mockReset()
    resetOidcConfigCache()
    delete process.env.OIDC_JIT_PROVISION
    delete process.env.OIDC_DEFAULT_ROLE_BACKEND_ID
    process.env.OIDC_ENABLED = 'true'
    process.env.OIDC_ISSUER = claims.iss
    process.env.OIDC_CLIENT_ID = 'c'
    process.env.OIDC_CLIENT_SECRET = 's'
    process.env.OIDC_REDIRECT_URI = 'http://localhost:4000/auth/oidc/callback'
    process.env.OIDC_UI_ORIGIN = 'http://localhost:5173'
  })

  it('returns existing user matched by issuer+subject', async () => {
    query.mockResolvedValueOnce([
      {
        id: 'u1',
        backend_user_id: 'b1',
        email: claims.email,
        is_active: true,
        role_backend_id: 'admin',
        is_admin: true,
        password_hash: null,
        must_change_password: false,
      },
    ])
    const result = await resolveUserFromOidcClaims(claims)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.id).toBe('u1')
  })

  it('rejects when no user and JIT is off', async () => {
    query
      .mockResolvedValueOnce([]) // by subject
      .mockResolvedValueOnce([]) // by email
    const result = await resolveUserFromOidcClaims(claims)
    expect(result).toMatchObject({ ok: false, status: 403 })
  })

  it('links by email when subject is new', async () => {
    query
      .mockResolvedValueOnce([]) // by subject
      .mockResolvedValueOnce([
        {
          id: 'u2',
          backend_user_id: 'b2',
          email: claims.email,
          is_active: true,
          role_backend_id: 'admin',
          is_admin: true,
          password_hash: 'x',
          must_change_password: false,
        },
      ])
      .mockResolvedValueOnce([{ oidc_subject: null }]) // existing link check
      .mockResolvedValueOnce(undefined) // UPDATE link
      .mockResolvedValueOnce([
        {
          id: 'u2',
          backend_user_id: 'b2',
          email: claims.email,
          is_active: true,
          role_backend_id: 'admin',
          is_admin: true,
          password_hash: 'x',
          must_change_password: false,
        },
      ])

    const result = await resolveUserFromOidcClaims(claims)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.id).toBe('u2')
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET oidc_issuer'),
      expect.arrayContaining(['u2', claims.iss, claims.sub]),
    )
  })
})
