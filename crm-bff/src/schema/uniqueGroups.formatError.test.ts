import { describe, expect, it } from 'vitest'
import { formatUniqueViolationError } from './uniqueGroups.js'

describe('formatUniqueViolationError', () => {
  it('returns null for non-unique errors', () => {
    expect(formatUniqueViolationError(null)).toBeNull()
    expect(formatUniqueViolationError(new Error('boom'))).toBeNull()
    expect(formatUniqueViolationError({ code: '23503' })).toBeNull()
  })

  it('does not echo Postgres detail (would leak field values)', () => {
    const message = formatUniqueViolationError({
      code: '23505',
      constraint: 'uq_account_field_phone',
      detail: 'Key (data->>phone)=(076 157 01 69) already exists.',
      message: 'duplicate key value violates unique constraint "uq_account_field_phone"',
    })
    expect(message).toBe('Unique constraint violated (uq_account_field_phone)')
    // Constraint name may mention the field; the conflicting *value* must not appear.
    expect(message).not.toMatch(/076|already exists|Key \(/i)
  })
})
