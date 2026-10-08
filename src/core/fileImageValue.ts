import { fileAssetUrl } from '@/core/graphql/filesProxy'

export interface ImageValue {
  url: string
  caption?: string
}

export function createEmptyImageValue(): ImageValue {
  return { url: '', caption: '' }
}

/** Asset URL for a BFF file id (proxy-aware). */
export function buildFileAssetUrl(
  fileId: string,
  params?: Record<string, string | number>,
): string {
  return fileAssetUrl(fileId, params)
}

export function imageValueFromFile(
  file: { id?: string; title?: string | null; type?: string | null; filename_download?: string | null },
  caption?: string,
): ImageValue | null {
  if (!file.id) return null
  const mime = String(file.type ?? '')
  if (mime && !mime.startsWith('image/')) return null

  return {
    url: buildFileAssetUrl(file.id, { width: 1200 }),
    caption:
      caption?.trim()
      || file.title?.trim()
      || file.filename_download?.trim()
      || '',
  }
}
