import { reactive } from 'vue'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import {
  fileAssetUrl as proxyFileAssetUrl,
  readFilesByIds,
  readRecordFiles,
} from '@/core/graphql/filesProxy'
import { filesSettings } from '@/core/fieldHelpers'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import {
  FILES_ASSET_FIELDS,
  FILES_JUNCTION_FILE_ID_FIELD,
  isFilesAssetCollection,
  isFilesJunctionFileIdField,
} from '@/core/filesField'
import type { LayoutFieldMetadata } from '@/interfaces'

// ── Shared types ─────────────────────────────────────────────────────────────

export interface FilePreviewData {
  id: string
  filename_download?: string
  type?: string
  filesize?: number
  created_on?: string
  uploaded_by?: FileUser
  title?: string | null
  description?: string | null
  tags?: string[] | null
  location?: string | null
  focal_point_x?: number | null
  focal_point_y?: number | null
  width?: number | null
  height?: number | null
}

export interface FileMetadata {
  id?: string
  filename_download?: string
  type?: string
  filesize?: number
  created_on?: string
  uploaded_by?: FileUser
  title?: string | null
  description?: string | null
  tags?: string[] | null
  location?: string | null
  focal_point_x?: number | null
  focal_point_y?: number | null
  width?: number | null
  height?: number | null
}

export interface FileItem {
  id?: string
  file_id?: string | FileMetadata
  filename_download?: string
  type?: string
  filesize?: number
  created_on?: string
  uploaded_by?: FileUser
  /** True when junction points at a file id missing from public.files. */
  __unavailable?: boolean
}

export type FileUser =
  | string
  | {
      id?: string
      first_name?: string | null
      last_name?: string | null
      email?: string | null
    }
  | null

// ── Pure helpers ─────────────────────────────────────────────────────────────

function nestedFileValue(item: FileItem): string | FileMetadata | undefined {
  return item[FILES_JUNCTION_FILE_ID_FIELD]
}

export function fileIsUnavailable(item: FileItem): boolean {
  return item.__unavailable === true
}

export function resolvedFileObj(item: FileItem): FileMetadata {
  const nested = nestedFileValue(item)
  if (nested && typeof nested === 'object') return nested as FileMetadata
  return item as FileMetadata
}

export function fileItemId(item: FileItem): string | undefined {
  const nested = nestedFileValue(item)
  if (nested && typeof nested === 'object') return nested.id
  if (typeof nested === 'string') return nested
  return item.id
}

export function fileItemName(item: FileItem, fallback = 'Attachment'): string {
  if (fileIsUnavailable(item)) return fallback
  const title = resolvedFileObj(item).title?.trim()
  if (title) return title
  const filename = resolvedFileObj(item).filename_download?.trim()
  if (filename) return filename
  return fallback
}

export function fileItemMime(item: FileItem): string {
  return resolvedFileObj(item).type ?? ''
}

export function fileIsImage(item: FileItem): boolean {
  return fileItemMime(item).startsWith('image/')
}

export function fileAssetUrl(id: string): string {
  return proxyFileAssetUrl(id, { width: 120, height: 120, fit: 'cover' })
}

export function fileDownloadUrl(id: string): string {
  if (!id) return '#'
  return proxyFileAssetUrl(id, { download: '1' })
}

export function fileSizeLabel(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileUserLabel(user?: FileUser): string {
  if (!user) return ''
  if (typeof user === 'string') return user

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return name || user.email || user.id || ''
}

export function fileColumnValue(item: FileItem, columnField: string): string {
  const f = resolvedFileObj(item)
  switch (columnField) {
    case 'filename_download': return f.filename_download ?? fileItemId(item) ?? ''
    case 'title':             return f.title ?? ''
    case 'type':              return f.type ?? ''
    case 'filesize':          return fileSizeLabel(f.filesize)
    case 'created_on':        return f.created_on ? formatLocalizedDateTime(f.created_on) : ''
    case 'uploaded_by':       return fileUserLabel(f.uploaded_by)
    case 'description':       return f.description ?? ''
    case 'location':          return f.location ?? ''
    case 'tags':              return Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags ?? '')
    case 'width':             return f.width != null ? String(f.width) : ''
    case 'height':            return f.height != null ? String(f.height) : ''
    case 'focal_point_x':     return f.focal_point_x != null ? String(f.focal_point_x) : ''
    case 'focal_point_y':     return f.focal_point_y != null ? String(f.focal_point_y) : ''
    default:                  return ''
  }
}

