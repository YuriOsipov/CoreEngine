import {
  bridgeReadItemsPage,
} from '@/core/graphql/itemsBridge'
import {
  applyCalculatedFields,
  collectFormulaRequestPaths,
  resolveCollectionFormulas,
} from '@/core/calculatedFields'
import {
  applyNestedColumnValues,
  collectNestedPathRelatedCollections,
  isNestedFieldPath,
  nestedDisplayFallbackRequestFields,
  resolveColumnFieldPath,
  type ResolvedDataTableFieldPath,
} from '@/core/dataTableFieldPath'
import {
  defaultDateDisplayFormat,
  defaultDateTimeDisplayFormat,
  effectiveDateDisplayFormat,
  formatDateValue,
} from '@/core/dateFormatting'
import { SYSTEM_AUDIT_USER_DISPLAY_FIELDS } from '@/core/layoutFieldRules'
import { isUsersAssetCollection } from '@/core/usersField'
import type {
  DataTableColumnConfig,
  DataTableSettings,
  DataTableSortConfig,
  CollectionDefinition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { keysEqual } from '@/core/relationHelpers'
import { translateCollection, translateField } from '@/core/translation'
import { resolveRecordKey } from '@/core/utils/object'
import { findRelationForField, normalizeSpecial } from '../utils/fieldMapper'
import {
  buildChoiceLabelMap,
  choiceValueLabel,
  extractTemplateFields,
  humanizeFieldName,
  relatedRecordLabel,
  resolveNumberDisplayOptions,
} from '../utils/recordDisplay'
import {
  dataTableSortQuery,
  resolveNameLinkSortFields,
  usesPrimaryKeyRecordLink,
} from './tableSettings'
import {
  fetchCollectionDisplayTemplate,
  getCachedCollectionFields,
  getCachedCollections,
  getCachedFields,
  getCachedRelations,
} from './collectionSchema'

const ARCHIVED_STATUS_VALUES = ['archived', 'Archived']

export interface DataTableRuntimeColumn extends DataTableColumnConfig {
  valueCollection?: string
}

export interface DataTableRuntime {
  collection: string
  columns: DataTableRuntimeColumn[]
  rows: Record<string, unknown>[]
  totalCount: number
  primaryKey: string
  label?: string
  parentId?: string | number
  parentName?: string
  sort?: DataTableSettings['sort']
}

export interface FetchDataTableOptions {
  collection: string
  settings?: DataTableSettings | null
  limit?: number
  offset?: number
  listFilter?: Record<string, unknown> | null
  /** Server-side list search (ANDed with listFilter by the BFF). */
  search?: string | null
  parentCollection?: string
  parentId?: string | number
  recordIds?: string[]
  totalCountOverride?: number
  includeArchivedStatus?: boolean
  /** When true, list only archived rows (skips the active-status exclude filter). */
  archivedOnly?: boolean
  defaultExcludedField?: string
  defaultColumnLimit?: number
  previewLimitWithoutParent?: number
  excludeHiddenFields?: boolean
  swallowFetchErrors?: boolean
}

export interface ResolveDataTableColumnsOptions {
  defaultExcludedField?: string
  defaultLimit?: number
  excludeHiddenFields?: boolean
  headerSource?: 'note' | 'humanize'
  dateFormatDefault?: string
}

interface M2OMetadata {
  templates: Map<string, string>
  collections: Map<string, string>
}

interface PreparedDataTableContext {
  collection: string
  fields: FieldDefinition[]
  relations: RelationDefinition[]
  fieldByName: Map<string, FieldDefinition>
  primaryKey: string
  parentRelation?: RelationDefinition
  columns: DataTableRuntimeColumn[]
  resolvedPaths: ResolvedDataTableFieldPath[]
  m2oMetadata: M2OMetadata
  choiceLabels: Map<string, Map<string, string>>
  requestFields: string[]
  dateFormats: Map<string, string>
  formulas: Record<string, string>
  allFields?: FieldDefinition[]
}

/** Expand auto Name sorts onto Display Template fields when present. */
async function resolveDataTableSortConfig(
  collection: string,
  sort: DataTableSortConfig | null,
  recordLinkField: string | null | undefined,
  primaryKey: string,
): Promise<DataTableSortConfig | null> {
  if (!sort?.field?.trim()) return sort
  if (!usesPrimaryKeyRecordLink(recordLinkField, primaryKey)) return sort
  if (sort.field.trim() !== 'name') return sort

  const template = await fetchCollectionDisplayTemplate(collection)
  const fields = resolveNameLinkSortFields('name', template)
  if (fields.length === 0 || (fields.length === 1 && fields[0] === 'name')) {
    return sort
  }
  return { ...sort, field: fields.join(',') }
}

export async function fetchDataTableRuntime(
  options: FetchDataTableOptions,
): Promise<DataTableRuntime> {
  const context = await prepareDataTableContext(options)
  const {
    collection,
    fields,
    primaryKey,
    fieldByName,
    requestFields,
    dateFormats,
    m2oMetadata,
    choiceLabels,
    resolvedPaths,
    formulas,
  } = context

  const filterQuery = buildFetchFilterQuery(options, fields, context.relations, context.parentRelation)
  const sortConfig = await resolveDataTableSortConfig(
    options.collection,
    options.settings?.sort ?? null,
    options.settings?.recordLinkField,
    primaryKey,
  )
  const sortParams = dataTableSortQuery(
    options.settings?.groupBy,
    sortConfig,
    fieldByName,
  )
  const hasDbSort = Object.keys(sortParams).length > 0

  if (options.recordIds && options.recordIds.length === 0) {
    return buildRuntimeResult(options, context, [], options.totalCountOverride ?? 0)
  }

  const limit = resolveFetchLimit(options)
  const offset = options.offset ?? 0

  try {
    const readQuery: Record<string, unknown> = {
      limit,
      offset,
      fields: requestFields as never,
      ...filterQuery,
      ...sortParams,
    }

    if (options.recordIds?.length) {
      readQuery.filter = {
        [primaryKey]: { _in: options.recordIds },
      }
      readQuery.limit = options.recordIds.length
      delete readQuery.offset
    }

    const filter =
      (readQuery.filter as Record<string, unknown> | undefined) ?? null
    const sort = Array.isArray(readQuery.sort)
      ? (readQuery.sort as string[])
      : null
    const selectFields = Array.isArray(readQuery.fields)
      ? (readQuery.fields as string[])
      : requestFields

    const search = options.search?.trim() || null
    const page = await bridgeReadItemsPage(
      collection,
      {
        filter,
        fields: selectFields,
        sort: sort ?? undefined,
        search,
        limit: Number(readQuery.limit ?? limit),
        offset:
          readQuery.offset === undefined ? undefined : Number(readQuery.offset),
        includeDeleted:
          Boolean(options.includeArchivedStatus) || Boolean(options.archivedOnly),
      },
      { includeTotalCount: !options.recordIds?.length },
    )

    // Evaluate formulas on raw rows (nested M2O objects intact) before display
    // wrapping turns relations into { id, label } cells.
    const hasFormulas = Object.keys(formulas).length > 0
    let rows = page.nodes.map((row) => {
      const withFormulas = hasFormulas
        ? applyCalculatedFields(row, formulas)
        : row
      return renderDataTableRowValues(
        withFormulas,
        m2oMetadata.templates,
        m2oMetadata.collections,
        choiceLabels,
        dateFormats,
        resolvedPaths,
      )
    })

    if (options.recordIds?.length && !hasDbSort) {
      const order = new Map(options.recordIds.map((id, index) => [String(id), index]))
      rows = rows.sort(
        (left, right) =>
          (order.get(String(left[primaryKey])) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(String(right[primaryKey])) ?? Number.MAX_SAFE_INTEGER),
      )
    }

    const totalCount = options.recordIds?.length
      ? (options.totalCountOverride ?? rows.length)
      : page.totalCount

    return buildRuntimeResult(options, context, rows, totalCount)
  } catch {
    if (!options.swallowFetchErrors) {
      throw new Error(`Failed to load records for collection "${collection}".`)
    }
    return buildRuntimeResult(options, context, [], 0)
  }
}

export async function loadRelatedFieldsForPaths(
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  paths: string[],
): Promise<Record<string, FieldDefinition[]>> {
  const rootCollections = collectNestedPathRelatedCollections(paths, fields, relations)
  const relatedFieldsByCollection: Record<string, FieldDefinition[]> = {}

  await Promise.all(
    Array.from(rootCollections).map(async (relatedCollection) => {
      const relatedFieldsRaw = await getCachedCollectionFields(relatedCollection)
      relatedFieldsByCollection[relatedCollection] =
        relatedFieldsRaw as unknown as FieldDefinition[]
    }),
  )

  const nestedTargetCollections = collectNestedPathRelatedCollections(
    paths,
    fields,
    relations,
    relatedFieldsByCollection,
  )
  const missingCollections = Array.from(nestedTargetCollections).filter(
    (collection) => !relatedFieldsByCollection[collection],
  )

  await Promise.all(
    missingCollections.map(async (relatedCollection) => {
      const relatedFieldsRaw = await getCachedCollectionFields(relatedCollection)
      relatedFieldsByCollection[relatedCollection] =
        relatedFieldsRaw as unknown as FieldDefinition[]
    }),
  )

  return relatedFieldsByCollection
}

export function resolveColumnPaths(
  collection: string,
  paths: string[],
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  relatedFieldsByCollection: Record<string, FieldDefinition[]>,
): ResolvedDataTableFieldPath[] {
  return paths
    .map((path) =>
      resolveColumnFieldPath(
        collection,
        path,
        fields,
        relations,
        relatedFieldsByCollection,
      ),
    )
    .filter((resolved): resolved is ResolvedDataTableFieldPath => Boolean(resolved))
}

export function getM2OMetadata(
  collection: string,
  columnKeys: string[],
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): M2OMetadata {
  const templates = new Map<string, string>()
  const collections = new Map<string, string>()

  for (const fieldName of columnKeys) {
    if (isNestedFieldPath(fieldName)) continue

    const field = fields.find((entry) => keysEqual(entry.field, fieldName))
    if (!field) continue
    const relation = findRelationForField(field, relations)
    const template = field.meta?.options?.template
    const special = normalizeSpecial(field.meta?.special)
    const isM2O = special.includes('m2o') || Boolean(relation?.related_collection)
    const relatedCollection = relation?.related_collection?.trim()

    if (isM2O && relatedCollection) {
      // Canonical field key so row[field] matches API payloads.
      collections.set(field.field, relatedCollection)
      if (fieldName !== field.field) collections.set(fieldName, relatedCollection)
      if (typeof template === 'string' && template.trim()) {
        templates.set(field.field, template)
        if (fieldName !== field.field) templates.set(fieldName, template)
      }
    }
  }

  return { templates, collections }
}

async function applyRelatedCollectionDisplayTemplates(
  m2oMetadata: M2OMetadata,
  columns: DataTableRuntimeColumn[],
): Promise<void> {
  const relatedCollections = [...new Set(m2oMetadata.collections.values())]
  const templatesByCollection = new Map<string, string>()
  await Promise.all(
    relatedCollections.map(async (collection) => {
      const template = await fetchCollectionDisplayTemplate(collection)
      if (template) templatesByCollection.set(collection, template)
    }),
  )

  for (const [field, relatedCollection] of m2oMetadata.collections) {
    const template = templatesByCollection.get(relatedCollection)
    if (template) m2oMetadata.templates.set(field, template)
  }

  for (const column of columns) {
    if (!column.relatedCollection) continue
    const template =
      templatesByCollection.get(column.relatedCollection) ??
      m2oMetadata.templates.get(column.field)
    if (template) column.template = template
  }
}

export async function getChoiceLabels(
  resolvedPaths: ResolvedDataTableFieldPath[],
): Promise<Map<string, Map<string, string>>> {
  const choiceLabels = new Map<string, Map<string, string>>()

  for (const resolved of resolvedPaths) {
    const definition = resolved.nestedDefinition ?? resolved.rootDefinition
    const fieldName = resolved.nestedField ?? resolved.rootField
    const labels = await buildChoiceLabelMap(definition?.meta?.options?.choices, {
      collection: resolved.valueCollection,
      field: fieldName,
    })
    if (labels.size > 0) {
      choiceLabels.set(resolved.path, labels)
    }
  }

  return choiceLabels
}

export function mergeListQueryFilters(
  ...filters: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const activeFilters = filters.filter(
    (filter): filter is Record<string, unknown> =>
      Boolean(filter && Object.keys(filter).length > 0),
  )

  if (activeFilters.length === 0) return {}
  if (activeFilters.length === 1) return { filter: activeFilters[0] }

  return {
    filter: {
      _and: activeFilters,
    },
  }
}

export function renderDataTableRowValues(
  row: Record<string, unknown>,
  m2oTemplates: Map<string, string>,
  m2oCollections: Map<string, string>,
  choiceLabels: Map<string, Map<string, string>>,
  dateFormats: Map<string, string> = new Map(),
  resolvedPaths: ResolvedDataTableFieldPath[] = [],
): Record<string, unknown> {
  const rendered = { ...row }

  for (const [field, format] of dateFormats) {
    const value = rendered[field]
    if (value !== null && value !== undefined) {
      rendered[field] = formatDateValue(value, format)
    }
  }

  applyNestedColumnValues(rendered, row, resolvedPaths, choiceLabels)

  for (const [field, relatedCollection] of m2oCollections) {
    const rowKey = resolveRecordKey(row, field) ?? field
    const value = row[rowKey]
    const record = value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null
    const template = m2oTemplates.get(field) ?? m2oTemplates.get(rowKey)
    const id = record?.id ?? value
    const label = relatedRecordLabel(record, id, template)
    const cell = {
      __crmValueType: 'm2o' as const,
      id,
      label,
      relatedCollection,
    }
    rendered[field] = cell
    if (rowKey !== field) rendered[rowKey] = cell
  }

  for (const [path, labels] of choiceLabels) {
    if (isNestedFieldPath(path)) continue

    const value = rendered[path]
    const label = choiceValueLabel(value, labels)
    if (label !== undefined) {
      rendered[path] = label
    }
  }

  return rendered
}

export async function translatedFieldLabel(
  definition: FieldDefinition,
  fallbackLabel: string,
): Promise<string> {
  return translateField(definition, fallbackLabel)
}

async function prepareDataTableContext(
  options: FetchDataTableOptions,
): Promise<PreparedDataTableContext> {
  const [fieldsRaw, relationsRaw, allFieldsRaw] = await Promise.all([
    getCachedCollectionFields(options.collection),
    getCachedRelations(),
    options.parentCollection ? getCachedFields() : Promise.resolve(null),
  ])

  const fields = fieldsRaw as unknown as FieldDefinition[]
  const relations = relationsRaw as unknown as RelationDefinition[]
  const allFields = allFieldsRaw as FieldDefinition[] | null
  const fieldByName = new Map(fields.map((field) => [field.field, field]))
  const primaryKey = getPrimaryKeyField(fields)

  const parentRelation = resolveParentRelation(
    options.collection,
    relations,
    options.parentCollection,
    options.parentId,
  )

  const columns = await resolveDataTableColumns(
    options.collection,
    fields,
    relations,
    options.settings,
    {
      defaultExcludedField: options.defaultExcludedField ?? parentRelation?.field,
      defaultLimit: options.defaultColumnLimit,
      excludeHiddenFields: options.excludeHiddenFields ?? !options.parentCollection,
      headerSource: options.parentCollection ? 'humanize' : 'note',
      dateFormatDefault: options.parentCollection ? 'short' : undefined,
    },
  )

  const columnKeys = columns.map((column) => column.field)
  const relatedFieldsByCollection = await loadRelatedFieldsForPaths(
    fields,
    relations,
    columnKeys,
  )
  const resolvedPaths = resolveColumnPaths(
    options.collection,
    columnKeys,
    fields,
    relations,
    relatedFieldsByCollection,
  )
  const m2oMetadata = getM2OMetadata(options.collection, columnKeys, fields, relations)
  await applyRelatedCollectionDisplayTemplates(m2oMetadata, columns)
  const choiceLabels = await getChoiceLabels(resolvedPaths)
  const extraFields = ['id', ...(parentRelation ? [parentRelation.field] : [])]
  if (hasDeletedField(fields)) {
    extraFields.push('is_deleted')
  }
  if (hasActiveField(fields)) {
    extraFields.push('is_active')
  }
  if (hasStatusField(fields)) {
    extraFields.push('status')
  }

  if (usesPrimaryKeyRecordLink(options.settings?.recordLinkField, primaryKey)) {
    if (fieldByName.has('name')) {
      extraFields.push('name')
    }
    const collectionTemplate = await fetchCollectionDisplayTemplate(options.collection)
    if (collectionTemplate) {
      extraFields.push(...extractTemplateFields(collectionTemplate))
    }
  }

  const formulas = resolveCollectionFormulas(fields)
  const requestFields = buildDataTableRequestFields(
    resolvedPaths,
    m2oMetadata,
    relatedFieldsByCollection,
    {
      extraFields: [...extraFields, ...collectFormulaRequestPaths(formulas)],
      allFields: allFields ?? undefined,
      mutateTemplates: Boolean(options.parentCollection),
    },
  )

  if (!requestFields.includes(primaryKey)) {
    requestFields.push(primaryKey)
  }

  const dateFormats = new Map<string, string>(
    columns
      .filter((column) => column.format)
      .map((column) => [column.field, column.format as string]),
  )

  return {
    collection: options.collection,
    fields,
    relations,
    fieldByName,
    primaryKey,
    parentRelation,
    columns,
    resolvedPaths,
    m2oMetadata,
    choiceLabels,
    requestFields,
    dateFormats,
    formulas,
    allFields: allFields ?? undefined,
  }
}

export async function resolveDataTableColumns(
  collection: string,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  settings?: DataTableSettings | null,
  options: ResolveDataTableColumnsOptions = {},
): Promise<DataTableRuntimeColumn[]> {
  const {
    defaultExcludedField,
    defaultLimit = 12,
    excludeHiddenFields = true,
    headerSource = 'note',
    dateFormatDefault,
  } = options

  const configured = settings?.columns?.filter((column) => column.enabled !== false) ?? []
  const sourceColumns: DataTableColumnConfig[] =
    configured.length > 0
      ? configured
      : fields
          .filter((field) => {
            if (excludeHiddenFields && field.meta?.hidden) return false
            // Skip relation aliases; keep live rollup aliases (computed / currency display).
            if (field.type === 'alias') {
              const opts = field.meta?.options
              const mode =
                opts && typeof opts === 'object'
                  ? String(
                      (opts as Record<string, unknown>).computeMode ??
                        (opts as Record<string, unknown>).compute_mode ??
                        '',
                    )
                      .trim()
                      .toLowerCase()
                  : ''
              const iface = String(field.meta?.interface ?? '').toLowerCase()
              const isLiveRollup =
                mode === 'rollup' ||
                (opts &&
                  typeof opts === 'object' &&
                  Boolean(
                    (opts as Record<string, unknown>).rollup &&
                      typeof (opts as Record<string, unknown>).rollup ===
                        'object',
                  )) ||
                iface.includes('calculated') ||
                iface.includes('formula') ||
                iface.includes('computed') ||
                iface.includes('currency')
              if (!isLiveRollup) return false
            }
            if (['user_updated', 'date_updated'].includes(field.field)) return false
            if (defaultExcludedField === field.field) return false
            return true
          })
          .slice(0, defaultLimit)
          .map((field) => ({
            field: field.field,
            header:
              headerSource === 'note'
                ? field.meta?.note?.trim() || humanizeFieldName(field.field)
                : humanizeFieldName(field.field),
          } satisfies DataTableColumnConfig))

  const relatedFieldsByCollection = await loadRelatedFieldsForPaths(
    fields,
    relations,
    sourceColumns.map((column) => column.field),
  )

  const columns: DataTableRuntimeColumn[] = []
  for (const column of sourceColumns) {
    const resolved = resolveColumnFieldPath(
      collection,
      column.field,
      fields,
      relations,
      relatedFieldsByCollection,
    )
    if (!resolved) continue

    const labelDefinition = resolved.nestedDefinition ?? resolved.rootDefinition
    const isDateType = ['date', 'dateTime', 'timestamp'].includes(labelDefinition.type)
    // DATE must stay date-only. Do not apply related-list `dateFormatDefault`
    // (`short`), which uses locale date+time and shows "12:00 AM" for midnight.
    // Never date-format non-date fields: auto-number names like "0068" parse as
    // year 68 via `new Date('0068')` and render as "Jan 1, 68".
    const format = isDateType
      ? (effectiveDateDisplayFormat(column.format, labelDefinition) ??
          (labelDefinition.type === 'date'
            ? defaultDateDisplayFormat()
            : (dateFormatDefault ??
                defaultDateTimeDisplayFormat({ includeSeconds: false }))))
      : undefined

    const numberDisplay = resolveNumberDisplayOptions(labelDefinition)

    columns.push({
      field: resolved.path,
      header: await translatedFieldLabel(
        labelDefinition,
        column.header ||
          (headerSource === 'note'
            ? resolved.rootDefinition.meta?.note?.trim() || humanizeFieldName(resolved.path)
            : humanizeFieldName(resolved.path)),
      ),
      component: resolved.component ?? column.component,
      relatedCollection: resolved.relatedCollection ?? column.relatedCollection,
      template: resolved.template ?? column.template,
      format,
      numberDisplay,
      valueCollection: resolved.valueCollection,
      enabled: true,
      ...(column.inlineEditable === true ? { inlineEditable: true } : {}),
    })
  }

  return columns
}

function buildDataTableRequestFields(
  resolvedPaths: ResolvedDataTableFieldPath[],
  m2oMetadata: M2OMetadata,
  relatedFieldsByCollection: Record<string, FieldDefinition[]>,
  options: {
    extraFields?: string[]
    allFields?: FieldDefinition[]
    mutateTemplates?: boolean
  } = {},
): string[] {
  const requestFields = new Set<string>(options.extraFields ?? [])

  for (const resolved of resolvedPaths) {
    if (isNestedFieldPath(resolved.path)) {
      for (const field of resolved.requestFields) {
        requestFields.add(field)
      }
      continue
    }

    const relatedCollectionName = m2oMetadata.collections.get(resolved.path)
    if (relatedCollectionName) {
      requestFields.add(`${resolved.path}.id`)
      if (isUsersAssetCollection(relatedCollectionName)) {
        for (const userField of SYSTEM_AUDIT_USER_DISPLAY_FIELDS) {
          requestFields.add(`${resolved.path}.${userField}`)
        }
      } else {
        const targetFields =
          relatedFieldsByCollection[relatedCollectionName] ??
          options.allFields?.filter((item) => item.collection === relatedCollectionName) ??
          []
        for (const field of nestedDisplayFallbackRequestFields(resolved.path, targetFields)) {
          requestFields.add(field)
        }
      }
      const template = m2oMetadata.templates.get(resolved.path) ?? resolved.template
      if (template) {
        if (options.mutateTemplates) {
          m2oMetadata.templates.set(resolved.path, template)
        }
        const relatedFields =
          relatedFieldsByCollection[relatedCollectionName] ??
          options.allFields?.filter((item) => keysEqual(item.collection, relatedCollectionName)) ??
          []
        for (const templateField of extractTemplateFields(template)) {
          const [head, ...rest] = templateField.split('.')
          const canonical = relatedFields.find((field) => keysEqual(field.field, head))?.field ?? head
          requestFields.add([resolved.path, canonical, ...rest].filter(Boolean).join('.'))
        }
        for (const field of resolved.requestFields) {
          requestFields.add(field)
        }
      }
      continue
    }

    requestFields.add(resolved.path)
  }

  return Array.from(requestFields)
}

function buildFetchFilterQuery(
  options: FetchDataTableOptions,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  parentRelation?: RelationDefinition,
): Record<string, unknown> {
  const hasDeleted = hasDeletedField(fields)
  const hasStatus = hasStatusField(fields)
  const statusFilter = options.archivedOnly
    ? hasDeleted
      ? { is_deleted: { _eq: true } }
      : hasStatus
        ? { status: { _in: ARCHIVED_STATUS_VALUES } }
        : undefined
    : options.includeArchivedStatus !== false && hasDeleted
      ? { is_deleted: { _neq: true } }
      : options.includeArchivedStatus !== false && hasStatus
        ? activeStatusFilter()
        : undefined

  if (options.parentCollection !== undefined) {
    const relation =
      parentRelation ??
      resolveParentRelation(
        options.collection,
        relations,
        options.parentCollection,
        options.parentId,
      )
    return mergeListQueryFilters(
      relation ? { [relation.field]: { _eq: options.parentId } } : undefined,
      statusFilter,
      options.listFilter,
    )
  }

  return mergeListQueryFilters(statusFilter, options.listFilter)
}

function resolveParentRelation(
  collection: string,
  relations: RelationDefinition[],
  parentCollection?: string,
  parentId?: string | number,
) {
  if (!parentCollection || parentId === undefined || parentId === null) {
    return undefined
  }

  return relations.find(
    (relation) =>
      relation.collection === collection &&
      relation.related_collection === parentCollection,
  )
}

function resolveFetchLimit(options: FetchDataTableOptions): number {
  if (options.limit !== undefined) return options.limit
  if (options.parentCollection && options.parentId !== undefined && options.parentId !== null) {
    return 100
  }
  return options.previewLimitWithoutParent ?? 100
}

async function buildRuntimeResult(
  options: FetchDataTableOptions,
  context: PreparedDataTableContext,
  rows: Record<string, unknown>[],
  totalCount: number,
): Promise<DataTableRuntime> {
  const label = options.parentCollection
    ? undefined
    : await translatedCollectionLabel(options.collection)

  return {
    collection: options.collection,
    columns: context.columns,
    rows,
    totalCount,
    primaryKey: context.primaryKey,
    label,
    parentId: options.parentId,
    parentName: context.parentRelation?.field,
    sort: options.settings?.sort ?? null,
  }
}

function hasDeletedField(fields: FieldDefinition[]): boolean {
  return fields.some((field) => field.field === 'is_deleted')
}

function hasActiveField(fields: FieldDefinition[]): boolean {
  return fields.some((field) => field.field === 'is_active')
}

function hasStatusField(fields: FieldDefinition[]): boolean {
  return fields.some((field) => field.field === 'status')
}

function activeStatusFilter(): Record<string, unknown> {
  return {
    status: {
      _nin: ARCHIVED_STATUS_VALUES,
    },
  }
}

function getPrimaryKeyField(fields: FieldDefinition[]): string {
  return (
    fields.find((field) => field.schema?.is_primary_key)?.field ??
    fields.find((field) => field.field === 'id')?.field ??
    'id'
  )
}

async function translatedCollectionLabel(collection: string): Promise<string> {
  const collections = await getCachedCollections()
  const definition = (collections as unknown as CollectionDefinition[]).find(
    (item) => item.collection === collection,
  )
  return translateCollection(collection, definition)
}
