import { describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const requireAuthenticatedUser = vi.fn()
const visibleSchemaEntityNames = vi.fn()
const resolveAppRoleId = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

vi.mock('../auth/accessGuards.js', () => ({
  requireAuthenticatedUser: (...args: unknown[]) => requireAuthenticatedUser(...args),
  requireAdminAccess: vi.fn(),
  requireSelfOrAdmin: vi.fn(),
}))

vi.mock('../services/rolePermissions.js', async () => {
  const actual = await vi.importActual<typeof import('../services/rolePermissions.js')>(
    '../services/rolePermissions.js',
  )
  return {
    ...actual,
    visibleSchemaEntityNames: (...args: unknown[]) => visibleSchemaEntityNames(...args),
    resolveAppRoleId: (...args: unknown[]) => resolveAppRoleId(...args),
  }
})

// Import after mocks — resolvers pulls many modules; keep test focused on SQL filter shape.
import { resolvers } from './index.js'

describe('layoutSettings visibility for navigation meta', () => {
  it('includes crm_navigation / app group rows for non-admins', async () => {
    requireAuthenticatedUser.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
      roleAdminAccess: false,
      roleId: 'role-clinician',
      canAuthorReports: false,
      mustChangePassword: false,
    })
    visibleSchemaEntityNames.mockResolvedValue(new Set(['visit', 'patient']))
    resolveAppRoleId.mockResolvedValue('role-clinician')
    query.mockResolvedValue([])

    await resolvers.Query.layoutSettings(
      null,
      {},
      { authorization: 'Bearer t', rolePreview: null, clientKey: 'test' },
    )

    expect(query).toHaveBeenCalled()
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('group_key = ')
    expect(sql).toMatch(/entity_api_name = ANY\(\$\d+::text\[\]\) OR group_key = 'app'/)
    expect(params).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['visit', 'patient']),
        expect.arrayContaining(['crm_navigation', '_report_folder']),
        expect.arrayContaining(['role-clinician']),
      ]),
    )
  })
})
