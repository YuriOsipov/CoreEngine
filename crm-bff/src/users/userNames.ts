/**
 * Shared user-collection naming.
 * Live users live in `app_users`; GraphQL/records use collection id `users`.
 */
export const USERS_ASSET_COLLECTION = 'users' as const

/** Admin-only on Setup → Users — never written via records API / Block Layout. */
export const USERS_ADMIN_ONLY_FIELDS = new Set([
  'role_id',
  'is_active',
  'backend_user_id',
  'auth_user_id',
  'password',
  'password_hash',
  'must_change_password',
])

/** Physical columns that custom-field DDL must never coerce/drop. */
export const USERS_RESERVED_COLUMNS = new Set([
  'id',
  'email',
  'first_name',
  'last_name',
  'role_id',
  'is_active',
  'backend_user_id',
  'auth_user_id',
  'updated_at',
])

export function isUsersAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === USERS_ASSET_COLLECTION
}
