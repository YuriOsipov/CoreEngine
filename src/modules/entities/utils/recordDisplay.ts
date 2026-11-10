import {
  humanizeName,
  translateChoice,
  type DynamicTranslationContext,
} from '@/core/translation'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import {
  formatOrgCurrencyValue,
  isOrgCurrencyPlaceholderAffix,
} from '@/core/orgLocale'
import { keysEqual, resolveRecordKey } from '@/core/utils/object'

export const DISPLAY_FIELD_CANDIDATES = [
  'long_name',
  'second_name',
  'first_name',
  'name',
  'title',
  'label',
  'email',
  'display_name',
  'id',
]

export function humanizeFieldName(field: string): string {
  return humanizeName(field)
}

export function scalarId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string' || typeof record.id === 'number') {
      return record.id
    }
  }
  return null
}

function isEmptyRelationId(id: string | number | null): boolean {
  return id === null || id === 0 || id === '0'
}

/** Resolves an M2O / table cell value to a relation primary key, ignoring invalid `0`. */
export function extractRelationFieldId(value: unknown): string | number | null {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.__crmValueType === 'm2o') {
      const id = scalarId(record.id)
      return isEmptyRelationId(id) ? null : id
    }
  }

  const id = scalarId(value)
  return isEmptyRelationId(id) ? null : id
}

export function recordId(
  record: Record<string, unknown>,
  primaryKey: string,
): string | number | null {
  return scalarId(record[primaryKey])
}

export function recordLabel(
  record: Record<string, unknown>,
  labelField: string,
): string {
  const value = record[labelField]
  if (value === null || value === undefined || value === '') {
    return String(record.id ?? '')
  }
  return String(value)
}

export function relatedRecordDisplayField(fields: Array<{ field: string }>): string {
  for (const candidate of DISPLAY_FIELD_CANDIDATES) {
    if (candidate === 'id') continue
    const match = fields.find((field) => keysEqual(field.field, candidate))
    if (match) return match.field
  }
  return fields.find((field) => keysEqual(field.field, 'id'))?.field ?? 'id'
}

export function extractTemplateFields(template: string): string[] {
  const matcher = /\{\{\s*([\w.]+)\s*\}\}/g
  const fields: string[] = []
  let match = matcher.exec(template)

  while (match) {
    fields.push(match[1])
    match = matcher.exec(template)
  }

  return fields
}

export function templateReferencesParent(template?: string): boolean {
  return Boolean(
    template &&
      extractTemplateFields(template).some(
        (field) => field === 'parent' || field.startsWith('parent.'),
      ),
  )
}

export function shouldUseTemplateForRelatedLabel(
  template: string | undefined,
  templateFields = template ? extractTemplateFields(template) : [],
): boolean {
  return Boolean(template) && !templateFields.some(
    (field) => field === 'parent' || field.startsWith('parent.'),
  )
}

export function renderTemplateLabel(
  template: string,
  row: Record<string, unknown>,
): string {
  const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    String(getPathValue(row, key) ?? ''),
  )

  return rendered.trim() || String(row.id ?? '')
}

/** Label for lookup pickers: values only — omit bare {{id}} from the display template. */
export function relatedPickerLabel(
  row: Record<string, unknown>,
  options: {
    template?: string
    displayField?: string
  } = {},
): string {
  const displayField = options.displayField || 'name'
  const template = options.template?.trim()
  if (template) {
    const fields = extractTemplateFields(template)
    const withoutId = fields.includes('id')
      ? template
          .replace(/\{\{\s*id\s*\}\}/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
      : template
    if (withoutId && shouldUseTemplateForRelatedLabel(withoutId)) {
      const label = renderTemplateLabel(withoutId, row)
      if (label && label !== String(row.id ?? '')) return label
    }
  }
  const fromField = row[displayField]
  if (fromField !== null && fromField !== undefined && String(fromField).trim()) {
    return String(fromField)
  }
  return String(row.id ?? '')
}

export function resolvePrimaryKeyRecordLabel(
  template: string | undefined,
  row: Record<string, unknown>,
  primaryKey: string,
): string {
  const pkValue = String(row[primaryKey] ?? '')
  const templateFields = template ? extractTemplateFields(template) : []
  if (!template || !shouldUseTemplateForRelatedLabel(template, templateFields)) {
    return pkValue
  }

  const rendered = template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => String(getPathValue(row, key) ?? ''))
    .trim()

  return rendered || pkValue
}

