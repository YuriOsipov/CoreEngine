import { describe, expect, it } from 'vitest'
import {
  isMultiPicklistFieldDefinition,
  isMultiPicklistOptions,
  normalizeMultiPicklistValue,
} from './picklistField'

describe('picklistField', () => {
  it('detects multiple options flag', () => {
    expect(isMultiPicklistOptions({ multiple: true })).toBe(true)
    expect(isMultiPicklistOptions({ multiple: false })).toBe(false)
    expect(isMultiPicklistOptions({})).toBe(false)
    expect(isMultiPicklistOptions(null)).toBe(false)
  })

  it('detects multi picklist field definitions', () => {
    expect(
      isMultiPicklistFieldDefinition({
        meta: { interface: 'select-dropdown', options: { multiple: true } },
      }),
    ).toBe(true)
    expect(
      isMultiPicklistFieldDefinition({
        meta: { interface: 'select-dropdown', options: { choices: [] } },
      }),
    ).toBe(false)
    expect(
      isMultiPicklistFieldDefinition({
        meta: { interface: 'input', options: { multiple: true } },
      }),
    ).toBe(false)
  })

  it('normalizes stored values into arrays', () => {
    expect(normalizeMultiPicklistValue(null)).toEqual([])
    expect(normalizeMultiPicklistValue('viber')).toEqual(['viber'])
    expect(normalizeMultiPicklistValue(['viber', 'telegram'])).toEqual([
      'viber',
      'telegram',
    ])
    expect(normalizeMultiPicklistValue('["viber","telegram"]')).toEqual([
      'viber',
      'telegram',
    ])
    expect(normalizeMultiPicklistValue('viber, telegram')).toEqual([
      'viber',
      'telegram',
    ])
  })
})
