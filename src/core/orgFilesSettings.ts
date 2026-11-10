import {
  readOrgSettingBridge,
  upsertOrgSettingBridge,
} from '@/core/graphql/orgSettingsApi'
import { IMAGE_FORMAT_OPTIONS } from '@/interfaces'

export const ORG_FILES_UPLOAD_SETTING_KEY = 'files_upload'

/** Org-wide defaults for Image field uploads (Setup → General). */
export interface OrgFilesUploadSettings {
  /** Specific image MIME types; empty / `image/` = any image. */
  allowedMimeTypes: string[]
  /** Max upload size in MB; null = no extra limit. */
  maxFileSizeMb: number | null
}

const CACHE_TTL_MS = 30_000
let cached: OrgFilesUploadSettings | null = null
let cachedAt = 0

export function defaultOrgFilesUploadSettings(): OrgFilesUploadSettings {
  return {
    allowedMimeTypes: ['image/'],
    maxFileSizeMb: null,
  }
}

export function normalizeOrgFilesUploadSettings(
  raw: unknown,
): OrgFilesUploadSettings {
  const defaults = defaultOrgFilesUploadSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const record = raw as Record<string, unknown>

  const mimeRaw = Array.isArray(record.allowedMimeTypes)
    ? record.allowedMimeTypes.map((v) => String(v || '').trim()).filter(Boolean)
    : []
  const known = new Set(IMAGE_FORMAT_OPTIONS.map((o) => o.value))
  const specific = mimeRaw.filter((mime) => known.has(mime))
  const allowedMimeTypes =
    specific.length > 0
      ? specific
      : mimeRaw.some((mime) => mime === 'image' || mime === 'image/')
        ? ['image/']
        : mimeRaw.length
          ? mimeRaw
          : ['image/']

  const sizeRaw = record.maxFileSizeMb
  const maxFileSizeMb =
    typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw > 0
      ? Math.round(sizeRaw * 100) / 100
      : null

  return { allowedMimeTypes, maxFileSizeMb }
}

export function clearOrgFilesUploadSettingsCache(): void {
  cached = null
  cachedAt = 0
}

export async function loadOrgFilesUploadSettings(
  force = false,
): Promise<OrgFilesUploadSettings> {
  if (
    !force &&
    cached &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return cached
  }
  try {
    const raw = await readOrgSettingBridge(ORG_FILES_UPLOAD_SETTING_KEY)
    cached = normalizeOrgFilesUploadSettings(raw)
  } catch {
    cached = defaultOrgFilesUploadSettings()
  }
  cachedAt = Date.now()
  return cached
}

export async function saveOrgFilesUploadSettings(
  value: OrgFilesUploadSettings,
): Promise<OrgFilesUploadSettings> {
  const normalized = normalizeOrgFilesUploadSettings(value)
  await upsertOrgSettingBridge(ORG_FILES_UPLOAD_SETTING_KEY, normalized)
  cached = normalized
  cachedAt = Date.now()
  return normalized
}
