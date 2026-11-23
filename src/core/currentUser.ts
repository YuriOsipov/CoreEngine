import { loadAppRoles } from './settingRoleUtils'
import { getRolePreviewOverride } from './rolePreview'
import { formatUserLabel } from '@/modules/entities/utils/recordDisplay'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'

export interface CurrentUser {
  id: string | null
  label: string
  email: string | null
  roleId: string | null
  roleName: string | null
  isAdmin: boolean
  /** Admin or role.can_author_reports — may author own-role reports. */
  canAuthorReports: boolean
  /**
   * When View-as-role is active: sample user id used for Owner RLS / $CURRENT_USER.
   * Null when not previewing.
   */
  rolePreviewActorId: string | null
}

let cachedUser: CurrentUser | null = null
let userPromise: Promise<CurrentUser> | null = null

export async function currentUser(): Promise<CurrentUser> {
  if (cachedUser) return cachedUser
  if (userPromise) return userPromise

  userPromise = (async () => {
    const me = await readCurrentUserBridge()
    const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ')
    let roleName = me.roleName
    if (me.roleId && !roleName) {
      roleName = await fetchRoleName(me.roleId)
    }
    // Trust BFF only — soft heuristics (role name / can-list-roles) falsely
    // marked every user as admin and broke "View as role" permission loading.
    const isAdmin = Boolean(me.adminAccess || me.roleAdminAccess)

    const previewActor =
      typeof me.rolePreviewActorId === 'string' && me.rolePreviewActorId.trim()
        ? me.rolePreviewActorId.trim()
        : null

    cachedUser = {
      id: me.id,
      label:
        formatUserLabel({
          first_name: me.firstName,
          last_name: me.lastName,
          email: me.email,
        }) ||
        fullName ||
        me.email ||
        me.id ||
        '',
      email: typeof me.email === 'string' && me.email.trim() ? me.email.trim() : null,
      roleId: me.roleId,
      roleName,
      isAdmin,
      canAuthorReports: Boolean(isAdmin || me.canAuthorReports),
      rolePreviewActorId: previewActor,
    }
    return cachedUser
  })()

  try {
    return await userPromise
  } finally {
    userPromise = null
  }
}

/**
 * Effective user id for filters / Owner-RLS-facing UI.
 * Under View-as-role, returns the sample actor of that role.
 */
export async function currentUserId(): Promise<string | null> {
  const user = await currentUser()
  if (user.isAdmin) {
    const preview = getRolePreviewOverride()
    if (preview !== undefined) {
      return user.rolePreviewActorId ?? user.id
    }
  }
  return user.id
}

export async function currentUserRole(): Promise<string | null> {
  const user = await currentUser()
  if (user.isAdmin) {
    const previewRoleId = getRolePreviewOverride()
    if (previewRoleId !== undefined) {
      return previewRoleId
    }
  }
  return user.roleId
}

export async function actualUserRole(): Promise<string | null> {
  return (await currentUser()).roleId
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  return (await currentUser()).isAdmin
}

export async function canCurrentUserAuthorReports(): Promise<boolean> {
  return (await currentUser()).canAuthorReports
}

/** Sync peek for list-filter `$CURRENT_USER` after `currentUser()` has warmed the cache. */
export function peekCachedCurrentUserId(): string | null {
  if (!cachedUser) return null
  if (cachedUser.isAdmin && getRolePreviewOverride() !== undefined) {
    const preview = cachedUser.rolePreviewActorId?.trim()
    if (preview) return preview
  }
  const id = cachedUser.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export function clearCurrentUserCache(): void {
  cachedUser = null
  userPromise = null
}

async function fetchRoleName(roleId: string): Promise<string | null> {
  try {
    const roles = await loadAppRoles()
    return roles.find((role) => role.id === roleId)?.name?.trim() || null
  } catch {
    return null
  }
}
