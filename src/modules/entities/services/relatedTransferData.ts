import {
  fieldDisplayTemplate,
  lookupLabelMetadata as buildLookupLabelMetadata,
  lookupOptionLabel as formatLookupOptionLabel,
} from '@/core/childLookupOptions'
import { nestedDisplayFallbackRequestFields } from '@/core/dataTableFieldPath'
import {
  resolveRelatedTransferFilter,
  resolveRelatedTransferValue,
  type RelatedTransferResolveContext,
} from '@/core/relatedTransferResolver'
import { readPath, resolveRecordKey } from '@/core/utils/object'
import type {
  FieldDefinition,
  RelationDefinition,
  RelatedTransferLookupMapping,
  RelatedTransferSettings,
} from '@/interfaces'
import { loadChildLookupFieldSettings } from '@/modules/config/services/layoutSettings'
import type {
  LookupHeaderItem,
  LookupPrefilterResult,
  LookupSelectOption,
  SourceItemsResult,
  TranslateFn,
} from '@/modules/entities/components/related-transfer/types'
import {
  createRelatedTransferItem,
  readRelatedTransferItems,
} from '@/modules/entities/services/relatedTransfer'
import {
  fetchCollectionDisplayTemplate,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  mergeFilterClauses,
  filterKnownFields,
  sanitizeFilterFields,
  splitLookupFilterForSource,
  lookupFilterFields,
  normalizeFilterFieldKeys,
  intersectLookupSourceIds,
  sourceIdFilter,
  lookupFilterTokens,
} from '@/modules/entities/utils/relatedTransferFilters'
import {
  assertLookupTokensResolved,
  filterTokenMissingMessage,
  isMissingFilterTokenValue,
  unresolvedFilterTokens,
  formatTransferValue,
  mergeParentRecord,
  normalizeParentTokenPaths,
  normalizeParentTokenPathsFromDirectRow,
  parentTokenHeaderLabel,
  defaultValueSourceFields,
  lookupSourceFields,
} from '@/modules/entities/utils/relatedTransferLookups'
import {
  collectionFields,
  keysEqual,
  isParentRelation,
  isFieldM2O,
  lookupParentCollection,
  parentHeaderDisplayFields,
  parentHeaderRecordLabel,
  primaryKeyField,
  relationCollectionForField,
  resolveCollectionKey,
  resolveFieldPath,
  resolveFlatFieldPath,
} from '@/modules/entities/utils/relatedTransferSchema'
import {
  buildChoiceLabelMap,
  extractTemplateFields,
  humanizeFieldName,
  relatedRecordFallbackLabel,
  renderTemplateLabel,
  scalarId,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'

export interface RelatedTransferDataContext {
  t: TranslateFn
  parentRecord: Record<string, unknown>
  parentId: string | number | undefined
  parentCollection?: string
  resolvedTargetParentField: string
  targetParentField?: string
  sourcePrimaryKey: string
  lookupRowsByTargetField: Map<string, Map<string, Record<string, unknown>>>
}

export function relatedTransferRequestError(
  err: unknown,
  collection: string,
  context: string,
  t: TranslateFn,
): Error {
  const message = err instanceof Error
    ? err.message
    : t('relatedTransfer.requestError', 'Request failed.')
  return new Error(
    t(
      'relatedTransfer.collectionAccessError',
      '{context} "{collection}": {message} Check that the JSON uses the exact collection key and that the role has the required permissions.',
      {
        context,
        collection,
        message,
      },
    ),
  )
}

export async function readDynamicItems(
  collection: string,
  params: Record<string, unknown>,
  contextLabel: string,
  t: TranslateFn,
): Promise<Record<string, unknown>[]> {
  try {
    return await readRelatedTransferItems(collection, params)
  } catch (err) {
    throw relatedTransferRequestError(err, collection, contextLabel, t)
  }
}

export async function createDynamicItem(
  collection: string,
  payload: Record<string, unknown>,
  contextLabel: string,
  t: TranslateFn,
): Promise<Record<string, unknown>> {
  try {
    return await createRelatedTransferItem(collection, payload)
  } catch (err) {
    throw relatedTransferRequestError(err, collection, contextLabel, t)
  }
}

export async function mergeChildLookupFieldSettings(
  baseSettings: RelatedTransferSettings,
): Promise<RelatedTransferSettings> {
  const fieldNames = baseSettings.target.columns.map((column) => column.field)
  const fieldSettings = await loadChildLookupFieldSettings(
    baseSettings.target.collection,
    fieldNames,
  )
  const entries = Object.entries(fieldSettings)
  if (entries.length === 0) return baseSettings

  const existingLookups = baseSettings.mapping?.lookups ?? {}
  const lookups: Record<string, RelatedTransferLookupMapping> = { ...existingLookups }
  const targetCollection = baseSettings.target.collection
  const [targetFields, relations] = await Promise.all([
    collectionFields(targetCollection),
    getCachedRelations() as Promise<RelationDefinition[]>,
  ])

  const sourceCollection = await resolveCollectionKey(baseSettings.source.itemCollection || '')
  const sourcePrimaryKey = baseSettings.source.itemPrimaryKey || 'id'

  for (const [targetField, childLookup] of entries) {
    const lookupCollection = childLookup.collection
      ? await resolveCollectionKey(childLookup.collection)
      : ''
    // Same collection as batch Source (e.g. Price from price_item): pin to that row by PK.
    // Different collection (e.g. Variant from item_variant): link via sourceField (Item).
    const lookupIsSourceCollection = Boolean(
      sourceCollection &&
      lookupCollection &&
      keysEqual(lookupCollection, sourceCollection),
    )
    const automaticFilter = lookupIsSourceCollection
      ? {
          [sourcePrimaryKey]: {
            _eq: `$source.${sourcePrimaryKey}`,
          },
        }
      : {
          [childLookup.childSourceField]: {
            _eq: `$source.${
              childLookup.sourceField?.trim()
              || baseSettings.target.itemField
              || sourcePrimaryKey
            }`,
          },
        }
    const isEditable = (baseSettings.target.editableFields ?? []).some((field) =>
      keysEqual(field, targetField),
    )
    lookups[targetField] = {
      ...existingLookups[targetField],
      collection: childLookup.collection,
      valueField: childLookup.valueField,
      labelField: childLookup.valueField,
      defaultValueField: childLookup.defaultValueField || undefined,
      selectable: isEditable && isFieldM2O(
        targetCollection,
        targetField,
        targetFields,
        relations ?? [],
      ),
      fields: Array.from(new Set([
        childLookup.valueField,
      ].filter((field): field is string => Boolean(field)))),
      filter: mergeFilterClauses(automaticFilter, childLookup.filter ?? null),
    }
  }

  return {
    ...baseSettings,
    mapping: {
      defaults: baseSettings.mapping?.defaults ?? {},
      copyFromSource: baseSettings.mapping?.copyFromSource ?? {},
      values: baseSettings.mapping?.values ?? {},
      lookups,
    },
  }
}

async function sourceChoiceLabelMap(
  fields: string[],
  definitions: FieldDefinition[] | null,
): Promise<Map<string, Map<string, string>>> {
  if (!definitions) return new Map()

  const definitionByField = new Map(definitions.map((field) => [field.field, field]))
  const labelsByField = new Map<string, Map<string, string>>()

  for (const field of fields) {
    const definition = definitionByField.get(field)
    const labels = await buildChoiceLabelMap(definition?.meta?.options?.choices, {
      collection: definition?.collection,
      field,
    })
    if (labels.size > 0) {
      labelsByField.set(field, labels)
    }
  }

  return labelsByField
}

async function parentTokenFinalRelationCollection(
  parentCollection: string,
  token: string,
): Promise<string | null> {
  const parts = token.replace(/^\$parent\./, '').split('.').filter(Boolean)
  let currentCollection = parentCollection
  let finalRelationCollection: string | null = null

  for (const part of parts) {
    const fields = await collectionFields(currentCollection)
    const field = fields?.find((item) => keysEqual(item.field, part))
    const relationCollection = await relationCollectionForField(
      currentCollection,
      field?.field ?? part,
      fields,
    )
    if (!relationCollection) {
      finalRelationCollection = null
      continue
    }

    currentCollection = await resolveCollectionKey(relationCollection)
    finalRelationCollection = currentCollection
  }

  return finalRelationCollection
}

async function parentTokenHeaderValue(
  token: string,
  ctx: RelatedTransferDataContext,
  context: RelatedTransferResolveContext,
): Promise<unknown> {
  const value = resolveRelatedTransferValue(token, context)
  const relatedId = scalarId(value)
  if (relatedId === null) return value

  const parentCollection = await lookupParentCollection(
    ctx.parentCollection,
    ctx.resolvedTargetParentField,
    ctx.targetParentField,
  )
  if (!parentCollection) return value

  const relatedCollection = await parentTokenFinalRelationCollection(parentCollection, token)
  if (!relatedCollection) return value

  const relatedFields = await collectionFields(relatedCollection)
  const primaryKey = primaryKeyField(relatedFields)
  const displayFields = parentHeaderDisplayFields(relatedFields, primaryKey)
  const rows = await readDynamicItems(
    relatedCollection,
    {
      limit: 1,
      fields: Array.from(new Set([primaryKey, ...displayFields])) as never,
      filter: {
        [primaryKey]: { _eq: relatedId },
      },
    },
    ctx.t('relatedTransfer.lookupParentContext', 'lookup parent relation'),
    ctx.t,
  )
  const row = rows[0]
  return row ? parentHeaderRecordLabel(row, primaryKey) : value
}

async function addLookupHeaderItems(
  headerItemsByToken: Map<string, LookupHeaderItem>,
  filter: Record<string, unknown> | null | undefined,
  ctx: RelatedTransferDataContext,
  context: RelatedTransferResolveContext,
): Promise<void> {
  for (const token of lookupFilterTokens(filter).filter((item) => item.startsWith('$parent.'))) {
    if (headerItemsByToken.has(token)) continue
    headerItemsByToken.set(token, {
      token,
      label: parentTokenHeaderLabel(token, humanizeFieldName),
      value: await parentTokenHeaderValue(token, ctx, context),
    })
  }
}

async function enrichParentRecordFromWildcard(
  parentCollection: string,
  parentRecord: Record<string, unknown>,
  ctx: RelatedTransferDataContext,
): Promise<void> {
  if (ctx.parentId === undefined || ctx.parentId === null) return

  const parentFields = await collectionFields(parentCollection)
  const primaryKey = primaryKeyField(parentFields)
  const rows = await readDynamicItems(
    parentCollection,
    {
      limit: 1,
      fields: ['*', '*.*'] as never,
      filter: {
        [primaryKey]: { _eq: ctx.parentId },
      },
    },
    ctx.t('relatedTransfer.lookupParentContext', 'lookup parent relation'),
    ctx.t,
  )
  const row = rows[0]
  if (!row) return

  mergeParentRecord(parentRecord, row)
}

async function enrichParentRecordFromDirectFields(
  parentCollection: string,
  parentRecord: Record<string, unknown>,
  nestedParentPaths: string[][],
  ctx: RelatedTransferDataContext,
): Promise<void> {
  if (ctx.parentId === undefined || ctx.parentId === null) return

  const parentFields = await collectionFields(parentCollection)
  const primaryKey = primaryKeyField(parentFields)
  const requestFields = Array.from(new Set(nestedParentPaths
    .flatMap((parts) => [
      parts.join('.'),
      resolveFieldPath(parentFields, parts.join('.')),
      resolveFlatFieldPath(parentFields, parts),
    ])
    .filter(Boolean)))

  if (requestFields.length === 0) return

  const rows = await readDynamicItems(
    parentCollection,
    {
      limit: 1,
      fields: Array.from(new Set([primaryKey, ...requestFields])) as never,
      filter: {
        [primaryKey]: { _eq: ctx.parentId },
      },
    },
    ctx.t('relatedTransfer.lookupParentContext', 'lookup parent relation'),
    ctx.t,
  )
  const row = rows[0]
  if (!row) return

  mergeParentRecord(parentRecord, row)
  normalizeParentTokenPathsFromDirectRow(parentRecord, row, parentFields, nestedParentPaths)
}

export async function enrichedParentRecordForLookup(
  filter: Record<string, unknown> | null | undefined,
  ctx: RelatedTransferDataContext,
): Promise<Record<string, unknown>> {
  const parentCollection = await lookupParentCollection(
    ctx.parentCollection,
    ctx.resolvedTargetParentField,
    ctx.targetParentField,
  )
  if (!parentCollection || !filter) return ctx.parentRecord

  const parentRecord = { ...ctx.parentRecord }
  const parentTokenPaths = lookupFilterTokens(filter)
    .filter((token) => token.startsWith('$parent.'))
    .map((token) => token.replace(/^\$parent\./, '').split('.'))
    .filter((parts) => parts.length > 0)

  // Fetch missing top-level parent fields (e.g. $parent.Facility_Price_Group)
  // — previously only nested paths were enriched, so source filters were dropped.
  // Treat null the same as missing so stale nulls from the page payload still re-fetch.
  const missingTopLevelPaths = parentTokenPaths
    .filter((parts) => parts.length === 1 && isMissingFilterTokenValue(readPath(parentRecord, parts[0]!)))
  if (missingTopLevelPaths.length > 0) {
    await enrichParentRecordFromDirectFields(
      parentCollection,
      parentRecord,
      missingTopLevelPaths,
      ctx,
    )
  }

  const nestedParentPaths = parentTokenPaths
    .filter((parts) => parts.length > 1 && isMissingFilterTokenValue(readPath(parentRecord, parts.join('.'))))

  if (nestedParentPaths.length === 0) return parentRecord

  await enrichParentRecordFromDirectFields(parentCollection, parentRecord, nestedParentPaths, ctx)
  normalizeParentTokenPaths(parentRecord, nestedParentPaths)

  const remainingNestedParentPaths = nestedParentPaths.filter(
    (parts) => isMissingFilterTokenValue(readPath(parentRecord, parts.join('.'))),
  )
  if (remainingNestedParentPaths.length === 0) return parentRecord

  await enrichParentRecordFromWildcard(parentCollection, parentRecord, ctx)
  normalizeParentTokenPaths(parentRecord, remainingNestedParentPaths)

  const wildcardRemainingNestedParentPaths = remainingNestedParentPaths.filter(
    (parts) => isMissingFilterTokenValue(readPath(parentRecord, parts.join('.'))),
  )
  if (wildcardRemainingNestedParentPaths.length === 0) return parentRecord

  const relations = await getCachedRelations() as RelationDefinition[]
  const parentFields = await collectionFields(parentCollection)
  for (const parts of wildcardRemainingNestedParentPaths) {
    const relationField = resolveRecordKey(parentRecord, parts[0]) ?? parts[0]
    const relationValue = parentRecord[relationField]
    const relatedId = scalarId(relationValue)
    if (relatedId === null) continue

    const relation = relations.find((item) =>
      isParentRelation(item, parentCollection, relationField),
    )
    const parentField = parentFields?.find((field) => keysEqual(field.field, relationField))
    const relatedCollection = relation?.related_collection ??
      relation?.meta?.one_collection ??
      parentField?.schema?.foreign_key_table ??
      relationField ??
      null
    if (!relatedCollection) continue

    const resolvedRelatedCollection = await resolveCollectionKey(relatedCollection)
    const relatedFields = await collectionFields(resolvedRelatedCollection)
    const primaryKey = primaryKeyField(relatedFields)
    const nestedPath = parts.slice(1).join('.')
    const nestedField = resolveFieldPath(relatedFields, nestedPath)
    // Request nested relation deeply (e.g. patient.group → group + group.*)
    const requestFields = Array.from(new Set([
      primaryKey,
      nestedPath,
      nestedField,
      nestedField ? `${nestedField}.id` : '',
      nestedField ? `${nestedField}.*` : '',
      '*.*',
    ].filter(Boolean)))
    const rows = await readDynamicItems(
      resolvedRelatedCollection,
      {
        limit: 1,
        fields: requestFields as never,
        filter: {
          [primaryKey]: { _eq: relatedId },
        },
      },
      ctx.t('relatedTransfer.lookupParentContext', 'lookup parent relation'),
      ctx.t,
    )
    const relatedRecord = rows[0]
    if (!relatedRecord) continue

    parentRecord[relationField] = {
      ...(relationValue && typeof relationValue === 'object'
        ? relationValue as Record<string, unknown>
        : { [primaryKey]: relatedId, id: relatedId }),
      ...relatedRecord,
    }
    normalizeParentTokenPaths(parentRecord, [parts])
  }

  return parentRecord
}

export async function lookupResolveContext(
  filter: Record<string, unknown> | null | undefined,
  sourceRecord: Record<string, unknown>,
  ctx: RelatedTransferDataContext,
): Promise<RelatedTransferResolveContext> {
  const parentRecord = await enrichedParentRecordForLookup(filter, ctx)
  return {
    parentRecord,
    parentId: ctx.parentId,
    sourceRecord,
    sourcePrimaryKey: ctx.sourcePrimaryKey,
  }
}

export async function loadLookupPrefilter(
  currentSettings: RelatedTransferSettings,
  ctx: RelatedTransferDataContext,
): Promise<LookupPrefilterResult> {
  const lookupRows = new Map<string, Map<string, Record<string, unknown>>>()
  const allowedByLookup: Array<Set<string>> = []
  const headerItemsByToken = new Map<string, LookupHeaderItem>()

  for (const [targetField, lookup] of Object.entries(currentSettings.mapping?.lookups ?? {})) {
    if (lookup.selectable) continue
    const split = splitLookupFilterForSource(lookup.filter)
    if (!split || !lookup.collection) continue

    const lookupFields = await collectionFields(lookup.collection)
    const sourceLinkField = resolveFieldPath(lookupFields, split.sourceLinkField)
    const valueField = resolveFieldPath(lookupFields, lookup.valueField)
    const context = await lookupResolveContext(split.parentFilter, {}, ctx)
    await addLookupHeaderItems(headerItemsByToken, split.parentFilter, ctx, context)
    const parentFilter = normalizeFilterFieldKeys(
      resolveRelatedTransferFilter(split.parentFilter, context),
      lookupFields,
    )
    // Missing parent filter → skip this lookup's source restriction (do not wipe Source).
    if (!parentFilter) {
      continue
    }

    const fields = Array.from(new Set([
      sourceLinkField,
      `${sourceLinkField}.id`,
      `${sourceLinkField}.name`,
      valueField,
      ...(lookup.fields ?? []).map((field) => resolveFieldPath(lookupFields, field)),
      ...lookupFilterFields(parentFilter).map((field) => resolveFieldPath(lookupFields, field)),
    ].filter(Boolean)))
    let rows: Record<string, unknown>[]
    try {
      rows = await readDynamicItems(
        lookup.collection,
        {
          limit: -1,
          fields: fields as never,
          filter: parentFilter,
        },
        ctx.t('relatedTransfer.lookupRowsContext', 'lookup collection'),
        ctx.t,
      )
    } catch {
      // Lookup failure must not clear the whole Source list.
      lookupRows.set(targetField, new Map())
      continue
    }
    const allowedIds = new Set<string>()
    const rowsBySourceId = new Map<string, Record<string, unknown>>()

    for (const row of rows) {
      const sourceId = scalarId(row[sourceLinkField])
      if (sourceId === null) continue
      const key = String(sourceId)
      const cachedRow = {
        ...row,
        [split.sourceLinkField]: row[sourceLinkField],
        [lookup.valueField]: row[valueField],
      }
      allowedIds.add(key)
      rowsBySourceId.set(key, cachedRow)
    }

    // Only restrict Source when lookup actually found linked rows.
    // An empty result used to push an empty Set and hide all price items.
    if (allowedIds.size > 0) {
      allowedByLookup.push(allowedIds)
    }
    lookupRows.set(targetField, rowsBySourceId)
  }

  return {
    allowedSourceIds: intersectLookupSourceIds(allowedByLookup),
    lookupRows,
    headerItems: Array.from(headerItemsByToken.values()),
  }
}

interface SourceM2ODisplayPlan {
  field: string
  relatedCollection: string
  template?: string
  requestFields: string[]
}

function canonicalRelatedPath(
  relatedFields: FieldDefinition[],
  path: string,
): string | null {
  const [root, ...rest] = path.split('.')
  const canonical = relatedFields.find((item) => keysEqual(item.field, root))?.field
  if (!canonical) return null
  return [canonical, ...rest].join('.')
}

async function sourceM2ODisplayPlans(
  collection: string,
  fields: string[],
  definitions: FieldDefinition[] | null,
): Promise<SourceM2ODisplayPlan[]> {
  const relations = await getCachedRelations() as RelationDefinition[]
  const plans: SourceM2ODisplayPlan[] = []

  for (const field of fields) {
    if (field.includes('.') || !isFieldM2O(collection, field, definitions, relations)) continue

    const relatedCollection = await relationCollectionForField(collection, field, definitions)
    if (!relatedCollection) continue

    const resolvedRelated = await resolveCollectionKey(relatedCollection)
    const relatedFields = await collectionFields(resolvedRelated)
    if (!relatedFields?.length) continue

    const definition = definitions?.find((item) => keysEqual(item.field, field))
    const template = fieldDisplayTemplate(definition) ??
      await fetchCollectionDisplayTemplate(resolvedRelated)
    const requestFields = new Set<string>([`${field}.id`])

    if (template && shouldUseTemplateForRelatedLabel(template)) {
      for (const templateField of extractTemplateFields(template)) {
        const canonical = canonicalRelatedPath(relatedFields, templateField)
        if (canonical) requestFields.add(`${field}.${canonical}`)
      }
    }

    for (const fallback of nestedDisplayFallbackRequestFields(field, relatedFields)) {
      const nested = fallback.slice(field.length + 1)
      if (canonicalRelatedPath(relatedFields, nested)) requestFields.add(fallback)
    }

    plans.push({
      field,
      relatedCollection: resolvedRelated,
      template,
      requestFields: Array.from(requestFields),
    })
  }

  return plans
}

function sourceItemRequestFields(
  fields: string[],
  plans: SourceM2ODisplayPlan[],
): string[] {
  const expanded = new Set(plans.map((plan) => plan.field))
  const requested = new Set(fields.filter((field) => !expanded.has(field)))
  for (const plan of plans) {
    for (const field of plan.requestFields) requested.add(field)
  }
  return Array.from(requested)
}

function relatedSourceLabel(
  record: Record<string, unknown>,
  template: string | undefined,
  id: string | number,
): string {
  const templateFields = template ? extractTemplateFields(template) : []
  if (template && shouldUseTemplateForRelatedLabel(template, templateFields)) {
    return renderTemplateLabel(template, record)
  }
  return relatedRecordFallbackLabel(record, id)
}

function sourceRowDisplayLabel(
  item: Record<string, unknown>,
  id: string | number,
  template: string | undefined,
  labelFields: string[],
  plans: SourceM2ODisplayPlan[],
): string {
  if (template && shouldUseTemplateForRelatedLabel(template)) {
    const rendered = renderTemplateLabel(template, item).trim()
    if (rendered && rendered !== String(id) && !rendered.includes('[object Object]')) {
      return rendered
    }
  }

  for (const field of labelFields) {
    const key = resolveRecordKey(item, field)
    if (!key) continue
    const value = item[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      const relatedId = scalarId(record.id)
      if (relatedId === null) continue
      const plan = plans.find((entry) =>
        keysEqual(entry.field, key) || keysEqual(entry.field, field),
      )
      const label = relatedSourceLabel(record, plan?.template, relatedId)
      if (label && label !== String(relatedId)) return label
    } else if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      typeof value !== 'object' &&
      String(value) !== String(id)
    ) {
      return String(value)
    }
  }

  return relatedRecordFallbackLabel(item, id)
}

