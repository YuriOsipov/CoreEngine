/**
 * Access rules for upsertLayoutSetting / deleteLayoutSetting.
 * Admins: any group. Non-admins with canAuthorReports: report/full for own role only.
 */
import type { MeUser } from '../adapters/usersAdapter.js'
import {
  findLayoutSettingBySettingId,
  type LayoutSettingRow,
} from '../schema/layoutSettings.js'
import {
  assertMeEntityPermission,
  resolveAppRoleId,
} from '../services/rolePermissions.js'

export type LayoutSettingUpsertInput = {
  settingId?: string | null
  entityApiName: string
  groupKey: string
  subGroup?: string | null
  roleId?: string | null
  name?: string | null
  body: Record<string, unknown>
}

function isAdmin(me: MeUser): boolean {
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

function normalizeSubGroup(subGroup: string | null | undefined): string | null {
  if (subGroup === undefined || subGroup === null || subGroup === '') return null
  return String(subGroup)
}

function isAuthorableReportSetting(
  groupKey: string,
  subGroup: string | null | undefined,
): boolean {
  return groupKey === 'report' && normalizeSubGroup(subGroup) === 'full'
}

function storedRoleId(row: LayoutSettingRow): string | null {
  if (row.roleId != null && row.roleId !== '') return String(row.roleId)
  const meta = row.payload?.__meta
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const role = (meta as Record<string, unknown>).role
    if (role != null && role !== '') return String(role)
  }
  return null
}

async function callerRoleRefs(me: MeUser): Promise<string[]> {
  const refs = new Set<string>()
  if (me.roleId) refs.add(String(me.roleId))
  const appRoleId = await resolveAppRoleId(me.roleId)
  if (appRoleId) refs.add(String(appRoleId))
  return [...refs]
}

function assertOwnsReportRole(
  stored: string | null,
  roleRefs: string[],
): void {
  if (stored == null || stored === '') {
    throw new Error('Admin access required')
  }
  if (!roleRefs.includes(String(stored))) {
    throw new Error('Admin access required')
  }
}

/** Normalize upsert input for admins; force own-role report writes for authors. */
export async function authorizeLayoutSettingUpsert(
  me: MeUser,
  input: LayoutSettingUpsertInput,
): Promise<LayoutSettingUpsertInput> {
  if (isAdmin(me)) return input

  if (!me.canAuthorReports) {
    throw new Error('Admin access required')
  }
  if (!isAuthorableReportSetting(input.groupKey, input.subGroup)) {
    throw new Error('Admin access required')
  }
  if (!me.roleId) {
    throw new Error('Admin access required')
  }

  const roleRefs = await callerRoleRefs(me)
  const forcedRoleId = String(me.roleId)
  const settingKey = input.settingId?.trim() || null
  if (settingKey) {
    const existing = await findLayoutSettingBySettingId(settingKey)
    if (existing) {
      if (!isAuthorableReportSetting(existing.groupKey, existing.subGroup)) {
        throw new Error('Admin access required')
      }
      assertOwnsReportRole(storedRoleId(existing), roleRefs)
    }
  }

  await assertMeEntityPermission(me, input.entityApiName, 'read')

  return {
    ...input,
    roleId: forcedRoleId,
    subGroup: 'full',
  }
}

/** Allow delete when admin, or report author deleting an own-role report. */
export async function authorizeLayoutSettingDelete(
  me: MeUser,
  settingId: string,
): Promise<LayoutSettingRow> {
  const existing = await findLayoutSettingBySettingId(settingId)
  if (!existing) {
    throw new Error('Layout setting not found')
  }
  if (isAdmin(me)) return existing

  if (!me.canAuthorReports) {
    throw new Error('Admin access required')
  }
  if (!isAuthorableReportSetting(existing.groupKey, existing.subGroup)) {
    throw new Error('Admin access required')
  }
  const roleRefs = await callerRoleRefs(me)
  assertOwnsReportRole(storedRoleId(existing), roleRefs)
  return existing
}
