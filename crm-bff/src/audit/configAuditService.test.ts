import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
  pool: { query: vi.fn(), end: vi.fn() },
}))

import {
  listConfigAudits,
  recordConfigAudit,
  writeConfigAudit,
} from './configAuditService.js'

describe('configAuditService', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('writes an append-only config audit row', async () => {
    query.mockResolvedValueOnce([{ id: '42' }])
    const id = await writeConfigAudit({
      action: 'UPDATE',
      resourceType: 'field',
      resourceKey: 'employee.salary',
      summary: 'Updated field sensitivity',
      userId: 'user-1',
      after: { sensitivity: 2 },
    })
    expect(id).toBe('42')
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]!
    expect(String(sql)).toMatch(/INSERT INTO public\.config_audits/i)
    expect(params[0]).toBe('UPDATE')
    expect(params[1]).toBe('field')
    expect(params[2]).toBe('employee.salary')
    expect(params[5]).toBeNull()
    expect(JSON.parse(String(params[6]))).toEqual({ sensitivity: 2 })
  })

  it('swallows write failures (best-effort after successful Setup mutation)', async () => {
    query.mockRejectedValueOnce(new Error('relation does not exist'))
    await expect(
      writeConfigAudit({
        action: 'CREATE',
        resourceType: 'entity',
        resourceKey: 'account',
        summary: 'Created entity',
      }),
    ).resolves.toBeNull()
  })

  it('recordConfigAudit uses the real session actor id', async () => {
    query.mockResolvedValueOnce([{ id: '7' }])
    await recordConfigAudit(
      { id: 'preview-user', auditActorId: 'admin-user' } as never,
      {
        action: 'REPLACE',
        resourceType: 'role_permissions',
        resourceKey: 'role:sales',
        summary: 'Replaced role permissions',
        after: { count: 3 },
      },
    )
    expect(query.mock.calls[0]![1][4]).toBe('admin-user')
  })

  it('lists audits newest-first with optional resource filters', async () => {
    query
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([
        {
          id: '9',
          action: 'UPDATE',
          resource_type: 'entity',
          resource_key: 'account',
          summary: 'Updated entity meta',
          user_id: 'u1',
          before_state: null,
          after_state: { hidden: true },
          created_at: '2026-11-23T12:00:00.000Z',
        },
      ])
    const page = await listConfigAudits({
      resourceType: 'entity',
      limit: 10,
      offset: 0,
    })
    expect(page.totalCount).toBe(1)
    expect(page.nodes[0]).toMatchObject({
      id: '9',
      resourceType: 'entity',
      resourceKey: 'account',
      after: { hidden: true },
    })
  })
})