function applySourceM2ODisplayLabels(
  items: Record<string, unknown>[],
  plans: SourceM2ODisplayPlan[],
  labelsByField: Map<string, Map<string, string>>,
  options: {
    primaryKey: string
    template?: string
    labelFields: string[]
  },
): Map<string, string> {
  const recordLabels = new Map<string, string>()

  for (const item of items) {
    const id = scalarId(item[options.primaryKey])
    if (id === null || id === 0 || id === '0') continue
    const label = sourceRowDisplayLabel(item, id, options.template, options.labelFields, plans)
    if (label) recordLabels.set(String(id), label)
  }

  for (const plan of plans) {
    const labels = labelsByField.get(plan.field) ?? new Map<string, string>()

    for (const item of items) {
      const value = item[plan.field]
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue

      const record = value as Record<string, unknown>
      const id = scalarId(record.id)
      if (id === null || id === 0 || id === '0') {
        item[plan.field] = null
        continue
      }

      const label = relatedSourceLabel(record, plan.template, id)
      if (label) labels.set(String(id), label)
      item[plan.field] = id
    }

    if (labels.size > 0) labelsByField.set(plan.field, labels)
  }

  return recordLabels
}

function applyTargetM2ODisplayValues(
  items: Record<string, unknown>[],
  plans: SourceM2ODisplayPlan[],
): void {
  for (const plan of plans) {
    for (const item of items) {
      const value = item[plan.field]
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      if ((value as Record<string, unknown>).__crmValueType === 'm2o') continue

      const record = value as Record<string, unknown>
      const id = scalarId(record.id)
      if (id === null || id === 0 || id === '0') {
        item[plan.field] = null
        continue
      }

      item[plan.field] = {
        __crmValueType: 'm2o',
        id,
        label: relatedSourceLabel(record, plan.template, id),
      }
    }
  }
}

