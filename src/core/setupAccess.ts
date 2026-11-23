import { currentUser } from '@/core/currentUser'
import { fetchAppRolesAdmin } from '@/core/graphql/userAdminApi'
import {
  getRolePreviewOverride,
  isRolePreviewActive,
} from '@/core/rolePreview'

export interface EffectiveSetupAccess {
  /** May open `/setup` at all. */
  canOpenSetup: boolean
  /** Full Setup (admin session, not previewing a non-admin role). */
  isFullSetupAdmin: boolean
  /** May author reports for the effective role. */
  canAuthorReports: boolean
}

async function resolvePreviewedRoleFlags(
  roleId: string | null,
): Promise<{ isAdmin: boolean; canAuthorReports: boolean }> {
  if (roleId == null || roleId === '') {
    return { isAdmin: false, canAuthorReports: false }
  }
  try {
    const roles = await fetchAppRolesAdmin()
    const matched = roles.find(
      (role) =>
        String(role.id) === String(roleId) ||
        String(role.backendRoleId ?? '') === String(roleId),
    )
    if (!matched) return { isAdmin: false, canAuthorReports: false }
    return {
      isAdmin: Boolean(matched.isAdmin),
      canAuthorReports: Boolean(matched.canAuthorReports || matched.isAdmin),
    }
  } catch {
    return { isAdmin: false, canAuthorReports: false }
  }
}

/**
 * Setup UI access for the effective session — honors admin "View as role"
 * the same way record ACL does (preview strips admin bypass for UI gates).
 */
export async function getEffectiveSetupAccess(): Promise<EffectiveSetupAccess> {
  const user = await currentUser()

  if (user.isAdmin && isRolePreviewActive()) {
    const previewRoleId = getRolePreviewOverride()
    const flags = await resolvePreviewedRoleFlags(
      previewRoleId === undefined ? null : previewRoleId,
    )
    if (flags.isAdmin) {
      return {
        canOpenSetup: true,
        isFullSetupAdmin: true,
        canAuthorReports: true,
      }
    }
    return {
      canOpenSetup: flags.canAuthorReports,
      isFullSetupAdmin: false,
      canAuthorReports: flags.canAuthorReports,
    }
  }

  if (user.isAdmin) {
    return {
      canOpenSetup: true,
      isFullSetupAdmin: true,
      canAuthorReports: true,
    }
  }

  const canAuthor = Boolean(user.canAuthorReports)
  return {
    canOpenSetup: canAuthor,
    isFullSetupAdmin: false,
    canAuthorReports: canAuthor,
  }
}
