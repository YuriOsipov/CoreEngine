import type { RelationDefinition, LayoutFieldMetadata } from '@/interfaces'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { filesSettings } from '@/core/fieldHelpers'
import { getCachedRelations } from '@/modules/entities/services/collectionSchema'

/**
 * Junction FK column / payload key pointing at a file row (`visit_files.file_id`).
 */
export const FILES_JUNCTION_FILE_ID_FIELD = 'file_id' as const

/** Registry / GraphQL collection name for file assets. */
export const FILES_ASSET_COLLECTION = 'files' as const

const SINGLE_FILE_FETCH_SUFFIXES = [
  'filename_download',
  'type',
  'filesize',
  'created_on',
  'title',
  'description',
  'width',
  'height',
  'focal_point_x',
  'focal_point_y',
  'tags',
  'location',
] as const

export const FILES_ASSET_FIELDS = [
  'id',
  ...SINGLE_FILE_FETCH_SUFFIXES,
  'uploaded_by.id',
  'uploaded_by.first_name',
  'uploaded_by.last_name',
  'uploaded_by.email',
] as const

export function isFilesJunctionFileIdField(field: string): boolean {
  return field === FILES_JUNCTION_FILE_ID_FIELD
}

/** Link-shaped O2M rows for parent create (file_id only). */
export function filesItemsToO2MPayload(
  items: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const item of items) {
    const nested = item[FILES_JUNCTION_FILE_ID_FIELD]
    const fileId =
      nested != null && typeof nested === 'object'
        ? (nested as { id?: unknown }).id
        : nested != null && nested !== ''
          ? nested
          : item.id
    if (fileId == null || fileId === '') continue
    // Skip unavailable placeholder rows without a real file asset.
    if (
      nested != null &&
      typeof nested === 'object' &&
      (nested as { unavailable?: unknown }).unavailable === true
    ) {
      continue
    }
    const row: Record<string, unknown> = {
      [FILES_JUNCTION_FILE_ID_FIELD]: { id: String(fileId) },
    }
    if (
      item.id != null &&
      item.id !== '' &&
      !(typeof item.id === 'string' && item.id.startsWith('temp-'))
    ) {
      row.id = item.id
    }
    rows.push(row)
  }
  return rows
}

export function isFilesAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === FILES_ASSET_COLLECTION
}

export function appendFileRequestFields(
  requestFields: Set<string>,
  layoutField: LayoutFieldMetadata,
): void {
  const base = layoutField.field

  if (filesSettings(layoutField)?.multiple) {
    requestFields.add(`${base}.id`)
    requestFields.add(`${base}.${FILES_JUNCTION_FILE_ID_FIELD}.*`)
    requestFields.add(`${base}.${FILES_JUNCTION_FILE_ID_FIELD}.uploaded_by.*`)
    return
  }

  requestFields.add(`${base}.id`)
  for (const suffix of SINGLE_FILE_FETCH_SUFFIXES) {
    requestFields.add(`${base}.${suffix}`)
  }
  requestFields.add(`${base}.uploaded_by.*`)
}

export function resolveFilesRelatedCollectionFromRelations(
  entityCollection: string,
  field: LayoutFieldMetadata,
  relations: RelationDefinition[],
): string {
  if (field.relatedCollection?.trim()) {
    return field.relatedCollection
  }

  const fromFieldRelation = relatedCollectionForCollectionField(
    relations,
    entityCollection,
    field.field,
  )
  if (fromFieldRelation) return fromFieldRelation

  if (filesSettings(field)?.multiple) {
    const junctionRelation = relations.find(
      (relation) =>
        relation.meta?.one_collection === entityCollection &&
        relation.meta?.one_field === field.field,
    )
    return (
      junctionRelation?.meta?.many_collection ??
      junctionRelation?.collection ??
      ''
    )
  }

  return FILES_ASSET_COLLECTION
}

export async function resolveFilesRelatedCollection(
  entityCollection: string,
  field: LayoutFieldMetadata,
): Promise<string> {
  const relations = (await getCachedRelations()) as RelationDefinition[]
  return resolveFilesRelatedCollectionFromRelations(
    entityCollection,
    field,
    relations,
  )
}
