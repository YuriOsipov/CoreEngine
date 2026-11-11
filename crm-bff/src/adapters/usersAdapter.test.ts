import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postgresFetchMe = vi.fn()
const hasAppUsers = vi.fn()
const postgresListUsers = vi.fn()

vi.mock('./postgresUsers.js', () => ({
  hasAppUsers: (...args: unknown[]) => hasAppUsers(...args),
  postgresFetchMe: (...args: unknown[]) => postgresFetchMe(...args),
  postgresListUsers: (...args: unknown[]) => postgresListUsers(...args),
}))

import { signAccessToken } from '../auth/jwt.js'
import { fetchMe } from './usersAdapter.js'

function forgeJwt(payload: Record<string, unknown>, secret = 'wrong-secret'): string {
  const b64url = (input: string) =>
    Buffer.from(input, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

describe('fetchMe JWT verification', () => {
  beforeEach(() => {
    hasAppUsers.mockReset()
    postgresFetchMe.mockReset()
    hasAppUsers.mockResolvedValue(true)
    process.env.AUTH_JWT_SECRET = 'test-bff-secret-at-least-32-chars!!'
    process.env.DIRECTUS_TOKEN = 'server-static-token'
    process.env.VITE_DIRECTUS_TOKEN = 'vite-static-token'
  })

  it('returns empty me when Authorization is missing (no static-token fallback)', async () => {
    const me = await fetchMe({ authorization: null })
    expect(me.id).toBeNull()
    expect(me.adminAccess).toBe(false)
    expect(postgresFetchMe).not.toHaveBeenCalled()
  })

  it('does not elevate when the Bearer value is the Directus static token', async () => {
    const me = await fetchMe({
      authorization: 'Bearer server-static-token',
    })
    expect(me.id).toBeNull()
    expect(postgresFetchMe).not.toHaveBeenCalled()
  })

  it('rejects forged tokens (wrong secret) even with a real admin id in the payload', async () => {
    const forged = forgeJwt({
      id: 'admin-user-id',
      role: 'admin',
      admin_access: true,
      iss: 'crm-bff',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    postgresFetchMe.mockResolvedValue({
      id: 'admin-user-id',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@example.com',
      adminAccess: true,
      roleId: 'role-admin',
      roleName: 'Admin',
      roleAdminAccess: true,
      mustChangePassword: false,
    })

    const me = await fetchMe({ authorization: `Bearer ${forged}` })
    expect(me.id).toBeNull()
    expect(me.adminAccess).toBe(false)
    expect(postgresFetchMe).not.toHaveBeenCalled()
  })

  it('loads the user from DB for a verified token (admin never from JWT)', async () => {
    const token = signAccessToken({
      id: 'user-1',
      role: 'role-1',
    })
    postgresFetchMe.mockResolvedValue({
      id: 'user-1',
      firstName: 'Pat',
      lastName: 'Lee',
      email: 'pat@example.com',
      adminAccess: false,
      roleId: 'role-1',
      roleName: 'Sales',
      roleAdminAccess: false,
      mustChangePassword: false,
    })

    const me = await fetchMe({ authorization: `Bearer ${token}` })
    expect(me).toMatchObject({
      id: 'user-1',
      adminAccess: false,
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    expect(postgresFetchMe).toHaveBeenCalledWith('user-1')
  })

  it('returns empty me when the DB user is missing or inactive (no claim-built identity)', async () => {
    const token = signAccessToken({
      id: 'deleted-admin',
      role: 'admin',
    })
    postgresFetchMe.mockResolvedValue(null)

    const me = await fetchMe({ authorization: `Bearer ${token}` })
    expect(me.id).toBeNull()
    expect(me.adminAccess).toBe(false)
    expect(me.roleAdminAccess).toBe(false)
    expect(postgresFetchMe).toHaveBeenCalledWith('deleted-admin')
  })
})
