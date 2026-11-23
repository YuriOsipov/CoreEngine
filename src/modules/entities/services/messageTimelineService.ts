import { bridgeReadItemsPage } from '@/core/graphql/itemsBridge'
import type { MessageTimelineSettings } from '@/interfaces'
import { normalizeMessageTimelineSettings } from '@/interfaces'

export type MessageTimelineDirection = 'outgoing' | 'incoming'

export interface MessageTimelineEntry {
  id: string
  collection: string
  direction: MessageTimelineDirection
  subject: string
  body: string
  type: string
  dateCreated: string | null
  sourceMessageId: string | null
  isDraft: boolean
  deliveryStatus: string | null
  status: string | null
}

export interface MessageTimelinePage {
  entries: MessageTimelineEntry[]
  /** Approximate combined total (outgoing + incoming API counts). */
  totalCount: number
  hasMore: boolean
}

const LIST_FIELDS = [
  'id',
  'subject',
  'body',
  'type',
  'date_created',
  'source_message',
  'is_draft',
  'delivery_status',
  'status',
] as const

function asRecordId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const nested = (value as { id?: unknown }).id
    return nested === null || nested === undefined || nested === ''
      ? null
      : String(nested)
  }
  return String(value)
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

function mapRow(
  row: Record<string, unknown>,
  collection: string,
  direction: MessageTimelineDirection,
): MessageTimelineEntry | null {
  const id = asRecordId(row.id)
  if (!id) return null
  return {
    id,
    collection,
    direction,
    subject: asString(row.subject),
    body: asString(row.body),
    type: asString(row.type) || '',
    dateCreated: asIsoDate(row.date_created),
    sourceMessageId: asRecordId(row.source_message),
    isDraft: row.is_draft === true,
    deliveryStatus: asString(row.delivery_status) || null,
    status: asString(row.status) || null,
  }
}

function parentFilter(
  parentField: string,
  parentId: string | number,
): Record<string, unknown> {
  return { [parentField]: { _eq: parentId } }
}

function andFilters(
  ...parts: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const filters = parts.filter(
    (part): part is Record<string, unknown> =>
      Boolean(part) && Object.keys(part as Record<string, unknown>).length > 0,
  )
  if (filters.length === 0) return {}
  if (filters.length === 1) return filters[0]!
  return { _and: filters }
}

function mergeTimelineEntries(
  outgoing: MessageTimelineEntry[],
  incoming: MessageTimelineEntry[],
): MessageTimelineEntry[] {
  const outgoingIds = new Set(outgoing.map((entry) => entry.id))
  const filteredIncoming = incoming.filter((entry) => {
    if (!entry.sourceMessageId) return true
    return !outgoingIds.has(entry.sourceMessageId)
  })
  return [...outgoing, ...filteredIncoming].sort((a, b) => {
    const aTime = a.dateCreated ? Date.parse(a.dateCreated) : 0
    const bTime = b.dateCreated ? Date.parse(b.dateCreated) : 0
    if (aTime !== bTime) return bTime - aTime
    return b.id.localeCompare(a.id)
  })
}

/** Exported for unit tests — merge + dedupe inbox copies of outbox rows. */
export function mergeMessageTimelineEntries(
  outgoing: MessageTimelineEntry[],
  incoming: MessageTimelineEntry[],
): MessageTimelineEntry[] {
  return mergeTimelineEntries(outgoing, incoming)
}

/**
 * Build GraphQL filters for outgoing / incoming sides.
 * Peer filter uses configured M2O fields only (no object-specific branching).
 */
