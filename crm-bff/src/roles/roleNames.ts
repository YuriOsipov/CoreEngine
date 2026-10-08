/**
 * Shared role-collection naming.
 * Live roles live in `app_roles`; GraphQL/records use collection id `roles`.
 */
export const ROLES_ASSET_COLLECTION = 'roles' as const

export const FORM_ROLES_ENTITY = 'form_roles' as const

export const FORM_ROLES_ROLE_ID_FIELD = 'role_id' as const

export function isRolesAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === ROLES_ASSET_COLLECTION
}

export function isFormRolesEntity(entityApiName: string): boolean {
  return entityApiName === FORM_ROLES_ENTITY
}
