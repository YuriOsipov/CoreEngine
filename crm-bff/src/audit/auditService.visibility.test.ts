import { describe, expect, it } from 'vitest'
import {
  cleanAuditSnapshot,
  hasVisibleAuditChanges,
  shouldSeedBeforeRevisionParent,
} from './auditService.js'

describe('audit snapshot visibility', () => {
  it('strips ephemeral underscore keys from snapshots', () => {
    expect(
      cleanAuditSnapshot({
        stage: 'Proposal',
        __openAutomationsApplied: true,
        __automationToasts: [{ severity: 'info', message: 'hi' }],
      }),
    ).toEqual({ stage: 'Proposal' })
  })

  it('treats stamp-only updates as no visible changes', () => {
    const before = {
      id: '1',
      stage: 'Proposal',
      amount: 100,
      user_updated: 'a',
      date_updated: '2026-01-01T00:00:00.000Z',
    }
    const after = {
      ...before,
      user_updated: 'b',
      date_updated: '2026-01-02T00:00:00.000Z',
    }
    expect(hasVisibleAuditChanges(before, after)).toBe(false)
  })

  it('detects stage changes for activity deltas', () => {
    expect(
      hasVisibleAuditChanges(
        { id: '1', stage: 'Proposal', user_updated: 'a' },
        { id: '1', stage: 'Won', user_updated: 'a' },
      ),
    ).toBe(true)
  })

  it('treats scalar FK and expanded M2O as equal', () => {
    expect(
      hasVisibleAuditChanges(
        { account: 'acc-1', stage: 'Proposal' },
        { account: { id: 'acc-1', name: 'Hofmann Elena' }, stage: 'Proposal' },
      ),
    ).toBe(false)
  })

  it('seeds before parent when latest revision is sparse vs mutation before', () => {
    const beforeSnapshot = {
      stage: 'Won',
      terminal: 'Cancel',
      amount: 5000,
      owner_id: 'admin-1',
      close_date: '2026-09-15',
      status: 'published',
    }
    const sparseParent = { stage: 'Won', terminal: 'Cancel', status: 'published' }
    expect(
      shouldSeedBeforeRevisionParent({
        parentSnapshot: sparseParent,
        beforeSnapshot,
      }),
    ).toBe(true)
  })

  it('does not seed when latest revision already matches mutation before', () => {
    const beforeSnapshot = {
      stage: 'Won',
      terminal: 'Cancel',
      amount: 5000,
      owner_id: 'admin-1',
    }
    expect(
      shouldSeedBeforeRevisionParent({
        parentSnapshot: { ...beforeSnapshot },
        beforeSnapshot,
      }),
    ).toBe(false)
  })
})
