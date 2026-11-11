/**
 * Shared GraphQL / REST access guards.
 */
import { fetchMe, type MeUser } from '../adapters/usersAdapter.js'

export type AuthContext = { authorization: string | null }

/** Any logged-in user — rejects missing/invalid Bearer JWT. */
export async function requireAuthenticatedUser(
  ctx: AuthContext | undefined,
): Promise<MeUser> {
  if (!ctx?.authorization) {
    throw new Error('Authentication required')
  }
  const me = await fetchMe({ authorization: ctx.authorization })
  if (!me?.id) {
    throw new Error('Authentication required')
  }
  return me
}

/** Setup / registry / admin ops — admin Bearer JWT required. */
export async function requireAdminAccess(
  ctx: AuthContext | undefined,
): Promise<MeUser> {
  if (!ctx?.authorization) {
    throw new Error('Admin access required')
  }
  const me = await fetchMe({ authorization: ctx.authorization })
  if (!(me.adminAccess || me.roleAdminAccess)) {
    throw new Error('Admin access required')
  }
  return me
}

/** Settings / recent views scoped to the caller (admins may act for any userId). */
export async function requireSelfOrAdmin(
  ctx: AuthContext | undefined,
  userId: string,
): Promise<MeUser> {
  const me = await requireAuthenticatedUser(ctx)
  if (me.adminAccess || me.roleAdminAccess) return me
  if (String(me.id) !== String(userId)) {
    throw new Error('Permission denied')
  }
  return me
}
