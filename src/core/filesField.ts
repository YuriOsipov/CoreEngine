import type {
  RelationDefinition,
  LayoutFieldMetadata,
  FieldDefinition,
  ImagePreviewSize,
  FilesSettings,
} from '@/interfaces'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { filesSettings } from '@/core/fieldHelpers'
import { getCachedRelations } from '@/modules/entities/services/collectionSchema'

/** Read Setup-owned `meta.options.files` from a field definition. */
export function filesOptionsFromDefinition(
  definition: FieldDefinition | null | undefined,
): Partial<FilesSettings> | null {
  const options = definition?.meta?.options
  if (!options || typeof options !== 'object') return null
  const files = (options as Record<string, unknown>).files
  if (!files || typeof files !== 'object') return null
  return files as Partial<FilesSettings>
}

/**
 * Upload constraints for a Files / Image layout field.
 * Image (single-file) fields use org General settings first; multi-file
 * Attachments still use layout / field meta.
 */
export async function resolveFilesUploadConstraints(
  layoutField: LayoutFieldMetadata,
  definition?: FieldDefinition | null,
): Promise<{ allowedMimeTypes: string[]; maxFileSizeMb: number | null }> {
  const fromLayout = filesSettings(layoutField)
  const isImage =
    fromLayout?.multiple !== true &&
    !String(layoutField.field || '').startsWith('files:')

  if (isImage) {
    const { loadOrgFilesUploadSettings } = await import('@/core/orgFilesSettings')
    const org = await loadOrgFilesUploadSettings()
    return {
      allowedMimeTypes: org.allowedMimeTypes.length
        ? org.allowedMimeTypes
        : ['image/'],
      maxFileSizeMb: org.maxFileSizeMb,
    }
  }

  const fromDef = filesOptionsFromDefinition(definition)
  const mimeFromDef = Array.isArray(fromDef?.allowedMimeTypes)
    ? fromDef!.allowedMimeTypes!.map((v) => String(v || '').trim()).filter(Boolean)
    : []
  const mimeFromLayout = fromLayout?.allowedMimeTypes ?? []
  const allowedMimeTypes = mimeFromDef.length ? mimeFromDef : mimeFromLayout

  const sizeFromDef = fromDef?.maxFileSizeMb
  const sizeFromLayout = fromLayout?.maxFileSizeMb
  const rawSize =
    typeof sizeFromDef === 'number' && sizeFromDef > 0
      ? sizeFromDef
      : typeof sizeFromLayout === 'number' && sizeFromLayout > 0
        ? sizeFromLayout
        : null

  return {
    allowedMimeTypes,
    maxFileSizeMb: rawSize,
  }
}

export function resolveImagePreviewSize(
  layoutField: LayoutFieldMetadata,
): ImagePreviewSize {
  const value = filesSettings(layoutField)?.previewSize
  if (value === 'sm' || value === 'md' || value === 'lg' || value === 'fill') {
    return value
  }
  return 'md'
}

export function imagePreviewPixelSize(size: ImagePreviewSize): number {
  switch (size) {
    case 'sm':
      return 96
    case 'lg':
      return 384
    case 'fill':
      return 640
    case 'md':
    default:
      return 256
  }
}

/**
 * Junction FK column / payload key pointing at a file row (`visit_files.file_id`).
 */
export const FILES_JUNCTION_FILE_ID_FIELD = 'file_id' as const

/** Registry / GraphQL collection name for file assets. */
export const FILES_ASSET_COLLECTION = 'files' as const

/** HTML5 DnD MIME for dragging an already-attached CoreEngine file asset. */
export const COREENGINE_FILE_DRAG_MIME = 'application/x-coreengine-file-asset' as const
/** @deprecated Prefer COREENGINE_FILE_DRAG_MIME; kept for in-flight drag payloads. */
const LEGACY_HELIX_FILE_DRAG_MIME = 'application/x-helix-file-asset' as const

export type CoreEngineFileDragPayload = {
  id: string
  filename_download?: string
  type?: string
  filesize?: number | null
  title?: string | null
  created_on?: string | null
  uploaded_by?: unknown
  width?: number | null
  height?: number | null
}

export function writeCoreEngineFileDragData(
  dataTransfer: DataTransfer | null | undefined,
  payload: CoreEngineFileDragPayload,
): void {
  if (!dataTransfer || !payload.id) return
  const json = JSON.stringify(payload)
  dataTransfer.setData(COREENGINE_FILE_DRAG_MIME, json)
  dataTransfer.setData('text/plain', payload.id)
  dataTransfer.effectAllowed = 'copy'
}

export function readCoreEngineFileDragData(
  dataTransfer: DataTransfer | null | undefined,
): CoreEngineFileDragPayload | null {
  if (!dataTransfer) return null
  const raw =
    dataTransfer.getData(COREENGINE_FILE_DRAG_MIME) ||
    dataTransfer.getData(LEGACY_HELIX_FILE_DRAG_MIME) ||
    // Some browsers only expose custom types after drop; text/plain is the id fallback.
    ''
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CoreEngineFileDragPayload
    const id = parsed?.id == null ? '' : String(parsed.id)
    if (!id) return null
    return { ...parsed, id }
  } catch {
    return null
  }
}

export function dataTransferHasCoreEngineFile(
  dataTransfer: DataTransfer | null | undefined,
): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types || [])
  return (
    types.includes(COREENGINE_FILE_DRAG_MIME) ||
    types.includes(LEGACY_HELIX_FILE_DRAG_MIME)
  )
}

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
/** Extract file UUID for a single-file (Image) M2O write. */
export function singleFileM2OPayload(
  raw: unknown,
): { id: string } | null {
  const items = Array.isArray(raw)
    ? raw
    : raw !== null && raw !== undefined && raw !== ''
      ? [raw]
      : []
  const first = items[0]
  if (first === null || first === undefined || first === '') return null
  if (typeof first === 'string' || typeof first === 'number') {
    const id = String(first).trim()
    return id ? { id } : null
  }
  if (typeof first !== 'object') return null
  const row = first as Record<string, unknown>
  const nested = row[FILES_JUNCTION_FILE_ID_FIELD]
  if (nested && typeof nested === 'object') {
    const nestedId = (nested as { id?: unknown }).id
    if (nestedId !== null && nestedId !== undefined && nestedId !== '') {
      return { id: String(nestedId) }
    }
  }
  if (typeof nested === 'string' || typeof nested === 'number') {
    const id = String(nested).trim()
    if (id) return { id }
  }
  if (row.id !== null && row.id !== undefined && row.id !== '') {
    return { id: String(row.id) }
  }
  return null
}

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

  // Single-file Image M2O: request the related file id. Preview metadata is
  // hydrated via /files (readFilesByIds) in AttachedDataTableField — avoid
  // Directus-era nested suffixes that can break GraphQL item reads.
  requestFields.add(`${base}.id`)
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
