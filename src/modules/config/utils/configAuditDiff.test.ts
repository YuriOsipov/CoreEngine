import { describe, expect, it } from 'vitest'
import { computeConfigAuditChanges } from './configAuditDiff'

describe('computeConfigAuditChanges', () => {
  it('diffs only changed fields when before and after exist', () => {
    const changes = computeConfigAuditChanges(
      {
        label: 'Account',
        note: 'Old',
        hidden: false,
      },
      {
        label: 'Account',
        note: 'Account list',
        hidden: false,
      },
    )
    expect(changes).toEqual([
      {
        field: 'note',
        label: 'Note',
        previousValue: 'Old',
        nextValue: 'Account list',
      },
    ])
  })

  it('shows CREATE after-only as initial values', () => {
    const changes = computeConfigAuditChanges(
      null,
      { note: 'Account list' },
      'CREATE',
    )
    expect(changes.map((c) => c.field)).toEqual(['note'])
    expect(changes[0]?.previousValue).toBe('—')
    expect(changes[0]?.nextValue).toBe('Account list')
  })

  it('hides UPDATE after-only legacy rows (no prior snapshot)', () => {
    expect(
      computeConfigAuditChanges(
        null,
        { note: 'Account list', label: 'Account' },
        'UPDATE',
      ),
    ).toEqual([])
  })
})
