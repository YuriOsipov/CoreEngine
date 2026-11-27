import { describe, expect, it } from 'vitest'
import { healthBody } from './environment.js'
import {
  MIGRATE_PRODUCTION_MESSAGE,
  MIGRATE_SANDBOX_MESSAGE,
  compareKernelMigrations,
} from './kernel.js'
import { assertConfigOnly } from './config.js'
import { toRoleSnapshot } from './permissions.js'
import { toTaskDefinition } from './tasks.js'
import { planRecordImport, type FkEdge } from './relations.js'
import { SnapshotHttpError } from './errors.js'

const catalog: FkEdge[] = [
  {
    fromEntity: 'item',
    field: 'group',
    toEntity: 'item_group',
    onDelete: 'SET NULL',
    required: false,
  },
  {
    fromEntity: 'item_group',
    field: 'parent',
    toEntity: 'item_group',
    onDelete: 'SET NULL',
    required: false,
  },
  {
    fromEntity: 'item_variant',
    field: 'item',
    toEntity: 'item',
    onDelete: 'RESTRICT',
    required: true,
  },
  {
    fromEntity: 'item_variant',
    field: 'variant',
    toEntity: 'variant',
    onDelete: 'RESTRICT',
    required: true,
  },
]

describe('kernel migration guard', () => {
  it('matches equal filename lists regardless of order', () => {
    expect(compareKernelMigrations(['b.sql', 'a.sql'], ['a.sql', 'b.sql'])).toEqual({ ok: true })
  })

  it('blocks when the snapshot has a migration the target lacks', () => {
    const result = compareKernelMigrations(['a.sql', 'b.sql'], ['a.sql'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(MIGRATE_PRODUCTION_MESSAGE)
      expect(result.extra).toEqual(['b.sql'])
    }
  })

  it('blocks when the target is ahead of the snapshot', () => {
    const result = compareKernelMigrations(['a.sql'], ['a.sql', 'c.sql'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(MIGRATE_SANDBOX_MESSAGE)
      expect(result.extra).toEqual(['c.sql'])
    }
  })
})

describe('config apply refuses business records', () => {
  it('rejects a records section before any database write', () => {
    expect(() => assertConfigOnly({ kernelMigrations: [], records: { item: [] } })).toThrow(
      SnapshotHttpError,
    )
    try {
      assertConfigOnly({ records: { item: [{ recordId: '1' }] } })
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotHttpError)
      expect((error as SnapshotHttpError).status).toBe(400)
      expect((error as Error).message).toMatch(/does not change business records/)
    }
  })

  it('allows a configuration body with no records key', () => {
    expect(() => assertConfigOnly({ kernelMigrations: ['a.sql'], entities: [] })).not.toThrow()
  })
})

describe('permission snapshot', () => {
  it('keeps the matrix and never uses full_pack', () => {
    const role = toRoleSnapshot('Sales Rep', false, false, [
      {
        entityApiName: 'item',
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: false,
        canImport: false,
        canExport: true,
        canViewAll: false,
        canModifyAll: false,
        maxReadSensitivity: 1,
        maxEditSensitivity: 0,
      },
    ])
    expect(role.permissions).toHaveLength(1)
    expect(role.permissions[0]?.canUpdate).toBe(false)
    expect(JSON.stringify(role)).not.toContain('full_pack')
  })
})

describe('task definitions', () => {
  it('strips runtime columns', () => {
    const definition = toTaskDefinition({
      key: 'purge',
      name: 'Purge',
      jobType: 'purge_archived_records',
      cron: '0 3 * * *',
      schedule: { cron: '0 3 * * *' },
      timezone: 'UTC',
      enabled: true,
      params: {},
      description: null,
    })
    expect(definition).toEqual({
      key: 'purge',
      name: 'Purge',
      jobType: 'purge_archived_records',
      cron: '0 3 * * *',
      schedule: { cron: '0 3 * * *' },
      timezone: 'UTC',
      enabled: true,
      params: {},
      description: null,
    })
    expect(definition).not.toHaveProperty('lastRunAt')
    expect(definition).not.toHaveProperty('nextRunAt')
    expect(definition).not.toHaveProperty('lastStatus')
    expect(definition).not.toHaveProperty('lastError')
  })
})

describe('record copy plan', () => {
  it('clears item.group when item groups are not selected', () => {
    const plan = planRecordImport(['item'], catalog)
    expect(plan.clears).toEqual([
      { entity: 'item', field: 'group', target: 'item_group' },
    ])
  })

  it('refuses item_variant without variant', () => {
    expect(() => planRecordImport(['item_variant', 'item'], catalog)).toThrow(
      /item_variant.variant requires variant/,
    )
  })

  it('copies groups before items', () => {
    const plan = planRecordImport(['item', 'variant', 'item_group'], catalog)
    expect(plan.order.indexOf('item_group')).toBeLessThan(plan.order.indexOf('item'))
    expect(plan.clears).toEqual([])
  })

  it('requires confirmation for users', () => {
    expect(() => planRecordImport(['users'], [])).toThrow(/sensitive/i)
    expect(planRecordImport(['users'], [], true).order).toEqual(['users'])
  })
})

describe('health environment', () => {
  it('reports sandbox only when APP_ENV=sandbox', () => {
    expect(healthBody(true, { APP_ENV: 'sandbox' }).environment).toBe('sandbox')
    expect(healthBody(true, {}).environment).toBe('production')
    expect(healthBody(true, { APP_ENV: 'production' }).environment).toBe('production')
    expect(healthBody(false, { APP_ENV: 'sandbox' })).toEqual({
      ok: false,
      service: 'crm-bff',
      environment: 'sandbox',
    })
  })
})
