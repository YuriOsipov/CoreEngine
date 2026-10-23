import type {
  FieldDefinition,
  LayoutFieldChildLookup,
} from '@/interfaces'
import {
  childLookupFilterTokensUnresolved,
  resolveChildLookupExtraFilter,
  resolveChildLookupFilterContext,
} from '@/core/childLookupParentContext'
import {
  lookupLabelMetadata,
  lookupOptionLabel,
  resolveFieldPath,
} from '@/core/childLookupOptions'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'
import { readRelatedTransferItems } from '@/modules/entities/services/relatedTransfer'
import {
  extractRelationFieldId,
  scalarId,
} from '@/modules/entities/utils/recordDisplay'

export interface ChildLookupFetchContext {
  entityCollection?: string
  sourceRecord: Record<string, unknown>
  parentCollection?: string
  parentId?: string | number
  parentName?: string
  parentRecord?: Record<string, unknown>
  entityParentField?: string
  sourcePrimaryKey?: string
}

export function resolveChildLookupSourceId(
  sourceRecord: Record<string, unknown>,
  settings: LayoutFieldChildLookup | undefined,
  sourceIdField?: string,
): string | number | null {
  if (sourceIdField) {
    const raw = sourceRecord[sourceIdField]
    if (raw !== undefined && raw !== null && raw !== '') {
      return scalarId(raw) ?? (typeof raw === 'string' || typeof raw === 'number' ? raw : null)
    }
    return scalarId(sourceRecord.id)
  }

  if (!settings?.sourceField) return null
  const raw = sourceRecord[settings.sourceField]
  if (raw === undefined || raw === null || raw === '') return null
  return scalarId(raw) ?? (typeof raw === 'string' || typeof raw === 'number' ? raw : null)
}

export async function loadChildLookupDefaultValue(
  lookup: LayoutFieldChildLookup,
  source: string | number,
  sourceCollection: string,
): Promise<unknown> {
  if (!sourceCollection || !lookup.defaultValueField) return undefined
  try {
    const fields = await getCachedCollectionFields(sourceCollection)
    const defaultValueField = resolveFieldPath(fields, lookup.defaultValueField)
    const rows = await readRelatedTransferItems(
      sourceCollection,
      {
        limit: 1,
        fields: [defaultValueField] as never,
        filter: {
          id: { _eq: source },
        },
      },
    )
    const value = rows[0]?.[defaultValueField]
    return scalarId(value) ?? value
  } catch {
    return undefined
  }
}

export async function fetchChildLookupRows(
  lookup: LayoutFieldChildLookup,
  source: string | number | null,
  context: ChildLookupFetchContext,
): Promise<{
  rows: Record<string, unknown>[]
  valueField: string
}> {
  if (!isChildLookupQueryReady(lookup)) {
    return { rows: [], valueField: '' }
  }

  const filterContext = await resolveChildLookupFilterContext({
    filter: lookup.filter,
    entityCollection: context.entityCollection ?? '',
    sourceRecord: context.sourceRecord,
    parentCollection: context.parentCollection,
    parentId: context.parentId,
    parentName: context.parentName,
    parentRecord: context.parentRecord,
    entityParentField: lookup.parentField,
    sourcePrimaryKey: lookup.sourceField,
  })
  // Dropping unresolved $parent.* clauses would match every Item Price for the
  // source item and pick the first row (often Retail) instead of Account's group.
  if (childLookupFilterTokensUnresolved(lookup.filter, filterContext)) {
    const fields = await collectionFields(lookup.collection)
    const valueField = fields
      ? resolveFieldPath(fields, lookup.valueField)
      : lookup.valueField
    return { rows: [], valueField }
  }
  const extraFilter = resolveChildLookupExtraFilter(lookup.filter, filterContext)
  const sourceFilter = childSourceEqualityFilter(lookup, source)

  const fields = await collectionFields(lookup.collection)
  if (!fields) return { rows: [], valueField: '' }

  const valueField = resolveFieldPath(fields, lookup.valueField)
  const filter = mergeFilters(sourceFilter, extraFilter)
  if (!filter) return { rows: [], valueField: '' }

  const rows = await readRelatedTransferItems(
    lookup.collection,
    {
      limit: -1,
      fields: [valueField] as never,
      filter,
    },
  )

  return { rows, valueField }
}

type PicklistOption = { label: string; value: unknown }

const PICKLIST_CACHE_TTL_MS = 30_000
const picklistOptionsCache = new Map<
  string,
  { expiresAt: number; options: PicklistOption[] }
>()

function picklistCacheKey(
  lookup: LayoutFieldChildLookup,
  source: string | number | null,
  context: ChildLookupFetchContext,
): string {
  return JSON.stringify([
    lookup.collection,
    lookup.childSourceField,
    lookup.valueField,
    lookup.filter ?? null,
    lookup.parentField ?? '',
    source,
    context.entityCollection ?? '',
    context.parentId ?? '',
    context.parentCollection ?? '',
  ])
}

