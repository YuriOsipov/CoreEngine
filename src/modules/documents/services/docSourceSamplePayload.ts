import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { keysEqual } from '@/core/utils/object'
import { FILES_ASSET_COLLECTION } from '@/core/filesField'
import { isUsersAssetCollection } from '@/core/usersField'
import type { RelationDefinition } from '@/interfaces'
import {
  getCachedCollectionFields,
  getCachedRelations,
  listParentRelatedCollections,
} from '@/modules/entities/services/collectionSchema'
import { normalizeSpecial } from '@/modules/entities/utils/fieldMapper'

/** Default relation depth for Doc Designer field-mapping source samples. */
export const DOC_SOURCE_SAMPLE_MAX_DEPTH = 5

const SKIP_FIELDS = new Set([
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
])

interface BuildCollectionSampleOptions {
  maxDepth: number
  /** Full depth budget reset for each related-collection branch. */
  branchMaxDepth: number
  visited: Set<string>
  /** Ancestor collections whose back-references are omitted in nested related samples. */
  excludeRelatedCollections?: Set<string>
}

function extendExcludedCollections(
  options: BuildCollectionSampleOptions,
  ...collections: string[]
): Set<string> {
  const exclude = new Set(options.excludeRelatedCollections ?? [])
  for (const name of collections) {
    if (name) exclude.add(name)
  }
  return exclude
}

function isExcludedRelatedCollection(
  relatedCollection: string,
  excludeRelatedCollections: Set<string> | undefined,
): boolean {
  if (!relatedCollection || !excludeRelatedCollections?.size) return false
  for (const excluded of excludeRelatedCollections) {
    if (keysEqual(relatedCollection, excluded)) return true
  }
  return false
}

function isAncestorForeignKeyField(
  fieldName: string,
  excludeRelatedCollections: Set<string> | undefined,
  relations: RelationDefinition[],
  collection: string,
): boolean {
  if (!excludeRelatedCollections?.size) return false

  for (const excluded of excludeRelatedCollections) {
    const relatedCollection = relatedCollectionForCollectionField(
      relations,
      collection,
      fieldName,
    )
    if (relatedCollection && keysEqual(relatedCollection, excluded)) {
      return true
    }
    if (keysEqual(fieldName, excluded)) return true
    if (keysEqual(fieldName, `${excluded}_id`)) return true
  }

  return false
}

function systemCollectionSample(collection: string): Record<string, unknown> | null {
  if (isUsersAssetCollection(collection)) {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      first_name: 'Sample',
      last_name: 'User',
      email: 'sample@example.com',
    }
  }

  if (keysEqual(collection, FILES_ASSET_COLLECTION)) {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      title: 'sample_file.pdf',
      filename_download: 'sample_file.pdf',
      type: 'application/pdf',
    }
  }

  return null
}

function childSampleOptions(
  options: BuildCollectionSampleOptions,
  parentCollection: string,
): BuildCollectionSampleOptions {
  return {
    maxDepth: options.branchMaxDepth,
    branchMaxDepth: options.branchMaxDepth,
    visited: new Set(options.visited),
    excludeRelatedCollections: extendExcludedCollections(options, parentCollection),
  }
}

function scalarSample(type: string, fieldName: string): unknown {
  switch (type) {
    case 'integer':
    case 'bigInteger':
    case 'float':
    case 'decimal':
      return 1
    case 'boolean':
      return true
    case 'date':
      return '2026-01-01'
    case 'dateTime':
    case 'timestamp':
      return '2026-01-01T12:00:00'
    case 'time':
      return '12:00:00'
    case 'json':
      return {}
    case 'uuid':
      return '00000000-0000-0000-0000-000000000001'
    default:
      return `sample_${fieldName}`
  }
}

function isO2MField(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): boolean {
  return relations.some(
    (relation) =>
      keysEqual(relation.meta?.one_collection ?? '', collection) &&
      keysEqual(relation.meta?.one_field ?? '', fieldName),
  )
}

function findO2MChildCollection(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): string | null {
  const relation = relations.find(
    (item) =>
      keysEqual(item.meta?.one_collection ?? '', collection) &&
      keysEqual(item.meta?.one_field ?? '', fieldName),
  )
  return relation?.meta?.many_collection ?? relation?.collection ?? null
}

async function buildRelatedCollectionSample(
  relatedCollection: string,
  currentCollection: string,
  options: BuildCollectionSampleOptions,
): Promise<Record<string, unknown>> {
  const systemSample = systemCollectionSample(relatedCollection)
  if (systemSample) return systemSample

  if (options.maxDepth <= 0) {
    return { id: 1 }
  }

  return buildCollectionSample(relatedCollection, {
    maxDepth: options.maxDepth - 1,
    branchMaxDepth: options.branchMaxDepth,
    visited: new Set(options.visited),
    excludeRelatedCollections: extendExcludedCollections(options, currentCollection),
  })
}

