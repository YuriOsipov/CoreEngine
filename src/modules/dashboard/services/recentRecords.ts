import { currentUserId } from '@/core/currentUser'
import {
  listRecentRecordViewsBridge,
  upsertRecentRecordViewBridge,
  type RecentRecordViewBridge,
} from '@/core/graphql/recentRecordsApi'
import type { SavedListFilter } from '@/modules/config/services/listFilterSettings'

export const RECENT_RECORD_VIEWS_COLLECTION = 'recent_record_views'
export const RECENTLY_VIEWED_FILTER_ID = '__recently_viewed__'

export const RECENTLY_VIEWED_FILTER: SavedListFilter = {
  id: RECENTLY_VIEWED_FILTER_ID,
  name: 'Recently Viewed',
  logic: 'and',
  conditions: [],
}

export type RecentRecordView = RecentRecordViewBridge

export interface RecentRecordQueryOptions {
  limit?: number
  offset?: number
}

export interface RecentRecordPage {
  ids: string[]
  views: RecentRecordView[]
  totalCount: number
}

export async function trackRecentRecordView(
  collection: string,
  recordId: string | number,
  _record: Record<string, unknown>,
): Promise<void> {
  try {
    const userId = await currentUserId()
    if (!userId) return

    await upsertRecentRecordViewBridge({
      userId,
      collection,
      recordId: String(recordId),
      viewedAt: new Date().toISOString(),
    })
  } catch {
    // Recent-view tracking should never block record details.
  }
}

export async function listRecentlyViewedRecordIds(
  collection: string,
  options: RecentRecordQueryOptions = {},
): Promise<RecentRecordPage> {
  try {
    const userId = await currentUserId()
    if (!userId) return { ids: [], views: [], totalCount: 0 }

    return listRecentRecordViewsBridge({
      userId,
      collection,
      limit: options.limit,
      offset: options.offset,
    })
  } catch {
    return { ids: [], views: [], totalCount: 0 }
  }
}
