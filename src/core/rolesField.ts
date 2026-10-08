/**
 * Shared role-collection naming (Vue).
 */
export const ROLES_ASSET_COLLECTION = 'roles' as const

export function isRolesAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === ROLES_ASSET_COLLECTION
}