export function safeFileDownloadUrl(item: FileItem): string {
  if (fileIsUnavailable(item)) return '#'
  const id = fileItemId(item)
  return id ? fileDownloadUrl(id) : '#'
}

async function hydrateJunctionFileIds(items: FileItem[]): Promise<FileItem[]> {
  const scalarIds = items
    .map((item) => {
      const nested = nestedFileValue(item)
      return typeof nested === 'string' && nested.trim() ? nested.trim() : null
    })
    .filter((id): id is string => Boolean(id))

  if (!scalarIds.length) {
    return items.map((item) => {
      const nested = nestedFileValue(item)
      if (nested && typeof nested === 'object') return { ...item, __unavailable: false }
      return { ...item, __unavailable: true }
    })
  }

  let found = new Map<string, FileMetadata>()
  try {
    const rows = await readFilesByIds(scalarIds, [...FILES_ASSET_FIELDS])
    found = new Map(
      rows
        .map((row) => row as FileMetadata)
        .filter((row) => row.id)
        .map((row) => [String(row.id), row]),
    )
  } catch {
    found = new Map()
  }

  return items.map((item) => {
    const nested = nestedFileValue(item)
    if (nested && typeof nested === 'object') {
      return { ...item, __unavailable: false }
    }
    if (typeof nested === 'string' && nested.trim()) {
      const meta = found.get(nested.trim())
      if (meta) {
        return { ...item, [FILES_JUNCTION_FILE_ID_FIELD]: meta, __unavailable: false }
      }
      return { ...item, __unavailable: true }
    }
    return { ...item, __unavailable: true }
  })
}

export const FILE_COLUMN_HEADER_KEYS: Record<string, [string, string]> = {
  filename_download: ['filePreview.field.filename', 'Name'],
  title:            ['filePreview.field.title', 'Title'],
  type:             ['filePreview.field.type', 'Type'],
  filesize:         ['filePreview.field.size', 'Size'],
  created_on:       ['filePreview.field.uploaded', 'Uploaded'],
  uploaded_by:      ['filePreview.field.uploadedBy', 'Uploaded By'],
  description:      ['filePreview.field.description', 'Description'],
  location:         ['filePreview.field.location', 'Location'],
  tags:             ['filePreview.field.tags', 'Tags'],
  width:            ['filePreview.field.width', 'Width'],
  height:           ['filePreview.field.height', 'Height'],
  focal_point_x:    ['filePreview.field.focalPointX', 'Focal Point X'],
  focal_point_y:    ['filePreview.field.focalPointY', 'Focal Point Y'],
}

export function fileColumnHeader(
  fieldName: string,
  fallback: string,
  t: (key: string, fallback?: string) => string,
): string {
  const entry = FILE_COLUMN_HEADER_KEYS[fieldName]
  return entry ? t(entry[0], entry[1]) : fallback
}

const LEGACY_FILE_LIST_COLUMNS = ['type', 'filesize', 'created_on', 'uploaded_by'] as const

function isLegacyFileListColumns(columns: Array<{ field: string }>): boolean {
  return (
    columns.length === LEGACY_FILE_LIST_COLUMNS.length &&
    columns.every((column, index) => column.field === LEGACY_FILE_LIST_COLUMNS[index])
  )
}

