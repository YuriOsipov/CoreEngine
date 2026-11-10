import type { LayoutFieldMetadata, EntityLayoutSchema, LayoutGroup } from '@/interfaces'
import { isHtmlEditorComponent } from '@/core/htmlContent'
import {
  extractRelationFieldId,
  formatDisplayValue,
} from '@/modules/entities/utils/recordDisplay'

/** Inline labels are on by default; only an explicit `false` opts out. */
export function isGroupInlineLabels(group: Pick<LayoutGroup, 'inlineLabels'>): boolean {
  return group.inlineLabels !== false
}

export function gridStyle(field: LayoutFieldMetadata): Record<string, string> {
  const span = Math.min(12, Math.max(1, field.span ?? 12))
  return { gridColumn: `span ${span}` }
}

export function isRepeaterField(field: LayoutFieldMetadata): boolean {
  return field.component === 'Repeater'
}

export function isAddressField(field: LayoutFieldMetadata): boolean {
  return field.component === 'Address'
}

export function isJsonListField(field: LayoutFieldMetadata): boolean {
  return field.component === 'JsonList'
}

export function isJsonCodeField(field: LayoutFieldMetadata): boolean {
  return field.component === 'JsonCode'
}

export function isSensitivityMatrixField(field: LayoutFieldMetadata): boolean {
  return field.component === 'SensitivityMatrix'
}

export function isM2ABuilderField(field: LayoutFieldMetadata): boolean {
  return field.component === 'M2ABuilder'
}

export function isM2MMultiSelectField(field: LayoutFieldMetadata): boolean {
  return field.component === 'M2MMultiSelect'
}

export function isDataTableField(field: LayoutFieldMetadata): boolean {
  return field.component === 'DataTable'
}

export function isTreeTableField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmTreeTable'
}

export function isSchedulerField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmScheduler'
}

export function isFilesField(field: LayoutFieldMetadata): boolean {
  return field.component === 'Files'
}

/** Resolved files-field settings. */
export function filesSettings(
  field: LayoutFieldMetadata,
): NonNullable<LayoutFieldMetadata['files']> | undefined {
  return field.files
}

/**
 * Single-file M2O field (Image / file-image) — FK column on the parent,
 * not the shared `files:{collection}` attachments list.
 */
export function isSingleFileField(field: LayoutFieldMetadata): boolean {
  if (!isFilesField(field)) return false
  if (String(field.field || '').startsWith('files:')) return false
  // Explicit multi-file Attachments only; missing `multiple` still means Image.
  return filesSettings(field)?.multiple !== true
}

/** Single-file field constrained to images (Setup Image / file-image). */
export function isImageField(field: LayoutFieldMetadata): boolean {
  if (!isSingleFileField(field)) return false
  const mimes = filesSettings(field)?.allowedMimeTypes ?? []
  // Empty MIME list: Setup Image is the only single-file Files field today.
  if (!mimes.length) return true
  return mimes.every(
    (mime) => mime === 'image' || mime.startsWith('image/'),
  )
}

export function isActivityLogField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmActivityLog'
}

export function isDocEngineField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmDocEngine'
}

export function isChildLookupField(field: LayoutFieldMetadata): boolean {
  return field.component === 'ChildLookup' || Boolean(field.childLookup)
}

export function isChoiceValueField(field: LayoutFieldMetadata): boolean {
  return ['Select', 'Dropdown', 'RadioButton', 'SelectButton', 'MultiSelect', 'ChildLookup'].includes(
    field.component,
  )
}

export function isChoiceOption(
  option: unknown,
): option is { label: string; value: unknown } {
  if (!option || typeof option !== 'object') return false
  const candidate = option as Record<string, unknown>
  return typeof candidate.label === 'string' && candidate.value !== undefined
}

export function isCheckboxField(field: LayoutFieldMetadata): boolean {
  return field.component === 'Checkbox'
}

/** Boolean UI components rendered as checkboxes in lists and forms. */
export function isBooleanColumn(column: { component?: string | null }): boolean {
  return column.component === 'Checkbox' || column.component === 'ToggleSwitch'
}

export function coerceBooleanDisplayValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  return false
}

export function isHtmlEditorField(field: LayoutFieldMetadata): boolean {
  return isHtmlEditorComponent(field.component)
}

