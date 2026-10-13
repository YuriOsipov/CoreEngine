import type { FieldDefinition } from '@/interfaces'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'

export interface SensitivitySource {
  /** M2O field on the current record, e.g. `item`. */
  relationField: string
  /** JSON list field on the related record for pathogens. */
  patogenField: string
  /** JSON list field on the related record for pharmacy. */
  pharmacyField: string
  /** JSON list field on the related record for resistance options. */
  resistanceField: string
  /** Column inside each list row, e.g. `name`. */
  valueColumn: string
}

export interface SensitivityRow {
  patogen: string
  pharmacy: string
  resistance: string
}

export interface SensitivityNoteRow {
  patogen: string
  note: string
}

/** Stored field value: matrix results + per-pathogen notes. */
export interface SensitivityValue {
  results: SensitivityRow[]
  notes: SensitivityNoteRow[]
}

export interface SensitivityLists {
  patogen: string[]
  pharmacy: string[]
  resistance: string[]
}

const DEFAULT_PATOGEN_FIELD = 'patogen'
const DEFAULT_PHARMACY_FIELD = 'pharmacy'
const DEFAULT_RESISTANCE_FIELD = 'resistance'
const DEFAULT_VALUE_COLUMN = 'name'

function normalizeSpecial(
  special: string[] | string | null | undefined,
): string[] {
  if (!special) return []
  if (Array.isArray(special)) return special
  return [special]
}

export function isSensitivityMatrixFieldDefinition(field: FieldDefinition): boolean {
  const special = normalizeSpecial(field.meta?.special)
  if (special.includes('json-sensitivity')) return true

  const iface = (field.meta?.interface ?? '').toLowerCase()
  return iface === 'json-sensitivity'
}

export function defaultSensitivitySource(): SensitivitySource {
  return {
    relationField: '',
    patogenField: DEFAULT_PATOGEN_FIELD,
    pharmacyField: DEFAULT_PHARMACY_FIELD,
    resistanceField: DEFAULT_RESISTANCE_FIELD,
    valueColumn: DEFAULT_VALUE_COLUMN,
  }
}

export function parseSensitivitySource(value: unknown): SensitivitySource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const relationField = String(row.relationField ?? row.relation_field ?? '').trim()
  if (!relationField) return null

  // Prefer explicit field names; fall back to legacy key names used as field ids.
  const patogenField =
    String(
      row.patogenField ??
        row.patogen_field ??
        row.patogenKey ??
        row.patogen_key ??
        DEFAULT_PATOGEN_FIELD,
    ).trim() || DEFAULT_PATOGEN_FIELD
  const pharmacyField =
    String(
      row.pharmacyField ??
        row.pharmacy_field ??
        row.pharmacyKey ??
        row.pharmacy_key ??
        DEFAULT_PHARMACY_FIELD,
    ).trim() || DEFAULT_PHARMACY_FIELD
  const resistanceField =
    String(
      row.resistanceField ??
        row.resistance_field ??
        row.resistanceKey ??
        row.resistance_key ??
        DEFAULT_RESISTANCE_FIELD,
    ).trim() || DEFAULT_RESISTANCE_FIELD
  const valueColumn =
    String(row.valueColumn ?? row.value_column ?? DEFAULT_VALUE_COLUMN).trim() ||
    DEFAULT_VALUE_COLUMN

  if (!patogenField || !pharmacyField || !resistanceField) return null

  return {
    relationField,
    patogenField,
    pharmacyField,
    resistanceField,
    valueColumn,
  }
}

export function getSensitivitySource(field: FieldDefinition): SensitivitySource | null {
  return parseSensitivitySource(field.meta?.options?.sensitivitySource)
}

function coerceJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function coerceJsonRows(value: unknown): Record<string, unknown>[] {
  const parsed = coerceJsonValue(value)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
}

/** Unique non-empty column values from a list of row objects, in order. */
export function namesFromListRows(value: unknown, column: string): string[] {
  const name = column.trim()
  if (!name) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const row of coerceJsonRows(value)) {
    const cell = row[name]
    if (cell === null || cell === undefined || cell === '') continue
    const label = typeof cell === 'string' ? cell.trim() : String(cell).trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

export function listsFromRelatedFields(
  related: Record<string, unknown>,
  source: SensitivitySource,
): SensitivityLists {
  return {
    patogen: namesFromListRows(related[source.patogenField], source.valueColumn),
    pharmacy: namesFromListRows(related[source.pharmacyField], source.valueColumn),
    resistance: namesFromListRows(related[source.resistanceField], source.valueColumn),
  }
}

function trimCell(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

/**
 * Sparse matrix: keep only rows with all three non-empty strings.
 * Dedupe by patogen+pharmacy (last wins).
 */
export function normalizeSensitivityResults(value: unknown): SensitivityRow[] {
  const parsed = coerceJsonValue(value)
  if (!Array.isArray(parsed)) return []

  const map = new Map<string, SensitivityRow>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const patogen = trimCell(row.patogen ?? row.pathogen)
    const pharmacy = trimCell(row.pharmacy)
    const resistance = trimCell(row.resistance)
    if (!patogen || !pharmacy || !resistance) continue
    map.set(`${patogen}\0${pharmacy}`, { patogen, pharmacy, resistance })
  }
  return Array.from(map.values())
}

/** Keep only rows with patogen + non-empty note. Dedupe by patogen (last wins). */
export function normalizeSensitivityNotes(value: unknown): SensitivityNoteRow[] {
  const parsed = coerceJsonValue(value)
  if (!Array.isArray(parsed)) return []

  const map = new Map<string, SensitivityNoteRow>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const patogen = trimCell(row.patogen ?? row.pathogen)
    const note = trimCell(row.note)
    if (!patogen || !note) continue
    map.set(patogen, { patogen, note })
  }
  return Array.from(map.values())
}