export async function loadSourceItems(
  currentSettings: RelatedTransferSettings,
  ctx: RelatedTransferDataContext,
): Promise<SourceItemsResult> {
  const sourceSettings = currentSettings.source
  const sourceDefinitions = await collectionFields(sourceSettings.itemCollection)
  const availableFields = sourceDefinitions
    ? new Set(sourceDefinitions.map((field) => field.field))
    : null
  const fields = filterKnownFields(Array.from(new Set([
    sourceSettings.itemPrimaryKey || 'id',
    sourceSettings.itemGroupField,
    ...(sourceSettings.itemLabelFields ?? []),
    ...(sourceSettings.fields ?? []),
    ...Object.values(currentSettings.mapping?.copyFromSource ?? {}),
    ...lookupSourceFields(currentSettings.mapping?.lookups ?? {}),
    ...defaultValueSourceFields(currentSettings),
  ].filter(Boolean) as string[])), availableFields)

  // Resolve source.filter the same way as lookup filters: enrich parent tokens,
  // normalize field keys, then sanitize against known source fields.
  const sourceFilterContext = await lookupResolveContext(sourceSettings.filter, {}, ctx)
  const sourceFilterHeaderItems = new Map<string, LookupHeaderItem>()
  await addLookupHeaderItems(
    sourceFilterHeaderItems,
    sourceSettings.filter,
    ctx,
    sourceFilterContext,
  )
  const unresolvedTokens = unresolvedFilterTokens(sourceSettings.filter, sourceFilterContext)
  if (unresolvedTokens.length > 0) {
    // Do not query GraphQL with `_eq: null`, and do not fail the whole dialog.
    return {
      items: [],
      choiceLabels: new Map(),
      sourceRecordLabels: new Map(),
      sourceRelationCollections: new Map(),
      lookupRows: new Map(),
      lookupHeaderItems: Array.from(sourceFilterHeaderItems.values()),
      warning: filterTokenMissingMessage(
        ctx.t('relatedTransfer.sourceFilterContext', 'Source filter'),
        unresolvedTokens,
        sourceFilterContext,
        ctx.t,
      ),
    }
  }
  const filter = sanitizeFilterFields(
    normalizeFilterFieldKeys(
      resolveRelatedTransferFilter(sourceSettings.filter, sourceFilterContext),
      sourceDefinitions,
    ),
    availableFields,
  )
  const sourceTemplate = await fetchCollectionDisplayTemplate(sourceSettings.itemCollection)
  const templateFields = sourceTemplate && shouldUseTemplateForRelatedLabel(sourceTemplate)
    ? extractTemplateFields(sourceTemplate)
    : []
  const planFields = Array.from(new Set([
    ...fields,
    ...templateFields.map((field) => field.split('.')[0]).filter(Boolean),
  ]))
  const [choiceLabels, m2oPlans] = await Promise.all([
    sourceChoiceLabelMap(fields, sourceDefinitions),
    sourceM2ODisplayPlans(sourceSettings.itemCollection, planFields, sourceDefinitions),
  ])
  for (const templateField of templateFields) {
    const root = templateField.split('.')[0] ?? templateField
    const plan = m2oPlans.find((entry) => keysEqual(entry.field, root))
    if (!plan || !templateField.includes('.')) continue
    const nested = `${plan.field}.${templateField.slice(root.length + 1)}`
    if (!plan.requestFields.includes(nested)) plan.requestFields.push(nested)
  }
  const lookupPrefilter = await loadLookupPrefilter(currentSettings, ctx)
  for (const item of lookupPrefilter.headerItems) {
    if (!sourceFilterHeaderItems.has(item.token)) {
      sourceFilterHeaderItems.set(item.token, item)
    }
  }
  const lookupHeaderItems = Array.from(sourceFilterHeaderItems.values())

  // Restrict by lookup source ids only when the lookup returned matches.
  // Empty lookup matches must not wipe Source (Source filter still applies).
  const lookupSourceIds = lookupPrefilter.allowedSourceIds
  const lookupIdFilter = lookupSourceIds && lookupSourceIds.size > 0
    ? sourceIdFilter(ctx.sourcePrimaryKey, lookupSourceIds)
    : null
  const sourceFilter = mergeFilterClauses(filter, lookupIdFilter)

  const requestFields = sourceItemRequestFields(fields, m2oPlans)
  for (const templateField of templateFields) {
    const root = templateField.split('.')[0] ?? templateField
    if (m2oPlans.some((entry) => keysEqual(entry.field, root))) continue
    if (sourceDefinitions?.some((definition) => keysEqual(definition.field, root))) {
      requestFields.push(templateField)
    }
  }

  const items = await readDynamicItems(
    sourceSettings.itemCollection,
    {
      limit: -1,
      fields: requestFields as never,
      ...(sourceFilter ? { filter: sourceFilter } : {}),
    },
    ctx.t('relatedTransfer.sourceItemsContext', 'source item collection'),
    ctx.t,
  )
  const sourceRecordLabels = applySourceM2ODisplayLabels(items, m2oPlans, choiceLabels, {
    primaryKey: sourceSettings.itemPrimaryKey || 'id',
    template: sourceTemplate,
    labelFields: sourceSettings.itemLabelFields ?? [],
  })

  return {
    items,
    choiceLabels,
    sourceRecordLabels,
    sourceRelationCollections: new Map(
      m2oPlans.map((plan) => [plan.field, plan.relatedCollection]),
    ),
    lookupRows: lookupPrefilter.lookupRows,
    lookupHeaderItems,
  }
}

