/**
 * Shared user-collection naming (Vue).
 */
export const USERS_ASSET_COLLECTION = 'users' as const

/** Admin-only on Setup → Users — never offered in Block Layout designer. */
export const USERS_LAYOUT_EXCLUDED_FIELDS = new Set([
  'role_id',
  'is_active',
])

export function isUsersAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === USERS_ASSET_COLLECTION
}

/** Role / is_Active stay on Setup → Users, not Block Layout palette. */
export function isUsersLayoutExcludedField(
  collection: string,
  fieldApiName: string,
): boolean {
  return (
    isUsersAssetCollection(collection) &&
    USERS_LAYOUT_EXCLUDED_FIELDS.has(fieldApiName)
  )
}
