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
    isFilesField(field) ||
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
