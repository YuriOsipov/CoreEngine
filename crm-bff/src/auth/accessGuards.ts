/**
 * Shared GraphQL / REST access guards.
 */
import { fetchMe, type MeUser } from '../adapters/usersAdapter.js'
import {
  applyRolePreview,
  type AuthContextWithPreview,
} from './rolePreview.js'

export type AuthContext = AuthContextWithPreview

export const PASSWORD_CHANGE_REQUIRED = 'Password change required'

export type AuthGuardOptions = {
  /**
   * Allow callers that still have must_change_password set
   * (change-password + GraphQL `me` only).
   */
  allowPasswordChange?: boolean
  /**
   * When true (default), admins with `X-Role-Preview` are treated as that role
   * for ACL / field security. Keep false for GraphQL `me` so the UI still
   * knows the session is admin.
   */
  applyRolePreview?: boolean
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
  if (options?.applyRolePreview === false) return me
  return applyRolePreview(me, ctx.rolePreview)
}

/** Setup / registry / admin ops — admin Bearer JWT required. */
export async function requireAdminAccess(
  ctx: AuthContext | undefined,
  options?: AuthGuardOptions,
): Promise<MeUser> {
  if (!ctx?.authorization) {
    throw new Error('Admin access required')
  }
  // Never apply role preview here — Setup must keep real admin privileges.
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
