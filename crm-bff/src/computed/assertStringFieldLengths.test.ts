import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./fieldMeta.js', () => ({
  loadEntityFieldMeta: vi.fn(),
}))

import { loadEntityFieldMeta } from './fieldMeta.js'
import {
  assertStringFieldLengths,
  assertValueWithinMaxLength,
} from './assertStringFieldLengths.js'

describe('assertStringFieldLengths', () => {
  beforeEach(() => {
    vi.mocked(loadEntityFieldMeta).mockReset()
  })

  it('allows values within maxLength', () => {
    expect(() =>
      assertValueWithinMaxLength('title', 'hello', 10),
    ).not.toThrow()
  })

  it('rejects values over maxLength', () => {
    expect(() =>
      assertValueWithinMaxLength('title', 'abcdefghijk', 10),
    ).toThrow(/exceeds maximum length of 10/)
  })

  it('skips fields without maxLength and non-string types', async () => {
    vi.mocked(loadEntityFieldMeta).mockResolvedValue([
      {
        id: '1',
        apiName: 'legacy',
        fieldType: 'STRING',
        interface: 'input',
        readonly: false,
        options: {},
      },
      {
        id: '2',
        apiName: 'amount',
        fieldType: 'FLOAT',
        interface: 'input',
        readonly: false,
        options: { maxLength: 5 },
      },
    ])
    await expect(
      assertStringFieldLengths('account', {
        legacy: 'x'.repeat(500),
        amount: 12.5,
      }),
    ).resolves.toBeUndefined()
  })

  it('enforces maxLength on STRING and TEXT patch keys', async () => {
    vi.mocked(loadEntityFieldMeta).mockResolvedValue([
      {
        id: '1',
        apiName: 'code',
        fieldType: 'STRING',
        interface: 'input',
        readonly: false,
        options: { maxLength: 5 },
      },
      {
        id: '2',
        apiName: 'notes',
        fieldType: 'TEXT',
        interface: 'input-multiline',
        readonly: false,
        options: { maxLength: 256 },
      },
    ])
    await expect(
      assertStringFieldLengths('account', { code: 'abcdef' }),
    ).rejects.toThrow(/code/)
    await expect(
      assertStringFieldLengths('account', { notes: 'n'.repeat(257) }),
    ).rejects.toThrow(/notes/)
    await expect(
      assertStringFieldLengths('account', {
        code: 'abc',
        notes: 'n'.repeat(256),
      }),
    ).resolves.toBeUndefined()
  })
})
