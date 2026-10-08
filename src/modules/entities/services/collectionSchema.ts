import {
  featureFlags,
  refuseLegacyFallback,
} from '@/core/graphql/featureFlags'
import { keysEqual } from '@/core/relationHelpers'
import { fetchRegistrySnapshotFromGraphQL } from '@/core/graphql/registryApi'
import { fetchRegistrySnapshotFromRest } from '@/core/supabase/registryRest'
import { bridgeReadItem, bridgeReadItems } from '@/core/graphql/itemsBridge'
import { readUsersBridge } from '@/core/graphql/usersApi'
import type {
  CollectionSchemaBundle,
  CollectionDefinition,
  FieldDefinition,
  LayoutFieldMetadata,
  RelationDefinition,
} from '@/interfaces'
import type { DataTableSettings } from '@/interfaces'
import type { PaletteItem } from '../utils/fieldPalette'
import { resolveFieldFormula } from '@/core/calculatedFields'
import {
  buildPaletteFromFields,
  isFieldReadonly,
} from '../utils/fieldMapper'
import { isChoiceOption, filesSettings } from '@/core/fieldHelpers'
import {
  choiceLabel,
  extractTemplateFields,
  humanizeFieldName,
  relatedRecordDisplayField,
  formatUserLabel,
  relatedPickerLabel,
  renderTemplateLabel,
  shouldUseTemplateForRelatedLabel,
} from '../utils/recordDisplay'
import {
  fieldDateDisplayFormat,
  primeVueDatePickerFormat,
} from '@/core/dateFormatting'
import { FILES_ASSET_COLLECTION, isFilesAssetCollection, resolveFilesRelatedCollection } from '@/core/filesField'
import { isRolesAssetCollection } from '@/core/rolesField'
import { isUsersAssetCollection } from '@/core/usersField'
import {
  translateCollection,
  translateField,
  translateLabel,
} from '@/core/translation'
import {
  fetchDataTableRuntime,
  translatedFieldLabel,
  type DataTableRuntime,
  type DataTableRuntimeColumn,
} from './dataTableRuntime'

export { translatedFieldLabel }

/** Folder / legacy names only — prefer entities.backend_config.internal. */
const EXCLUDED_USER_COLLECTIONS = new Set(['main'])

function isInternalCollection(collection: {
  collection: string
  meta?: { internal?: boolean; hidden?: boolean } | null
}): boolean {
  if (collection.meta?.internal === true) return true
  return EXCLUDED_USER_COLLECTIONS.has(collection.collection)
}
const PICKLIST_COMPONENTS = new Set([
  'Select',
  'Dropdown',
  'RadioButton',
  'SelectButton',
  'MultiSelect',
])
type RegistrySnapshot = {
  collections: CollectionDefinition[]
  fields: FieldDefinition[]
  relations: RelationDefinition[]
}

let registrySnapshotCache: Promise<RegistrySnapshot> | null = null
let registrySnapshotEpoch = 0

async function loadRegistrySnapshot(): Promise<RegistrySnapshot> {
  if (!registrySnapshotCache) {
    const epoch = registrySnapshotEpoch
    registrySnapshotCache = (
      featureFlags.schemaFromRest
        ? fetchRegistrySnapshotFromRest(true)
        : fetchRegistrySnapshotFromGraphQL(true)
    ).then((snapshot) => {
      if (epoch !== registrySnapshotEpoch) {
        return loadRegistrySnapshot()
      }
      return snapshot
    })
  }
  return registrySnapshotCache
}

export interface FieldRuntimeMetadata {
  required: boolean
  readonly: boolean
  formula?: string
  template?: string
  props: Record<string, unknown>
}

export interface DataTableColumnMetadata extends DataTableRuntimeColumn {}

/** @deprecated Use DataTableRuntime from dataTableRuntime.ts */
export type DataTableRuntimeMetadata = DataTableRuntime

