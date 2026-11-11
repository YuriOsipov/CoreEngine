/**
 * Shared GraphQL / REST access guards.
 */
import { fetchMe, type MeUser } from '../adapters/usersAdapter.js'

export type AuthContext = { authorization: string | null }

export const PASSWORD_CHANGE_REQUIRED = 'Password change required'

export type AuthGuardOptions = {
  /**
   * Allow callers that still have must_change_password set
   * (change-password + GraphQL `me` only).
   */
  allowPasswordChange?: boolean
}

function assertNoPendingPasswordChange(
  me: MeUser,
  options?: AuthGuardOptions,
): void {
  if (me.mustChangePassword && !options?.allowPasswordChange) {
    throw new Error(PASSWORD_CHANGE_REQUIRED)
  }
}

/** Any logged-in user — rejects missing/invalid Bearer JWT. */
export async function requireAuthenticatedUser(
  ctx: AuthContext | undefined,
  options?: AuthGuardOptions,
): Promise<MeUser> {
  if (!ctx?.authorization) {
    throw new Error('Authentication required')
  }
  const me = await fetchMe({ authorization: ctx.authorization })
  if (!me?.id) {
    throw new Error('Authentication required')
  }
  assertNoPendingPasswordChange(me, options)
  return me
}

/** Setup / registry / admin ops — admin Bearer JWT required. */
export async function requireAdminAccess(
  ctx: AuthContext | undefined,
  options?: AuthGuardOptions,
): Promise<MeUser> {
  if (!ctx?.authorization) {
    throw new Error('Admin access required')
  }
  const me = await fetchMe({ authorization: ctx.authorization })
  if (!(me.adminAccess || me.roleAdminAccess)) {
    throw new Error('Admin access required')
  }
  assertNoPendingPasswordChange(me, options)
  return me
}

/** Settings / recent views scoped to the caller (admins may act for any userId). */
export async function requireSelfOrAdmin(
  ctx: AuthContext | undefined,
  userId: string,
  options?: AuthGuardOptions,
): Promise<MeUser> {
  const me = await requireAuthenticatedUser(ctx, options)
  if (me.adminAccess || me.roleAdminAccess) return me
  if (String(me.id) !== String(userId)) {
    throw new Error('Permission denied')
  }
  return me
}