async function buildCollectionSample(
  collection: string,
  options: BuildCollectionSampleOptions,
): Promise<Record<string, unknown>> {
  const systemSample = systemCollectionSample(collection)
  if (systemSample) return systemSample

  if (options.visited.has(collection) || options.maxDepth < 0) {
    return { id: 1 }
  }

  options.visited.add(collection)

  const [fields, allRelations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])

  const payload: Record<string, unknown> = {}

  if (fields.some((field) => field.field === 'id')) {
    payload.id = 1
  }

  for (const field of fields) {
    if (field.field === 'id') continue
    if (SKIP_FIELDS.has(field.field)) continue
    if (field.meta?.hidden) continue
    if (
      isAncestorForeignKeyField(
        field.field,
        options.excludeRelatedCollections,
        allRelations,
        collection,
      )
    ) {
      continue
    }

    const special = normalizeSpecial(field.meta?.special)

    if (special.includes('o2m') || (field.type === 'alias' && isO2MField(collection, field.field, allRelations))) {
      const childCollection = findO2MChildCollection(collection, field.field, allRelations)
      if (
        !childCollection ||
        isExcludedRelatedCollection(childCollection, options.excludeRelatedCollections)
      ) {
        continue
      }

      if (options.maxDepth > 0) {
        const childSample = await buildCollectionSample(
          childCollection,
          childSampleOptions(options, collection),
        )
        payload[field.field] = [childSample]
      } else {
        payload[field.field] = []
      }
      continue
    }

    if (special.includes('m2m') || special.includes('m2a') || special.includes('files')) {
      const junctionCollection = findO2MChildCollection(collection, field.field, allRelations)
      if (
        !junctionCollection ||
        isExcludedRelatedCollection(junctionCollection, options.excludeRelatedCollections)
      ) {
        continue
      }

      if (options.maxDepth > 0) {
        const junctionSample = await buildCollectionSample(
          junctionCollection,
          childSampleOptions(options, collection),
        )
        payload[field.field] = [junctionSample]
      } else {
        payload[field.field] = []
      }
      continue
    }

    const relatedCollection = relatedCollectionForCollectionField(
      allRelations,
      collection,
      field.field,
    )

    if (special.includes('m2o') || relatedCollection) {
      if (
        relatedCollection &&
        isExcludedRelatedCollection(relatedCollection, options.excludeRelatedCollections)
      ) {
        continue
      }

      if (relatedCollection) {
        payload[field.field] = await buildRelatedCollectionSample(
          relatedCollection,
          collection,
          options,
        )
      } else {
        payload[field.field] = 1
      }
      continue
    }

    if (field.type === 'alias') continue

    payload[field.field] = scalarSample(field.type, field.field)
  }

  options.visited.delete(collection)
  return payload
}

async function appendRelatedCollectionSamples(
  collection: string,
  payload: Record<string, unknown>,
  options: BuildCollectionSampleOptions,
): Promise<void> {
  const related = await listParentRelatedCollections(collection)

  for (const entry of related) {
    if (Object.prototype.hasOwnProperty.call(payload, entry.relationKey)) continue

    if (options.maxDepth > 0) {
      const childSample = await buildCollectionSample(
        entry.relatedCollection,
        childSampleOptions(options, collection),
      )
      payload[entry.relationKey] = [childSample]
    } else {
      payload[entry.relationKey] = []
    }
  }
}

/** Adds missing related-collection arrays using the page layout designer relation keys. */
export async function ensureDocSourceRelatedCollections(
  collection: string,
  payload: Record<string, unknown>,
  options: { maxDepth?: number } = {},
): Promise<Record<string, unknown>> {
  const maxDepth = options.maxDepth ?? DOC_SOURCE_SAMPLE_MAX_DEPTH
  await appendRelatedCollectionSamples(collection, payload, {
    maxDepth,
    branchMaxDepth: maxDepth,
    visited: new Set([collection]),
  })
  return payload
}

/** Builds a nested sample object shaped like a CRM record for DocEngine field mapping. */
export async function buildDocSourceSamplePayload(
  collection: string,
  options: {
    maxDepth?: number
    /** Omit these related collections (e.g. child when sampling a parent). */
    excludeRelatedCollections?: string[]
  } = {},
): Promise<Record<string, unknown>> {
  const maxDepth = options.maxDepth ?? DOC_SOURCE_SAMPLE_MAX_DEPTH
  const visited = new Set<string>()
  const excludeRelatedCollections = options.excludeRelatedCollections?.length
    ? new Set(options.excludeRelatedCollections.filter(Boolean))
    : undefined
  const sampleOptions: BuildCollectionSampleOptions = {
    maxDepth,
    branchMaxDepth: maxDepth,
    visited,
    excludeRelatedCollections,
  }
  const payload = await buildCollectionSample(collection, sampleOptions)
  await appendRelatedCollectionSamples(collection, payload, sampleOptions)
  return payload
}
