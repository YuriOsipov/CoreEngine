import { query } from '../db/pool.js'

export interface RegistryFileRow {
  id: string
  backend_target: string
  backend_file_id: string
  filename: string | null
  mime_type: string | null
  filesize: string | number | null
  title: string | null
  uploaded_by: string | null
  created_at: string
  meta: Record<string, unknown> | null
  parent_collection: string | null
  parent_record_id: string | null
}

const FILE_ROW_SELECT = `id::text AS id, backend_target, backend_file_id, filename, mime_type,
            filesize, title, uploaded_by::text AS uploaded_by, created_at::text AS created_at, meta,
            parent_collection, parent_record_id`

export function toFileAssetShape(
  row: RegistryFileRow,
  requestedId?: string,
): Record<string, unknown> {
  const id =
    requestedId &&
    (requestedId === row.id || requestedId === row.backend_file_id)
      ? requestedId
      : row.backend_file_id || row.id
  const filesize =
    row.filesize == null || row.filesize === ''
      ? null
      : Number(row.filesize)
  const meta = row.meta && typeof row.meta === 'object' ? { ...row.meta } : {}
  // Columns win over legacy meta keys if both exist.
  delete meta.uploaded_by
  delete meta.created_on
  return {
    id,
    filename_download: row.filename,
    title: row.title,
    type: row.mime_type,
    filesize: Number.isFinite(filesize as number) ? filesize : null,
    ...meta,
    parent_collection: row.parent_collection || null,
    parent_record_id: row.parent_record_id || null,
    uploaded_by: row.uploaded_by || null,
    created_on: row.created_at || null,
  }
}

