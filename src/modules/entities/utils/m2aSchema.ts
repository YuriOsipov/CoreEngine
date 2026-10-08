import type {
  CollectionDefinition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { bridgeReadItem } from '@/core/graphql/itemsBridge'
import { keysEqual } from '@/core/relationHelpers'
import {
  mapFieldTypeToComponent,
  isFieldReadonly,
  normalizeSpecial,
} from '@/modules/entities/utils/fieldMapper'
import {
  getCachedCollectionFields,
  getCachedCollections,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  extractTemplateFields,
  getPathValue,
  humanizeFieldName,
  scalarId,
} from '@/modules/entities/utils/recordDisplay'
import { isRepeaterFieldDefinition } from '@/core/repeaterField'

export interface M2AMetadata {
  field: string
  junctionCollection: string
  parentFkField: string
  collectionField: string
  itemField: string
  sortField: string | null
  allowedCollections: string[]
}

export interface M2AJunctionRow {
  id?: string | number
  collection: string
  sort?: number | null
  item: Record<string, unknown> | string | number | null
  hideBlock?: boolean
}

const DEFAULT_ITEM_FIELD = 'item'
const DEFAULT_COLLECTION_FIELD = 'collection'
const DEFAULT_SORT_FIELD = 'sort'
const DEFAULT_ITEM_SUMMARY_FIELDS = ['title', 'headline', 'name', 'label']
const HIDE_BLOCK_FIELD = 'hide_block'

function isTruthyBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
}

function readRecordFieldValue(
  record: Record<string, unknown>,
  fieldName: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(record, fieldName)) {
    return record[fieldName]
  }
  const matchedKey = Object.keys(record).find((key) => keysEqual(key, fieldName))
  return matchedKey ? record[matchedKey] : undefined
}

function mergeJunctionHideFlagsOntoItem(
  junctionRow: Record<string, unknown>,
  item: M2AJunctionRow['item'],
): M2AJunctionRow['item'] {
  const record: Record<string, unknown> =
    item && typeof item === 'object'
      ? { ...(item as Record<string, unknown>) }
      : scalarId(item) !== null
        ? { id: scalarId(item) }
        : {}

  if (
    isTruthyBoolean(readRecordFieldValue(junctionRow, HIDE_BLOCK_FIELD)) &&
    !isTruthyBoolean(readRecordFieldValue(record, HIDE_BLOCK_FIELD))
  ) {
    record[HIDE_BLOCK_FIELD] = true
  }

  return Object.keys(record).length > 0 ? record : item
}

export function isM2ABlockItemHidden(item: M2AJunctionRow['item']): boolean {
  if (!item || typeof item !== 'object') return false
  return isTruthyBoolean(
    readRecordFieldValue(item as Record<string, unknown>, HIDE_BLOCK_FIELD),
  )
}

export function readJunctionHideBlock(junctionRow: Record<string, unknown>): boolean {
  return isTruthyBoolean(readRecordFieldValue(junctionRow, HIDE_BLOCK_FIELD))
}

export function isM2ABlockRowHidden(row: M2AJunctionRow): boolean {
  if (row.hideBlock === true) return true
  return isM2ABlockItemHidden(row.item)
}

export function filterVisibleM2ABlocks(rows: M2AJunctionRow[]): M2AJunctionRow[] {
  return rows.filter((row) => !isM2ABlockRowHidden(row))
}

export function serializeM2AEditorRows(rows: M2AJunctionRow[]): string {
  return JSON.stringify(
    rows.map((row, index) => ({
      id: row.id ?? null,
      collection: row.collection,
      sort: row.sort ?? index,
      hideBlock: row.hideBlock === true,
      item: row.item,
    })),
  )
}

export function m2aEditorRowsToFieldValue(
  rows: M2AJunctionRow[],
  metadata: M2AMetadata,
): Record<string, unknown>[] {
  const { collectionField, itemField, sortField } = metadata

  return rows.map((row, index) => {
    const entry: Record<string, unknown> = {
      [collectionField]: row.collection,
      [itemField]: row.item,
    }

    if (row.id !== undefined) {
      entry.id = row.id
    }

    if (sortField) {
      entry[sortField] = row.sort ?? index
    }

    if (row.hideBlock !== undefined) {
      entry[HIDE_BLOCK_FIELD] = row.hideBlock
    }

    return entry
  })
}