export async function loadSourceGroups(
  currentSettings: RelatedTransferSettings,
  t: TranslateFn,
): Promise<Record<string, unknown>[]> {
  const sourceSettings = currentSettings.source
  if (
    sourceSettings.mode !== 'tree' ||
    !sourceSettings.groupCollection ||
    !sourceSettings.itemGroupField
  ) {
    return []
  }

  const fields = Array.from(new Set([
    sourceSettings.groupPrimaryKey || 'id',
    sourceSettings.groupParentField,
    sourceSettings.groupLabelField || 'name',
  ].filter(Boolean) as string[]))

  return await readDynamicItems(
    sourceSettings.groupCollection,
    {
      limit: -1,
      fields: fields as never,
    },
    t('relatedTransfer.sourceGroupsContext', 'source group collection'),
    t,
  )
}

export async function loadTargetRows(
  currentSettings: RelatedTransferSettings,
  parentField: string,
  parentId: string | number | undefined,
  t: TranslateFn,
): Promise<Record<string, unknown>[]> {
  const targetSettings = currentSettings.target
  if (parentId === undefined || parentId === null) return []
  if (!parentField) return []

  const columnFields = targetSettings.columns.map((column) => column.field).filter(Boolean)
  const fields = Array.from(new Set([
    'id',
    parentField,
    targetSettings.itemField,
    targetSettings.duplicateKey,
    ...columnFields,
  ].filter(Boolean) as string[]))
  const targetDefinitions = await collectionFields(targetSettings.collection)
  const m2oPlans = await sourceM2ODisplayPlans(
    targetSettings.collection,
    columnFields,
    targetDefinitions,
  )

  const rows = await readDynamicItems(
    targetSettings.collection,
    {
      limit: -1,
      fields: sourceItemRequestFields(fields, m2oPlans) as never,
      filter: {
        [parentField]: { _eq: parentId },
      },
    },
    t('relatedTransfer.targetRowsContext', 'target collection'),
    t,
  )
  applyTargetM2ODisplayValues(rows, m2oPlans)
  return rows
}