/** Full-width complex fields always keep stacked labels (ignore group.inlineLabels). */
export function isFullWidthLayoutField(field: LayoutFieldMetadata): boolean {
  return (
    isDataTableField(field) ||
    isM2ABuilderField(field) ||
    isTreeTableField(field) ||
    isSchedulerField(field) ||
    // Multi-file Attachments stay full-width; single Image sits like a normal field.
    (isFilesField(field) && !isSingleFileField(field)) ||
    isActivityLogField(field) ||
    isDocEngineField(field) ||
    isHtmlEditorField(field) ||
    isRepeaterField(field) ||
    isJsonListField(field) ||
    isJsonCodeField(field) ||
    isSensitivityMatrixField(field)
  )
}

export function isHtmlEditorColumn(column: { component?: string | null }): boolean {
  return isHtmlEditorComponent(column.component)
}

export function isAutoCompleteField(field: LayoutFieldMetadata): boolean {
  return field.component === 'AutoComplete'
}

export function isRelationPickerField(field: LayoutFieldMetadata): boolean {
  return Boolean(
    field.relatedCollection &&
      !field.childLookup &&
      !isDataTableField(field) &&
      !isTreeTableField(field) &&
      !isSchedulerField(field) &&
      !isFilesField(field) &&
      !isM2ABuilderField(field) &&
      !isM2MMultiSelectField(field) &&
      !isRepeaterField(field) &&
      !isAddressField(field) &&
      !isJsonListField(field) &&
      !isJsonCodeField(field) &&
      !isSensitivityMatrixField(field) &&
      !isActivityLogField(field) &&
      !isDocEngineField(field),
  )
}

export function isRelatedValueField(
  field: LayoutFieldMetadata,
  value: unknown,
): boolean {
  return Boolean(
    field.relatedCollection &&
      !isDataTableField(field) &&
      extractRelationFieldId(value) !== null,
  )
}

export function relatedFieldRelationId(value: unknown): string | number | null {
  return extractRelationFieldId(value)
}

export function formatFieldDisplayValue(value: unknown): string {
  return formatDisplayValue(value, { emptyValue: '-', arrayDisplay: 'count-objects' })
}

export function treeTableSummary(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '-'
  return `${value.length} chosen item${value.length === 1 ? '' : 's'}`
}

export function sectionLabel(
  section: EntityLayoutSchema['sections'][number],
  index: number,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  return section.title || t('formRenderer.tabFallback', `Tab {n}`, { n: index + 1 })
}

export function relatedFieldValue(
  field: LayoutFieldMetadata,
  value: unknown,
): string | number | null {
  if (!isRelatedValueField(field, value)) return null
  return relatedFieldRelationId(value)
}

export function treeTableValue(
  value: unknown,
): Array<string | number | Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<string | number | Record<string, unknown>>) : []
}

export function canOpenRelatedList(
  field: LayoutFieldMetadata,
  parentName: string | undefined,
  parentId: string | number | undefined | null,
): boolean {
  return Boolean(
    field.relatedCollection && parentName && parentId !== undefined && parentId !== null,
  )
}

export function formatChoiceValue(
  value: unknown,
  labels: Record<string, string>,
  formatFallback: (v: unknown) => string,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return formatFallback(value)
    return value.map((item) => labels[String(item)] ?? formatFallback(item)).join(', ')
  }

  return labels[String(value)] ?? formatFallback(value)
}

/** Integer / float / decimal / biginteger (case-insensitive). */
export function isNumericFieldType(type: string | null | undefined): boolean {
  const normalized = String(type ?? '').toLowerCase()
  return (
    normalized === 'integer' ||
    normalized === 'biginteger' ||
    normalized === 'float' ||
    normalized === 'decimal' ||
    normalized === 'number'
  )
}

/**
 * Global rule: numeric and currency fields align right in tables.
 * Matches InputNumber / currency interfaces and numeric storage types.
 */
export function isNumericFieldDefinition(
  field: {
    type?: string | null
    meta?: { interface?: string | null } | null
    component?: string | null
  } | null | undefined,
): boolean {
  if (!field) return false
  if (field.component === 'InputNumber') return true
  if (isNumericFieldType(field.type)) return true
  const iface = String(field.meta?.interface ?? '').toLowerCase()
  return (
    iface.includes('currency') ||
    iface.includes('number') ||
    iface.includes('numeric') ||
    iface.includes('slider')
  )
}