export function isM2ABlockLinked(
  rows: M2AJunctionRow[],
  collection: string,
  itemId: string | number,
): boolean {
  const target = String(itemId)
  return rows.some(
    (row) =>
      keysEqual(row.collection, collection) &&
      String(blockRowItemId(row) ?? '') === target,
  )
}

export function linkedM2AItemIds(
  rows: M2AJunctionRow[],
  collection: string,
): Array<string | number> {
  const ids: Array<string | number> = []
  for (const row of rows) {
    if (!keysEqual(row.collection, collection)) continue
    const id = blockRowItemId(row)
    if (id !== null) ids.push(id)
  }
  return ids
}

export function appendM2ABlockRow(
  rows: M2AJunctionRow[],
  collection: string,
  itemId: string | number,
): M2AJunctionRow[] {
  if (isM2ABlockLinked(rows, collection, itemId)) return rows
  return [
    ...rows,
    {
      id: `temp-${crypto.randomUUID()}`,
      collection,
      sort: rows.length,
      item: { id: itemId },
      hideBlock: false,
    },
  ]
}

export function blockRowItemId(row: M2AJunctionRow): string | number | null {
  if (!row.item || typeof row.item !== 'object') return scalarId(row.item)
  return scalarId((row.item as Record<string, unknown>).id)
}

function relationHasAllowedCollections(
  relation: RelationDefinition | undefined,
): boolean {
  const allowed = relation?.meta?.one_allowed_collections
  if (Array.isArray(allowed)) {
    return allowed.some((item) => typeof item === 'string' && item.length > 0)
  }
  return typeof allowed === 'string' && allowed.length > 0
}

export function isFieldM2A(
  collection: string,
  fieldName: string,
  fields: FieldDefinition[] | null | undefined,
  relations: RelationDefinition[],
): boolean {
  if (!collection || !fieldName) return false

  const field = fields?.find((item) => keysEqual(item.field, fieldName))
  const special = normalizeSpecial(field?.meta?.special)
  if (special.includes('o2m') || special.includes('m2m')) return false
  if (special.includes('m2a')) return true

  const relation = findM2ARelation(collection, fieldName, relations)
  return relationHasAllowedCollections(relation)
}

function parseAllowedCollections(
  relation: RelationDefinition | undefined,
  field: FieldDefinition | undefined,
): string[] {
  const rawAllowed = relation?.meta?.one_allowed_collections
  if (Array.isArray(rawAllowed)) {
    return rawAllowed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (typeof rawAllowed === 'string' && rawAllowed.trim()) {
    try {
      const parsed = JSON.parse(rawAllowed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      }
    } catch {
      return rawAllowed
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
  }

  const optionCollections = field?.meta?.options?.collections
  if (Array.isArray(optionCollections)) {
    return optionCollections
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && typeof item.collection === 'string') {
          return item.collection
        }
        return null
      })
      .filter((item): item is string => Boolean(item))
  }

  return []
}

function inferAllowedCollectionsFromJunction(
  junctionCollection: string,
  itemField: string,
  relations: RelationDefinition[],
): string[] {
  const collections = new Set<string>()

  for (const relation of relations) {
    if (!keysEqual(relation.collection, junctionCollection)) continue
    if (!keysEqual(relation.field, itemField)) continue

    const target = relation.meta?.one_collection ?? relation.related_collection
    if (typeof target === 'string' && target.length > 0) {
      collections.add(target)
    }
  }

  return Array.from(collections).sort((left, right) => left.localeCompare(right))
}

function findM2ARelation(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): RelationDefinition | undefined {
  const candidates = relations.filter(
    (item) =>
      (keysEqual(item.meta?.one_collection ?? '', collection) &&
        keysEqual(item.meta?.one_field ?? '', fieldName) &&
        Boolean(item.meta?.many_collection)) ||
      (keysEqual(item.collection, collection) &&
        keysEqual(item.field, fieldName) &&
        Boolean(item.meta?.many_collection)),
  )
  return (
    candidates.find((item) => relationHasAllowedCollections(item)) ?? candidates[0]
  )
}

