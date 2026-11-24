import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

import { postgresListDashboards, postgresListPanels } from './postgresDashboards.js'
import { postgresListPresets } from './postgresPresets.js'

describe('list visibility SQL scope', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue([])
  })

  it('scopes presets to global + own user + role refs', async () => {
    await postgresListPresets({
      visibility: {
        kind: 'scoped',
        userId: 'u1',
        roleRefs: ['role-a', 'role-b'],
      },
    })
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/user_id IS NULL AND role_id IS NULL/)
    expect(sql).toMatch(/user_id = \$1/)
    expect(sql).toMatch(/role_id::text = ANY\(\$2::text\[\]\)/)
    expect(params[0]).toBe('u1')
    expect(params[1]).toEqual(['role-a', 'role-b'])
  })

  it('scopes dashboards by role_id', async () => {
    await postgresListDashboards({
      visibility: { kind: 'scoped', userId: 'u1', roleRefs: ['role-a'] },
    })
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/role_id IS NULL OR role_id::text = ANY\(\$1::text\[\]\)/)
    expect(params[0]).toEqual(['role-a'])
  })

  it('scopes panels to visible parent dashboards', async () => {
    await postgresListPanels({
      visibility: { kind: 'scoped', userId: 'u1', roleRefs: ['role-a'] },
    })
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/dashboard_id IN \(/)
    expect(sql).toMatch(/FROM public\.app_dashboards/)
    expect(sql).toMatch(/role_id IS NULL OR role_id::text = ANY\(\$1::text\[\]\)/)
    expect(params[0]).toEqual(['role-a'])
  })

  it('does not add visibility clauses for admins', async () => {
    await postgresListDashboards({ visibility: { kind: 'admin' } })
    const [sql] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toMatch(/role_id IS NULL/)
  })
})
