import { currentUserId } from '@/core/currentUser'
import {
  readUserSettingBridge,
  upsertUserSettingBridge,
} from '@/core/graphql/userSettingsApi'

const PINNED_FILTER_GROUP = 'list'
const PINNED_FILTER_KEY = 'pinned_filter'

export async function loadUserSetting(
  collection: string,
  group: string,
  key: string,
): Promise<string | null> {
  const userId = await currentUserId()
  if (!userId) return null

  const value = await readUserSettingBridge({
    userId,
    collection,
    groupKey: group,
    key,
  })
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : String(value)
}

export async function saveUserSetting(
  collection: string,
  group: string,
  key: string,
  value: string | null,
): Promise<void> {
  const userId = await currentUserId()
  if (!userId) return

  await upsertUserSettingBridge({
    userId,
    collection,
    groupKey: group,
    key,
    value,
  })
}

export function loadPinnedFilter(collection: string): Promise<string | null> {
  return loadUserSetting(collection, PINNED_FILTER_GROUP, PINNED_FILTER_KEY)
}

export function savePinnedFilter(
  collection: string,
  filterId: string | null,
): Promise<void> {
  return saveUserSetting(collection, PINNED_FILTER_GROUP, PINNED_FILTER_KEY, filterId)
}
