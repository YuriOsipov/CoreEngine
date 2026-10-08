import { getAccessToken } from '@/core/auth/session'
import { graphqlUrl } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'
import { fetchFilesFromGraphQL, fetchRecordFilesFromGraphQL } from './filesApi'

/** BFF origin derived from VITE_GRAPHQL_URL (strip trailing /graphql). */
export function bffBaseUrl(): string {
  return graphqlUrl.replace(/\/graphql\/?$/i, '') || 'http://localhost:4000'
}

export function canUseFilesProxy(): boolean {
  return featureFlags.recordsFromGraphQL
}

async function authHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  }
}

export function bffFileAssetUrl(
  fileId: string,
  params?: Record<string, string | number>,
): string {
  if (!fileId) return ''
  const base = `${bffBaseUrl()}/assets/${encodeURIComponent(fileId)}`
  if (!params || Object.keys(params).length === 0) return base
  const search = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  )
  return `${base}?${search.toString()}`
}

/** Asset URL — BFF only. */
export function fileAssetUrl(
  fileId: string,
  params?: Record<string, string | number>,
): string {
  if (!fileId) return ''
  if (!canUseFilesProxy()) {
    refuseLegacyFallback('fileAssetUrl')
  }
  return bffFileAssetUrl(fileId, params)
}

export type UploadedFileAsset = {
  id: string
  filename_download?: string
  type?: string
  filesize?: number | null
  title?: string | null
  created_on?: string | null
  uploaded_by?:
    | string
    | {
        id?: string
        first_name?: string | null
        last_name?: string | null
        email?: string | null
      }
    | null
}

export async function uploadFileViaBff(
  file: File,
  parent?: { collection: string; recordId: string | number },
): Promise<UploadedFileAsset> {
  const formData = new FormData()
  if (parent?.collection && parent.recordId != null && parent.recordId !== '') {
    formData.append('parent_collection', parent.collection)
    formData.append('parent_record_id', String(parent.recordId))
  }
  formData.append('file', file)

  const response = await fetch(`${bffBaseUrl()}/files`, {
    method: 'POST',
    headers: await authHeaders(),
    body: formData,
    credentials: 'include',
  })

  const payload = (await response.json().catch(() => null)) as
    | (Partial<UploadedFileAsset> & { error?: string })
    | null

  if (!response.ok) {
    throw new Error(payload?.error || `BFF file upload HTTP ${response.status}`)
  }

  const id = String(payload?.id ?? '')
  if (!id) {
    throw new Error('BFF file upload returned no file id.')
  }

  return {
    id,
    filename_download: payload?.filename_download,
    type: payload?.type,
    filesize: payload?.filesize,
    title: payload?.title,
    created_on: payload?.created_on,
    uploaded_by: payload?.uploaded_by,
  }
}

export async function updateFileViaBff(
  fileId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${bffBaseUrl()}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: await authHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify(payload),
    credentials: 'include',
  })

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | { error?: string }
    | null

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: string }).error || '')
        : ''
    throw new Error(message || `BFF file update HTTP ${response.status}`)
  }

  return (body as Record<string, unknown>) ?? {}
}

/** Upload — BFF only. Optional parent attaches the file to any CRM record. */
export async function uploadFile(
  file: File,
  parent?: { collection: string; recordId: string | number },
): Promise<UploadedFileAsset> {
  if (!canUseFilesProxy()) {
    refuseLegacyFallback('uploadFile')
  }
  try {
    return await uploadFileViaBff(file, parent)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'BFF file upload failed.')
  }
}

/** Patch file metadata — BFF only. */
export async function updateFileMetadata(
  fileId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!canUseFilesProxy()) {
    refuseLegacyFallback('updateFileMetadata')
  }
  return updateFileViaBff(fileId, payload)
}

export async function deleteFileViaBff(fileId: string): Promise<void> {
  const response = await fetch(`${bffBaseUrl()}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: await authHeaders({ Accept: 'application/json' }),
    credentials: 'include',
  })
  if (!response.ok && response.status !== 404) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `BFF file delete HTTP ${response.status}`)
  }
}

/** Soft-delete a file asset — BFF only. */
export async function deleteFile(fileId: string): Promise<void> {
  if (!canUseFilesProxy()) {
    refuseLegacyFallback('deleteFile')
  }
  await deleteFileViaBff(fileId)
}

export async function readRecordFiles(
  collection: string,
  recordId: string | number,
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  if (!canUseFilesProxy()) {
    refuseLegacyFallback('readRecordFiles')
  }
  return fetchRecordFilesFromGraphQL(String(collection), String(recordId), fields)
}

/** Batch file metadata by id — GraphQL only. */
export async function readFilesByIds(
  ids: string[],
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))]
  if (uniqueIds.length === 0) return []

  if (!canUseFilesProxy()) {
    refuseLegacyFallback('readFilesByIds')
  }
  return fetchFilesFromGraphQL(uniqueIds, fields)
}
