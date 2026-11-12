import { describe, expect, it } from 'vitest'
import { expandDottedFilterKeys } from './expandDottedFilterKeys.js'

describe('expandDottedFilterKeys', () => {
  it('expands SOQL-style dotted keys into nested objects', () => {
    expect(
      expandDottedFilterKeys({ 'account.margin': { _gt: 0 } }),
    ).toEqual({ account: { margin: { _gt: 0 } } })
  })

  it('expands multi-hop paths and merges under _and/_or', () => {
    expect(
      expandDottedFilterKeys({
        _or: [
          { 'manager.salary': { _gt: 100 } },
          { name: { _eq: 'x' } },
        ],
      }),
    ).toEqual({
      _or: [{ manager: { salary: { _gt: 100 } } }, { name: { _eq: 'x' } }],
    })
  })

  it('leaves already-nested relation filters intact', () => {
    const nested = { account: { margin: { _eq: 1 } } }
    expect(expandDottedFilterKeys(nested)).toEqual(nested)
  })
})
