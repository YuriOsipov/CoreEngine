import { query } from '../../db/pool.js'

export interface M2ORelationMeta {
  /** Field on the parent entity that stores the FK scalar. */
  fieldApiName: string
  /** Related entity api_name. */
  relatedEntityApiName: string
}

export interface M2ARelationMeta {
  /** Alias field on the parent entity (e.g. blocks). */
  fieldApiName: string
  /** Junction entity api_name (e.g. visit_blocks). */
  junctionEntityApiName: string
  /** FK on the junction pointing at the parent (e.g. visit_id). */
  parentFkField: string
  /** Polymorphic collection column on the junction. */
  collectionField: string
  /** Polymorphic item id column on the junction. */
  itemField: string
  /** Optional sort column on the junction. */
  sortField: string | null
}

export interface O2MRelationMeta {
  /** Alias field on the parent entity (e.g. attachments). */
  fieldApiName: string
  /** Junction / child entity api_name (e.g. visit_files). */
  junctionEntityApiName: string
  /** FK on the junction pointing at the parent (e.g. visit_id). */
  parentFkField: string
  /** Related FK on the junction (e.g. file_id); null for plain O2M children. */
  junctionField: string | null
  /** Optional sort column on the junction. */
  sortField: string | null
}

/** Child entity that has an M2O FK pointing at this parent (reverse of M2O). */
export interface ReverseM2OChildMeta {
  childEntityApiName: string
  /** FK field on the child (e.g. opportunity_id). */
  fkFieldApiName: string
}

interface RelationCacheEntry {
  m2o: M2ORelationMeta[]
  m2a: M2ARelationMeta[]
  o2m: O2MRelationMeta[]
  expiresAt: number
}

const RELATION_TTL_MS = 30_000
const relationCache = new Map<string, RelationCacheEntry>()
const reverseChildCache = new Map<
  string,
  { rows: ReverseM2OChildMeta[]; expiresAt: number }
>()

export function clearRecordRelationsCache(): void {
  relationCache.clear()
  reverseChildCache.clear()
}

