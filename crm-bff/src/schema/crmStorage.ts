/**
 * Target schema for typed per-entity CRM tables (Option C).
 * Registry / PLATFORM metadata stays in `public`.
 */
import { query } from '../db/pool.js'

export const CRM_SCHEMA = 'crm_schema' as const

export type CrmEntityStorage = 'jsonb' | 'typed'

export interface CrmEntityStorageConfig {
  storage: CrmEntityStorage
  /** Postgres schema for typed tables; defaults to CRM_SCHEMA. */
  schema: string
  /** Physical table name; defaults to entity api_name when typed. */
  table: string | null
}

/** FK delete action stored on `relations.meta.on_delete` and applied in DDL. */
export type OnDeleteAction = 'CASCADE' | 'SET NULL' | 'RESTRICT'

const ON_DELETE_ACTIONS = new Set<OnDeleteAction>([
  'CASCADE',
  'SET NULL',
  'RESTRICT',
])

/** Normalize registry / UI values to a Postgres ON DELETE action. */
export function normalizeOnDelete(value: unknown): OnDeleteAction {
  if (value == null || String(value).trim() === '') return 'RESTRICT'
  const raw = String(value)
    .toUpperCase()
    .replace(/_/g, ' ')
    .trim()
  if (raw === 'CASCADE' || raw === 'DELETE CASCADE') return 'CASCADE'
  if (
    raw === 'RESTRICT' ||
    raw === 'DELETE RESTRICT' ||
    raw === 'NO ACTION' ||
    raw === 'DELETE NO ACTION'
  ) {
    return 'RESTRICT'
  }
  if (raw === 'SET NULL' || raw === 'DELETE SET NULL') return 'SET NULL'
  return 'RESTRICT'
}

export function isOnDeleteAction(value: unknown): value is OnDeleteAction {
  return ON_DELETE_ACTIONS.has(normalizeOnDelete(value))
}

/** Registry field that becomes a real column on a typed CRM table. */
export interface CrmPromotedField {
  apiName: string
  fieldType: string
  /** Postgres column type. */
  pgType: string
  /**
   * True when this column is a relation FK scalar that should be btree-indexed
   * (M2O, junction M2M, O2M many_field, M2A parent/item).
   */
  needsFkIndex: boolean
  /**
   * True when fields.is_indexed requests a btree index (scalar columns).
   * Combined with needsFkIndex for DDL index planning.
   */
  needsBtreeIndex: boolean
  /**
   * True when a Postgres FOREIGN KEY to a CRM typed table can be declared
   * (related entity lives in crm_schema).
   */
  canDeclareFk: boolean
  relatedEntityApiName: string | null
  /**
   * Postgres ON DELETE action for M2O FKs. Defaults to RESTRICT when unset.
   */
  onDelete: OnDeleteAction | null
  /**
   * When true, list `search` may match this M2O via the related entity's
   * Display Template (opt-in Setup → Use in search).
   */
  useInSearch: boolean
}