export async function fetchCollectionSchema(
  collection: string,
): Promise<CollectionSchemaBundle> {
  const [collections, fields, relations] = await Promise.all([
    getCachedCollections(),
    getCachedFields(),
    getCachedRelations(),
  ])

  return {
    collection: collections.find((c) => c.collection === collection),
    fields: fields.filter((f) => f.collection === collection),
    relations: relations.filter((r) => r.collection === collection),
  }
}

export function clearMetadataCache(): void {
  registrySnapshotEpoch += 1
  registrySnapshotCache = null
}

export async function getCachedCollections(): Promise<CollectionDefinition[]> {
  if (featureFlags.schemaFromRest || featureFlags.schemaFromGraphQL) {
    const snapshot = await loadRegistrySnapshot()
    return snapshot.collections
  }

  refuseLegacyFallback('getCachedCollections')
}

export async function fetchCollectionIcon(collectionName: string): Promise<string | null> {
  const collections = await getCachedCollections()
  return collections.find((c) => c.collection === collectionName)?.meta?.icon ?? null
}

export async function fetchCollectionLabel(collectionName: string): Promise<string> {
  const collections = await getCachedCollections()
  const definition = collections.find((c) => c.collection === collectionName)
  return translateCollection(collectionName, definition)
}

export async function getCachedFields(): Promise<FieldDefinition[]> {
  if (featureFlags.schemaFromRest || featureFlags.schemaFromGraphQL) {
    const snapshot = await loadRegistrySnapshot()
    return snapshot.fields
  }

  refuseLegacyFallback('getCachedFields')
}

export async function getCachedRelations(): Promise<
  CollectionSchemaBundle['relations']
> {
  if (featureFlags.schemaFromRest || featureFlags.schemaFromGraphQL) {
    const snapshot = await loadRegistrySnapshot()
    return snapshot.relations
  }

  refuseLegacyFallback('getCachedRelations')
}

export async function getCachedCollectionFields(
  collection: string,
): Promise<FieldDefinition[]> {
  const fields = await getCachedFields()
  return fields.filter((field) => keysEqual(field.collection, collection))
}

async function getCachedField(
  collection: string,
  field: string,
): Promise<FieldDefinition> {
  const fields = await getCachedFields()
  const definition = fields.find(
    (item) => item.collection === collection && item.field === field,
  )

  if (!definition) {
    throw new Error(`Field "${collection}.${field}" was not found.`)
  }

  return definition
}

export async function isCollectionFieldReadonly(
  collection: string,
  field: string,
): Promise<boolean> {
  const fields = await getCachedFields()
  const definition = fields.find(
    (item) => item.collection === collection && item.field === field,
  )
  if (!definition) return false
  return isFieldReadonly(definition)
}

export interface UserCollectionOption {
  label: string
  value: string
  description: string
  icon: string | null
  internal: boolean
  hidden: boolean
}

export async function listUserCollections(options?: {
  includeInternal?: boolean
  includeHidden?: boolean
}): Promise<UserCollectionOption[]> {
  const collections = await getCachedCollections()
  const includeInternal = options?.includeInternal === true
  const includeHidden = options?.includeHidden === true

  const visibleCollections = collections.filter((c) => {
    const internal = isInternalCollection(c)
    if (internal) return includeInternal
    if (c.meta?.hidden) return includeHidden
    return true
  })

  const mapped = await Promise.all(
    visibleCollections.map(async (c) => ({
      value: c.collection,
      label: await translateCollection(c.collection, c),
      description: c.meta?.description?.trim() || '',
      icon: c.meta?.icon ?? null,
      internal: isInternalCollection(c),
      hidden: c.meta?.hidden === true,
    })),
  )

  return mapped.sort((a, b) => a.label.localeCompare(b.label))
}

