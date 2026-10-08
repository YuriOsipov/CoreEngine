import {
  resolveRelatedTransferValue,
  type RelatedTransferResolveContext,
} from '@/core/relatedTransferResolver'
import { readPath, resolveRecordKey, setPathValue } from '@/core/utils/object'
import type { RelatedTransferSettings } from '@/interfaces'
import { formatDisplayValue, scalarId } from '@/modules/entities/utils/recordDisplay'
import {
  collectSourceTokenFields,
  lookupFilterTokens,
} from '@/modules/entities/utils/relatedTransferFilters'
import {
  resolveFlatFieldPath,
} from '@/modules/entities/utils/relatedTransferSchema'
import type { FieldDefinition } from '@/interfaces'
import type { LookupSelectOption, TransferRow, TranslateFn } from '@/modules/entities/components/related-transfer/types'
import { LOOKUP_SOURCE_COLUMN_PREFIX } from '@/modules/entities/components/related-transfer/types'

export function formatTransferValue(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.__crmValueType === 'm2o' && record.label !== undefined && record.label !== null) {
      return String(record.label)
    }
    return String(record.label ?? record.name ?? record.title ?? record.id ?? formatDisplayValue(value))
  }
  return formatDisplayValue(value, { emptyValue: '-' })
}

export function buildCreatePayload(
  currentSettings: RelatedTransferSettings,
  sourceRecord: Record<string, unknown>,
  context: {
    parentRecord: Record<string, unknown>
    parentId: string | number | undefined
    parentField: string
    sourcePrimaryKey: string
  },
): Record<string, unknown> {
  const targetSettings = currentSettings.target
  const mapping = currentSettings.mapping
  const payload: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(mapping?.defaults ?? {})) {
    payload[field] = resolveRelatedTransferValue(value, {
      parentRecord: context.parentRecord,
      parentId: context.parentId,
      sourceRecord,
      sourcePrimaryKey: context.sourcePrimaryKey,
    })
  }

  for (const [targetField, sourceField] of Object.entries(mapping?.copyFromSource ?? {})) {
    payload[targetField] = sourceRecord[sourceField]
  }

  for (const [field, value] of Object.entries(mapping?.values ?? {})) {
    payload[field] = resolveRelatedTransferValue(value, {
      parentRecord: context.parentRecord,
      parentId: context.parentId,
      sourceRecord,
      sourcePrimaryKey: context.sourcePrimaryKey,
    })
  }

  if (context.parentField) {
    payload[context.parentField] = context.parentId
  }
  payload[targetSettings.itemField] = scalarId(sourceRecord[context.sourcePrimaryKey])

  return payload
}

export function buildPendingPayload(
  currentSettings: RelatedTransferSettings,
  row: TransferRow,
  payloadContext: Parameters<typeof buildCreatePayload>[2],
): Record<string, unknown> {
  const sourceRecord = row.source
  if (!sourceRecord) return row.draft ?? {}

  return {
    ...buildCreatePayload(currentSettings, sourceRecord, payloadContext),
    ...(row.draft ?? {}),
  }
}

export function applyTargetDefaultValues(
  draft: Record<string, unknown>,
  defaultValues: Record<string, unknown> | undefined,
  context: RelatedTransferResolveContext,
): void {
  if (!defaultValues) return
  for (const [field, value] of Object.entries(defaultValues)) {
    if (!(field in draft) || draft[field] === undefined || draft[field] === null) {
      const resolved = resolveRelatedTransferValue(value, context)
      draft[field] = scalarId(resolved) ?? resolved
    }
  }
}

export function applySelectableLookupDefaults(
  draft: Record<string, unknown>,
  currentSettings: RelatedTransferSettings,
  sourceRecord: Record<string, unknown>,
  lookupOptions: Record<string, LookupSelectOption[]>,
  sourcePrimaryKey: string,
): void {
  for (const [field, lookup] of Object.entries(currentSettings.mapping?.lookups ?? {})) {
    if (!lookup.selectable || !lookup.defaultValueField || draft[field] !== undefined) continue
    const resolved = resolveRelatedTransferValue(`$source.${lookup.defaultValueField}`, {
      sourceRecord,
      sourcePrimaryKey,
    })
    const defaultValue = scalarId(resolved) ?? resolved
    if (
      defaultValue !== undefined &&
      defaultValue !== null &&
      lookupOptions[field]?.some((option) => option.value === defaultValue)
    ) {
      draft[field] = defaultValue
    }
  }
}

export function mergeParentRecord(
  parentRecord: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    const existingKey = resolveRecordKey(parentRecord, key)
    parentRecord[existingKey ?? key] = value
  }
}