export async function postgresFindFileRow(id: string): Promise<RegistryFileRow | null> {
  const rows = await query<RegistryFileRow>(
    `SELECT ${FILE_ROW_SELECT}
     FROM public.files
     WHERE deleted_at IS NULL
       AND (id::text = $1 OR backend_file_id = $1)
     ORDER BY CASE WHEN backend_target = 'SUPABASE' THEN 0 ELSE 1 END
     LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function postgresFindFileRows(ids: string[]): Promise<RegistryFileRow[]> {
  const unique = [...new Set(ids.map(String).filter(Boolean))]
  if (!unique.length) return []
  return query<RegistryFileRow>(
    `SELECT ${FILE_ROW_SELECT}
     FROM public.files
     WHERE deleted_at IS NULL
       AND (id::text = ANY($1::text[]) OR backend_file_id = ANY($1::text[]))`,
    [unique],
  )
}

export async function postgresUpsertFile(input: {
  id?: string | null
  backendTarget: 'DIRECTUS' | 'SUPABASE'
  backendFileId: string
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  title?: string | null
  uploadedBy?: string | null
  meta?: Record<string, unknown> | null
  parentCollection?: string | null
  parentRecordId?: string | null
}): Promise<RegistryFileRow> {
  const rows = await query<RegistryFileRow>(
    `INSERT INTO public.files (
       id, backend_target, backend_file_id, filename, mime_type, filesize, title, uploaded_by, meta,
       parent_collection, parent_record_id
     ) VALUES (
       COALESCE($1::uuid, extensions.gen_random_uuid()),
       $2, $3, $4, $5, $6, $7, $8::uuid, COALESCE($9::jsonb, '{}'::jsonb),
       NULLIF($10, ''), NULLIF($11, '')
     )
     ON CONFLICT (backend_target, backend_file_id) DO UPDATE SET
       filename = EXCLUDED.filename,
       mime_type = EXCLUDED.mime_type,
       filesize = EXCLUDED.filesize,
       title = COALESCE(EXCLUDED.title, public.files.title),
       uploaded_by = COALESCE(EXCLUDED.uploaded_by, public.files.uploaded_by),
       meta = public.files.meta || EXCLUDED.meta,
       parent_collection = COALESCE(EXCLUDED.parent_collection, public.files.parent_collection),
       parent_record_id = COALESCE(EXCLUDED.parent_record_id, public.files.parent_record_id),
       updated_at = now(),
       deleted_at = NULL
     RETURNING ${FILE_ROW_SELECT}`,
    [
      input.id ?? null,
      input.backendTarget,
      input.backendFileId,
      input.filename ?? null,
      input.mimeType ?? null,
      input.filesize ?? null,
      input.title ?? null,
      input.uploadedBy ?? null,
      JSON.stringify(input.meta ?? {}),
      input.parentCollection ?? null,
      input.parentRecordId ?? null,
    ],
  )
  if (!rows[0]) throw new Error('postgresUpsertFile: no row returned')
  return rows[0]
}

/** Drop leftover `backend_target = DIRECTUS` registry rows for the same file id. */
export async function postgresDropLegacyFileAlias(fileId: string): Promise<void> {
  await query(
    `DELETE FROM public.files
     WHERE backend_target = 'DIRECTUS'
       AND (id::text = $1 OR backend_file_id = $1)`,
    [fileId],
  )
}

export async function postgresUpdateFileMeta(
  id: string,
  payload: Record<string, unknown>,
): Promise<RegistryFileRow | null> {
  const filename =
    typeof payload.filename_download === 'string'
      ? payload.filename_download
      : typeof payload.filename === 'string'
        ? payload.filename
        : null
  const title = typeof payload.title === 'string' ? payload.title : null
  const mimeType =
    typeof payload.type === 'string'
      ? payload.type
      : typeof payload.mime_type === 'string'
        ? payload.mime_type
        : null
  const uploadedBy =
    typeof payload.uploaded_by === 'string'
      ? payload.uploaded_by
      : payload.uploaded_by &&
          typeof payload.uploaded_by === 'object' &&
          (payload.uploaded_by as { id?: unknown }).id != null
        ? String((payload.uploaded_by as { id: unknown }).id)
        : null

  const extra = { ...payload }
  delete extra.id
  delete extra.filename_download
  delete extra.filename
  delete extra.title
  delete extra.type
  delete extra.mime_type
  delete extra.filesize
  delete extra.uploaded_by

  const rows = await query<RegistryFileRow>(
    `UPDATE public.files SET
       filename = COALESCE($2, filename),
       title = COALESCE($3, title),
       mime_type = COALESCE($4, mime_type),
       uploaded_by = COALESCE($5::uuid, uploaded_by),
       meta = meta || COALESCE($6::jsonb, '{}'::jsonb),
       updated_at = now()
     WHERE deleted_at IS NULL
       AND (id::text = $1 OR backend_file_id = $1)
     RETURNING ${FILE_ROW_SELECT}`,
    [id, filename, title, mimeType, uploadedBy, JSON.stringify(extra)],
  )
  return rows[0] ?? null
}

export async function postgresListFilesByParent(
  collection: string,
  recordId: string,
): Promise<RegistryFileRow[]> {
  const parentCollection = collection.trim()
  const parentRecordId = recordId.trim()
  if (!parentCollection || !parentRecordId) return []
  return query<RegistryFileRow>(
    `SELECT ${FILE_ROW_SELECT}
     FROM public.files
     WHERE deleted_at IS NULL
       AND parent_collection = $1
       AND parent_record_id = $2
     ORDER BY created_at DESC`,
    [parentCollection, parentRecordId],
  )
}

export async function postgresSoftDeleteFile(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE public.files
     SET deleted_at = now(), updated_at = now()
     WHERE deleted_at IS NULL
       AND (id::text = $1 OR backend_file_id = $1)
     RETURNING id::text AS id`,
    [id],
  )
  return Boolean(rows[0])
}

export async function hasRegistryFiles(): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.files WHERE deleted_at IS NULL) AS exists`,
  )
  return Boolean(rows[0]?.exists)
}