async function loadPaletteSnapshot(
  collection: string,
): Promise<{
  collections: CollectionDefinition[]
  fields: FieldDefinition[]
  relations: CollectionSchemaBundle['relations']
}> {
  const snapshot = await loadRegistrySnapshot()
  const collections = snapshot.collections as unknown as CollectionDefinition[]
  if (collections.some((row) => row.collection === collection)) {
    return {
      collections,
      fields: snapshot.fields as unknown as FieldDefinition[],
      relations: snapshot.relations as CollectionSchemaBundle['relations'],
    }
  }

  // Newly created objects are often missing from a snapshot fetched before Save.
  clearMetadataCache()
  const fresh = await loadRegistrySnapshot()
  return {
    collections: fresh.collections as unknown as CollectionDefinition[],
    fields: fresh.fields as unknown as FieldDefinition[],
    relations: fresh.relations as CollectionSchemaBundle['relations'],
  }
}

export async function buildLivePalette(
  collection: string,
): Promise<PaletteItem[]> {
  const { collections, fields: allFields, relations } = await loadPaletteSnapshot(
    collection,
  )

  const collectionMeta = collections.find((c) => c.collection === collection)
  if (!collectionMeta) {
    const available = collections
      .map((c) => c.collection)
      .slice(0, 8)
      .join(', ')
    throw new Error(
      `Collection "${collection}" does not exist in the registry. Try: ${available}${available.length >= 8 ? '…' : ''}`,
    )
  }

  const bundle: CollectionSchemaBundle = {
    collection: collectionMeta,
    fields: allFields.filter((f) => f.collection === collection),
    relations: relations.filter((r) => r.collection === collection),
  }

  if (bundle.fields.length === 0) {
    throw new Error(
      `No fields returned for "${collection}". Check admin permissions for /fields.`,
    )
  }

  const palette = buildPaletteFromFields(
    bundle.fields,
    bundle.relations,
  )
  const fieldByName = new Map(bundle.fields.map((field) => [field.field, field]))
  const translatedPalette = await Promise.all(
    palette.map(async (item) => {
      const field = fieldByName.get(item.fieldKey)
      return field
        ? { ...item, label: await translateField(field, item.label) }
        : item
    }),
  )

  if (translatedPalette.length === 0) {
    throw new Error(
      `No layout-eligible fields in "${collection}" (${bundle.fields.length} columns are hidden, relational, or unsupported types).`,
    )
  }

  return translatedPalette
}

/**
 * Returns true when manyCollection is a junction table that holds a FK to
 * the files asset collection — meaning the O2M is a file-attachments list.
 */
function isFilesJunction(
  manyCollection: string,
  allRelations: RelationDefinition[],
): boolean {
  return allRelations.some(
    (r) =>
      (r.collection === manyCollection ||
        r.meta?.many_collection === manyCollection) &&
      isFilesAssetCollection(String(r.related_collection || r.meta?.one_collection || '')),
  )
}

export interface ParentRelatedCollectionRef {
  id: string
  relatedCollection: string
  relationKey: string
  relation: RelationDefinition
  isFilesJunction: boolean
}

/**
 * Where related-list create should write.
 * - Plain O2M: create a child row on `relatedCollection` with parent FK.
 * - M2M junction (e.g. item_item): link an existing related entity via a junction row
 *   (UI searches `createCollection`; insert goes to `junction.collection`).
 */
export interface RelatedCreateTarget {
  createCollection: string
  /** FK on createCollection for plain O2M children (null for M2M). */
  parentField: string | null
  junction?: {
    collection: string
    parentField: string
    relatedField: string
  }
}