export async function resolveLookupValue(
  targetField: string,
  lookup: RelatedTransferLookupMapping,
  sourceRecord: Record<string, unknown>,
  ctx: RelatedTransferDataContext,
  sourceCollection?: string,
): Promise<unknown> {
  const sourceId = scalarId(sourceRecord[ctx.sourcePrimaryKey])
  const cachedLookupRow = sourceId !== null
    ? ctx.lookupRowsByTargetField.get(targetField)?.get(String(sourceId)) ?? null
    : null
  if (cachedLookupRow && lookup.valueField) {
    return cachedLookupRow[lookup.valueField]
  }

  // Batch Source row is already the lookup record (typical for Price on price_item).
  if (
    lookup.collection &&
    sourceCollection &&
    keysEqual(lookup.collection, sourceCollection) &&
    lookup.valueField
  ) {
    const direct = sourceRecord[lookup.valueField]
      ?? Object.entries(sourceRecord).find(([key]) => keysEqual(key, lookup.valueField))?.[1]
    if (direct !== undefined) return scalarId(direct) ?? direct
  }

  const fields = Array.from(new Set([
    lookup.valueField,
    ...(lookup.fields ?? []),
  ].filter(Boolean)))
  const context = await lookupResolveContext(lookup.filter, sourceRecord, ctx)
  const filter = resolveRelatedTransferFilter(lookup.filter, context)
  assertLookupTokensResolved(targetField, lookup.filter, context, ctx.t)

  if (!lookup.collection || !lookup.valueField || !filter) {
    return undefined
  }

  let rows: Record<string, unknown>[]
  try {
    rows = await readDynamicItems(
      lookup.collection,
      {
        limit: 5,
        fields: fields as never,
        filter,
      },
      ctx.t('relatedTransfer.lookupRowsContext', 'lookup collection'),
      ctx.t,
    )
  } catch {
    return undefined
  }

  if (rows.length === 0) {
    return undefined
  }
  if (rows.length > 1) {
    // Prefer the row that is the batch source item when PKs align.
    const matched = sourceId === null
      ? null
      : rows.find((row) => String(scalarId(row.id) ?? scalarId(row[ctx.sourcePrimaryKey])) === String(sourceId))
    if (matched) {
      return matched[lookup.valueField]
    }
    throw new Error(
      ctx.t(
        'relatedTransfer.lookupMultipleMatches',
        'Multiple lookup records found for "{field}". Refine the lookup filter.',
        { field: targetField },
      ),
    )
  }

  return rows[0][lookup.valueField]
}