function inferJunctionCollection(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): string | null {
  const relation = findM2ARelation(collection, fieldName, relations)
  if (relation?.meta?.many_collection) return relation.meta.many_collection

  const singular = collection.endsWith('s') ? collection.slice(0, -1) : collection
  const candidates = [
    `${singular}_${fieldName}`,
    `${collection}_${fieldName}`,
  ]

  for (const candidate of candidates) {
    if (
      relations.some(
        (item) =>
          keysEqual(item.collection, candidate) ||
          keysEqual(item.meta?.many_collection ?? '', candidate),
      )
    ) {
      return candidate
    }
  }

  return null
}

export function resolveM2AMetadata(
  collection: string,
  fieldName: string,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): M2AMetadata | null {
  if (!isFieldM2A(collection, fieldName, fields, relations)) return null

  const field = fields.find((item) => keysEqual(item.field, fieldName))
  const relation = findM2ARelation(collection, fieldName, relations)
  const junctionCollection =
    relation?.meta?.many_collection ??
    inferJunctionCollection(collection, fieldName, relations)
  if (!junctionCollection) return null

  const collectionField = DEFAULT_COLLECTION_FIELD
  const sortField = relation?.meta?.sort_field ?? DEFAULT_SORT_FIELD

  const parentFkRelation = relations.find(
    (item) =>
      (keysEqual(item.collection, junctionCollection) ||
        keysEqual(item.meta?.many_collection ?? '', junctionCollection)) &&
      (keysEqual(item.related_collection ?? '', collection) ||
        keysEqual(item.meta?.one_collection ?? '', collection)),
  )
  const parentFkField =
    parentFkRelation?.meta?.many_field ??
    parentFkRelation?.field ??
    `${collection.replace(/s$/, '')}_id`

  const itemField = resolveM2AJunctionItemField(
    junctionCollection,
    relations,
    parentFkField,
    collectionField,
  )

  let allowedCollections = parseAllowedCollections(relation, field)
  if (!allowedCollections.length) {
    allowedCollections = inferAllowedCollectionsFromJunction(
      junctionCollection,
      itemField,
      relations,
    )
  }

  return {
    field: field?.field ?? fieldName,
    junctionCollection,
    parentFkField,
    collectionField,
    itemField,
    sortField,
    allowedCollections,
  }
}

function resolveM2AJunctionItemField(
  junctionCollection: string,
  relations: RelationDefinition[],
  parentFkField: string,
  collectionDiscriminatorField: string,
): string {
  const itemRelation = relations.find(
    (relation) =>
      keysEqual(relation.collection, junctionCollection) &&
      keysEqual(relation.field, DEFAULT_ITEM_FIELD),
  )
  if (itemRelation) return DEFAULT_ITEM_FIELD

  const polymorphicRelation = relations.find(
    (relation) =>
      keysEqual(relation.collection, junctionCollection) &&
      keysEqual(relation.meta?.junction_field ?? '', collectionDiscriminatorField) &&
      !keysEqual(relation.field, parentFkField),
  )
  if (polymorphicRelation?.field) return polymorphicRelation.field

  return (
    junctionItemFieldName(junctionCollection, relations, parentFkField) ??
    DEFAULT_ITEM_FIELD
  )
}

function junctionItemFieldName(
  junctionCollection: string,
  relations: RelationDefinition[],
  parentFkField: string,
): string | null {
  const junctionRelation = relations.find(
    (item) =>
      keysEqual(item.collection, junctionCollection) &&
      item.meta?.junction_field &&
      !keysEqual(item.meta.junction_field, DEFAULT_COLLECTION_FIELD) &&
      !keysEqual(item.field, parentFkField),
  )
  if (junctionRelation?.field) return junctionRelation.field

  return DEFAULT_ITEM_FIELD
}

