import { describe, expect, it } from 'vitest'
import { validateDomainPack } from './validateDomainPack.js'

describe('validateDomainPack', () => {
  it('accepts a minimal valid pack', () => {
    const result = validateDomainPack({
      pack: { id: 'sales', label: 'Sales' },
      entities: [
        {
          apiName: 'account',
          label: 'Account',
          fields: [
            { apiName: 'name', label: 'Name', type: 'STRING' },
            {
              apiName: 'salary',
              label: 'Salary',
              type: 'DECIMAL',
              sensitivity: 2,
            },
          ],
        },
      ],
      roles: [{ name: 'Sales Rep', permissions: 'full_pack' }],
      layouts: [
        {
          entityApiName: 'account',
          groupKey: 'record',
          settingId: 'account-record',
          payload: {},
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects bad pack id and duplicate fields', () => {
    const result = validateDomainPack({
      pack: { id: 'Bad Id', label: 'X' },
      entities: [
        {
          apiName: 'account',
          label: 'Account',
          fields: [
            { apiName: 'name', label: 'A' },
            { apiName: 'name', label: 'B' },
          ],
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path === 'pack.id')).toBe(true)
    expect(
      result.errors.some((e) => /duplicate field/i.test(e.message)),
    ).toBe(true)
  })
})