export async function fetchChildLookupPicklistOptions(
  lookup: LayoutFieldChildLookup,
  source: string | number | null,
  context: ChildLookupFetchContext,
): Promise<PicklistOption[]> {
  if (!isChildLookupQueryReady(lookup)) return []

  const cacheKey = picklistCacheKey(lookup, source, context)
  const cached = picklistOptionsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.options
  }

  const filterContext = await resolveChildLookupFilterContext({
    filter: lookup.filter,
    entityCollection: context.entityCollection ?? '',
    sourceRecord: context.sourceRecord,
    parentCollection: context.parentCollection,
    parentId: context.parentId,
    parentName: context.parentName,
    parentRecord: context.parentRecord,
    entityParentField: lookup.parentField,
    sourcePrimaryKey: lookup.sourceField,
  })
  if (childLookupFilterTokensUnresolved(lookup.filter, filterContext)) {
    return []
  }
  const extraFilter = resolveChildLookupExtraFilter(lookup.filter, filterContext)
  const sourceFilter = childSourceEqualityFilter(lookup, source)

  const fields = await collectionFields(lookup.collection)
  if (!fields) return []

  const valueField = resolveFieldPath(fields, lookup.valueField)
  const labelMetadata = await lookupLabelMetadata(lookup.collection, fields, valueField, collectionFields)
  const filter = mergeFilters(sourceFilter, extraFilter)
  if (!filter) return []

  const rows = await readRelatedTransferItems(
    lookup.collection,
    {
      limit: -1,
      fields: Array.from(new Set([
        valueField,
        ...labelMetadata.requestFields,
      ].filter(Boolean))) as never,
      filter,
    },
  )

  const options = rows.flatMap((row) => {
    const value = scalarId(row[valueField]) ?? row[valueField]
    if (value === undefined || value === null || value === '') return []
    return [{
      value,
      label: lookupOptionLabel(row, labelMetadata, value),
    }]
  })

  picklistOptionsCache.set(cacheKey, {
    expiresAt: Date.now() + PICKLIST_CACHE_TTL_MS,
    options,
  })
  return options
}

/** Load a single picklist option by saved value (keeps edit forms showing current selection). */
export async function fetchChildLookupOptionByValue(
  lookup: LayoutFieldChildLookup,
  value: string | number,
): Promise<PicklistOption | null> {
  if (!lookup.collection?.trim() || !lookup.valueField?.trim()) return null

  const fields = await collectionFields(lookup.collection)
  if (!fields) return null

  const valueField = resolveFieldPath(fields, lookup.valueField)
  const labelMetadata = await lookupLabelMetadata(
    lookup.collection,
    fields,
    valueField,
    collectionFields,
  )
  try {
    const rows = await readRelatedTransferItems(lookup.collection, {
      limit: 1,
      fields: Array.from(
        new Set([valueField, ...labelMetadata.requestFields].filter(Boolean)),
      ) as never,
      filter: {
        [valueField]: { _eq: value },
      },
    })
    const row = rows[0]
    if (!row) return null
    const resolved = scalarId(row[valueField]) ?? row[valueField]
    if (resolved === undefined || resolved === null || resolved === '') return null
    return {
      value: resolved,
      label: lookupOptionLabel(row, labelMetadata, resolved),
    }
  } catch {
    return null
  }
}

export function childLookupOptionMatchesValue(
  optionValue: unknown,
  currentValue: unknown,
): boolean {
  const left = extractRelationFieldId(optionValue) ?? scalarId(optionValue)
  const right = extractRelationFieldId(currentValue) ?? scalarId(currentValue)
  if (left === null || right === null) return false
  return String(left) === String(right)
}

export async function resolveChildLookupScalarValue(
  lookup: LayoutFieldChildLookup,
  source: string | number | null,
  context: ChildLookupFetchContext & { sourceCollection?: string },
): Promise<unknown> {
  const { rows, valueField } = await fetchChildLookupRows(lookup, source, context)
  if (rows.length === 1 && valueField) {
    return scalarId(rows[0][valueField]) ?? rows[0][valueField]
  }

  if (
    source !== null &&
    context.sourceCollection &&
    lookup.defaultValueField
  ) {
    const defaultValue = await loadChildLookupDefaultValue(
      lookup,
      source,
      context.sourceCollection,
    )
    if (defaultValue !== undefined) return defaultValue
  }

  if (rows.length > 0 && valueField) {
    return scalarId(rows[0][valueField]) ?? rows[0][valueField]
  }

  return undefined
}

/** True when lookup-query settings are complete enough to run a list query. */
export function isChildLookupQueryReady(lookup: LayoutFieldChildLookup): boolean {
  if (!lookup.collection?.trim() || !lookup.valueField?.trim()) return false
  if (lookup.childSourceField?.trim()) return true
  const filter = lookup.filter
  return Boolean(filter && typeof filter === 'object' && Object.keys(filter).length > 0)
}

function childSourceEqualityFilter(
  lookup: LayoutFieldChildLookup,
  source: string | number | null,
): Record<string, unknown> | null {
  const childSourceField = lookup.childSourceField?.trim()
  if (!childSourceField || source === null) return null
  return { [childSourceField]: { _eq: source } }
}

function mergeFilters(
  first: Record<string, unknown> | null,
  second: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (first && second) return { _and: [first, second] }
  return first ?? second
}

async function collectionFields(collection: string): Promise<FieldDefinition[] | null> {
  try {
    return await getCachedCollectionFields(collection)
  } catch {
    return null
  }
}