export async function fetchM2AMetadata(
  collection: string,
  fieldName: string,
): Promise<M2AMetadata | null> {
  const [fields, relations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  return resolveM2AMetadata(
    collection,
    fieldName,
    fields as FieldDefinition[],
    relations as RelationDefinition[],
  )
}

export function buildM2ARequestFields(metadata: M2AMetadata): string[] {
  const { field, collectionField, itemField, sortField } = metadata
  const fields = [
    `${field}.id`,
    `${field}.${collectionField}`,
    `${field}.${itemField}.id`,
    `${field}.${itemField}.*`,
    `${field}.${HIDE_BLOCK_FIELD}`,
  ]
  if (sortField) {
    fields.push(`${field}.${sortField}`)
  }
  return fields
}

export function buildM2ARequestFieldsFallback(fieldName: string): string[] {
  const fields = [
    `${fieldName}.id`,
    `${fieldName}.collection`,
    `${fieldName}.sort`,
    `${fieldName}.item.id`,
    `${fieldName}.item.*`,
    `${fieldName}.${HIDE_BLOCK_FIELD}`,
  ]
  return fields
}

function resolveJunctionCollectionName(
  row: Record<string, unknown>,
  collectionField: string,
): string {
  const candidates = [
    row[collectionField],
    row[DEFAULT_COLLECTION_FIELD],
    row.collection,
  ]

  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed && trimmed !== '[object Object]') return trimmed
    }
    if (raw && typeof raw === 'object') {
      const nested = (raw as Record<string, unknown>).collection
      if (typeof nested === 'string') {
        const trimmed = nested.trim()
        if (trimmed) return trimmed
      }
    }
  }

  return ''
}

export function normalizeM2ARows(
  value: unknown,
  metadata?: M2AMetadata | null,
): M2AJunctionRow[] {
  if (!Array.isArray(value)) return []

  const collectionField = metadata?.collectionField ?? DEFAULT_COLLECTION_FIELD
  const itemField = metadata?.itemField ?? DEFAULT_ITEM_FIELD
  const sortField = metadata?.sortField ?? DEFAULT_SORT_FIELD

  const rows: M2AJunctionRow[] = []

  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const collection = resolveJunctionCollectionName(row, collectionField)
    if (!collection) continue

    const item = row[itemField] ?? row.item ?? null
    const normalizedItem = mergeJunctionHideFlagsOntoItem(
      row,
      item && typeof item === 'object'
        ? { ...(item as Record<string, unknown>) }
        : scalarId(item) !== null
          ? { id: scalarId(item) }
          : null,
    )

    rows.push({
      id: scalarId(row.id) ?? undefined,
      collection,
      sort: typeof row[sortField] === 'number' ? row[sortField] as number : index,
      item: normalizedItem,
      hideBlock: readJunctionHideBlock(row),
    })
  }

  return rows.sort((left, right) => (left.sort ?? 0) - (right.sort ?? 0))
}

function stripHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function containsHtmlMarkup(value: string): boolean {
  return /<[a-z][^>]*>/i.test(value) || /&lt;[a-z]/i.test(value)
}

function fieldKeyFromTemplateToken(token: string): string {
  return token.split('.')[0] ?? token
}

function isRichTextField(field?: FieldDefinition | null): boolean {
  if (!field) return false
  const iface = (field.meta?.interface ?? '').toLowerCase()
  return (
    iface.includes('wysiwyg') ||
    iface.includes('rich-text-html') ||
    iface.includes('rich-text-md') ||
    iface.includes('input-rich-text')
  )
}

function isNonScalarTemplateValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  return typeof value === 'object'
}

function isNonScalarTemplateField(
  fieldDef: FieldDefinition | undefined,
  value: unknown,
): boolean {
  if (fieldDef && (isRepeaterFieldDefinition(fieldDef) || fieldDef.type === 'json')) return true
  return isNonScalarTemplateValue(value)
}

function renderScalarTemplateLabel(
  template: string,
  record: Record<string, unknown>,
  fields?: FieldDefinition[] | null,
): string {
  const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = getPathValue(record, key)
    const fieldKey = fieldKeyFromTemplateToken(key)
    const definition = fields?.find((field) => keysEqual(field.field, fieldKey))
    if (isNonScalarTemplateField(definition, value)) return ''
    return String(value ?? '')
  })

  return rendered.replace(/\s+/g, ' ').trim()
}

export function templateReferencesNonScalarFields(
  template: string | undefined,
  fields?: FieldDefinition[] | null,
): boolean {
  if (!template?.trim() || !fields?.length) return false

  return extractTemplateFields(template).some((token) => {
    const fieldKey = fieldKeyFromTemplateToken(token)
    const definition = fields.find((field) => keysEqual(field.field, fieldKey))
    return Boolean(definition && (isRepeaterFieldDefinition(definition) || definition.type === 'json'))
  })
}

