import type { DocTemplateRecord } from '@/interfaces'
import {
  parseSettingRoleId,
  parseSettingRoleName,
} from '@/core/settingRoleUtils'

/** Templates visible to the current user: role empty (all) or role matches. */
export function docTemplateAccessFilter(
  roleId: string | null,
): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ role: { _null: true } }]
  if (roleId) {
    parts.push({ role: { _eq: roleId } })
  }
  return { _or: parts }
}

/**
 * @deprecated Unsafe on Hasura when `doc_value.template` is a scalar FK.
 * Prefer client-side `canAccessDocTemplate` after loading nested template fields.
 */
export function docValueTemplateAccessFilter(
  roleId: string | null,
): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [
    { template: { role: { _null: true } } },
  ]
  if (roleId) {
    parts.push({ template: { role: { _eq: roleId } } })
  }
  return { _or: parts }
}

export function parseDocTemplateRoleId(
  role: DocTemplateRecord['role'],
): string | null {
  return parseSettingRoleId(role as never)
}

export function parseDocTemplateRoleName(
  role: DocTemplateRecord['role'],
): string | null {
  return parseSettingRoleName(role as never)
}

export function canAccessDocTemplate(
  record: Pick<DocTemplateRecord, 'role'>,
  roleId: string | null,
): boolean {
  const templateRoleId = parseDocTemplateRoleId(record.role)
  if (templateRoleId === null) return true
  return templateRoleId === roleId
}
