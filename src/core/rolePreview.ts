import { DEFAULT_ROLE_SELECT_VALUE } from '@/core/settingRoleUtils'

export const ROLE_PREVIEW_STORAGE_KEY = 'crm_role_preview'
export const ROLE_PREVIEW_LABEL_STORAGE_KEY = 'crm_role_preview_label'
export const ACTUAL_ROLE_SELECT_VALUE = '__actual_role__'

/** BFF header — admin View as role for API ACL / field security. */
export const ROLE_PREVIEW_HEADER = 'X-Role-Preview'

/**
 * Value for `X-Role-Preview` when an admin is previewing another role.
 * `undefined` = not previewing (omit the header).
 */
export function getRolePreviewHeaderValue(): string | undefined {
  const override = getRolePreviewOverride()
  if (override === undefined) return undefined
  if (override === null) return DEFAULT_ROLE_SELECT_VALUE
  return override
}

/** Headers to merge into GraphQL / REST calls while View as role is active. */
export function rolePreviewRequestHeaders(): Record<string, string> {
  const value = getRolePreviewHeaderValue()
  return value ? { [ROLE_PREVIEW_HEADER]: value } : {}
}

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
