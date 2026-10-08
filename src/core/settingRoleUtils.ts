import { readRolesBridge } from '@/core/graphql/rolesApi'
import type { AppRoleOption, SavedRoleScopedLayout, SetupLayoutListItem } from '@/interfaces'

export const SETTING_ROLE_FIELDS = [
  'id',
  'collection',
  'group',
  'name',
  'sub_group',
  'role',
  'body',
] as const

export const SETTING_LIST_FIELDS = [
  ...SETTING_ROLE_FIELDS,
  'role.id',
  'role.name',
] as const

export interface SettingRecordWithRole {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: unknown
}

export interface SettingRecordWithAudit extends SettingRecordWithRole {
  date_created?: string | null
  date_updated?: string | null
  user_created?: { first_name?: string | null; last_name?: string | null } | null
  user_updated?: { first_name?: string | null; last_name?: string | null } | null
}

function formatSettingUserName(
  user?: { first_name?: string | null; last_name?: string | null } | null,
): string | null {
  if (!user) return null
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return name || null
}

export class DuplicateRoleScopedLayoutError extends Error {
  constructor() {
    super('Duplicate role-scoped layout')
    this.name = 'DuplicateRoleScopedLayoutError'
  }
}

export function roleFilter(roleId: string | null): Record<string, unknown> {
  if (roleId === null) {
    return { role: { _null: true } }
  }
  return { role: { _eq: roleId } }
}

export function parseSettingRoleId(
  role: SettingRecordWithRole['role'],
): string | null {
  if (role === undefined || role === null) return null
  if (typeof role === 'string') return role || null
  if (role.id === undefined || role.id === null) return null
  return String(role.id)
}

export function parseSettingRoleName(
  role: SettingRecordWithRole['role'],
): string | null {
  if (!role || typeof role === 'string') return null
  return role.name?.trim() || null
}

export function normalizeSetupLayoutListItem(
  record: SettingRecordWithAudit,
): SetupLayoutListItem {
  const base = normalizeSavedRoleScopedLayout(record)
  return {
    ...base,
    dateCreated: record.date_created ?? null,
    dateUpdated: record.date_updated ?? null,
    userCreatedName: formatSettingUserName(record.user_created),
    userUpdatedName: formatSettingUserName(record.user_updated),
  }
}

export function normalizeSavedRoleScopedLayout(
  record: SettingRecordWithRole,
): SavedRoleScopedLayout {
  const roleId = parseSettingRoleId(record.role)
  const roleName = parseSettingRoleName(record.role)
  const name = record.name?.trim() || String(record.id)

  return {
    id: String(record.id),
    name,
    roleId,
    roleName,
  }
}

export function canDeleteRoleScopedLayout(
  layout: { id: string; roleId: string | null },
  layouts: Array<{ id: string; roleId: string | null }>,
): boolean {
  if (layout.roleId !== null) return true
  return layouts.some((item) => item.roleId === null && item.id !== layout.id)
}

export function sortRoleScopedLayouts(
  layouts: SavedRoleScopedLayout[],
): SavedRoleScopedLayout[] {
  return [...layouts].sort((a, b) => {
    if (a.roleId === null && b.roleId !== null) return -1
    if (a.roleId !== null && b.roleId === null) return 1
    return a.name.localeCompare(b.name)
  })
}

export async function loadAppRoles(): Promise<AppRoleOption[]> {
  return readRolesBridge()
}

export const DEFAULT_ROLE_SELECT_VALUE = '__default_role__'

export function roleIdToSelectValue(roleId: string | null | undefined): string {
  return roleId ?? DEFAULT_ROLE_SELECT_VALUE
}

export function selectValueToRoleId(value: unknown): string | null {
  if (value === null || value === undefined || value === DEFAULT_ROLE_SELECT_VALUE) {
    return null
  }
  return String(value)
}

export function buildRoleSelectOptions(
  roleOptions: AppRoleOption[],
  defaultRoleLabel: string,
): Array<{ label: string; value: string }> {
  return [
    {
      label: defaultRoleLabel,
      value: DEFAULT_ROLE_SELECT_VALUE,
    },
    ...roleOptions.map((role) => ({
      label: role.name,
      value: role.id,
    })),
  ]
}

export function pickUnusedRoleId(
  layouts: SavedRoleScopedLayout[],
  roleOptions: AppRoleOption[],
): string | null {
  const usedRoleIds = new Set(layouts.map((layout) => layout.roleId ?? null))
  if (!usedRoleIds.has(null)) return null
  return roleOptions.find((role) => !usedRoleIds.has(role.id))?.id ?? null
}

export function layoutLabelForRole(
  layout: SavedRoleScopedLayout,
  defaultRoleLabel: string,
): string {
  if (layout.roleId === null) {
    return `${layout.name} (${defaultRoleLabel})`
  }
  const roleLabel = layout.roleName || layout.roleId
  return `${layout.name} (${roleLabel})`
}

