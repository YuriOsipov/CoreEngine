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
  email: 'user@example.com',
  emailVerified: true,
  givenName: 'Platform',
  familyName: 'User',
  nonce: 'n',
}

describe('resolveUserFromOidcClaims', () => {
  beforeEach(() => {
    query.mockReset()
    resetOidcConfigCache()
    delete process.env.OIDC_JIT_PROVISION
    delete process.env.OIDC_DEFAULT_ROLE_BACKEND_ID
    delete process.env.OIDC_ALLOWED_EMAIL_DOMAINS
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

  it('links by email when subject is new and user is not admin', async () => {
    query
      .mockResolvedValueOnce([]) // by subject
      .mockResolvedValueOnce([
        {
          id: 'u2',
          backend_user_id: 'b2',
          email: claims.email,
          is_active: true,
          role_backend_id: 'member',
          is_admin: false,
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
          role_backend_id: 'member',
          is_admin: false,
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

  it('refuses email-link when emailVerified is false', async () => {
    query
      .mockResolvedValueOnce([]) // by subject
      .mockResolvedValueOnce([
        {
          id: 'u2',
          backend_user_id: 'b2',
          email: claims.email,
          is_active: true,
          role_backend_id: 'member',
          is_admin: false,
          password_hash: 'x',
          must_change_password: false,
        },
      ])

    const result = await resolveUserFromOidcClaims({
      ...claims,
      emailVerified: false,
    })
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(String((result as { error: string }).error)).toMatch(/not verified/i)
  })

  it('refuses email-link for admin accounts', async () => {
    query
      .mockResolvedValueOnce([]) // by subject
      .mockResolvedValueOnce([
        {
          id: 'u-admin',
          backend_user_id: 'b-admin',
          email: claims.email,
          is_active: true,
          role_backend_id: 'admin',
          is_admin: true,
          password_hash: 'x',
          must_change_password: false,
        },
      ])

    const result = await resolveUserFromOidcClaims(claims)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(String((result as { error: string }).error)).toMatch(/Admin accounts/i)
  })

  it('rejects email outside OIDC_ALLOWED_EMAIL_DOMAINS', async () => {
    process.env.OIDC_ALLOWED_EMAIL_DOMAINS = 'acme.com'
    resetOidcConfigCache()
    query.mockResolvedValueOnce([]) // by subject
    const result = await resolveUserFromOidcClaims(claims)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(String((result as { error: string }).error)).toMatch(/domain/i)
  })

  it('recovers JIT unique races by reloading the concurrent user', async () => {
    process.env.OIDC_JIT_PROVISION = 'true'
    process.env.OIDC_DEFAULT_ROLE_BACKEND_ID = 'member'
    process.env.OIDC_ALLOWED_EMAIL_DOMAINS = 'example.com'
    resetOidcConfigCache()

    query
      .mockResolvedValueOnce([]) // by subject
      .mockResolvedValueOnce([]) // by email
      .mockResolvedValueOnce([{ id: 'role-1' }]) // role lookup
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
      .mockResolvedValueOnce([
        {
          id: 'u-raced',
          backend_user_id: 'oidc:idp-sub-1',
          email: claims.email,
          is_active: true,
          role_backend_id: 'member',
          is_admin: false,
          password_hash: null,
          must_change_password: false,
        },
      ])

    const result = await resolveUserFromOidcClaims(claims)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.id).toBe('u-raced')
  })
})