export interface CrmRecordRelation {
  storage: CrmEntityStorage
  /** SQL FROM target, e.g. public.business_records or "crm_schema"."patient". */
  relationSql: string
  /** When true, queries must filter entity_api_name = collection. */
  needsEntityFilter: boolean
  schema: string
  table: string | null
  promoted: CrmPromotedField[]
  /** Envelope `status` column (schedule templates only). */
  hasStatus: boolean
  /** Envelope `is_deleted` column — archived records. */
  hasDeleted: boolean
  /** Envelope `is_active` column. */
  hasActive: boolean
  /** Related entity display template (e.g. `{{description}}`) for label sort. */
  displayTemplate: string | null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

/**
 * Resolve storage routing from `entities.backend_config`.
 * Default is typed tables in `crm_schema` (Option C). Opt out with
 * `{ "storage": "jsonb" }` to use archived `public.business_records`
 * (sandbox only; production CRM stays typed).
 */
export function resolveCrmStorageConfig(
  backendConfig: unknown,
  entityApiName: string,
): CrmEntityStorageConfig {
  const config = asObject(backendConfig)
  const storageRaw = String(config.storage || 'typed').toLowerCase()
  const storage: CrmEntityStorage = storageRaw === 'jsonb' ? 'jsonb' : 'typed'
  const rawSchema =
    typeof config.schema === 'string' && config.schema.trim()
      ? config.schema.trim()
      : CRM_SCHEMA
  // Common misconfig when UI/docs say "crm.schema" instead of schema name crm_schema.
  const schema =
    rawSchema === 'crm.schema' || rawSchema === 'crm-schema'
      ? CRM_SCHEMA
      : rawSchema
  const table =
    typeof config.table === 'string' && config.table.trim()
      ? config.table.trim()
      : storage === 'typed'
        ? entityApiName
        : null

  return { storage, schema, table }
}

/** Qualified relation name for a typed CRM entity table. */
export function crmQualifiedTable(
  config: Pick<CrmEntityStorageConfig, 'schema' | 'table'>,
  entityApiName: string,
): string {
  const schema = config.schema || CRM_SCHEMA
  const table = config.table || entityApiName
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

const ENVELOPE_FIELD_NAMES = new Set([
  'id',
  'status',
  'is_deleted',
  'is_active',
  'date_created',
  'date_updated',
  'created_at',
  'updated_at',
])

/** Default NUMERIC(precision, scale) for FLOAT / Number fields. */
export const DEFAULT_NUMERIC_PRECISION = 18
export const DEFAULT_NUMERIC_SCALE = 2
export const MAX_NUMERIC_PRECISION = 38

/** Clamp Size (precision) and Decimals (scale) for FLOAT storage. */
export function normalizeNumericPrecisionScale(
  options?: Record<string, unknown> | null,
): { precision: number; scale: number } {
  const opts =
    options && typeof options === 'object' && !Array.isArray(options)
      ? options
      : {}
  let precision = Number(opts.precision ?? DEFAULT_NUMERIC_PRECISION)
  if (!Number.isFinite(precision)) precision = DEFAULT_NUMERIC_PRECISION
  precision = Math.min(
    MAX_NUMERIC_PRECISION,
    Math.max(1, Math.trunc(precision)),
  )

  let scale = Number(opts.scale ?? opts.decimalPlaces ?? DEFAULT_NUMERIC_SCALE)
  if (!Number.isFinite(scale)) scale = DEFAULT_NUMERIC_SCALE
  scale = Math.min(precision, Math.max(0, Math.trunc(scale)))

  return { precision, scale }
}

/** True when pgType is `numeric` or `numeric(p,s)`. */
export function isNumericPgType(pgType: string): boolean {
  return /^numeric(\s*\(|$)/i.test(String(pgType || '').trim())
}

/**
 * Ensure FLOAT field options carry clamped precision/scale (and UI mirrors).
 */
export function normalizeFloatFieldOptions(
  options?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out = asObject(options)
  const { precision, scale } = normalizeNumericPrecisionScale(out)
  out.precision = precision
  out.scale = scale
  out.decimalPlaces = scale
  out.minFractionDigits = scale
  out.maxFractionDigits = scale
  return out
}

/** Map registry field_type → Postgres column type for promoted columns. */
export function pgTypeForFieldType(
  fieldType: string,
  options?: Record<string, unknown> | null,
): string {
  switch (String(fieldType || '').toUpperCase()) {
    case 'BOOLEAN':
      return 'boolean'
    case 'INTEGER':
      return 'bigint'
    case 'FLOAT': {
      const { precision, scale } = normalizeNumericPrecisionScale(options)
      return `numeric(${precision},${scale})`
    }
    case 'DATE':
      return 'date'
    case 'DATETIME':
      return 'timestamptz'
    case 'JSON':
      return 'jsonb'
    case 'UUID':
      // record_id and FKs are text in business_records / GraphQL.
      return 'text'
    case 'STRING':
    default:
      return 'text'
  }
}

export function shouldPromoteField(apiName: string, fieldType: string): boolean {
  if (ENVELOPE_FIELD_NAMES.has(apiName)) return false
  if (String(fieldType || '').toUpperCase() === 'ALIAS') return false
  // Postgres identifier safety: allow snake_case / alnum / underscore only.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(apiName)) return false
  return true
}

const storageCache = new Map<string, { value: CrmRecordRelation; expiresAt: number }>()
const STORAGE_TTL_MS = 30_000

export function clearCrmStorageCache(): void {
  storageCache.clear()
}

export async function loadPromotedFields(
  entityApiName: string,
): Promise<CrmPromotedField[]> {
  const rows = await query<{
    api_name: string
    field_type: string
    options: Record<string, unknown> | null
    is_indexed: boolean
    kind: string | null
    related_entity_api_name: string | null
    meta: Record<string, unknown> | null
  }>(
    `SELECT f.api_name,
            f.field_type,
            f.options,
            COALESCE(f.is_indexed, false) AS is_indexed,
            r.kind,
            re.api_name AS related_entity_api_name,
            r.meta
     FROM public.entities e
     JOIN public.fields f ON f.entity_id = e.id
     LEFT JOIN public.relations r
       ON r.field_id = f.id
      AND r.kind IN ('M2O', 'M2M', 'O2M')
     LEFT JOIN public.entities re ON re.id = r.related_entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
     ORDER BY f.sort, f.api_name`,
    [entityApiName],
  )

  // M2A junction extras: parent FK + polymorphic item (+ collection) live on many_collection.
  const m2aRows = await query<{
    many_field: string | null
    junction_field: string | null
    collection_field: string | null
  }>(
    `SELECT r.meta->>'many_field' AS many_field,
            COALESCE(r.meta->>'junction_field', 'item') AS junction_field,
            COALESCE(r.meta->>'collection_field', 'collection') AS collection_field
     FROM public.relations r
     WHERE r.kind = 'M2A'
       AND (
         r.meta->>'many_collection' = $1
         OR r.junction_entity_id = (
           SELECT id FROM public.entities
           WHERE api_name = $1 AND deleted_at IS NULL
           LIMIT 1
         )
       )`,
    [entityApiName],
  )

  const out: CrmPromotedField[] = []
  const seen = new Set<string>()

  const pushField = (
    apiName: string,
    fieldType: string,
    opts: {
      needsFkIndex: boolean
      needsBtreeIndex?: boolean
      relatedEntityApiName: string | null
      onDelete?: OnDeleteAction | null
      forceText?: boolean
      fieldOptions?: Record<string, unknown> | null
    },
  ): void => {
    if (!shouldPromoteField(apiName, fieldType)) return
    const useInSearch = opts.fieldOptions?.useInSearch === true
    if (seen.has(apiName)) {
      // Upgrade flags if we already promoted as a plain scalar.
      const existing = out.find((f) => f.apiName === apiName)
      if (existing) {
        if (opts.needsFkIndex) existing.needsFkIndex = true
        if (opts.needsBtreeIndex) existing.needsBtreeIndex = true
        if (opts.relatedEntityApiName && !existing.relatedEntityApiName) {
          existing.relatedEntityApiName = opts.relatedEntityApiName
          existing.canDeclareFk = true
          existing.pgType = 'text'
        }
        if (opts.onDelete && !existing.onDelete) {
          existing.onDelete = opts.onDelete
        }
        if (useInSearch) existing.useInSearch = true
        existing.needsBtreeIndex =
          existing.needsBtreeIndex || existing.needsFkIndex
      }
      return
    }
    seen.add(apiName)
    const related = opts.relatedEntityApiName
    const isFk = opts.needsFkIndex
    const needsBtreeIndex = Boolean(opts.needsBtreeIndex) || isFk
    out.push({
      apiName,
      fieldType,
      pgType:
        isFk || opts.forceText
          ? 'text'
          : pgTypeForFieldType(fieldType, opts.fieldOptions),
      needsFkIndex: isFk,
      needsBtreeIndex,
      canDeclareFk: Boolean(related),
      relatedEntityApiName: related,
      onDelete: opts.onDelete ?? null,
      useInSearch: isFk && useInSearch,
    })
  }

  for (const row of rows) {
    const kind = String(row.kind || '').toUpperCase()
    const meta = row.meta && typeof row.meta === 'object' ? row.meta : null
    const oneCollection =
      typeof meta?.one_collection === 'string' ? meta.one_collection.trim() : ''

    let needsFkIndex = false
    let related: string | null = row.related_entity_api_name
    let onDelete: OnDeleteAction | null = null

    if (kind === 'M2O') {
      needsFkIndex = true
      related =
        related ||
        (oneCollection && !['files', 'roles', 'users'].includes(oneCollection)
          ? oneCollection
          : null)
      // Platform targets still need an index even without crm FK.
      if (!related && oneCollection) needsFkIndex = true
      onDelete = normalizeOnDelete(meta?.on_delete)
    } else if (kind === 'M2M') {
      // Junction-side FK (one_field null) or many_field on this junction row.
      needsFkIndex = true
      related =
        related ||
        (oneCollection && !['files', 'roles', 'users'].includes(oneCollection)
          ? oneCollection
          : null)
    } else if (kind === 'O2M') {
      // Import shape: O2M row lives on junction; field is many_field (parent FK).
      needsFkIndex = true
      related =
        related ||
        (oneCollection && !['files', 'roles', 'users'].includes(oneCollection)
          ? oneCollection
          : null)
    }

    pushField(row.api_name, row.field_type, {
      needsFkIndex,
      needsBtreeIndex: Boolean(row.is_indexed),
      relatedEntityApiName: related,
      onDelete,
      fieldOptions: asObject(row.options),
    })
  }

  for (const m2a of m2aRows) {
    if (m2a.many_field) {
      pushField(m2a.many_field, 'STRING', {
        needsFkIndex: true,
        relatedEntityApiName: null, // resolved via parent entity elsewhere; visit_id often also M2O
        forceText: true,
      })
    }
    if (m2a.junction_field) {
      // Polymorphic item id — index for lookups; no single-table FK.
      pushField(m2a.junction_field, 'STRING', {
        needsFkIndex: true,
        relatedEntityApiName: null,
        forceText: true,
      })
    }
    if (m2a.collection_field) {
      pushField(m2a.collection_field, 'STRING', {
        needsFkIndex: true,
        relatedEntityApiName: null,
        forceText: true,
      })
    }
  }

  // If M2A many_field matches an existing column that already has related (e.g. visit_id M2O),
  // re-scan to attach related when possible.
  for (const field of out) {
    if (!field.needsFkIndex || field.relatedEntityApiName) continue
    const match = rows.find((r) => r.api_name === field.apiName)
    if (match?.related_entity_api_name) {
      field.relatedEntityApiName = match.related_entity_api_name
      field.canDeclareFk = true
    }
  }

  return out
}

async function loadEnvelopeFlags(entityApiName: string): Promise<{
  hasStatus: boolean
  hasDeleted: boolean
  hasActive: boolean
}> {
  const rows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
       AND f.api_name = ANY($2::text[])`,
    [entityApiName, ['status', 'is_deleted', 'is_active']],
  )
  const names = new Set(rows.map((row) => row.api_name))
  return {
    hasStatus: names.has('status'),
    hasDeleted: names.has('is_deleted'),
    hasActive: names.has('is_active'),
  }
}

/** Resolve where CRM rows for an entity live (typed crm_schema vs jsonb shared). */
export async function resolveRecordRelation(
  entityApiName: string,
): Promise<CrmRecordRelation> {
  const cached = storageCache.get(entityApiName)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const rows = await query<{ backend_config: unknown; display_template: string | null }>(
    `SELECT backend_config, display_template
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const config = resolveCrmStorageConfig(rows[0]?.backend_config, entityApiName)
  const displayTemplate = rows[0]?.display_template
    ? String(rows[0].display_template)
    : null
  const envelope = await loadEnvelopeFlags(entityApiName)

  let value: CrmRecordRelation
  if (config.storage === 'typed') {
    const promoted = await loadPromotedFields(entityApiName)
    value = {
      storage: 'typed',
      relationSql: crmQualifiedTable(config, entityApiName),
      needsEntityFilter: false,
      schema: config.schema,
      table: config.table || entityApiName,
      promoted,
      displayTemplate,
      ...envelope,
    }
  } else {
    value = {
      storage: 'jsonb',
      relationSql: 'public.business_records',
      needsEntityFilter: true,
      schema: 'public',
      table: 'business_records',
      promoted: [],
      displayTemplate,
      ...envelope,
    }
  }

  storageCache.set(entityApiName, {
    value,
    expiresAt: Date.now() + STORAGE_TTL_MS,
  })
  return value
}

/** Unwrap M2O / file link payloads (`{ id }`) before binding promoted columns. */
function unwrapRelationBindValue(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const id = (raw as { id?: unknown }).id
    if (id !== undefined && id !== null && id !== '') return id
  }
  return raw
}

/** Coerce a JSONB scalar into a JS value suitable for a promoted column bind. */
export function coercePromotedValue(
  field: CrmPromotedField,
  raw: unknown,
): unknown {
  if (raw === undefined || raw === null || raw === '') return null
  // jsonb keeps nested objects; scalar columns need FK / link ids unwrapped.
  const value =
    field.pgType === 'jsonb' ? raw : unwrapRelationBindValue(raw)
  if (value === undefined || value === null || value === '') return null
  if (isNumericPgType(field.pgType) || field.pgType === 'double precision') {
    const n = typeof value === 'number' ? value : Number(String(value))
    return Number.isFinite(n) ? n : null
  }
  switch (field.pgType) {
    case 'boolean': {
      if (typeof value === 'boolean') return value
      const s = String(value).toLowerCase()
      if (s === 'true' || s === '1') return true
      if (s === 'false' || s === '0') return false
      return null
    }
    case 'bigint': {
      const n = typeof value === 'number' ? value : Number(String(value))
      return Number.isFinite(n) ? Math.trunc(n) : null
    }
    case 'jsonb':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'date':
    case 'timestamptz':
    case 'text':
    case 'uuid':
    default:
      // Never String(object) — that becomes "[object Object]" in UUID/text FKs.
      if (typeof value === 'object') return null
      return String(value)
  }
}