export function repeaterFieldsForCollection(
  fields: FieldDefinition[] | null | undefined,
): FieldDefinition[] {
  return (fields ?? []).filter(isRepeaterFieldDefinition)
}

function displayTemplateUsesHtml(
  template: string,
  record: Record<string, unknown>,
  fields?: FieldDefinition[] | null,
): boolean {
  const rendered = renderScalarTemplateLabel(template, record, fields)
  if (containsHtmlMarkup(rendered)) return true

  for (const token of extractTemplateFields(template)) {
    const value = getPathValue(record, token)
    if (typeof value === 'string' && containsHtmlMarkup(value)) return true

    const fieldKey = fieldKeyFromTemplateToken(token)
    const definition = fields?.find((field) => keysEqual(field.field, fieldKey))
    if (isNonScalarTemplateField(definition, value)) continue
    if (isRichTextField(definition)) return true
  }

  return false
}

const DISPLAY_FALLBACK_FIELDS = [
  'headline',
  'content',
  'body',
  'description',
  'text',
  ...DEFAULT_ITEM_SUMMARY_FIELDS,
]

function fallbackM2ADisplayTemplate(
  record: Record<string, unknown>,
  fields?: FieldDefinition[] | null,
  preferredFieldNames?: string[] | null,
): M2ADisplayTemplateResult {
  const preferred = (preferredFieldNames ?? []).filter(Boolean)
  const orderedFields = preferred.length
    ? [
        ...preferred,
        ...DISPLAY_FALLBACK_FIELDS.filter(
          (fieldName) => !preferred.some((item) => keysEqual(item, fieldName)),
        ),
      ]
    : DISPLAY_FALLBACK_FIELDS

  for (const fieldName of orderedFields) {
    const value = record[fieldName] ?? readRecordFieldValue(record, fieldName)
    if (typeof value !== 'string' || !value.trim()) continue

    const definition = fields?.find((field) => keysEqual(field.field, fieldName))
    return {
      html: value.trim(),
      isHtml: containsHtmlMarkup(value) || isRichTextField(definition),
    }
  }

  const id = scalarId(record)
  const text = id === null ? '' : String(id)
  return { html: text, isHtml: false }
}

export interface M2ADisplayTemplateResult {
  html: string
  isHtml: boolean
}

export function renderM2ADisplayTemplate(
  item: M2AJunctionRow['item'],
  collectionDefinition?: CollectionDefinition | null,
  collectionFields?: FieldDefinition[] | null,
  preferredFieldNames?: string[] | null,
): M2ADisplayTemplateResult {
  if (!item || typeof item !== 'object') {
    const id = scalarId(item)
    const text = id === null ? '' : String(id)
    return { html: text, isHtml: false }
  }

  const record = item as Record<string, unknown>
  const template = collectionDefinition?.meta?.display_template?.trim()

  if (template) {
    const rendered = renderScalarTemplateLabel(template, record, collectionFields)
    const recordId = String(record.id ?? '')
    if (rendered && rendered !== recordId) {
      return {
        html: rendered.trim(),
        isHtml: displayTemplateUsesHtml(template, record, collectionFields),
      }
    }
  }

  return fallbackM2ADisplayTemplate(record, collectionFields, preferredFieldNames)
}

export function summarizeM2AItem(
  item: M2AJunctionRow['item'],
  collectionDefinition?: CollectionDefinition | null,
  preferredFieldNames?: string[] | null,
): string {
  const display = renderM2ADisplayTemplate(
    item,
    collectionDefinition,
    null,
    preferredFieldNames,
  )
  if (!display.html) return ''
  return stripHtml(display.html)
}

function isShallowM2AItem(item: M2AJunctionRow['item']): boolean {
  if (item === null || item === undefined) return false
  if (typeof item !== 'object') return true
  const record = item as Record<string, unknown>
  return Object.keys(record).every((key) => key === 'id')
}

export async function hydrateM2AItems(rows: M2AJunctionRow[]): Promise<M2AJunctionRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.collection || !isShallowM2AItem(row.item)) return row

      const itemId = scalarId(
        typeof row.item === 'object' ? (row.item as Record<string, unknown>).id : row.item,
      )
      if (itemId === null) return row

      try {
        const fullItem = await bridgeReadItem(row.collection, itemId)
        return { ...row, item: fullItem }
      } catch {
        return row
      }
    }),
  )
}

