/**
 * Shared file-asset naming (Supabase Storage + public.files).
 * Physical junction FK is `file_id`; asset collection id is `files`.
 */
export const FILES_JUNCTION_FILE_ID_FIELD = 'file_id' as const

export const FILES_ASSET_COLLECTION = 'files' as const

export function isFilesJunctionFileIdField(field: string): boolean {
  return field === FILES_JUNCTION_FILE_ID_FIELD
}

export function isFilesAssetCollection(relatedCollection: string): boolean {
  return relatedCollection === FILES_ASSET_COLLECTION
}