export async function resolveRelatedCreateTarget(
  relatedCollection: string,
  parentCollection?: string | null,
): Promise<RelatedCreateTarget> {
  const collection = String(relatedCollection || '').trim()
  const parent = String(parentCollection || '').trim()
  if (!collection) {
    return { createCollection: '', parentField: null }
  }
  if (!parent) {
    return { createCollection: collection, parentField: null }
  }

  const relations = await getCachedRelations()
  const junctionFace = relations.find((relation) => {
    const manyCollection =
      relation.meta?.many_collection || relation.collection
    const oneCollection =
      relation.meta?.one_collection || relation.related_collection
    return (
      manyCollection === collection &&
      oneCollection === parent &&
      Boolean(relation.meta?.junction_field)
    )
  })

  if (junctionFace) {
    const parentField = String(
      junctionFace.meta?.many_field || junctionFace.field || '',
    ).trim()
    const relatedField = String(junctionFace.meta?.junction_field || '').trim()
    const relatedLink = relations.find((relation) => {
      const manyCollection =
        relation.meta?.many_collection || relation.collection
      return (
        manyCollection === collection &&
        (relation.field === relatedField ||
          relation.meta?.many_field === relatedField)
      )
    })
    const createCollection = String(
      relatedLink?.related_collection ||
        relatedLink?.meta?.one_collection ||
        '',
    ).trim()

    if (createCollection && parentField && relatedField) {
      return {
        createCollection,
        parentField: null,
        junction: {
          collection,
          parentField,
          relatedField,
        },
      }
    }
  }

  const childFace = relations.find((relation) => {
    const manyCollection =
      relation.meta?.many_collection || relation.collection
    const oneCollection =
      relation.meta?.one_collection || relation.related_collection
    return manyCollection === collection && oneCollection === parent
  })

  return {
    createCollection: collection,
    parentField: childFace
      ? String(childFace.meta?.many_field || childFace.field || '').trim() || null
      : null,
  }
}

/** Child collections related to a parent, using the same rules as the page layout designer. */
export async function listParentRelatedCollections(
  collection: string,
): Promise<ParentRelatedCollectionRef[]> {
  const relations = await getCachedRelations()

  const items = relations
    .filter((relation) => {
      if (relation.related_collection === collection) return true
      if (relation.meta?.one_collection === collection) return true
      return false
    })
    .map((relation) => {
      const relatedCollection =
        relation.meta?.many_collection || relation.collection
      const relationKey =
        relation.meta?.one_field || `${relatedCollection}_${relation.field}`
      const manyField =
        relation.meta?.many_field ||
        (relation.collection === relatedCollection ? relation.field : '')

      return {
        id: `related-${relatedCollection}-${manyField || relation.field}`,
        relatedCollection,
        relationKey,
        relation,
        isFilesJunction: isFilesJunction(relatedCollection, relations),
      }
    })
    .filter((item) => item.relatedCollection && item.relatedCollection !== collection)

  const unique = new Map<string, (typeof items)[number]>()
  for (const item of items) {
    const manyField = item.relation.meta?.many_field || item.relation.field
    const key = `${item.relatedCollection}::${manyField}`
    const existing = unique.get(key)
    if (!existing) {
      unique.set(key, item)
      continue
    }
    const preferCurrent = item.relation.collection === collection
    const existingIsParent = existing.relation.collection === collection
    if (preferCurrent && !existingIsParent) {
      unique.set(key, item)
    }
  }

  return [...unique.values()].sort((left, right) =>
    left.relationKey.localeCompare(right.relationKey),
  )
}

function isObjectFilesChild(
  relatedCollection: string,
  parentCollection: string,
  isJunction: boolean,
): boolean {
  if (isFilesAssetCollection(relatedCollection)) return false
  if (isJunction) return true
  return (
    relatedCollection === `${parentCollection}_files` ||
    relatedCollection.endsWith('_files')
  )
}