export function buildMessageTimelineFilters(options: {
  parentId: string | number
  outgoingParentField: string
  incomingParentField: string
  outgoingPeerField?: string
  incomingPeerField?: string
  outgoingDraftField?: string
  hideDrafts: boolean
  peerId?: string | number | null
}): { outgoingFilter: Record<string, unknown>; incomingFilter: Record<string, unknown> } {
  const peerId =
    options.peerId !== undefined && options.peerId !== null && options.peerId !== ''
      ? options.peerId
      : null
  const draftField = options.outgoingDraftField?.trim() || ''
  const draftFilter =
    options.hideDrafts && draftField
      ? { [draftField]: { _neq: true } }
      : null
  const outgoingPeerField = options.outgoingPeerField?.trim() || ''
  const incomingPeerField = options.incomingPeerField?.trim() || ''

  return {
    outgoingFilter: andFilters(
      parentFilter(options.outgoingParentField, options.parentId),
      draftFilter,
      peerId !== null && outgoingPeerField
        ? { [outgoingPeerField]: { _eq: peerId } }
        : null,
    ),
    incomingFilter: andFilters(
      parentFilter(options.incomingParentField, options.parentId),
      peerId !== null && incomingPeerField
        ? { [incomingPeerField]: { _eq: peerId } }
        : null,
    ),
  }
}

/**
 * Page of the merged outbox + inbox thread (newest first).
 * Fetches the newest `offset + limit` rows from each side, merges, then slices.
 */
export async function fetchMessageTimeline(options: {
  parentId: string | number
  parentCollection?: string | null
  settings?: MessageTimelineSettings | null
  limit?: number
  offset?: number
  /** Optional peer record id for configured peer M2O fields. */
  peerId?: string | number | null
}): Promise<MessageTimelinePage> {
  const settings = normalizeMessageTimelineSettings(options.settings)
  if (
    !settings.outgoingCollection
    || !settings.incomingCollection
    || !settings.outgoingParentField
    || !settings.incomingParentField
  ) {
    return { entries: [], totalCount: 0, hasMore: false }
  }

  const pageSize = Math.max(1, options.limit ?? settings.maxItems)
  const offset = Math.max(0, options.offset ?? 0)
  const need = offset + pageSize

  const { outgoingFilter, incomingFilter } = buildMessageTimelineFilters({
    parentId: options.parentId,
    outgoingParentField: settings.outgoingParentField,
    incomingParentField: settings.incomingParentField,
    outgoingPeerField: settings.outgoingPeerField,
    incomingPeerField: settings.incomingPeerField,
    outgoingDraftField: settings.outgoingDraftField,
    hideDrafts: settings.hideDrafts,
    peerId: options.peerId,
  })

  const [outgoingPage, incomingPage] = await Promise.all([
    bridgeReadItemsPage(settings.outgoingCollection, {
      filter: outgoingFilter,
      fields: [...LIST_FIELDS],
      sort: ['-date_created'],
      limit: need,
      offset: 0,
    }),
    bridgeReadItemsPage(settings.incomingCollection, {
      filter: incomingFilter,
      fields: [...LIST_FIELDS],
      sort: ['-date_created'],
      limit: need,
      offset: 0,
    }),
  ])

  const outgoing = outgoingPage.nodes
    .map((row) =>
      mapRow(row as Record<string, unknown>, settings.outgoingCollection, 'outgoing'),
    )
    .filter((entry): entry is MessageTimelineEntry => entry !== null)

  const incoming = incomingPage.nodes
    .map((row) =>
      mapRow(row as Record<string, unknown>, settings.incomingCollection, 'incoming'),
    )
    .filter((entry): entry is MessageTimelineEntry => entry !== null)

  const merged = mergeTimelineEntries(outgoing, incoming)
  const entries = merged.slice(offset, offset + pageSize)
  const totalCount = Math.max(
    0,
    (outgoingPage.totalCount ?? 0) + (incomingPage.totalCount ?? 0),
  )
  const hasMore =
    merged.length > offset + entries.length
    || outgoingPage.nodes.length >= need && outgoingPage.totalCount > outgoingPage.nodes.length
    || incomingPage.nodes.length >= need && incomingPage.totalCount > incomingPage.nodes.length

  return { entries, totalCount, hasMore }
}