export async function collectionDisplayLabel(collection: string): Promise<string> {
  const collections = (await getCachedCollections()) as CollectionDefinition[]
  const definition = collections.find((item) => keysEqual(item.collection, collection))
  if (definition?.meta?.note?.trim()) return definition.meta.note.trim()
  return humanizeFieldName(collection.replace(/^block_/, ''))
}

export function editableItemFieldsForCollection(
  fields: FieldDefinition[],
  configuredFields?: string[],
): FieldDefinition[] {
  if (configuredFields?.length) {
    return configuredFields
      .map((fieldName) => fields.find((field) => keysEqual(field.field, fieldName)))
      .filter((field): field is FieldDefinition => Boolean(field))
  }

  return fields
    .filter((field) => {
      if (field.meta?.hidden) return false
      if (field.schema?.is_primary_key) return false
      if (isFieldReadonly(field)) return false
      return mapFieldTypeToComponent(field) !== null
    })
    .sort((left, right) => {
      const sortLeft = left.meta?.sort ?? 999
      const sortRight = right.meta?.sort ?? 999
      if (sortLeft !== sortRight) return sortLeft - sortRight
      return left.field.localeCompare(right.field)
    })
}

function normalizeComparableItem(item: M2AJunctionRow['item']): unknown {
  if (!item || typeof item !== 'object') return item ?? null
  const record = item as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) {
    normalized[key] = value
  }
  return normalized
}

function isTemporaryM2ARowId(id: string | number | undefined): boolean {
  return typeof id === 'string' && id.startsWith('temp-')
}

export function isTemporaryM2AJunctionId(id: string | number | undefined): boolean {
  return isTemporaryM2ARowId(id)
}

function junctionItemScalar(item: M2AJunctionRow['item']): string | number | null {
  return scalarId(item)
}

/**
 * Load M2A junction rows for a parent (M2M-style list), then hydrate target items.
 */
export async function loadM2AJunctionRows(
  metadata: M2AMetadata,
  parentId: string | number,
): Promise<M2AJunctionRow[]> {
  const { bridgeReadItems } = await import('@/core/graphql/itemsBridge')
  const sortField = metadata.sortField
  const fields = [
    'id',
    metadata.parentFkField,
    metadata.collectionField,
    metadata.itemField,
    ...(sortField ? [sortField] : []),
    'hide_block',
  ]
  const items = await bridgeReadItems(metadata.junctionCollection, {
    filter: { [metadata.parentFkField]: { _eq: parentId } },
    fields,
    sort: sortField ? [sortField] : ['id'],
    limit: -1,
  })
  const normalized = normalizeM2ARows(items, metadata).map((row, index) => ({
    ...row,
    sort: row.sort ?? index,
  }))
  return hydrateM2AItems(normalized)
}

/**
 * Persist M2A editor rows as independent junction CRUD (create/update/delete).
 */