export function formatUserLabel(
  record: Record<string, unknown> | null | undefined,
): string {
  if (!record) return ''

  const fullName = [record.first_name, record.last_name]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join(' ')
    .trim()
  if (fullName) return fullName

  for (const field of ['email', 'name', 'title', 'label', 'display_name'] as const) {
    const value = record[field]
    if (value !== null && value !== undefined && value !== '') {
      return String(value)
    }
  }

  return ''
}

export function relatedRecordFallbackLabel(value: unknown, id?: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const userLabel = formatUserLabel(record)
    if (userLabel) return userLabel

    for (const field of DISPLAY_FIELD_CANDIDATES) {
      if (field === 'id') continue
      const key = resolveRecordKey(record, field)
      if (!key) continue
      const displayValue = record[key]
      if (
        displayValue !== null &&
        displayValue !== undefined &&
        displayValue !== '' &&
        typeof displayValue !== 'object'
      ) {
        return String(displayValue)
      }
    }
  }

  return String(id ?? '')
}

type ArrayDisplayMode = 'list' | 'count' | 'count-objects'

interface FormatDisplayValueOptions {
  emptyValue?: string
  booleanLabels?: {
    true: string
    false: string
  }
  arrayDisplay?: ArrayDisplayMode
  itemLabel?: (count: number) => string
}

export interface NumberDisplayOptions {
  prefix?: string
  suffix?: string
  decimalPlaces?: number
  /** When true and no field affix, format with org currency (Intl). */
  useOrgCurrency?: boolean
}

/** Resolve Currency / Number interface options for list and read-only display. */
export function resolveNumberDisplayOptions(
  definition: {
    type?: string
    meta?: { interface?: string | null; options?: Record<string, unknown> | null } | null
  } | null | undefined,
): NumberDisplayOptions | null {
  if (!definition) return null

  const options = (definition.meta?.options ?? {}) as Record<string, unknown>
  const iface = String(definition.meta?.interface || '').toLowerCase()
  const type = String(definition.type || '').toLowerCase()
  const isNumericType = ['float', 'decimal', 'integer', 'biginteger', 'number'].includes(type)
  const isFloatLike = type === 'float' || type === 'decimal'
  const isCurrency = iface.includes('currency')
  const isNumberIface =
    iface.includes('number') || iface.includes('numeric') || iface.includes('slider')

  // Legacy field options often store ISO codes as suffix ("USD") — ignore those
  // for currency interfaces and use org currency symbol as prefix instead.
  const suffixRaw = isCurrency ? options.suffix : (options.suffix ?? options.currency)
  const prefixRaw = options.prefix
  const placesRaw =
    options.scale ?? options.decimalPlaces ?? options.minFractionDigits
  const places =
    typeof placesRaw === 'number'
      ? placesRaw
      : typeof placesRaw === 'string' && placesRaw.trim()
        ? Number(placesRaw)
        : NaN

  const suffix = typeof suffixRaw === 'string' ? suffixRaw.trim() : ''
  const prefix = typeof prefixRaw === 'string' ? prefixRaw.trim() : ''
  const hasPlaces = Number.isFinite(places)
  // Ignore leftover `$` / `USD` / `€` markers — company currency is authoritative.
  const customAffix = isCurrency
    ? Boolean(prefix && !isOrgCurrencyPlaceholderAffix(prefix))
    : Boolean(suffix || prefix)
  const hasAffix = isCurrency ? customAffix : Boolean(suffix || prefix)

  // FLOAT/DECIMAL always get display options (scale defaults to 2).
  if (
    !isFloatLike &&
    !isCurrency &&
    !isNumberIface &&
    !(isNumericType && (hasAffix || hasPlaces))
  ) {
    return null
  }
  if (!isFloatLike && !isCurrency && !hasAffix && !hasPlaces) return null

  const resolved: NumberDisplayOptions = {}
  if (isCurrency) {
    // Default: live org currency sign as prefix (e.g. €53.27).
    resolved.useOrgCurrency = !customAffix
    if (customAffix && prefix) resolved.prefix = prefix
  } else {
    if (prefix) resolved.prefix = prefix
    if (suffix) resolved.suffix = suffix
  }
  if (hasPlaces) {
    resolved.decimalPlaces = Math.min(38, Math.max(0, Math.trunc(places)))
  } else if (isCurrency || isFloatLike) {
    resolved.decimalPlaces = 2
  }
  return resolved
}

