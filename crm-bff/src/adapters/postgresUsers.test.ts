import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

import {
  clearHasAppUsersCache,
  escapeIlikePattern,
  postgresListUsers,
} from './postgresUsers.js'

function mockProfileMeta(): void {
  query
    .mockResolvedValueOnce([
      { column_name: 'id' },
      { column_name: 'first_name' },
      { column_name: 'last_name' },
      { column_name: 'email' },
      { column_name: 'role_id' },
      { column_name: 'is_active' },
      { column_name: 'backend_user_id' },
      { column_name: 'updated_at' },
    ])
    .mockResolvedValueOnce([
      { api_name: 'first_name' },
      { api_name: 'last_name' },
      { api_name: 'email' },
      { api_name: 'role_id' },
      { api_name: 'is_active' },
    ])
}

describe('postgresListUsers', () => {
  beforeEach(() => {
    query.mockReset()
    clearHasAppUsersCache()
  })

  it('never interpolates client fields into SQL and ignores credential-like fields', async () => {
    mockProfileMeta()
    query.mockResolvedValueOnce([
      {
        id: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        role_id: null,
        is_active: true,
      },
    ])

    const rows = await postgresListUsers({
      search: 'Ada',
      fields: [
        'id',
        'email',
        'password_hash',
        'password',
        "email); DROP TABLE app_users;--",
        'first_name',
      ],
      limit: 10,
      includeEmail: true,
    })

    expect(query).toHaveBeenCalledTimes(3)
    const [sql, params] = query.mock.calls[2] as [string, unknown[]]
    expect(sql).toMatch(/SELECT COALESCE\(NULLIF\(backend_user_id/)
    expect(sql).toMatch(/FROM public\.app_users/)
    expect(sql).toMatch(/ESCAPE/)
    expect(sql).not.toMatch(/password_hash/i)
    expect(sql).not.toMatch(/app_user_credentials/)
    expect(sql).not.toContain('DROP TABLE')
    expect(params).toEqual(['%Ada%', 10])

    expect(rows).toEqual([
      {
        id: 'u1',
        email: 'ada@example.com',
        first_name: 'Ada',
      },
    ])
    expect(rows[0]).not.toHaveProperty('password_hash')
    expect(rows[0]).not.toHaveProperty('password')
  })

  it('omits email unless includeEmail is true', async () => {
    mockProfileMeta()
    query.mockResolvedValueOnce([
      {
        id: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        role_id: null,
        is_active: true,
      },
    ])
    const rows = await postgresListUsers({
      search: 'Ada',
      fields: ['id', 'email', 'first_name'],
      limit: 10,
    })
    expect(rows).toEqual([{ id: 'u1', first_name: 'Ada' }])
    expect(rows[0]).not.toHaveProperty('email')
  })

  it('includes email on id lookups for detail layouts', async () => {
    mockProfileMeta()
    query
      .mockResolvedValueOnce([
        {
          id: 'u1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          role_id: null,
          is_active: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          match_id: 'u1',
          id: 'u1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          role_id: null,
          is_active: true,
        },
      ])

    const rows = await postgresListUsers({
      ids: ['u1'],
      fields: ['id', 'email', 'first_name'],
      limit: 1,
    })
    expect(rows).toEqual([
      { id: 'u1', email: 'ada@example.com', first_name: 'Ada' },
    ])
  })

  it('escapes ILIKE wildcards in search', async () => {
    mockProfileMeta()
    query.mockResolvedValueOnce([])
    await postgresListUsers({ search: 'a%b_c\\d', limit: 5 })
    const [, params] = query.mock.calls[2] as [string, unknown[]]
    expect(params[0]).toBe(`%${escapeIlikePattern('a%b_c\\d')}%`)
    expect(params[0]).toBe('%a\\%b\\_c\\\\d%')
  })

  it('caps limit and does not dump the full user table without filters', async () => {
    await expect(postgresListUsers({})).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()

    mockProfileMeta()
    query.mockResolvedValueOnce([])
    await postgresListUsers({ search: 'x', limit: 50_000 })
    const [, params] = query.mock.calls[2] as [string, unknown[]]
    expect(params[1]).toBe(200)
  })
})

describe('escapeIlikePattern', () => {
  it('escapes %, _, and backslash', () => {
    expect(escapeIlikePattern('100%_done\\x')).toBe('100\\%\\_done\\\\x')
  })
})
