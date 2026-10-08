import { DEFAULT_ROLE_SELECT_VALUE } from '@/core/settingRoleUtils'

export const ROLE_PREVIEW_STORAGE_KEY = 'crm_role_preview'
export const ROLE_PREVIEW_LABEL_STORAGE_KEY = 'crm_role_preview_label'
export const ACTUAL_ROLE_SELECT_VALUE = '__actual_role__'

export function getRolePreviewOverride(): string | null | undefined {
  if (typeof sessionStorage === 'undefined') return undefined

  const raw = sessionStorage.getItem(ROLE_PREVIEW_STORAGE_KEY)
  if (raw === null) return undefined
  if (raw === DEFAULT_ROLE_SELECT_VALUE) return null
  return raw
}

export function setRolePreviewOverride(roleId: string | null): void {
  sessionStorage.setItem(
    ROLE_PREVIEW_STORAGE_KEY,
    roleId === null ? DEFAULT_ROLE_SELECT_VALUE : roleId,
  )
}

export function clearRolePreviewOverride(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(ROLE_PREVIEW_STORAGE_KEY)
  sessionStorage.removeItem(ROLE_PREVIEW_LABEL_STORAGE_KEY)
}

export function isRolePreviewActive(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(ROLE_PREVIEW_STORAGE_KEY) !== null
}

export function setRolePreviewDisplayLabel(label: string): void {
  if (typeof sessionStorage === 'undefined') return
  if (!label.trim()) {
    sessionStorage.removeItem(ROLE_PREVIEW_LABEL_STORAGE_KEY)
    return
  }
  sessionStorage.setItem(ROLE_PREVIEW_LABEL_STORAGE_KEY, label)
}

export function getRolePreviewDisplayLabel(): string {
  if (typeof sessionStorage === 'undefined') return ''
  return sessionStorage.getItem(ROLE_PREVIEW_LABEL_STORAGE_KEY) ?? ''
}
