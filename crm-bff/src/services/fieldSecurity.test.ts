import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const loadM2ORelations = vi.fn()
const loadO2MRelations = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
  pool: { query: vi.fn(), end: vi.fn() },
}))

vi.mock('../adapters/records/relations.js', () => ({
  loadM2ORelations: (...args: unknown[]) => loadM2ORelations(...args),
  loadO2MRelations: (...args: unknown[]) => loadO2MRelations(...args),
}))

import type { MeUser } from '../adapters/usersAdapter.js'
import {
  applyFieldAccessToSchemaField,
  assertFieldsEditable,
  assertPayloadWritable,
  assertReadableQuery,
  clearFieldSecurityCache,
  filterReadableFieldPaths,
  redactRecord,
  resolveFieldAccess,
} from './fieldSecurity.js'

function user(overrides: Partial<MeUser> = {}): MeUser {
  return {
    id: 'user-1',
    firstName: null,
    lastName: null,
    email: null,
    adminAccess: false,
    roleId: 'sales',
    roleName: null,
    roleAdminAccess: false,
    mustChangePassword: false,
    ...overrides,
  }
}

/** employee.salary = confidential, employee.cost_center = restricted; account.margin = restricted. */
function mockRegistry(roleTiers: Array<{ entity: string; read: number; edit: number }>) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM public.fields')) {
      return [
        { entity_api_name: 'employee', field_api_name: 'salary', sensitivity: 2 },
        { entity_api_name: 'employee', field_api_name: 'cost_center', sensitivity: 1 },
        { entity_api_name: 'account', field_api_name: 'margin', sensitivity: 1 },
      ]
    }
    if (sql.includes('FROM public.app_roles')) {
      return roleTiers.map((row) => ({
        entity_api_name: row.entity,
        max_read_sensitivity: row.read,
        max_edit_sensitivity: row.edit,
      }))
    }
    return []
  })
}