export function fileColumns(
  field: LayoutFieldMetadata,
  t: (key: string, fallback?: string) => string,
): Array<{ field: string; header: string }> {
  const configured = (filesSettings(field)?.columns ?? []).filter(
    (c) => c.field !== 'filename_download',
  )
  // Title is rendered as a dedicated link column in AttachedDataTableField.
  const defaults = [
    { field: 'description', header: t('filePreview.field.description', 'Description') },
    { field: 'filesize', header: t('filePreview.field.size', 'Size') },
    { field: 'created_on', header: t('filePreview.field.uploaded', 'Uploaded') },
  ]
  if (!configured.length || isLegacyFileListColumns(configured)) return defaults
  return configured
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useFiles() {
  const cache = reactive<Record<string, FileItem[]>>({})
  const inFlight = new Set<string>()

  async function load(
    fieldKey: string,
    relatedCollection: string,
    raw: unknown,
  ): Promise<void> {
    if (raw === null || raw === undefined) {
      cache[fieldKey] = []
      return
    }

    const items = Array.isArray(raw) ? (raw as unknown[]) : [raw]

    const firstItem = items[0]
    if (
      items.length > 0 &&
      typeof firstItem === 'object' &&
      firstItem !== null &&
      (Object.keys(firstItem as object).some(isFilesJunctionFileIdField) ||
        'filename_download' in (firstItem as object) ||
        'title' in (firstItem as object))
    ) {
      const junctionRows = items as FileItem[]
      const needsHydrate = junctionRows.some((item) => {
        const nested = nestedFileValue(item)
        return typeof nested === 'string' || fileIsUnavailable(item)
      })
      if (!needsHydrate) {
        cache[fieldKey] = junctionRows
        return
      }

      const inflightKey = `${fieldKey}:junction:${junctionRows
        .map((item) => fileItemId(item) ?? '')
        .join(',')}`
      if (inFlight.has(inflightKey)) return
      inFlight.add(inflightKey)
      try {
        cache[fieldKey] = await hydrateJunctionFileIds(junctionRows)
      } finally {
        inFlight.delete(inflightKey)
      }
      return
    }

    const ids = items
      .map((item) => {
        if (typeof item === 'number' || typeof item === 'string') return item
        if (typeof item === 'object' && item !== null && 'id' in item) {
          const id = (item as { id?: string | number }).id
          if (id !== undefined && id !== null && id !== '') return id
        }
        return null
      })
      .filter((id): id is number | string => id !== null && id !== undefined)

    if (!ids.length) {
      cache[fieldKey] = []
      return
    }

    const inflightKey = `${fieldKey}:${ids.join(',')}`
    if (inFlight.has(inflightKey)) return
    inFlight.add(inflightKey)

    try {
      if (isFilesAssetCollection(relatedCollection)) {
        const result = await readFilesByIds(
          ids.map(String),
          [...FILES_ASSET_FIELDS],
        )
        cache[fieldKey] = result.map((item) => item as FileItem)
        return
      }

      const fetchFields = [
        'id',
        `${FILES_JUNCTION_FILE_ID_FIELD}.*`,
        `${FILES_JUNCTION_FILE_ID_FIELD}.uploaded_by.*`,
      ]

      const result = await bridgeReadItems(relatedCollection, {
        filter: { id: { _in: ids } },
        fields: fetchFields,
        limit: -1,
      })
      cache[fieldKey] = result.map((item) => item as FileItem)
    } catch {
      cache[fieldKey] = ids.map((id) => ({ id: String(id) }))
    } finally {
      inFlight.delete(inflightKey)
    }
  }

  async function loadByParent(
    fieldKey: string,
    relatedCollection: string,
    parentFk: string,
    parentId: string | number,
  ): Promise<void> {
    const inflightKey = `${fieldKey}:parent:${relatedCollection}:${parentFk}:${parentId}`
    if (inFlight.has(inflightKey)) return
    inFlight.add(inflightKey)
    try {
      const result = await bridgeReadItems(relatedCollection, {
        filter: { [parentFk]: { _eq: parentId } },
        fields: [
          'id',
          `${FILES_JUNCTION_FILE_ID_FIELD}.*`,
          `${FILES_JUNCTION_FILE_ID_FIELD}.uploaded_by.*`,
        ],
        limit: -1,
      })
      cache[fieldKey] = await hydrateJunctionFileIds(result as FileItem[])
    } catch {
      cache[fieldKey] = []
    } finally {
      inFlight.delete(inflightKey)
    }
  }

  async function loadForRecord(
    fieldKey: string,
    collection: string,
    recordId: string | number,
  ): Promise<void> {
    const inflightKey = `${fieldKey}:record:${collection}:${recordId}`
    if (inFlight.has(inflightKey)) return
    inFlight.add(inflightKey)
    try {
      const rows = await readRecordFiles(collection, recordId, [...FILES_ASSET_FIELDS])
      cache[fieldKey] = rows.map((item) => item as FileItem)
    } catch {
      cache[fieldKey] = []
    } finally {
      inFlight.delete(inflightKey)
    }
  }

  function getFiles(fieldKey: string): FileItem[] {
    return cache[fieldKey] ?? []
  }

  function setFiles(fieldKey: string, items: FileItem[]): void {
    cache[fieldKey] = items
  }

  function clearAll(): void {
    for (const key of Object.keys(cache)) {
      delete cache[key]
    }
    inFlight.clear()
  }

  return { cache, load, loadByParent, loadForRecord, getFiles, setFiles, clearAll }
}
