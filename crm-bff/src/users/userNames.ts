/**
 * Shared user-collection naming.
 * Live users live in `app_users`; GraphQL/records use collection id `users`.
 */
export const USERS_ASSET_COLLECTION = 'users' as const

export function isUsersAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === USERS_ASSET_COLLECTION
}
