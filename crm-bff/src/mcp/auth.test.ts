import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminAccess = vi.fn()
const requireAuthenticatedUser = vi.fn()

vi.mock('../auth/accessGuards.js', () => ({
  requireAdminAccess: (...args: unknown[]) => requireAdminAccess(...args),
  requireAuthenticatedUser: (...args: unknown[]) =>
    requireAuthenticatedUser(...args),
}))

import { assertToolAccess } from './auth.js'

describe('MCP assertToolAccess', () => {
  beforeEach(() => {
    requireAdminAccess.mockReset()
    requireAuthenticatedUser.mockReset()
  })

  it('requires admin for list_objects', async () => {
    requireAdminAccess.mockResolvedValue({ id: 'admin-1', adminAccess: true })
    const me = await assertToolAccess(
      { authorization: 'Bearer t' },
      'list_objects',
    )
    expect(requireAdminAccess).toHaveBeenCalled()
    expect(requireAuthenticatedUser).not.toHaveBeenCalled()
    expect(me.id).toBe('admin-1')
  })

  it('allows authenticated user for query_records', async () => {
    requireAuthenticatedUser.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
    })
    const me = await assertToolAccess(
      { authorization: 'Bearer t' },
      'query_records',
    )
    expect(requireAuthenticatedUser).toHaveBeenCalled()
    expect(me.id).toBe('u1')
  })

  it('denies admin tool when requireAdminAccess throws', async () => {
    requireAdminAccess.mockRejectedValue(new Error('Admin access required'))
    await expect(
      assertToolAccess({ authorization: 'Bearer t' }, 'export_domain_pack'),
    ).rejects.toThrow(/Admin access required/)
  })

  it('blocks schema write tools when MCP_SCHEMA_WRITE_ENABLED is off', async () => {
    const prev = process.env.MCP_SCHEMA_WRITE_ENABLED
    delete process.env.MCP_SCHEMA_WRITE_ENABLED
    requireAdminAccess.mockResolvedValue({ id: 'admin-1', adminAccess: true })
    await expect(
      assertToolAccess({ authorization: 'Bearer t' }, 'upsert_object_schema'),
    ).rejects.toThrow(/MCP_SCHEMA_WRITE_ENABLED/)
    process.env.MCP_SCHEMA_WRITE_ENABLED = 'true'
    const me = await assertToolAccess(
      { authorization: 'Bearer t' },
      'upsert_object_schema',
    )
    expect(me.id).toBe('admin-1')
    if (prev === undefined) delete process.env.MCP_SCHEMA_WRITE_ENABLED
    else process.env.MCP_SCHEMA_WRITE_ENABLED = prev
  })

  it('enforces MCP credential scopes when mcpScopes is set', async () => {
    requireAuthenticatedUser.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
      mcpScopes: ['read'],
      mcpCredentialId: 'cred-1',
    })
    await expect(
      assertToolAccess({ authorization: 'Bearer ce_mcp_x' }, 'create_record'),
    ).rejects.toThrow(/requires MCP credential scope "write"/)

    requireAuthenticatedUser.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
      mcpScopes: ['write'],
      mcpCredentialId: 'cred-1',
    })
    const me = await assertToolAccess(
      { authorization: 'Bearer ce_mcp_x' },
      'create_record',
    )
    expect(me.id).toBe('u1')
  })

  it('skips credential scope check for web-session JWT (no mcpScopes)', async () => {
    requireAuthenticatedUser.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
    })
    const me = await assertToolAccess(
      { authorization: 'Bearer jwt' },
      'create_record',
    )
    expect(me.id).toBe('u1')
  })
})
