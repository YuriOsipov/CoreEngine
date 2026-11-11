import { describe, expect, it } from 'vitest'
import {
  filterKnownFields,
  mergeFilterClauses,
} from '../src/modules/entities/utils/relatedTransferFilters'

describe('mergeFilterClauses', () => {
  it('returns the non-null clause when only one side is set', () => {
    expect(mergeFilterClauses({ a: 1 }, null)).toEqual({ a: 1 })
    expect(mergeFilterClauses(null, { b: 2 })).toEqual({ b: 2 })
  })

  it('AND-merges when both sides are set', () => {
    expect(mergeFilterClauses({ a: 1 }, { b: 2 })).toEqual({
      _and: [{ a: 1 }, { b: 2 }],
    })
  })
})

describe('filterKnownFields', () => {
  it('keeps all fields when availability is empty', () => {
    expect(filterKnownFields(['name', 'amount'], null)).toEqual(['name', 'amount'])
  })

  it('filters to known roots', () => {
    const available = new Set(['name', 'account'])
    expect(filterKnownFields(['name', 'missing', 'account.id'], available)).toEqual([
      'name',
      'account.id',
    ])
  })
})