export async function persistM2AJunctionRows(
  metadata: M2AMetadata,
  parentId: string | number,
  current: M2AJunctionRow[],
  original: M2AJunctionRow[],
): Promise<M2AJunctionRow[]> {
  const {
    bridgeCreateItem,
    bridgeUpdateItem,
    bridgeDeleteItem,
  } = await import('@/core/graphql/itemsBridge')

  const { collectionField, itemField, parentFkField, sortField, junctionCollection } =
    metadata
  const originalById = new Map(
    original
      .filter((row) => row.id !== undefined && !isTemporaryM2ARowId(row.id))
      .map((row) => [String(row.id), row] as const),
  )
  const currentPersistedIds = new Set(
    current
      .filter((row) => row.id !== undefined && !isTemporaryM2ARowId(row.id))
      .map((row) => String(row.id)),
  )

  for (const originalRow of original) {
    if (originalRow.id === undefined || isTemporaryM2ARowId(originalRow.id)) continue
    if (currentPersistedIds.has(String(originalRow.id))) continue
    await bridgeDeleteItem(junctionCollection, originalRow.id)
  }

  const nextRows: M2AJunctionRow[] = []
  for (const [index, row] of current.entries()) {
    const itemId = junctionItemScalar(row.item)
    if (itemId === null) {
      throw new Error('M2A block is missing a target item id')
    }
    const sortValue = row.sort ?? index
    const hideBlock = row.hideBlock === true
    const payload: Record<string, unknown> = {
      [parentFkField]: parentId,
      [collectionField]: row.collection,
      [itemField]: itemId,
      hide_block: hideBlock,
    }
    if (sortField) payload[sortField] = sortValue

    if (row.id !== undefined && !isTemporaryM2ARowId(row.id)) {
      const previous = originalById.get(String(row.id))
      const prevItemId = previous ? junctionItemScalar(previous.item) : null
      const changed =
        !previous ||
        previous.collection !== row.collection ||
        String(prevItemId) !== String(itemId) ||
        Number(previous.sort ?? 0) !== Number(sortValue) ||
        Boolean(previous.hideBlock) !== hideBlock
      if (changed) {
        await bridgeUpdateItem(junctionCollection, row.id, payload)
      }
      nextRows.push({
        ...row,
        id: row.id,
        sort: sortValue,
        hideBlock,
        item: row.item,
      })
      continue
    }

    const created = await bridgeCreateItem(junctionCollection, payload, {
      fields: [
        'id',
        parentFkField,
        collectionField,
        itemField,
        ...(sortField ? [sortField] : []),
        'hide_block',
      ],
    })
    nextRows.push({
      ...row,
      id: created.id as string | number,
      sort: sortValue,
      hideBlock,
      item: row.item,
    })
  }

  return hydrateM2AItems(nextRows)
}

export function buildM2APayloadRows(
  current: M2AJunctionRow[],
  original: M2AJunctionRow[] | undefined,
  metadata: M2AMetadata,
): Record<string, unknown>[] {
  const { collectionField, itemField, sortField } = metadata
  const originalById = new Map(
    (original ?? [])
      .filter((row) => row.id !== undefined)
      .map((row) => [String(row.id), row] as const),
  )
  const currentIds = new Set(
    current
      .map((row) => row.id)
      .filter((id): id is string | number => id !== undefined)
      .map((id) => String(id)),
  )

  const payload: Record<string, unknown>[] = []

  for (const [index, row] of current.entries()) {
    const entry: Record<string, unknown> = {
      [collectionField]: row.collection,
    }
    if (sortField) {
      entry[sortField] = row.sort ?? index
    }
    if (row.id !== undefined && !isTemporaryM2ARowId(row.id)) {
      entry.id = row.id
    }

    if (row.hideBlock !== undefined) {
      entry[HIDE_BLOCK_FIELD] = row.hideBlock
    }

    const originalRow = row.id !== undefined ? originalById.get(String(row.id)) : undefined
    const itemChanged =
      !originalRow ||
      JSON.stringify(normalizeComparableItem(originalRow.item)) !==
        JSON.stringify(normalizeComparableItem(row.item))

    if (itemChanged && row.item && typeof row.item === 'object') {
      entry[itemField] = { ...(row.item as Record<string, unknown>) }
    } else if (scalarId(row.item) !== null) {
      entry[itemField] = { id: scalarId(row.item) }
    } else if (row.item && typeof row.item === 'object') {
      const itemId = scalarId((row.item as Record<string, unknown>).id)
      entry[itemField] = itemId !== null ? { id: itemId } : {}
    } else {
      entry[itemField] = {}
    }

    payload.push(entry)
  }

  for (const originalRow of original ?? []) {
    if (originalRow.id === undefined) continue
    if (currentIds.has(String(originalRow.id))) continue
    payload.push({
      id: originalRow.id,
      [collectionField]: originalRow.collection,
      delete: true,
    })
  }

  return payload
}

export async function normalizeM2AFieldValue(
  collection: string,
  fieldName: string,
  value: unknown,
  original?: unknown,
): Promise<unknown> {
  const [fields, relations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const metadata = resolveM2AMetadata(
    collection,
    fieldName,
    fields as FieldDefinition[],
    relations as RelationDefinition[],
  )
  if (!metadata) return value

  const currentRows = normalizeM2ARows(value, metadata)
  const originalRows = original === undefined ? undefined : normalizeM2ARows(original, metadata)
  return buildM2APayloadRows(currentRows, originalRows, metadata)
}