/** Files junction / `{object}_files` child of this object — not a field on the parent. */
export async function resolveObjectFilesChild(
  collection: string,
): Promise<{ relatedCollection: string } | null> {
  const related = await listParentRelatedCollections(collection)
  const filesChildren = related.filter((entry) =>
    isObjectFilesChild(entry.relatedCollection, collection, entry.isFilesJunction),
  )
  if (filesChildren.length) {
    const preferredName = `${collection}_files`
    const match =
      filesChildren.find((entry) => entry.relatedCollection === preferredName) ??
      filesChildren.find((entry) => entry.isFilesJunction) ??
      filesChildren[0]
    return match ? { relatedCollection: match.relatedCollection } : null
  }

  const preferredName = `${collection}_files`
  const collections = (await getCachedCollections()) as CollectionDefinition[]
  if (collections.some((entry) => entry.collection === preferredName)) {
    return { relatedCollection: preferredName }
  }
  return null
}

/** Junction collection used to list/upload files for this object. */
export async function resolveAttachedFilesCollection(
  entityCollection: string | undefined,
  field: LayoutFieldMetadata,
): Promise<string> {
  if (field.field.startsWith('files:')) {
    return FILES_ASSET_COLLECTION
  }
  const entity = entityCollection?.trim() ?? ''
  let related = field.relatedCollection?.trim() ?? ''
  if (entity && filesSettings(field)?.multiple !== false) {
    if (!related || isFilesAssetCollection(related)) {
      const child = await resolveObjectFilesChild(entity)
      if (child?.relatedCollection) return child.relatedCollection
    }
  }
  if (entity) {
    return resolveFilesRelatedCollection(entity, field)
  }
  return related
}

export async function buildRelatedObjectPalette(
  collection: string,
): Promise<PaletteItem[]> {
  const related = await listParentRelatedCollections(collection)

  const palette = await Promise.all(
    related.map(async (entry) => ({
      id: entry.id,
      label: await translateLabel(
        humanizeFieldName(entry.relationKey || entry.relatedCollection),
        [
          `fields.${collection}.${entry.relationKey}`,
          entry.relationKey,
          entry.relatedCollection,
        ],
      ),
      component: entry.isFilesJunction ? 'Files' : 'DataTable',
      fieldKey: entry.relationKey,
      fieldType: 'related-object',
      relatedCollection: entry.relatedCollection,
      multiple: entry.isFilesJunction ? true : undefined,
      description: entry.isFilesJunction
        ? `${entry.relatedCollection} · files`
        : `${entry.relatedCollection} table`,
      paletteKind: 'relatedObject',
    } satisfies PaletteItem)),
  )

  return palette.sort((left, right) => left.label.localeCompare(right.label))
}

const USER_OPTION_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'email',
] as const

function mapUserOption(
  row: Record<string, unknown>,
  template?: string,
): { label: string; value: string | number } {
  const useTemplate = shouldUseTemplateForRelatedLabel(
    template,
    template ? extractTemplateFields(template) : [],
  )

  return {
    value: row.id as string | number,
    label: useTemplate && template
      ? renderTemplateLabel(template, row)
      : formatUserLabel(row) || String(row.id ?? ''),
  }
}

async function searchAppUserOptions(
  query: string,
  template?: string,
): Promise<Array<{ label: string; value: string | number }>> {
  const search = query.trim()
  const items = await readUsersBridge({
    search: search || null,
    fields: [...USER_OPTION_FIELDS],
    limit: 20,
    sort: ['first_name', 'last_name'],
  })

  return items.map((row) => mapUserOption(row, template))
}

async function fetchAppUserOptionById(
  id: string | number,
  template?: string,
): Promise<{ label: string; value: string | number } | null> {
  const rows = await readUsersBridge({
    ids: [String(id)],
    fields: [...USER_OPTION_FIELDS],
    limit: 1,
  })
  const row = rows[0]
  return row ? mapUserOption(row, template) : null
}

