import { isNestedFieldPath } from '@/core/dataTableFieldPath'
import { serializeDateFieldValue, toDate } from '@/core/dateFormatting'
import { isHtmlEditorColumn } from '@/core/fieldHelpers'
import { isSystemAuditFieldName } from '@/core/layoutFieldRules'
import type { LayoutFieldChildLookup, PrimeVueComponentType } from '@/interfaces'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

export type InlineCellEditorKind =
  | 'text'
  | 'number'
  | 'select'
  | 'date'
  | 'datetime'
  | 'lookup'
  | 'childLookup'
  | 'boolean'

export interface InlineEditableColumnLike {
  field: string
  component?: PrimeVueComponentType | string | null
  relatedCollection?: string | null
  template?: string | null
  format?: string | null
  autoRecordId?: boolean
  recordLink?: boolean
  inlineEditable?: boolean
  /** Entity-global child value lookup (Field config). */
  childLookup?: LayoutFieldChildLookup | null
}

export interface InlineLookupOption {
  label: string
  value: string | number
}

const DATETIME_FORMAT_HINT = /H{1,2}|h{1,2}|ss|\bA\b|\ba\b/

export function resolveInlineCellEditorKind(
  column: InlineEditableColumnLike,
): InlineCellEditorKind | null {
  const isRecordLinkWrapper = Boolean(column.recordLink)
  if (!isRecordLinkWrapper && hasChildLookupSettings(column)) {
    return 'childLookup'
  }
  if (
    !isRecordLinkWrapper &&
    (column.relatedCollection?.trim() || column.component === 'AutoComplete')
  ) {
    return 'lookup'
  }

  switch (column.component) {
    case 'ChildLookup':
      return hasChildLookupSettings(column) ? 'childLookup' : null
    case 'InputNumber':
      return 'number'
    case 'Select':
    case 'Dropdown':
      return 'select'
    case 'DatePicker':
    case 'Calendar':
      return column.format && DATETIME_FORMAT_HINT.test(column.format)
        ? 'datetime'
        : 'date'
    case 'Checkbox':
    case 'ToggleSwitch':
      return 'boolean'
    case 'InputText':
    case 'Password':
      return 'text'
    default:
      return null
  }
}

function hasChildLookupSettings(column: InlineEditableColumnLike): boolean {
  const settings = column.childLookup
  if (!settings || typeof settings !== 'object') return false
  return Boolean(String(settings.sourceField ?? '').trim())
}

export function supportsInlineCellEditor(
  column: InlineEditableColumnLike,
  options: { recordLinksEnabled?: boolean } = {},
): boolean {
  if (options.recordLinksEnabled === false) return false
  if (column.autoRecordId) return false
  if (!column.field?.trim()) return false
  if (isNestedFieldPath(column.field)) return false
  if (isSystemAuditFieldName(column.field)) return false
  if (isHtmlEditorColumn(column)) return false
  return resolveInlineCellEditorKind(column) !== null
}

export function isInlineEditableColumn(
  column: InlineEditableColumnLike,
  options: { recordLinksEnabled?: boolean } = {},
): boolean {
  if (column.inlineEditable !== true) return false
  return supportsInlineCellEditor(column, options)
}

export function toInlineEditorModel(
  kind: InlineCellEditorKind,
  rawValue: unknown,
): unknown {
  switch (kind) {
    case 'lookup': {
      const id = extractRelationFieldId(rawValue)
      if (id === null) return null
      return {
        label: lookupLabel(rawValue, id),
        value: id,
      } satisfies InlineLookupOption
    }
    case 'childLookup':
      return extractRelationFieldId(rawValue) ?? (rawValue === undefined ? null : rawValue)
    case 'number': {
      if (rawValue === null || rawValue === undefined || rawValue === '') return null
      const parsed = Number(rawValue)
      return Number.isFinite(parsed) ? parsed : null
    }
    case 'boolean':
      return rawValue === true || rawValue === 1 || rawValue === '1' || rawValue === 'true'
    case 'date':
    case 'datetime':
      return toDate(rawValue)
    case 'select':
      return rawValue === undefined ? null : rawValue
    case 'text':
      return rawValue == null ? '' : String(rawValue)
    default:
      return rawValue
  }
}

export function serializeInlineCellValue(
  kind: InlineCellEditorKind,
  editorValue: unknown,
): unknown {
  switch (kind) {
    case 'lookup':
      return extractRelationFieldId(lookupEditorId(editorValue))
    case 'childLookup': {
      const id = extractRelationFieldId(editorValue)
      if (id !== null) return id
      const value = emptyToNull(editorValue)
      return value === '' ? null : value
    }
    case 'number': {
      if (editorValue === null || editorValue === undefined || editorValue === '') {
        return null
      }
      const parsed = Number(editorValue)
      return Number.isFinite(parsed) ? parsed : null
    }
    case 'boolean':
      return Boolean(editorValue)
    case 'date':
      return serializeDateFieldValue(emptyToNull(editorValue), 'date') ?? null
    case 'datetime':
      return serializeDateFieldValue(emptyToNull(editorValue), 'dateTime') ?? null
    case 'select':
    case 'text': {
      const value = emptyToNull(editorValue)
      return value === '' ? null : value
    }
    default:
      return editorValue ?? null
  }
}

export function inlineCellValuesEqual(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right)
}

export function buildInlinePatchedFieldValue(
  kind: InlineCellEditorKind,
  editorValue: unknown,
  serialized: unknown,
  column: InlineEditableColumnLike,
): unknown {
  if (kind === 'childLookup' && column.relatedCollection?.trim()) {
    const id = extractRelationFieldId(serialized)
    if (id === null) return null
    const label =
      (isLookupOption(editorValue) && editorValue.label) ||
      lookupLabel(editorValue, id)
    return {
      __crmValueType: 'm2o',
      id,
      label,
      relatedCollection: column.relatedCollection,
    }
  }

  if (kind !== 'lookup') return serialized

  const option = isLookupOption(editorValue) ? editorValue : null
  const id = option?.value ?? extractRelationFieldId(serialized)
  if (id === null) return null

  return {
    __crmValueType: 'm2o',
    id,
    label: option?.label || String(id),
    relatedCollection: column.relatedCollection ?? undefined,
  }
}

function lookupEditorId(value: unknown): unknown {
  if (isLookupOption(value)) return value.value
  return value
}

function isLookupOption(value: unknown): value is InlineLookupOption {
  if (!value || typeof value !== 'object') return false
  const option = value as Partial<InlineLookupOption>
  return (
    typeof option.label === 'string' &&
    (typeof option.value === 'string' || typeof option.value === 'number')
  )
}

function lookupLabel(rawValue: unknown, id: string | number): string {
  if (rawValue && typeof rawValue === 'object') {
    const record = rawValue as Record<string, unknown>
    const label = record.label ?? record.name ?? record.title
    if (label !== null && label !== undefined && String(label).trim()) {
      return String(label)
    }
  }
  return String(id)
}

function emptyToNull(value: unknown): unknown {
  if (value === undefined || value === '') return null
  return value
}

function normalizeComparable(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const id = extractRelationFieldId(value)
    if (id !== null) return String(id)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
