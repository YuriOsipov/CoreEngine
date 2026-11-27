import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
  pool: { query: vi.fn(), end: vi.fn() },
}))

import { applyConfigSnapshot } from './applySnapshot.js'
import { importSelectedRecords } from './records.js'
import { SnapshotHttpError } from './errors.js'

describe('applyConfigSnapshot', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('does not query the database when the body contains records', async () => {
    await expect(
      applyConfigSnapshot({ kernelMigrations: ['a.sql'], records: { item: [] } }),
    ).rejects.toBeInstanceOf(SnapshotHttpError)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 409 when the snapshot is ahead and does not write', async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes('schema_migrations')) return [{ filename: 'a.sql' }]
      throw new Error(`unexpected sql: ${sql}`)
    })
    await expect(
      applyConfigSnapshot({ kernelMigrations: ['a.sql', 'b.sql'], entities: [] }),
    ).rejects.toThrow(/Run registry:migrate on Production/)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when the target is ahead of the snapshot', async () => {
    query.mockResolvedValue([{ filename: 'a.sql' }, { filename: 'c.sql' }])
    await expect(
      applyConfigSnapshot({ kernelMigrations: ['a.sql'], entities: [], roles: [], tasks: [] }),
    ).rejects.toThrow(/sandbox/)
  })
})

describe('importSelectedRecords', () => {
  beforeEach(() => {
    query.mockReset()
    delete process.env.APP_ENV
  })

  it('returns 403 when APP_ENV is not sandbox and does not write', async () => {
    await expect(
      importSelectedRecords({ entities: ['item'], records: {} }, {}),
    ).rejects.toMatchObject({ status: 403 })
    expect(query).not.toHaveBeenCalled()
  })
})