/** Format a numeric value using Currency / Number interface options. */
export function formatNumberDisplayValue(
  value: unknown,
  options?: NumberDisplayOptions | null,
): string | null {
  if (!options) return null
  if (value === null || value === undefined || value === '') return null

  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null

  // Currency → org sign as prefix (`$53.27`), never `53.27 USD`.
  if (options.useOrgCurrency) {
    return formatOrgCurrencyValue(num, {
      decimalPlaces: options.decimalPlaces,
    })
  }

  const prefix = options.prefix ?? ''
  const suffix = options.suffix ?? ''
  const formatted =
    typeof options.decimalPlaces === 'number'
      ? num.toFixed(options.decimalPlaces)
      : String(num)
  if (!prefix && !suffix) return formatted
  if (prefix && suffix) return `${prefix}${formatted} ${suffix}`.trim()
  if (prefix) return `${prefix}${formatted}`
  return `${formatted} ${suffix}`.trim()
}

export function formatDisplayValue(
  value: unknown,
  options: FormatDisplayValueOptions = {},
): string {
  const emptyValue = options.emptyValue ?? ''
  if (value === null || value === undefined || value === '') return emptyValue

  if (typeof value === 'boolean') {
    return value
      ? options.booleanLabels?.true ?? 'Yes'
      : options.booleanLabels?.false ?? 'No'
  }

  if (value instanceof Date) return formatLocalizedDateTime(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return emptyValue

    const arrayDisplay = options.arrayDisplay ?? 'list'
    if (
      arrayDisplay === 'count' ||
      (arrayDisplay === 'count-objects' && value.some((item) => item && typeof item === 'object'))
    ) {
      return itemCountLabel(value.length, options.itemLabel)
    }

    return value.map((item) => formatDisplayValue(item, options)).join(', ')
  }

  if (typeof value === 'object') {
    const label = relatedRecordFallbackLabel(value)
    return label || JSON.stringify(value)
  }

  return String(value)
}

function itemCountLabel(count: number, label?: (count: number) => string): string {
  return label?.(count) ?? `${count} item${count === 1 ? '' : 's'}`
}

export interface ChoiceOption {
  text?: string
  label?: string
  value?: unknown
}

export function relatedRecordLabel(
  record: Record<string, unknown> | null | undefined,
  id: unknown,
  template?: string,
): string {
  const templateFields = template ? extractTemplateFields(template) : []
  if (record && template && shouldUseTemplateForRelatedLabel(template, templateFields)) {
    const rendered = renderTemplateLabel(template, record).trim()
    if (rendered && rendered !== String(id ?? '')) return rendered
  }
  return relatedRecordFallbackLabel(record, id)
}

export function getPathValue(
  row: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    const current = value as Record<string, unknown>
    const recordKey = resolveRecordKey(current, key)
    if (!recordKey) return undefined
    return current[recordKey]
  }, row)
}

export function rowRecordId(row: Record<string, unknown>): string | null {
  const id = row.id
  if (id === null || id === undefined || id === '') return null
  return String(id)
}

export { setPathValueByPath as setPathValue } from '@/core/utils/object'

export async function buildChoiceLabelMap(
  choices: unknown,
  context: DynamicTranslationContext = {},
): Promise<Map<string, string>> {
  if (!Array.isArray(choices)) return new Map()

  const labels = new Map<string, string>()
  for (const choice of choices as ChoiceOption[]) {
    if (choice.value === undefined) continue
    labels.set(
      String(choice.value),
      await choiceLabel(choice, context),
    )
  }

  return labels
}

export async function choiceLabel(
  choice: ChoiceOption,
  context: DynamicTranslationContext = {},
): Promise<string> {
  return translateChoice(choice, context)
}

export function choiceValueLabel(
  value: unknown,
  labels: Map<string, string>,
): string | undefined {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => labels.get(String(item)) ?? String(item))
    return mapped.length > 0 ? mapped.join(', ') : undefined
  }

  if (typeof value === 'string' && value.includes(',')) {
    const values = value.split(',').map((item) => item.trim()).filter(Boolean)
    const mapped = values.map((item) => labels.get(item) ?? item)
    return mapped.length > 0 ? mapped.join(', ') : undefined
  }

  return labels.get(String(value))
}

