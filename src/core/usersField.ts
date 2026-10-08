/**
 * Shared user-collection naming (Vue).
 */
export const USERS_ASSET_COLLECTION = 'users' as const

export function isUsersAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === USERS_ASSET_COLLECTION
}