function readMetaString(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = meta?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** M2O relations for an entity (field -> related entity), cached briefly. */
export async function loadM2ORelations(
  entityApiName: string,
): Promise<M2ORelationMeta[]> {
  const bundle = await loadEntityRelations(entityApiName)
  return bundle.m2o
}

/** M2A alias relations for an entity (field -> junction meta), cached briefly. */
export async function loadM2ARelations(
  entityApiName: string,
): Promise<M2ARelationMeta[]> {
  const bundle = await loadEntityRelations(entityApiName)
  return bundle.m2a
}

/** O2M / files alias relations for an entity (field -> junction meta), cached briefly. */
export async function loadO2MRelations(
  entityApiName: string,
): Promise<O2MRelationMeta[]> {
  const bundle = await loadEntityRelations(entityApiName)
  return bundle.o2m
}

/**
 * Entities that reference `entityApiName` via an M2O FK
 * (e.g. quote.opportunity_id → opportunity).
 */
export async function loadReverseM2OChildren(
  entityApiName: string,
): Promise<ReverseM2OChildMeta[]> {
  const parent = String(entityApiName || '').trim()
  if (!parent) return []
  const cached = reverseChildCache.get(parent)
  if (cached && cached.expiresAt > Date.now()) return cached.rows

  const rows = await query<{
    child_api_name: string
    fk_field: string
  }>(
    `SELECT e.api_name AS child_api_name,
            f.api_name AS fk_field
     FROM public.relations r
     JOIN public.fields f ON f.id = r.field_id
     JOIN public.entities e ON e.id = r.entity_id AND e.deleted_at IS NULL
     LEFT JOIN public.entities related
       ON related.id = r.related_entity_id AND related.deleted_at IS NULL
     WHERE upper(COALESCE(r.kind, '')) = 'M2O'
       AND e.api_name <> $1
       AND (
         related.api_name = $1
         OR COALESCE(r.meta->>'one_collection', '') = $1
       )
     ORDER BY e.api_name ASC, f.api_name ASC`,
    [parent],
  )

  const out: ReverseM2OChildMeta[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const child = String(row.child_api_name || '').trim()
    const fk = String(row.fk_field || '').trim()
    if (!child || !fk) continue
    const key = `${child}|${fk}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ childEntityApiName: child, fkFieldApiName: fk })
  }

  reverseChildCache.set(parent, {
    rows: out,
    expiresAt: Date.now() + RELATION_TTL_MS,
  })
  return out
}

async function loadEntityRelations(
  entityApiName: string,
): Promise<{ m2o: M2ORelationMeta[]; m2a: M2ARelationMeta[]; o2m: O2MRelationMeta[] }> {
  const cached = relationCache.get(entityApiName)
  if (cached && cached.expiresAt > Date.now()) {
    return { m2o: cached.m2o, m2a: cached.m2a, o2m: cached.o2m }
  }

  const rows = await query<{
    kind: string
    field_api_name: string
    related_entity_api_name: string | null
    junction_entity_api_name: string | null
    meta: Record<string, unknown> | null
    entity_api_name: string
  }>(
    `SELECT r.kind,
            f.api_name AS field_api_name,
            related.api_name AS related_entity_api_name,
            junction.api_name AS junction_entity_api_name,
            r.meta,
            e.api_name AS entity_api_name
     FROM public.relations r
     JOIN public.fields f ON f.id = r.field_id
     JOIN public.entities e ON e.id = r.entity_id
     -- Soft-deleted related objects must not win M2O label resolution.
     LEFT JOIN public.entities related
       ON related.id = r.related_entity_id AND related.deleted_at IS NULL
     LEFT JOIN public.entities junction ON junction.id = r.junction_entity_id
     WHERE e.deleted_at IS NULL
       AND (
         e.api_name = $1
         OR COALESCE(r.meta->>'one_collection', '') = $1
       )`,
    [entityApiName],
  )

  const m2o: M2ORelationMeta[] = []
  const m2a: M2ARelationMeta[] = []
  const o2m: O2MRelationMeta[] = []
  const o2mSeen = new Set<string>()

  for (const row of rows) {
    const kind = String(row.kind || '').toUpperCase()
    const meta = row.meta && typeof row.meta === 'object' ? row.meta : null
    const oneCollection = readMetaString(meta, 'one_collection')
    const ownedByParent = row.entity_api_name === entityApiName

    if (ownedByParent) {
      // Real M2O FKs, plus junction "other side" FKs imported as M2M with one_field null
      // (e.g. item_item.related_item_id → item).
      const oneField = readMetaString(meta, 'one_field')
      const isJunctionSideFk = kind === 'M2M' && oneField == null
      if (kind === 'M2O' || isJunctionSideFk) {
        const fromEntity = row.related_entity_api_name
          ? String(row.related_entity_api_name)
          : null
        const relatedEntityApiName =
          fromEntity ||
          // After a related object rename/archive, meta.one_collection is the
          // surviving target (e.g. item_price_group → price_group).
          (kind === 'M2O' && oneCollection ? oneCollection : null) ||
          (oneCollection === 'files' ? 'files' : null) ||
          (oneCollection === 'roles' ? 'roles' : null) ||
          (oneCollection === 'users' ? 'users' : null) ||
          (isJunctionSideFk ? oneCollection : null)
        if (relatedEntityApiName) {
          m2o.push({
            fieldApiName: row.field_api_name,
            relatedEntityApiName,
          })
        }
      }
    }

    if (ownedByParent && kind === 'M2A') {
      const junctionEntityApiName =
        (row.junction_entity_api_name
          ? String(row.junction_entity_api_name)
          : null) || readMetaString(meta, 'many_collection')
      const parentFkField = readMetaString(meta, 'many_field')
      if (junctionEntityApiName && parentFkField) {
        m2a.push({
          fieldApiName: row.field_api_name,
          junctionEntityApiName,
          parentFkField,
          collectionField: readMetaString(meta, 'collection_field') || 'collection',
          itemField: readMetaString(meta, 'junction_field') || 'item',
          sortField: readMetaString(meta, 'sort_field'),
        })
      }
    }

    // O2M/files aliases: relation often lives on the junction row (import shape).
    if ((kind === 'O2M' || kind === 'M2M') && oneCollection === entityApiName) {
      const fieldApiName = readMetaString(meta, 'one_field')
      const junctionEntityApiName =
        readMetaString(meta, 'many_collection') ||
        (row.entity_api_name !== entityApiName ? row.entity_api_name : null) ||
        (row.junction_entity_api_name ? String(row.junction_entity_api_name) : null)
      const parentFkField = readMetaString(meta, 'many_field')
      if (!fieldApiName || !junctionEntityApiName || !parentFkField) continue
      const key = `${fieldApiName}|${junctionEntityApiName}|${parentFkField}`
      if (o2mSeen.has(key)) continue
      o2mSeen.add(key)
      o2m.push({
        fieldApiName,
        junctionEntityApiName,
        parentFkField,
        junctionField: readMetaString(meta, 'junction_field'),
        sortField: readMetaString(meta, 'sort_field'),
      })
    }
  }

  // System audit FKs are seeded as UUID fields without relation rows. Always
  // expand them as M2O → users so Created By / Last Modified By resolve to names.
  const m2oFields = new Set(m2o.map((rel) => rel.fieldApiName))
  for (const fieldApiName of ['user_created', 'user_updated'] as const) {
    if (m2oFields.has(fieldApiName)) continue
    const fieldRows = await query<{ id: string }>(
      `SELECT f.id::text AS id
       FROM public.fields f
       JOIN public.entities e ON e.id = f.entity_id
       WHERE e.deleted_at IS NULL
         AND e.api_name = $1
         AND f.api_name = $2
       LIMIT 1`,
      [entityApiName, fieldApiName],
    )
    if (!fieldRows[0]) continue
    m2o.push({ fieldApiName, relatedEntityApiName: 'users' })
  }

  relationCache.set(entityApiName, {
    m2o,
    m2a,
    o2m,
    expiresAt: Date.now() + RELATION_TTL_MS,
  })
  return { m2o, m2a, o2m }
}

/** Extract the FK scalar id from a stored M2O value (scalar or nested {id}). */
export function fkIdFromValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return id == null ? null : String(id)
  }
  if (value === '') return null
  return String(value)
}

function relationFieldKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/** Match a requested field to the relation's api name, ignoring case and separators. */
export function canonicalRelationField(
  name: string,
  relationFields: Set<string>,
): string | null {
  if (relationFields.has(name)) return name
  const needle = relationFieldKey(name)
  for (const field of relationFields) {
    if (relationFieldKey(field) === needle) return field
  }
  return null
}

export function readRecordField(
  record: Record<string, unknown>,
  field: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(record, field)) return record[field]
  const needle = relationFieldKey(field)
  const key = Object.keys(record).find((candidate) => relationFieldKey(candidate) === needle)
  return key ? record[key] : undefined
}

export function writeRecordField(
  record: Record<string, unknown>,
  field: string,
  value: unknown,
): void {
  if (Object.prototype.hasOwnProperty.call(record, field)) {
    record[field] = value
    return
  }
  const needle = relationFieldKey(field)
  const key = Object.keys(record).find((candidate) => relationFieldKey(candidate) === needle)
  record[key ?? field] = value
}

/**
 * Split requested fields into direct fields and per-relation nested subfields.
 * `provider_type.name` → relations.get('provider_type') = ['name'].
 * `blocks` / `blocks.item.*` → relations.get('blocks') when base is in relationFields.
 */
export function splitRelationFields(
  fields: string[] | null | undefined,
  relationFields: Set<string>,
): { direct: string[]; relations: Map<string, string[]> } {
  const direct: string[] = []
  const relations = new Map<string, string[]>()
  if (!fields?.length) return { direct, relations }

  for (const field of fields) {
    const dot = field.indexOf('.')
    if (dot === -1) {
      const relationField = canonicalRelationField(field, relationFields)
      if (relationField) {
        if (!relations.has(relationField)) relations.set(relationField, [])
      } else {
        direct.push(field)
      }
      continue
    }
    const base = field.slice(0, dot)
    const rest = field.slice(dot + 1)
    const relationField = canonicalRelationField(base, relationFields)
    if (!relationField) {
      // Not a relation we can expand; keep base so projection retains the scalar.
      direct.push(base)
      continue
    }
    const list = relations.get(relationField) ?? []
    if (rest) list.push(rest)
    relations.set(relationField, list)
  }

  return { direct, relations }
}