export async function searchRelatedCollectionOptions(
  relatedCollection: string,
  query: string,
  template?: string,
  excludeIds?: Array<string | number> | null,
): Promise<Array<{ label: string; value: string | number }>> {
  const excluded = new Set(
    (excludeIds ?? []).map((id) => String(id)).filter(Boolean),
  )

  function withoutExcluded(
    options: Array<{ label: string; value: string | number }>,
  ): Array<{ label: string; value: string | number }> {
    if (!excluded.size) return options
    return options.filter((option) => !excluded.has(String(option.value)))
  }

  if (isUsersAssetCollection(relatedCollection)) {
    try {
      return withoutExcluded(await searchAppUserOptions(query, template))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(
        `[collectionSchema] Failed to search users: ${message}`,
        error,
      )
      return []
    }
  }

  if (isRolesAssetCollection(relatedCollection)) {
    try {
      const search = query.trim()
      const items = await bridgeReadItems('roles', {
        limit: 20,
        fields: ['id', 'name'],
        ...(search ? { search } : {}),
        ...(excluded.size
          ? { filter: { id: { _nin: [...excluded] } } }
          : {}),
        sort: ['name'],
      })
      return withoutExcluded(
        items.map((row) => ({
          value: row.id as string | number,
          label: String(row.name ?? row.id ?? ''),
        })),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[collectionSchema] Failed to search roles: ${message}`, error)
      return []
    }
  }

  const allFields = await getCachedFields()
  const relatedFields = allFields.filter(
    (f) => f.collection === relatedCollection,
  )
  const resolvedTemplate =
    template?.trim() ||
    (await fetchCollectionDisplayTemplate(relatedCollection)) ||
    undefined
  const templateFields = resolvedTemplate
    ? extractTemplateFields(resolvedTemplate)
    : []
  const displayField = relatedRecordDisplayField(relatedFields)
  // Prefer real template/display scalars for sort — registry may expose formula
  // fields like `name` that Hasura cannot order_by.
  const sortField =
    templateFields.find((field) =>
      relatedFields.some((candidate) => candidate.field === field),
    ) ||
    (relatedFields.some((field) => field.field === displayField)
      ? displayField
      : null) ||
    'id'
  const fields = Array.from(
    new Set(['id', displayField, sortField, ...templateFields].filter(Boolean)),
  )

  try {
    const search = query.trim()
    const excludeFilter = excluded.size
      ? { id: { _nin: [...excluded] } }
      : null
    const items = await bridgeReadItems(relatedCollection, {
      limit: 20,
      fields,
      ...(search ? { search } : {}),
      ...(excludeFilter ? { filter: excludeFilter } : {}),
      sort: [sortField],
    })

    const mapped = items.map((row) => ({
      value: row.id as string | number,
      label: relatedPickerLabel(row, {
        template: resolvedTemplate,
        displayField,
      }),
    }))

    if (!search) return withoutExcluded(mapped)

    const idHits = await bridgeReadItems(relatedCollection, {
      limit: 20,
      fields,
      filter: excludeFilter
        ? {
            _and: [
              excludeFilter,
              {
                _or: [
                  { id: { _eq: search } },
                  { id: { _starts_with: search } },
                ],
              },
            ],
          }
        : {
            _or: [
              { id: { _eq: search } },
              { id: { _starts_with: search } },
            ],
          },
      sort: ['id'],
    }).catch(() => [] as Record<string, unknown>[])

    const byId = new Map<string, { label: string; value: string | number }>()
    const exact = await fetchRelatedCollectionOptionById(
      relatedCollection,
      search,
      resolvedTemplate,
    )
    if (exact) byId.set(String(exact.value), exact)
    for (const row of idHits) {
      const value = row.id as string | number
      byId.set(String(value), {
        value,
        label: relatedPickerLabel(row, {
          template: resolvedTemplate,
          displayField,
        }),
      })
    }
    for (const option of mapped) {
      byId.set(String(option.value), option)
    }

    return withoutExcluded([...byId.values()])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn(
      `[collectionSchema] Failed to search ${relatedCollection}: ${message}`,
      error,
    )
    return []
  }
}

export async function fetchRelatedCollectionOptionById(
  relatedCollection: string,
  id: string | number,
  template?: string,
): Promise<{ label: string; value: string | number } | null> {
  if (isUsersAssetCollection(relatedCollection)) {
    try {
      return await fetchAppUserOptionById(id, template)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(
        `[collectionSchema] Failed to fetch users/${id}: ${message}`,
        error,
      )
      return null
    }
  }

  if (isRolesAssetCollection(relatedCollection)) {
    try {
      const items = await bridgeReadItems('roles', {
        filter: { id: { _eq: id } },
        limit: 1,
        fields: ['id', 'name'],
      })
      const row = items[0]
      if (!row) return null
      return {
        value: row.id as string | number,
        label: String(row.name ?? row.id ?? ''),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[collectionSchema] Failed to fetch roles/${id}: ${message}`, error)
      return null
    }
  }

  const allFields = await getCachedFields()
  const relatedFields = allFields.filter(
    (f) => f.collection === relatedCollection,
  )
  const resolvedTemplate =
    template?.trim() ||
    (await fetchCollectionDisplayTemplate(relatedCollection)) ||
    undefined
  const templateFields = resolvedTemplate ? extractTemplateFields(resolvedTemplate) : []
  const displayField = relatedRecordDisplayField(relatedFields)
  const fields = Array.from(
    new Set([
      'id',
      displayField,
      ...templateFields,
    ]),
  )
  const useTemplate = shouldUseTemplateForRelatedLabel(resolvedTemplate, templateFields)

  try {
    const row = await bridgeReadItem(relatedCollection, id, { fields })

    if (!row) return null

    const label = relatedPickerLabel(row, {
      template: useTemplate ? resolvedTemplate : undefined,
      displayField,
    })

    return {
      value: row.id as string | number,
      label,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn(
      `[collectionSchema] Failed to fetch ${relatedCollection}/${id}: ${message}`,
      error,
    )
    return null
  }
}

export async function fetchFieldDisplayTemplate(
  collection: string,
  field: string,
): Promise<string | undefined> {
  const definition = await getCachedField(collection, field)
  const template = definition.meta?.options?.template

  return typeof template === 'string' && template.trim()
    ? template
    : undefined
}

export async function fetchCollectionDisplayTemplate(
  collection: string,
): Promise<string | undefined> {
  const collections = await getCachedCollections()
  const template = collections.find((item) => item.collection === collection)?.meta?.display_template

  return typeof template === 'string' && template.trim()
    ? template.trim()
    : undefined
}

export async function fetchTranslatedFieldLabel(
  collection: string,
  field: string,
  fallbackLabel: string,
): Promise<string> {
  try {
    const definition = await getCachedField(collection, field)
    return translatedFieldLabel(definition, fallbackLabel)
  } catch {
    return translateLabel(fallbackLabel, [
      `fields.${collection}.${field}`,
      `${collection}.${field}`,
      field,
    ])
  }
}

export async function fetchFieldRuntimeMetadata(
  collection: string,
  field: string,
  component: string,
): Promise<FieldRuntimeMetadata> {
  const definition = await getCachedField(collection, field)
  const props: Record<string, unknown> = {}
  const template = definition.meta?.options?.template

  if (PICKLIST_COMPONENTS.has(component)) {
    const choices = definition.meta?.options?.choices
    if (Array.isArray(choices)) {
      props.optionLabel = 'label'
      props.optionValue = 'value'
      props.placeholder = 'Select...'
      props.options = await Promise.all(
        choices
          .filter((choice) => choice?.value !== undefined)
          .map(async (choice) => ({
            label: await choiceLabel(choice, { collection, field }),
            value: choice.value as unknown,
          })),
      )
    }
  }

  if (component === 'AutoComplete') {
    props.optionLabel = 'label'
    props.placeholder = 'Select...'
    props.dropdown = true
    props.forceSelection = true
  }

  if (component === 'DatePicker') {
    props.dateFormat = datePickerFormat(definition) ?? 'yy-mm-dd'
    props.showIcon = true
    props.showTime =
      definition.type === 'timestamp' || definition.type === 'dateTime'
  }

  if (component === 'Checkbox') {
    props.binary = true
  }

  if (component === 'InputNumber') {
    const options = (definition.meta?.options ?? {}) as Record<string, unknown>
    const iface = String(definition.meta?.interface || '').toLowerCase()
    const suffix = options.suffix ?? options.currency
    const prefix = options.prefix
    const placesRaw = options.decimalPlaces ?? options.minFractionDigits
    const places =
      typeof placesRaw === 'number'
        ? placesRaw
        : typeof placesRaw === 'string' && placesRaw.trim()
          ? Number(placesRaw)
          : NaN

    if (typeof suffix === 'string' && suffix.trim()) {
      props.suffix = suffix.trim()
    }
    if (typeof prefix === 'string' && prefix.trim()) {
      props.prefix = prefix.trim()
    }
    if (Number.isFinite(places)) {
      const n = Math.min(6, Math.max(0, Math.trunc(places)))
      props.minFractionDigits = n
      props.maxFractionDigits = n
    } else if (iface.includes('currency') || definition.type === 'float' || definition.type === 'decimal') {
      props.minFractionDigits = 2
      props.maxFractionDigits = 2
    }
  }

  if (component === 'Editor') {
    props.editorStyle = 'min-height: 200px'
    const softLimit = definition.meta?.options?.softLength
      ?? definition.meta?.options?.softLimit
    if (typeof softLimit === 'number' && softLimit > 0) {
      props.placeholder = `Max ${softLimit} characters (soft limit)`
    }
  }

  const collectionFields = await getCachedCollectionFields(collection)
  const formula =
    resolveFieldFormula(
      definition,
      collectionFields.map((item) => item.field),
    ) ?? undefined

  return {
    required: Boolean(definition.meta?.required),
    readonly: isFieldReadonly(definition),
    formula,
    template: typeof template === 'string' && template.trim()
      ? template
      : undefined,
    props,
  }
}

function datePickerFormat(
  definition: FieldDefinition,
): string | undefined {
  const format = fieldDateDisplayFormat(definition)
  if (!format) return undefined
  const preset = format.toLowerCase()
  if (preset === 'short') return 'm/d/yy'
  if (preset === 'long') return 'MM d, yy'
  return primeVueDatePickerFormat(format)
}

export async function fetchChoiceLabelMap(
  collection: string,
  field: string,
  component = 'Select',
): Promise<Record<string, string>> {
  const metadata = await fetchFieldRuntimeMetadata(collection, field, component)
  const options = metadata.props.options
  if (!Array.isArray(options)) return {}

  return options.reduce<Record<string, string>>((labels, option) => {
    if (!isChoiceOption(option)) return labels
    labels[String(option.value)] = option.label
    return labels
  }, {})
}

export async function fetchDataTableRuntimeMetadata(
  relatedCollection: string,
  parentName?: string,
  parentId?: string | number,
  relatedLimit = 100,
  tableSettings?: DataTableSettings | null,
  relatedOffset = 0,
): Promise<DataTableRuntime> {
  return fetchDataTableRuntime({
    collection: relatedCollection,
    settings: tableSettings,
    limit: relatedLimit,
    offset: relatedOffset,
    parentCollection: parentName,
    parentId,
    defaultColumnLimit: 6,
    previewLimitWithoutParent: 5,
    excludeHiddenFields: false,
    swallowFetchErrors: true,
  })
}

export async function findParentFkField(
  junctionCollection: string,
  parentCollection: string,
): Promise<string | null> {
  const relations = (await getCachedRelations()) as RelationDefinition[]
  const rel = relations.find(
    (r) =>
      (r.meta?.many_collection === junctionCollection || r.collection === junctionCollection) &&
      (r.related_collection === parentCollection || r.meta?.one_collection === parentCollection),
  )
  return rel?.meta?.many_field ?? rel?.field ?? null
}
