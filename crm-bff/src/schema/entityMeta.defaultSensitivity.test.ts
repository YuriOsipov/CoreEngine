import { describe, expect, it } from 'vitest'
import { parseDefaultFieldSensitivity, readDefaultFieldSensitivity } from './entityMeta.js'

describe('defaultFieldSensitivity', () => {
  it('defaults to none when unset', () => {
    expect(parseDefaultFieldSensitivity(undefined)).toBe(0)
    expect(parseDefaultFieldSensitivity(null)).toBe(0)
    expect(readDefaultFieldSensitivity({})).toBe(0)
  })

  it('clamps entity / pack backend_config values', () => {
    expect(readDefaultFieldSensitivity({ defaultFieldSensitivity: 1 })).toBe(1)
    expect(readDefaultFieldSensitivity({ defaultFieldSensitivity: 2 })).toBe(2)
    expect(readDefaultFieldSensitivity({ defaultFieldSensitivity: 9 })).toBe(2)
    expect(readDefaultFieldSensitivity({ defaultFieldSensitivity: -1 })).toBe(0)
  })
})
