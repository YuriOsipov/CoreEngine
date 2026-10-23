import type { EntityLayoutSchema, LayoutFieldMetadata } from '@/interfaces'

export const SYSTEM_AUDIT_FIELDS = [
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
] as const

export const SYSTEM_AUDIT_USER_FIELDS = ['user_created', 'user_updated'] as const

/** Nested scalars requested so list cells can show a user name (mirrors record detail). */
export const SYSTEM_AUDIT_USER_DISPLAY_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'email',
] as const

export type SystemAuditFieldName = (typeof SYSTEM_AUDIT_FIELDS)[number]

export function isSystemAuditFieldName(field: string): boolean {
  return (SYSTEM_AUDIT_FIELDS as readonly string[]).includes(field)
}

export function isSystemAuditUserFieldName(field: string): boolean {
  return (SYSTEM_AUDIT_USER_FIELDS as readonly string[]).includes(field)
}

export function isSystemAuditLayoutField(field: LayoutFieldMetadata): boolean {
  return isSystemAuditFieldName(field.field)
}

export function isEditableFormLayoutField(field: LayoutFieldMetadata): boolean {
  if (isSystemAuditLayoutField(field)) return false
  if (field.component === 'BlockLayout') return false
  return true
}

export function isWritableLayoutField(field: LayoutFieldMetadata): boolean {
  if (isSystemAuditLayoutField(field)) return false
  if (field.readonly === true) return false
  return true
}

const CLIENT_ONLY_LAYOUT_COMPONENTS = [
  'DataTable',
  'CrmTreeTable',
  'CrmScheduler',
  'CrmActivityLog',
  'CrmDocEngine',
] as const

export function isClientOnlyLayoutField(field: LayoutFieldMetadata): boolean {
  return (CLIENT_ONLY_LAYOUT_COMPONENTS as readonly string[]).includes(field.component)
}

export function isSystemInfoEnabled(schema: EntityLayoutSchema): boolean {
  return schema.systemInfo?.enabled !== false
}

export function filterEditableLayoutFields(
  fields: LayoutFieldMetadata[],
): LayoutFieldMetadata[] {
  return fields.filter(isEditableFormLayoutField)
}
