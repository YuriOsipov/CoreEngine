import { randomUUID } from 'node:crypto'
import {
  postgresFindFileRow,
  postgresFindFileRows,
  postgresListFilesByParent,
  postgresSoftDeleteFile,
  postgresUpdateFileMeta,
  postgresUpsertFile,
  toFileAssetShape,
} from './postgresFiles.js'
import {
  isSupabaseStorageConfigured,
  storageDownload,
  storageUpload,
} from '../files/supabaseStorage.js'
import { enrichHtmlAssetBuffer } from '../files/htmlAssetEnrichment.js'
import { listUsers } from './usersAdapter.js'

function useSupabaseUploads(): boolean {
  const force = (process.env.FILES_BACKEND || '').trim().toUpperCase()
  if (force === 'DIRECTUS') {
    throw new Error(
      'FILES_BACKEND=directus was retired. Configure Supabase Storage (FILES_BACKEND=supabase).',
    )
  }
  if (force === 'SUPABASE' || force === 'POSTGRES' || force === 'STORAGE' || !force) {
    return isSupabaseStorageConfigured()
  }
  return isSupabaseStorageConfigured()
}

function requireSupabaseFiles(purpose: string): void {
  if (useSupabaseUploads() && isSupabaseStorageConfigured()) return
  throw new Error(
    `Files backend refused (${purpose}): configure Supabase Storage or set FILES_BACKEND=supabase.`,
  )
}

function safeFilename(name: string | undefined): string {
  const base = (name || 'upload.bin').replace(/[/\\]/g, '_').trim() || 'upload.bin'
  return base.slice(0, 180)
}

function isGenericBinaryType(value: string | null | undefined): boolean {
  const type = String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return !type || type === 'application/octet-stream' || type === 'binary/octet-stream'
}

