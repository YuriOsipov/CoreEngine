/**
 * Upsert must not probe existence before permissions are known, and must not
 * reveal create-vs-update denials (existence oracle). Require both actions first.
 */
import type { MeUser } from '../adapters/usersAdapter.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'

export async function assertUpsertPermissions(
  me: MeUser,
  collection: string,
): Promise<MeUser> {
  await assertMeEntityPermission(me, collection, 'create')
  return assertMeEntityPermission(me, collection, 'update')
}
