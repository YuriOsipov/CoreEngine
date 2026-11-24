import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STRING_MAX_LENGTH,
  DEFAULT_TEXT_MAX_LENGTH,
  MAX_STRING_MAX_LENGTH,
  MAX_TEXT_MAX_LENGTH,
  MIN_TEXT_MAX_LENGTH,
  normalizeStringFieldOptions,
  normalizeStringMaxLength,
  pgTypeForFieldType,
  resolveStringFieldMaxLength,
} from './crmStorage.js'

describe('string / text field length', () => {
  it('defaults STRING to 255 and TEXT to 32768', () => {
    expect(normalizeStringMaxLength('STRING', {})).toBe(DEFAULT_STRING_MAX_LENGTH)
    expect(normalizeStringMaxLength('TEXT', {})).toBe(DEFAULT_TEXT_MAX_LENGTH)
  })

  it('clamps STRING to 1–255 and TEXT to 256–131072', () => {
    expect(normalizeStringMaxLength('STRING', { maxLength: 0 })).toBe(1)
    expect(normalizeStringMaxLength('STRING', { maxLength: 999 })).toBe(
      MAX_STRING_MAX_LENGTH,
    )
    expect(normalizeStringMaxLength('TEXT', { maxLength: 10 })).toBe(
      MIN_TEXT_MAX_LENGTH,
    )
    expect(normalizeStringMaxLength('TEXT', { length: 999_999 })).toBe(
      MAX_TEXT_MAX_LENGTH,
    )
  })

  it('writes maxLength + length mirrors into options', () => {
    expect(normalizeStringFieldOptions('STRING', { maxLength: 80 })).toEqual({
      maxLength: 80,
      length: 80,
    })
    expect(normalizeStringFieldOptions('TEXT', { length: 4000 })).toEqual({
      maxLength: 4000,
      length: 4000,
    })
  })

  it('maps STRING to varchar(n) and TEXT to text', () => {
    expect(pgTypeForFieldType('STRING', { maxLength: 120 })).toBe('varchar(120)')
    expect(pgTypeForFieldType('STRING', {})).toBe('varchar(255)')
    expect(pgTypeForFieldType('TEXT', { maxLength: 4000 })).toBe('text')
  })

  it('resolveStringFieldMaxLength ignores legacy fields without length', () => {
    expect(resolveStringFieldMaxLength('STRING', {})).toBeNull()
    expect(resolveStringFieldMaxLength('TEXT', { foo: 1 })).toBeNull()
    expect(resolveStringFieldMaxLength('STRING', { maxLength: 40 })).toBe(40)
    expect(resolveStringFieldMaxLength('INTEGER', { maxLength: 40 })).toBeNull()
  })
})