/** Resolve a browser-safe Content-Type for /assets responses. */
export function resolveAssetContentType(input: {
  mimeType?: string | null
  storageContentType?: string | null
  filename?: string | null
  buffer?: Buffer | null
}): string {
  const filename = String(input.filename || '').toLowerCase()
  const registryType = String(input.mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const storageType = String(input.storageContentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()

  if (filename.endsWith('.html') || filename.endsWith('.htm') || registryType === 'text/html') {
    return 'text/html; charset=utf-8'
  }
  if (filename.endsWith('.pdf') || registryType === 'application/pdf') {
    return 'application/pdf'
  }
  if (filename.endsWith('.svg') || registryType === 'image/svg+xml') {
    return 'image/svg+xml'
  }
  if (filename.endsWith('.json') || registryType === 'application/json') {
    return 'application/json; charset=utf-8'
  }
  if (filename.endsWith('.txt') || registryType === 'text/plain') {
    return 'text/plain; charset=utf-8'
  }

  if (registryType && !isGenericBinaryType(registryType)) {
    return input.mimeType!.includes('charset') || !registryType.startsWith('text/')
      ? String(input.mimeType)
      : `${registryType}; charset=utf-8`
  }

  if (storageType && !isGenericBinaryType(storageType)) {
    return input.storageContentType!.includes('charset') || !storageType.startsWith('text/')
      ? String(input.storageContentType)
      : `${storageType}; charset=utf-8`
  }

  const head = input.buffer
    ? input.buffer.subarray(0, 64).toString('utf8').trimStart().toLowerCase()
    : ''
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return 'text/html; charset=utf-8'
  }

  return 'application/octet-stream'
}

function wantsUploadedByExpand(fields?: string[] | null): boolean {
  if (!fields?.length || fields.includes('*')) return true
  return fields.some(
    (field) => field === 'uploaded_by' || field.startsWith('uploaded_by.'),
  )
}

async function expandUploadedBy(
  records: Record<string, unknown>[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  if (!records.length || !wantsUploadedByExpand(fields)) return records

  const ids = [
    ...new Set(
      records
        .map((row) => {
          const value = row.uploaded_by
          if (value == null || value === '') return null
          if (typeof value === 'object') {
            const id = (value as { id?: unknown }).id
            return id == null ? null : String(id)
          }
          return String(value)
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  if (!ids.length) return records

  const users = await listUsers({
    ids,
    fields: ['id', 'first_name', 'last_name', 'email'],
    limit: ids.length,
  })
  const byId = new Map(
    users
      .map((user) => {
        const id = user.id == null ? null : String(user.id)
        return id ? ([id, user] as const) : null
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry)),
  )

  return records.map((row) => {
    const raw = row.uploaded_by
    const id =
      raw == null || raw === ''
        ? null
        : typeof raw === 'object'
          ? ((raw as { id?: unknown }).id == null ? null : String((raw as { id: unknown }).id))
          : String(raw)
    if (!id) return row
    const user = byId.get(id)
    return {
      ...row,
      uploaded_by: user
        ? {
            id: user.id,
            first_name: user.first_name ?? null,
            last_name: user.last_name ?? null,
            email: user.email ?? null,
          }
        : id,
    }
  })
}

function projectFields(
  record: Record<string, unknown>,
  fields?: string[] | null,
): Record<string, unknown> {
  if (!fields?.length || fields.includes('*')) return record
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const base = field.split(/[.:(]/)[0] ?? field
    if (base in record) out[base] = record[base]
  }
  if (!('id' in out) && 'id' in record) out.id = record.id
  return out
}

export async function uploadFileBuffer(input: {
  filename?: string | null
  mimeType?: string | null
  buffer: Buffer
  title?: string | null
  uploadedBy?: string | null
  parentCollection?: string | null
  parentRecordId?: string | null
}): Promise<Record<string, unknown>> {
  requireSupabaseFiles('upload')
  const filename = safeFilename(input.filename ?? undefined)
  const mimeType = input.mimeType || 'application/octet-stream'
  const id = randomUUID()
  const storagePath = `${id}/${filename}`
  await storageUpload({
    path: storagePath,
    buffer: input.buffer,
    mimeType,
  })
  const row = await postgresUpsertFile({
    id,
    backendTarget: 'SUPABASE',
    backendFileId: id,
    filename,
    mimeType,
    filesize: input.buffer.length,
    title: input.title ?? filename,
    uploadedBy: input.uploadedBy ?? null,
    meta: { storage_path: storagePath },
    parentCollection: input.parentCollection ?? null,
    parentRecordId: input.parentRecordId ?? null,
  })
  const [shaped] = await expandUploadedBy([toFileAssetShape(row, id)], [
    'id',
    'uploaded_by.id',
    'uploaded_by.first_name',
    'uploaded_by.last_name',
    'uploaded_by.email',
  ])
  return shaped ?? toFileAssetShape(row, id)
}

export async function updateFileRecord(
  id: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await postgresFindFileRow(id)
  if (!row) throw new Error(`File not found: ${id}`)
  const updated = await postgresUpdateFileMeta(id, payload)
  if (!updated) throw new Error(`File not found: ${id}`)
  const [shaped] = await expandUploadedBy([toFileAssetShape(updated, id)], ['*'])
  return shaped ?? toFileAssetShape(updated, id)
}

export async function findFile(
  id: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const row = await postgresFindFileRow(id)
  if (!row) throw new Error(`File not found: ${id}`)
  const [shaped] = await expandUploadedBy([toFileAssetShape(row, id)], fields)
  return projectFields(shaped ?? toFileAssetShape(row, id), fields)
}

export async function findFiles(
  ids: string[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(ids.map(String).filter(Boolean))]
  if (!unique.length) return []

  const pgRows = await postgresFindFileRows(unique)
  const shaped: Record<string, unknown>[] = []
  for (const requested of unique) {
    const match = pgRows.find(
      (row) => row.id === requested || row.backend_file_id === requested,
    )
    if (!match) continue
    shaped.push(toFileAssetShape(match, requested))
  }
  const expanded = await expandUploadedBy(shaped, fields)
  return expanded.map((row) => projectFields(row, fields))
}

export async function listRecordFiles(
  collection: string,
  recordId: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  const rows = await postgresListFilesByParent(collection, recordId)
  const shaped = rows.map((row) => toFileAssetShape(row))
  const expanded = await expandUploadedBy(shaped, fields)
  return expanded.map((row) => projectFields(row, fields))
}

export async function deleteFileRecord(id: string): Promise<boolean> {
  return postgresSoftDeleteFile(id)
}

export async function loadAsset(
  id: string,
  _search?: string,
): Promise<{
  buffer: Buffer
  contentType: string | null
  filename: string | null
} | null> {
  const row = await postgresFindFileRow(id)
  if (!row || row.backend_target !== 'SUPABASE') return null
  const path =
    typeof row.meta?.storage_path === 'string'
      ? row.meta.storage_path
      : `${row.backend_file_id}/${row.filename || 'file'}`
  const downloaded = await storageDownload(path)
  if (!downloaded) return null
  const contentType = resolveAssetContentType({
    mimeType: row.mime_type,
    storageContentType: downloaded.contentType,
    filename: row.filename,
    buffer: downloaded.buffer,
  })
  return {
    buffer: enrichHtmlAssetBuffer(downloaded.buffer, contentType),
    contentType,
    filename: row.filename,
  }
}
