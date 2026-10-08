import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface RecentRecordViewBridge {
  id: string | number
  user: string
  collection: string
  record_id: string
  viewed_at: string
}

export interface RecentRecordViewGql {
  id: string
  userId: string
  collection: string
  recordId: string
  viewedAt: string
}

export interface RecentRecordPageGql {
  ids: string[]
  views: RecentRecordViewGql[]
  totalCount: number
}

const RECENT_RECORD_VIEWS_QUERY = /* GraphQL */ `
  query RecentRecordViews(
    $userId: ID!
    $collection: String!
    $limit: Int
    $offset: Int
  ) {
    recentRecordViews(
      userId: $userId
      collection: $collection
      limit: $limit
      offset: $offset
    ) {
      ids
      totalCount
      views {
        id
        userId
        collection
        recordId
        viewedAt
      }
    }
  }
`

const UPSERT_RECENT_RECORD_VIEW = /* GraphQL */ `
  mutation UpsertRecentRecordView(
    $userId: ID!
    $collection: String!
    $recordId: ID!
    $viewedAt: String
  ) {
    upsertRecentRecordView(
      userId: $userId
      collection: $collection
      recordId: $recordId
      viewedAt: $viewedAt
    ) {
      id
      userId
      collection
      recordId
      viewedAt
    }
  }
`

export async function fetchRecentRecordViewsFromGraphQL(options: {
  userId: string
  collection: string
  limit?: number
  offset?: number
}): Promise<RecentRecordPageGql> {
  const data = await graphqlRequest<{ recentRecordViews: RecentRecordPageGql }>(
    RECENT_RECORD_VIEWS_QUERY,
    options,
  )
  return (
    data.recentRecordViews ?? {
      ids: [],
      views: [],
      totalCount: 0,
    }
  )
}

export async function upsertRecentRecordViewToGraphQL(options: {
  userId: string
  collection: string
  recordId: string
  viewedAt?: string
}): Promise<void> {
  await graphqlRequest(UPSERT_RECENT_RECORD_VIEW, options)
}

export function canUseRecentRecordsGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

/** Upsert recent view — GraphQL only. */
export async function upsertRecentRecordViewBridge(options: {
  userId: string
  collection: string
  recordId: string
  viewedAt?: string
}): Promise<void> {
  if (!canUseRecentRecordsGraphQL()) {
    refuseLegacyFallback('upsertRecentRecordViewBridge')
  }
  await upsertRecentRecordViewToGraphQL(options)
}

/** List recent views — GraphQL only. */
export async function listRecentRecordViewsBridge(options: {
  userId: string
  collection: string
  limit?: number
  offset?: number
}): Promise<{
  ids: string[]
  views: RecentRecordViewBridge[]
  totalCount: number
}> {
  if (!canUseRecentRecordsGraphQL()) {
    refuseLegacyFallback('listRecentRecordViewsBridge')
  }
  const page = await fetchRecentRecordViewsFromGraphQL(options)
  return {
    ids: page.ids,
    totalCount: page.totalCount,
    views: page.views.map((row) => ({
      id: row.id,
      user: row.userId,
      collection: row.collection,
      record_id: row.recordId,
      viewed_at: row.viewedAt,
    })),
  }
}
