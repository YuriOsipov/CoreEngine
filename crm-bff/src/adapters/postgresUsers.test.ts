import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

import { escapeIlikePattern, postgresListUsers } from './postgresUsers.js'

describe('postgresListUsers', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('never interpolates client fields into SQL and ignores credential-like fields', async () => {
    query.mockResolvedValueOnce([
      {
        id: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
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

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/SELECT COALESCE\(NULLIF\(backend_user_id/)
    expect(sql).toMatch(/FROM public\.app_users/)
    expect(sql).toMatch(/ESCAPE/)
    expect(sql).not.toMatch(/password/i)
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
    query.mockResolvedValueOnce([
      {
        id: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
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

  it('escapes ILIKE wildcards in search', async () => {
    query.mockResolvedValueOnce([])
    await postgresListUsers({ search: 'a%b_c\\d', limit: 5 })
    const [, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params[0]).toBe(`%${escapeIlikePattern('a%b_c\\d')}%`)
    expect(params[0]).toBe('%a\\%b\\_c\\\\d%')
  })

  it('caps limit and does not dump the full user table without filters', async () => {
    await expect(postgresListUsers({})).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()

    query.mockResolvedValueOnce([])
    await postgresListUsers({ search: 'x', limit: 50_000 })
    const [, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params[1]).toBe(200)
  })
})

describe('escapeIlikePattern', () => {
  it('escapes %, _, and backslash', () => {
    expect(escapeIlikePattern('100%_done\\x')).toBe('100\\%\\_done\\\\x')
  })
})
