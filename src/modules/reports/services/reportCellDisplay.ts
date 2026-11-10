import {
  formatLocalizedDate,
  formatLocalizedDateTime,
} from '@/core/dateFormatting'
import { getOrgLanguage } from '@/core/orgLocale'
import type { FieldDefinition, RelationDefinition } from '@/interfaces'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  formatNumberDisplayValue,
  resolveNumberDisplayOptions,
  type NumberDisplayOptions,
} from '@/modules/entities/utils/recordDisplay'
import { findRelationForField, normalizeSpecial } from '@/modules/entities/utils/fieldMapper'
import type { ReportAggregate } from './reportSettings'

/** Format a raw cell for report drill-down using field meta + org locale/currency. */
export function formatReportCellDisplay(
  value: unknown,
  field: FieldDefinition | null | undefined,
  emptyLabel = '(empty)',
): string {
  if (value === null || value === undefined || value === '') return emptyLabel

  if (field) {
    const type = String(field.type ?? '').toLowerCase()
    if (type === 'date') {
      return formatLocalizedDate(value) || emptyLabel
    }
    if (type === 'datetime' || type === 'timestamp') {
      return formatLocalizedDateTime(value, { includeSeconds: false }) || emptyLabel
    }

    const numberOpts = resolveNumberDisplayOptions(field)
    const formattedNumber = formatNumberDisplayValue(value, numberOpts)
    if (formattedNumber !== null) return formattedNumber
  }

  return formatFallbackCellValue(value, emptyLabel)
}

function formatFallbackCellValue(value: unknown, emptyLabel: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return formatLocalizedDate(trimmed) || emptyLabel
    }
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) {
      return formatLocalizedDateTime(trimmed, { includeSeconds: false }) || emptyLabel
    }
  }
  if (value instanceof Date) {
    return formatLocalizedDateTime(value, { includeSeconds: false }) || emptyLabel
  }
  if (typeof value === 'object' && value) {
    const record = value as Record<string, unknown>
    if (record.__crmValueType === 'm2o' && record.label != null) return String(record.label)
    return String(record.name ?? record.title ?? record.label ?? record.id ?? JSON.stringify(record))
  }
  return String(value)
}

/**
 * Pivot indicator / total formatting: field currency/number options when known,
 * otherwise org-locale numeric with consistent decimals (no raw "4016" vs "3,615.58").
 */
export function formatReportAggregateValue(
  value: unknown,
  aggregate: ReportAggregate,
  numberDisplay?: NumberDisplayOptions | null,
): string {
  if (value === null || value === undefined || value === '') {
    return aggregate === 'count' ? '0' : ''
  }

  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)

  if (aggregate === 'count') {
    return new Intl.NumberFormat(getOrgLanguage(), {
      maximumFractionDigits: 0,
    }).format(numeric)
  }

  const viaField = formatNumberDisplayValue(numeric, numberDisplay)
  if (viaField !== null) return viaField

  const digits =
    typeof numberDisplay?.decimalPlaces === 'number'
      ? numberDisplay.decimalPlaces
      : undefined
  return new Intl.NumberFormat(getOrgLanguage(), {
    minimumFractionDigits: digits ?? 0,
    maximumFractionDigits: digits ?? 2,
  }).format(numeric)
}

/** Load NumberDisplayOptions for pivot value field paths. */
export async function resolveReportValueDisplayOptions(
  collection: string,
  valueFields: string[],
): Promise<Record<string, NumberDisplayOptions>> {
  const definitions = await resolveReportFieldDefinitions(collection, valueFields)
  const result: Record<string, NumberDisplayOptions> = {}
  for (const [path, field] of definitions) {
    const options = resolveNumberDisplayOptions(field)
    if (options) result[path] = options
  }
  return result
}

export async function resolveReportFieldDefinition(
  collection: string,
  fieldPath: string,
): Promise<FieldDefinition | null> {
  if (!collection || !fieldPath) return null
  const relations = await getCachedRelations()
  return resolveFieldPath(collection, fieldPath, relations)
}

export async function resolveReportFieldDefinitions(
  collection: string,
  fieldPaths: string[],
): Promise<Map<string, FieldDefinition>> {
  const map = new Map<string, FieldDefinition>()
  if (!collection) return map
  const unique = Array.from(new Set(fieldPaths.filter(Boolean)))
  await Promise.all(
    unique.map(async (path) => {
      const field = await resolveReportFieldDefinition(collection, path)
      if (field) map.set(path, field)
    }),
  )
  return map
}

async function resolveFieldPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<FieldDefinition | null> {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return null

  let currentCollection = collection
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = (await getCachedCollectionFields(currentCollection)) as FieldDefinition[]
    const field = fields.find((item) => item.field === part)
    if (!field) return null
    if (index === parts.length - 1) return field

    const relation =
      findRelationForField(field, relations) ??
      relations.find(
        (item) => item.collection === currentCollection && item.field === part,
      )
    const special = normalizeSpecial(field.meta?.special)
    const related = relation?.related_collection
    const isM2O = Boolean(related) && (special.includes('m2o') || Boolean(related))
    if (!isM2O || !related) return null
    currentCollection = related
  }

  return null
}
