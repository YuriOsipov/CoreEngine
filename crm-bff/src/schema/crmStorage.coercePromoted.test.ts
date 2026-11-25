import { describe, expect, it } from 'vitest'
import { coercePromotedValue, type CrmPromotedField } from './crmStorage.js'

function field(apiName: string, pgType: string): CrmPromotedField {
  return {
    apiName,
    pgType,
    fieldType: 'STRING',
    needsFkIndex: false,
    needsBtreeIndex: false,
    canDeclareFk: false,
    relatedEntityApiName: null,
    onDelete: null,
    useInSearch: false,
  }
}

describe('coercePromotedValue', () => {
  it('keeps date Date values as YYYY-MM-DD (UTC parts)', () => {
    const raw = new Date(Date.UTC(2026, 11, 13))
    expect(coercePromotedValue(field('close_date', 'date'), raw)).toBe('2026-12-13')
  })

  it('keeps timestamptz Date values as ISO strings', () => {
    const raw = new Date('2026-12-13T23:00:00.000Z')
    expect(coercePromotedValue(field('updated_at', 'timestamptz'), raw)).toBe(
      '2026-12-13T23:00:00.000Z',
    )
  })

  it('unwraps m2o { id } for uuid columns', () => {
    expect(
      coercePromotedValue(field('owner_id', 'uuid'), {
        id: '53596681-57da-4afd-8b86-4aa1c2931e8e',
      }),
    ).toBe('53596681-57da-4afd-8b86-4aa1c2931e8e')
  })

  it('maps empty values to null', () => {
    expect(coercePromotedValue(field('owner_id', 'uuid'), null)).toBeNull()
    expect(coercePromotedValue(field('owner_id', 'uuid'), '')).toBeNull()
    expect(coercePromotedValue(field('owner_id', 'uuid'), undefined)).toBeNull()
  })
})