export async function resolveLookupPayload(
  currentSettings: RelatedTransferSettings,
  sourceRecord: Record<string, unknown>,
  ctx: RelatedTransferDataContext,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {}
  const sourceCollection = currentSettings.source.itemCollection

  for (const [targetField, lookup] of Object.entries(currentSettings.mapping?.lookups ?? {})) {
    if (lookup.selectable) continue
    const value = await resolveLookupValue(
      targetField,
      lookup,
      sourceRecord,
      ctx,
      sourceCollection,
    )
    if (value !== undefined) {
      payload[targetField] = value
    }
  }

  return payload
}

export async function loadSelectableLookupOptions(
  currentSettings: RelatedTransferSettings,
  sourceRecord: Record<string, unknown>,
  ctx: RelatedTransferDataContext,
): Promise<Record<string, LookupSelectOption[]>> {
  const optionsByField: Record<string, LookupSelectOption[]> = {}

  for (const [targetField, lookup] of Object.entries(currentSettings.mapping?.lookups ?? {})) {
    if (!lookup.selectable || !lookup.collection || !lookup.valueField) continue

    const lookupFields = await collectionFields(lookup.collection)
    const valueField = resolveFieldPath(lookupFields, lookup.valueField)
    const labelMetadata = await buildLookupLabelMetadata(
      lookup.collection,
      lookupFields,
      valueField,
      collectionFields,
      relationCollectionForField,
    )
    const context = await lookupResolveContext(lookup.filter, sourceRecord, ctx)
    const filter = normalizeFilterFieldKeys(
      resolveRelatedTransferFilter(lookup.filter, context),
      lookupFields,
    )
    assertLookupTokensResolved(targetField, lookup.filter, context, ctx.t)
    if (!filter) {
      optionsByField[targetField] = []
      continue
    }

    const rows = await readDynamicItems(
      lookup.collection,
      {
        limit: -1,
        fields: Array.from(new Set([
          valueField,
          ...labelMetadata.requestFields,
          ...(lookup.fields ?? []).map((field) => resolveFieldPath(lookupFields, field)),
        ].filter(Boolean))) as never,
        filter,
      },
      ctx.t('relatedTransfer.lookupRowsContext', 'lookup collection'),
      ctx.t,
    )

    const options: LookupSelectOption[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const value = scalarId(row[valueField]) ?? row[valueField]
      if (value === undefined || value === null || value === '') continue
      const key = String(value)
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        value,
        label: formatLookupOptionLabel(row, labelMetadata, value, formatTransferValue),
      })
    }
    optionsByField[targetField] = options
  }

  return optionsByField
}
