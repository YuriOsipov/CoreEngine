import { loadAppRoles } from './settingRoleUtils'
import { getRolePreviewOverride } from './rolePreview'
import { formatUserLabel } from '@/modules/entities/utils/recordDisplay'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'

export interface CurrentUser {
  id: string | null
  label: string
  roleId: string | null
  roleName: string | null
  isAdmin: boolean
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
      roleId: me.roleId,
      roleName,
      isAdmin,
    }
    return cachedUser
  })()

  try {
    return await userPromise
  } finally {
    userPromise = null
  }
}

export async function currentUserId(): Promise<string | null> {
  return (await currentUser()).id
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