describe('fieldSecurity', () => {
  beforeEach(() => {
    query.mockReset()
    loadM2ORelations.mockReset()
    loadO2MRelations.mockReset()
    loadM2ORelations.mockResolvedValue([])
    loadO2MRelations.mockResolvedValue([])
    clearFieldSecurityCache()
  })

  it('bypasses admins and system callers without touching the database', async () => {
    expect(await resolveFieldAccess(user({ roleAdminAccess: true }), 'employee')).toBeNull()
    expect(await resolveFieldAccess(null, 'employee')).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('returns null for entities without sensitive fields', async () => {
    mockRegistry([])
    expect(await resolveFieldAccess(user(), 'opportunity')).toBeNull()
  })

  it('hides every marked field from a role with no sensitivity grant', async () => {
    mockRegistry([])
    const access = await resolveFieldAccess(user(), 'employee')
    expect([...(access?.unreadable ?? [])].sort()).toEqual(['cost_center', 'salary'])
    expect([...(access?.uneditable ?? [])].sort()).toEqual(['cost_center', 'salary'])
  })

  it('applies tiers per entity: restricted read, no edit', async () => {
    mockRegistry([{ entity: 'employee', read: 1, edit: 0 }])
    const access = await resolveFieldAccess(user(), 'Employee')
    expect([...(access?.unreadable ?? [])]).toEqual(['salary'])
    expect([...(access?.uneditable ?? [])].sort()).toEqual(['cost_center', 'salary'])
  })

  it('returns null when the role covers every tier', async () => {
    mockRegistry([{ entity: 'employee', read: 2, edit: 2 }])
    expect(await resolveFieldAccess(user(), 'employee')).toBeNull()
  })

  it('caches registry and role lookups between calls', async () => {
    mockRegistry([])
    await resolveFieldAccess(user(), 'employee')
    await resolveFieldAccess(user(), 'employee')
    await resolveFieldAccess(user(), 'account')
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('treats a pre-migration database as having no sensitive fields', async () => {
    query.mockRejectedValue(Object.assign(new Error('column does not exist'), { code: '42703' }))
    expect(await resolveFieldAccess(user(), 'employee')).toBeNull()
  })

  it('redacts records and projections', async () => {
    mockRegistry([{ entity: 'employee', read: 1, edit: 0 }])
    const access = await resolveFieldAccess(user(), 'employee')

    expect(redactRecord({ id: '1', name: 'A', salary: 9, cost_center: 'X' }, access)).toEqual({
      id: '1',
      name: 'A',
      cost_center: 'X',
    })
    expect(filterReadableFieldPaths(['id', 'salary', 'manager.name'], access)).toEqual([
      'id',
      'manager.name',
    ])
    expect(filterReadableFieldPaths(['salary'], access)).toEqual(['id'])
  })

  it('rejects write payloads that touch uneditable fields instead of dropping them', async () => {
    mockRegistry([{ entity: 'employee', read: 1, edit: 0 }])
    const access = await resolveFieldAccess(user(), 'employee')

    expect(() => assertPayloadWritable({ name: 'B' }, access)).not.toThrow()
    expect(() => assertPayloadWritable({ name: 'B', cost_center: 'Y' }, access)).toThrow(
      'Permission denied: update on employee.cost_center',
    )
    expect(() => assertPayloadWritable({ salary: null }, access)).toThrow('employee.salary')
    await expect(
      assertFieldsEditable(user(), 'employee', ['name', 'salary', null]),
    ).rejects.toThrow('employee.salary')
    await expect(
      assertFieldsEditable(user({ adminAccess: true }), 'employee', ['salary']),
    ).resolves.toBeUndefined()
  })

  it('flags schema fields as hidden or read-only per role', async () => {
    mockRegistry([{ entity: 'employee', read: 1, edit: 0 }])
    const access = await resolveFieldAccess(user(), 'employee')
    const base = { hidden: false, readonly: false }

    expect(applyFieldAccessToSchemaField({ ...base, apiName: 'salary' }, access)).toMatchObject({
      hidden: true,
      readonly: true,
      restricted: true,
      writeRestricted: true,
    })
    expect(
      applyFieldAccessToSchemaField({ ...base, apiName: 'cost_center' }, access),
    ).toMatchObject({ hidden: false, readonly: true, restricted: false, writeRestricted: true })
    expect(applyFieldAccessToSchemaField({ ...base, apiName: 'name' }, access)).toMatchObject({
      hidden: false,
      readonly: false,
      restricted: false,
      writeRestricted: false,
    })
  })

  it('rejects filter, sort, and aggregate on unreadable fields', async () => {
    mockRegistry([])
    const me = user()
    await expect(
      assertReadableQuery(me, 'employee', { filter: { salary: { _gt: 100 } } }),
    ).rejects.toThrow('Permission denied: read on employee.salary')
    await expect(
      assertReadableQuery(me, 'employee', {
        filter: { _and: [{ name: { _eq: 'x' } }, { _or: [{ salary: { _null: false } }] }] },
      }),
    ).rejects.toThrow('employee.salary')
    await expect(
      assertReadableQuery(me, 'employee', { sort: ['-salary'] }),
    ).rejects.toThrow('employee.salary')
    await expect(
      assertReadableQuery(me, 'employee', { aggregate: { avg: 'salary' } }),
    ).rejects.toThrow('employee.salary')
    await expect(
      assertReadableQuery(me, 'employee', { filter: { name: { _eq: 'x' } }, sort: ['name'] }),
    ).resolves.toBeUndefined()
  })

  it('follows M2O hops in filters and sort paths', async () => {
    mockRegistry([])
    loadM2ORelations.mockImplementation(async (entity: string) =>
      entity === 'opportunity'
        ? [{ fieldApiName: 'account', relatedEntityApiName: 'account' }]
        : [],
    )
    const me = user()
    await expect(
      assertReadableQuery(me, 'opportunity', { filter: { account: { margin: { _gt: 0 } } } }),
    ).rejects.toThrow('Permission denied: read on account.margin')
    await expect(
      assertReadableQuery(me, 'opportunity', { sort: ['account.margin'] }),
    ).rejects.toThrow('account.margin')
    await expect(
      assertReadableQuery(me, 'opportunity', { sort: ['account.name'] }),
    ).resolves.toBeUndefined()
  })
})
