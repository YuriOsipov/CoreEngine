import { readPresetsBridge } from '@/core/graphql/presetsApi'

export interface BookmarkPreset {
  id: string
  collection: string
  bookmark: string
  filter: Record<string, unknown> | null
  search: string | null
}

/** Used for the collection tree catalog. */
const BOOKMARK_PRESET_CORE_FIELDS = [
  'id',
  'collection',
  'bookmark',
  'filter',
] as const

/** Optional fields for fill-time preset queries; not all backends expose every name. */
const BOOKMARK_PRESET_EXTENDED_FIELDS = [
  ...BOOKMARK_PRESET_CORE_FIELDS,
  'search',
  'search_query',
  'layout_query',
] as const

const BOOKMARK_PRESET_QUERY = {
  limit: -1,
  filter: {
    collection: { _nnull: true },
    bookmark: { _nnull: true },
  } as never,
  sort: ['collection', 'bookmark'] as never,
}

let presetsCache: Promise<BookmarkPreset[]> | null = null

export function coercePresetFilter(
  filter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null
  if (Object.keys(filter).length === 0) return null
  return filter
}

function normalizeFieldOperators(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const ops = value as Record<string, unknown>
  if (ops._eq === null) return { _null: true }
  if (ops._neq === null) return { _nnull: true }

  return ops
}

function normalizeFilterNode(node: unknown): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node

  const record = node as Record<string, unknown>

  if (Array.isArray(record._and)) {
    const flattened = record._and.flatMap((entry) => {
      const normalized = normalizeFilterNode(entry)
      if (
        normalized &&
        typeof normalized === 'object' &&
        !Array.isArray(normalized) &&
        Array.isArray((normalized as Record<string, unknown>)._and)
      ) {
        return (normalized as Record<string, unknown>)._and as unknown[]
      }
      return [normalized]
    })

    if (flattened.length === 1) {
      return flattened[0]
    }

    return { _and: flattened.map((entry) => normalizeFilterNode(entry)) }
  }

  if (Array.isArray(record._or)) {
    return {
      _or: record._or.map((entry) => normalizeFilterNode(entry)),
    }
  }

  const next: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(record)) {
    if (field.startsWith('_')) continue
    next[field] = normalizeFieldOperators(value)
  }

  return Object.keys(next).length > 0 ? next : record
}

/** Normalizes preset filters (`_eq: null` → `_null`, flatten `_and`). */
export function normalizePresetFilter(
  filter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const base = coercePresetFilter(filter)
  if (!base) return null

  const normalized = normalizeFilterNode(base)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return null
  }

  return coercePresetFilter(normalized as Record<string, unknown>)
}

function extractPresetFilter(record: Record<string, unknown>): Record<string, unknown> | null {
  const direct = normalizePresetFilter(
    record.filter && typeof record.filter === 'object' && !Array.isArray(record.filter)
      ? (record.filter as Record<string, unknown>)
      : null,
  )
  if (direct) return normalizePresetFilter(direct)

  const layoutQuery = record.layout_query
  if (!layoutQuery || typeof layoutQuery !== 'object' || Array.isArray(layoutQuery)) {
    return null
  }

  for (const layoutConfig of Object.values(layoutQuery as Record<string, unknown>)) {
    if (!layoutConfig || typeof layoutConfig !== 'object' || Array.isArray(layoutConfig)) continue
    const nested = normalizePresetFilter(
      (layoutConfig as Record<string, unknown>).filter as Record<string, unknown> | undefined,
    )
    if (nested) return normalizePresetFilter(nested)
  }

  return null
}