export function createEmptySensitivityValue(): SensitivityValue {
  return { results: [], notes: [] }
}

/**
 * Normalize stored value.
 * Accepts legacy bare results array, or `{ results|matrix|items, notes }`.
 * Also accepts JSON strings (common when jsonb is double-encoded).
 */
export function normalizeSensitivityValue(value: unknown): SensitivityValue {
  const parsed = coerceJsonValue(value)

  if (Array.isArray(parsed)) {
    return {
      results: normalizeSensitivityResults(parsed),
      notes: [],
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return createEmptySensitivityValue()
  }

  const row = parsed as Record<string, unknown>
  const resultsRaw = row.results ?? row.matrix ?? row.items
  return {
    results: normalizeSensitivityResults(resultsRaw),
    notes: normalizeSensitivityNotes(row.notes),
  }
}

export function formatSensitivitySummary(value: unknown, emptyValue = '-'): string {
  const payload = normalizeSensitivityValue(value)
  const rows = payload.results
  const noteCount = payload.notes.length
  if (rows.length === 0 && noteCount === 0) return emptyValue
  if (rows.length === 0) {
    return tSensitivityNoteCount(noteCount)
  }
  const preview = rows
    .slice(0, 3)
    .map((row) => `${row.patogen} · ${row.pharmacy} · ${row.resistance}`)
  const suffix = rows.length > 3 ? ` (+${rows.length - 3})` : ''
  const noteSuffix = noteCount > 0 ? ` · ${tSensitivityNoteCount(noteCount)}` : ''
  return `${preview.join('; ')}${suffix}${noteSuffix}`
}

function tSensitivityNoteCount(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`
}

export interface SensitivityCrossTable {
  /** Column headers = pathogens (first-seen order). */
  pathogens: string[]
  /** Row headers = pharmacies (first-seen order). */
  pharmacies: string[]
  /** cellMap[pharmacy][patogen] = resistance */
  cellMap: Record<string, Record<string, string>>
  /** Optional note per pathogen. */
  notesByPatogen: Record<string, string>
}

/** Pivot results: columns = pathogen, rows = pharmacy, cell = resistance (last wins). */
export function buildSensitivityCrossTable(value: unknown): SensitivityCrossTable {
  const payload = normalizeSensitivityValue(value)
  const pathogens: string[] = []
  const pharmacies: string[] = []
  const patogenSeen = new Set<string>()
  const pharmacySeen = new Set<string>()
  const cellMap: Record<string, Record<string, string>> = {}

  for (const row of payload.results) {
    if (!patogenSeen.has(row.patogen)) {
      patogenSeen.add(row.patogen)
      pathogens.push(row.patogen)
    }
    if (!pharmacySeen.has(row.pharmacy)) {
      pharmacySeen.add(row.pharmacy)
      pharmacies.push(row.pharmacy)
    }
    if (!cellMap[row.pharmacy]) cellMap[row.pharmacy] = {}
    cellMap[row.pharmacy][row.patogen] = row.resistance
  }

  const notesByPatogen: Record<string, string> = {}
  for (const note of payload.notes) {
    notesByPatogen[note.patogen] = note.note
  }

  return { pathogens, pharmacies, cellMap, notesByPatogen }
}

function readEmbeddedRelated(
  record: Record<string, unknown>,
  source: SensitivitySource,
): { hit: boolean; related: Record<string, unknown> | null } {
  const raw = record[source.relationField]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { hit: false, related: null }
  }
  const related = raw as Record<string, unknown>
  const hasAny =
    Object.prototype.hasOwnProperty.call(related, source.patogenField) ||
    Object.prototype.hasOwnProperty.call(related, source.pharmacyField) ||
    Object.prototype.hasOwnProperty.call(related, source.resistanceField)
  if (!hasAny) return { hit: false, related: null }
  return { hit: true, related }
}

export async function loadSensitivityLists(
  entityCollection: string,
  source: SensitivitySource,
  record: Record<string, unknown>,
): Promise<SensitivityLists> {
  const empty: SensitivityLists = { patogen: [], pharmacy: [], resistance: [] }
  const embedded = readEmbeddedRelated(record, source)
  if (embedded.hit && embedded.related) {
    return listsFromRelatedFields(embedded.related, source)
  }

  const [{ getCachedRelations }, { bridgeReadItem }] = await Promise.all([
    import('@/modules/entities/services/collectionSchema'),
    import('@/core/graphql/itemsBridge'),
  ])

  let relationValue = record[source.relationField]
  const relationLoaded = Object.prototype.hasOwnProperty.call(record, source.relationField)
  const selfId = extractRelationFieldId(record.id)
  if (!relationLoaded && selfId !== null && entityCollection.trim()) {
    try {
      const self = await bridgeReadItem(entityCollection, selfId, {
        fields: [source.relationField],
      })
      relationValue = self?.[source.relationField]
    } catch {
      relationValue = undefined
    }
  }

  const id = extractRelationFieldId(relationValue)
  if (id === null || !entityCollection.trim()) return empty

  const relatedCollection = relatedCollectionForCollectionField(
    await getCachedRelations(),
    entityCollection,
    source.relationField,
  )
  if (!relatedCollection) return empty

  try {
    const row = await bridgeReadItem(relatedCollection, id, {
      fields: [source.patogenField, source.pharmacyField, source.resistanceField],
    })
    if (!row) return empty
    return listsFromRelatedFields(row, source)
  } catch {
    return empty
  }
}
