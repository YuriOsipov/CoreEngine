import { describe, expect, it } from 'vitest'
import {
  buildMessageTimelineFilters,
  mergeMessageTimelineEntries,
  type MessageTimelineEntry,
} from './messageTimelineService'

function entry(
  partial: Partial<MessageTimelineEntry> & Pick<MessageTimelineEntry, 'id' | 'direction'>,
): MessageTimelineEntry {
  return {
    collection: partial.direction === 'outgoing' ? 'message' : 'incoming_message',
    subject: '',
    body: '',
    type: 'internal',
    dateCreated: null,
    sourceMessageId: null,
    isDraft: false,
    deliveryStatus: null,
    status: null,
    ...partial,
  }
}

describe('mergeMessageTimelineEntries', () => {
  it('sorts by date_created descending (newest first)', () => {
    const merged = mergeMessageTimelineEntries(
      [
        entry({
          id: 'o2',
          direction: 'outgoing',
          dateCreated: '2026-01-02T10:00:00.000Z',
        }),
      ],
      [
        entry({
          id: 'i1',
          direction: 'incoming',
          dateCreated: '2026-01-01T10:00:00.000Z',
        }),
      ],
    )
    expect(merged.map((row) => row.id)).toEqual(['o2', 'i1'])
  })

  it('drops incoming copies that point at an outgoing source_message', () => {
    const merged = mergeMessageTimelineEntries(
      [
        entry({
          id: 'out-1',
          direction: 'outgoing',
          dateCreated: '2026-01-01T10:00:00.000Z',
        }),
      ],
      [
        entry({
          id: 'in-copy',
          direction: 'incoming',
          dateCreated: '2026-01-01T10:01:00.000Z',
          sourceMessageId: 'out-1',
        }),
        entry({
          id: 'in-reply',
          direction: 'incoming',
          dateCreated: '2026-01-01T11:00:00.000Z',
        }),
      ],
    )
    expect(merged.map((row) => row.id)).toEqual(['in-reply', 'out-1'])
  })
})

describe('buildMessageTimelineFilters', () => {
  it('ANDs configured parent and peer fields without object-specific branching', () => {
    const { outgoingFilter, incomingFilter } = buildMessageTimelineFilters({
      parentId: 'contact-1',
      outgoingParentField: 'contact',
      incomingParentField: 'contact',
      outgoingPeerField: 'to_user',
      incomingPeerField: 'from_user',
      outgoingDraftField: 'is_draft',
      hideDrafts: true,
      peerId: 'admin',
    })

    expect(outgoingFilter).toEqual({
      _and: [
        { contact: { _eq: 'contact-1' } },
        { is_draft: { _neq: true } },
        { to_user: { _eq: 'admin' } },
      ],
    })
    expect(incomingFilter).toEqual({
      _and: [
        { contact: { _eq: 'contact-1' } },
        { from_user: { _eq: 'admin' } },
      ],
    })
  })

  it('skips draft and peer filters when those fields are not configured', () => {
    const { outgoingFilter, incomingFilter } = buildMessageTimelineFilters({
      parentId: 'parent-1',
      outgoingParentField: 'account',
      incomingParentField: 'account',
      hideDrafts: true,
      peerId: 'someone',
    })

    expect(outgoingFilter).toEqual({ account: { _eq: 'parent-1' } })
    expect(incomingFilter).toEqual({ account: { _eq: 'parent-1' } })
  })
})
