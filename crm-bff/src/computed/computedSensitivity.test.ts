import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadM2ORelations = vi.fn()
const loadO2MRelations = vi.fn()
const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
  pool: { query: vi.fn(), end: vi.fn() },
}))

vi.mock('../adapters/records/relations.js', () => ({
  loadM2ORelations: (...args: unknown[]) => loadM2ORelations(...args),
  loadO2MRelations: (...args: unknown[]) => loadO2MRelations(...args),
}))

import {
  collectComputedSourcePaths,
  elevateComputedSensitivities,
  requiredComputedSensitivity,
} from './computedSensitivity.js'

describe('computedSensitivity', () => {
  beforeEach(() => {
    loadM2ORelations.mockReset()
    loadO2MRelations.mockReset()
    query.mockReset()
    loadM2ORelations.mockResolvedValue([])
    loadO2MRelations.mockResolvedValue([])
  })

  it('collects bare and nested formula source paths', () => {
    expect(collectComputedSourcePaths('{{salary}}')).toEqual(['salary'])
    expect(collectComputedSourcePaths('{{multiply(salary, 12)}}').sort()).toEqual([
      'salary',
    ])
    expect(collectComputedSourcePaths('{{manager.salary}}')).toEqual([
      'manager.salary',
    ])
  })

  it('collects sources from arithmetic and nested call expressions', () => {
    expect(collectComputedSourcePaths('{{salary + bonus}}').sort()).toEqual([
      'bonus',
      'salary',
    ])
    expect(
      collectComputedSourcePaths(
        '{{IF(EQUAL(status, "x"), secret_field, open_field)}}',
      ).sort(),
    ).toEqual(['open_field', 'secret_field', 'status'])
    expect(
      collectComputedSourcePaths('{{MULTIPLY(account.margin, quantity)}}').sort(),
    ).toEqual(['account.margin', 'quantity'])
  })

  it('requires rollup fields to inherit child value-field sensitivity', async () => {
    const byEntity = new Map([
      ['employee', new Map([['salary', 2]])],
    ])
    const required = await requiredComputedSensitivity(
      'account',
      {
        computeMode: 'rollup',
        rollup: {
          childEntity: 'employee',
          parentField: 'account',
          valueField: 'salary',
          op: 'SUM',
        },
      },
      'input',
      byEntity,
    )
    expect(required).toBe(2)
  })

  it('elevates unmarked formula fields from sensitive sources', async () => {
    const byEntity = new Map([
      ['employee', new Map([['salary', 2]])],
    ])
    await elevateComputedSensitivities(byEntity, [
      {
        entity: 'employee',
        apiName: 'annual_pay',
        options: { computeMode: 'formula', formula: '{{multiply(salary, 12)}}' },
        fieldInterface: 'input',
      },
    ])
    expect(byEntity.get('employee')?.get('annual_pay')).toBe(2)
  })

  it('follows M2O hops when elevating formula sensitivity', async () => {
    loadM2ORelations.mockImplementation(async (entity: string) =>
      entity === 'opportunity'
        ? [{ fieldApiName: 'account', relatedEntityApiName: 'account' }]
        : [],
    )
    const byEntity = new Map([
      ['account', new Map([['margin', 1]])],
    ])
    await elevateComputedSensitivities(byEntity, [
      {
        entity: 'opportunity',
        apiName: 'acct_margin',
        options: { computeMode: 'formula', formula: '{{account.margin}}' },
        fieldInterface: 'input',
      },
    ])
    expect(byEntity.get('opportunity')?.get('acct_margin')).toBe(1)
  })
})
