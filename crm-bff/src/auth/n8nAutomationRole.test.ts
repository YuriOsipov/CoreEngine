import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const seedFullPermissionsForRole = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))
vi.mock('../services/rolePermissions.js', () => ({
  seedFullPermissionsForRole: (...args: unknown[]) =>
    seedFullPermissionsForRole(...args),
}))

import { resolveN8nAutomationRole } from './n8nAutomationRole.js'

describe('resolveN8nAutomationRole', () => {
  beforeEach(() => {
    query.mockReset()
    seedFullPermissionsForRole.mockReset()
  })

  it('default seed prefers non-admin Integration (creates if missing)', async () => {
    query
      .mockResolvedValueOnce([]) // lookup Integration
      .mockResolvedValueOnce([]) // insert role
    seedFullPermissionsForRole.mockResolvedValue(undefined)

    const role = await resolveN8nAutomationRole({})
    expect(role.isAdmin).toBe(false)
    expect(role.name).toBe('Integration')
    expect(seedFullPermissionsForRole).toHaveBeenCalledWith(role.id)
    const insertSql = String(query.mock.calls[1]?.[0] ?? '')
    expect(insertSql).toMatch(/INSERT INTO public\.app_roles/)
    expect(insertSql).toMatch(/false/)
  })

  it('reuses existing non-admin Integration', async () => {
    query.mockResolvedValueOnce([
      { id: 'role-1', name: 'Integration', is_admin: false },
    ])
    const role = await resolveN8nAutomationRole({})
    expect(role).toEqual({
      id: 'role-1',
      name: 'Integration',
      isAdmin: false,
    })
    expect(seedFullPermissionsForRole).toHaveBeenCalledWith('role-1')
  })

  it('--admin uses an admin role', async () => {
    query.mockResolvedValueOnce([{ id: 'admin-1', name: 'Administrator' }])
    const role = await resolveN8nAutomationRole({ wantAdmin: true })
    expect(role).toEqual({
      id: 'admin-1',
      name: 'Administrator',
      isAdmin: true,
    })
    expect(seedFullPermissionsForRole).not.toHaveBeenCalled()
  })
})