export function normalizeParentTokenPaths(
  parentRecord: Record<string, unknown>,
  nestedParentPaths: string[][],
): void {
  for (const parts of nestedParentPaths) {
    const value = readPath(parentRecord, parts.join('.'))
    if (!isMissingFilterTokenValue(value)) {
      setPathValue(parentRecord, parts, value)
    }
  }
}

export function normalizeParentTokenPathsFromDirectRow(
  parentRecord: Record<string, unknown>,
  row: Record<string, unknown>,
  parentFields: FieldDefinition[] | null,
  nestedParentPaths: string[][],
): void {
  for (const parts of nestedParentPaths) {
    if (!isMissingFilterTokenValue(readPath(parentRecord, parts.join('.')))) continue

    const flatField = resolveFlatFieldPath(parentFields, parts)
    const candidates = [
      flatField,
      parts.join('_'),
      parts.join('.'),
    ].filter((field): field is string => Boolean(field))

    for (const candidate of candidates) {
      const rowKey = resolveRecordKey(row, candidate)
      if (!rowKey) continue

      const value = row[rowKey]
      if (!isMissingFilterTokenValue(value)) {
        setPathValue(parentRecord, parts, value)
        break
      }
    }
  }
}

export function isMissingFilterTokenValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

export function unresolvedFilterTokens(
  filter: Record<string, unknown> | null | undefined,
  context: RelatedTransferResolveContext,
): string[] {
  return lookupFilterTokens(filter).filter((token) =>
    isMissingFilterTokenValue(resolveRelatedTransferValue(token, context)),
  )
}

export function filterTokenMissingMessage(
  contextLabel: string,
  tokens: string[],
  context: RelatedTransferResolveContext,
  t: TranslateFn,
): string {
  return t(
    'relatedTransfer.filterTokenMissing',
    '{context}: "{token}" is empty on this record, so no source items can be loaded. Set that value on the parent (e.g. Patient → Group), or change Source filter to a field that has a value (e.g. Facility → Price Group). Parent keys: {keys}.',
    {
      context: contextLabel,
      token: tokens.join(', '),
      keys: Object.keys(context.parentRecord ?? {}).join(', ') || '-',
    },
  )
}

export function assertFilterTokensResolved(
  contextLabel: string,
  filter: Record<string, unknown> | null | undefined,
  context: RelatedTransferResolveContext,
  t: TranslateFn,
): void {
  const unresolved = unresolvedFilterTokens(filter, context)
  if (unresolved.length > 0) {
    throw new Error(filterTokenMissingMessage(contextLabel, unresolved, context, t))
  }
}

/** @deprecated Prefer {@link assertFilterTokensResolved}. */
export function assertLookupTokensResolved(
  targetField: string,
  filter: Record<string, unknown> | null | undefined,
  context: RelatedTransferResolveContext,
  t: TranslateFn,
): void {
  assertFilterTokensResolved(
    t('relatedTransfer.lookupMappingContext', 'Lookup mapping for "{field}"', { field: targetField }),
    filter,
    context,
    t,
  )
}

export function isLookupSourceColumn(field: string): boolean {
  return field.startsWith(LOOKUP_SOURCE_COLUMN_PREFIX)
}

export function lookupSourceTargetField(field: string): string {
  return field.replace(LOOKUP_SOURCE_COLUMN_PREFIX, '')
}

export function defaultValueSourceFields(currentSettings: RelatedTransferSettings): string[] {
  const fields: string[] = []
  for (const value of Object.values(currentSettings.target.defaultValues ?? {})) {
    if (typeof value === 'string') {
      const match = /^\$source\.([A-Za-z0-9_.]+)$/.exec(value.trim())
      if (match) fields.push(match[1].split('.')[0])
    }
  }
  return fields
}

export function lookupSourceFields(
  lookups: Record<string, { filter?: Record<string, unknown> | null; defaultValueField?: string }>,
): string[] {
  const fields = new Set<string>()

  for (const lookup of Object.values(lookups)) {
    collectSourceTokenFields(lookup.filter, fields)
    if (lookup.defaultValueField) {
      fields.add(lookup.defaultValueField.split('.')[0])
    }
  }

  return Array.from(fields)
}

export function targetValue(row: Record<string, unknown> | undefined, field: string): unknown {
  if (!row) return undefined
  return row[field]
}

export function duplicateValue(
  row: Record<string, unknown> | undefined,
  duplicateKey: string,
): string | number | null {
  if (!row) return null
  return scalarId(row[duplicateKey])
}

export function sourceValue(
  row: Record<string, unknown> | undefined,
  field: string,
): string | number | null {
  if (!row) return null
  return scalarId(row[field])
}

export function parentTokenHeaderLabel(token: string, humanizeFieldName: (field: string) => string): string {
  return humanizeFieldName(token.replace(/^\$parent\./, '').replace(/\./g, ' '))
}