function extractPresetSearch(record: Record<string, unknown>): string | null {
  for (const key of ['search', 'search_query'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function normalizePreset(record: Record<string, unknown>): BookmarkPreset | null {
  const collection = typeof record.collection === 'string' ? record.collection.trim() : ''
  const bookmark = typeof record.bookmark === 'string' ? record.bookmark.trim() : ''
  const id = record.id

  if (!collection || !bookmark || id == null) return null

  return {
    id: String(id),
    collection,
    bookmark,
    filter: extractPresetFilter(record),
    search: extractPresetSearch(record),
  }
}

function presetIdsMatch(left: string | number | null | undefined, right: string): boolean {
  if (left == null) return false
  return String(left) === String(right)
}

function mapBookmarkPresets(records: unknown): BookmarkPreset[] {
  return (records as Record<string, unknown>[])
    .map(normalizePreset)
    .filter((preset): preset is BookmarkPreset => preset !== null)
}

async function requestBookmarkPresets(
  fields: readonly string[],
  extra: Record<string, unknown> = {},
): Promise<BookmarkPreset[]> {
  const filter =
    (extra.filter as Record<string, unknown> | undefined) ??
    (BOOKMARK_PRESET_QUERY.filter as Record<string, unknown>)
  const sort =
    (extra.sort as string[] | undefined) ??
    (BOOKMARK_PRESET_QUERY.sort as unknown as string[])
  const limit =
    typeof extra.limit === 'number' ? extra.limit : BOOKMARK_PRESET_QUERY.limit

  const records = await readPresetsBridge({
    fields: [...fields],
    filter,
    sort,
    limit,
  })
  return mapBookmarkPresets(records)
}

async function loadBookmarkPresetsFromApi(): Promise<BookmarkPreset[]> {
  try {
    return await requestBookmarkPresets(BOOKMARK_PRESET_EXTENDED_FIELDS)
  } catch (extendedErr) {
    console.warn(
      '[docPresets] Extended preset fields unavailable, falling back to core fields:',
      extendedErr,
    )
    return requestBookmarkPresets(BOOKMARK_PRESET_CORE_FIELDS)
  }
}

export function clearPresetsCache(): void {
  presetsCache = null
}

export async function loadBookmarkPresets(): Promise<BookmarkPreset[]> {
  if (!presetsCache) {
    presetsCache = loadBookmarkPresetsFromApi().catch((err) => {
      presetsCache = null
      console.warn('[docPresets] Failed to load bookmark presets:', err)
      return []
    })
  }

  return presetsCache
}

async function loadPresetRecordById(
  presetId: string,
  fields: readonly string[],
): Promise<BookmarkPreset | null> {
  const records = await readPresetsBridge({
    fields: [...fields],
    filter: { id: { _eq: presetId } },
    limit: 1,
  })
  return mapBookmarkPresets(records)[0] ?? null
}

export async function loadPresetById(
  presetId: string,
): Promise<BookmarkPreset | null> {
  const normalized = presetId.trim()
  if (!normalized) return null

  const cached = (await loadBookmarkPresets()).find((preset) =>
    presetIdsMatch(preset.id, normalized),
  )
  if (cached) return cached

  try {
    const extended = await loadPresetRecordById(normalized, BOOKMARK_PRESET_EXTENDED_FIELDS)
    if (extended) return extended
  } catch {
    // fall through to core fields
  }

  try {
    return await loadPresetRecordById(normalized, BOOKMARK_PRESET_CORE_FIELDS)
  } catch (err) {
    console.warn('[docPresets] Failed to load preset by id:', normalized, err)
    return null
  }
}

export async function loadPresetFilter(
  presetId: string,
): Promise<Record<string, unknown> | null> {
  const preset = await loadPresetById(presetId)
  return preset?.filter ?? null
}

function presetCollectionKey(collection: string): string {
  return collection.trim().toLowerCase()
}

export function groupBookmarkPresetsByCollection(
  presets: BookmarkPreset[],
): Map<string, BookmarkPreset[]> {
  const grouped = new Map<string, BookmarkPreset[]>()

  for (const preset of presets) {
    const key = presetCollectionKey(preset.collection)
    const current = grouped.get(key) ?? []
    current.push(preset)
    grouped.set(key, current)
  }

  for (const [collection, entries] of grouped) {
    grouped.set(
      collection,
      [...entries].sort((a, b) => a.bookmark.localeCompare(b.bookmark)),
    )
  }

  return grouped
}
