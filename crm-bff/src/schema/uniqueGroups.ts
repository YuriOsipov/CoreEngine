/**
 * Registry unique groups → crm_schema UNIQUE indexes (Directus-style avoid-duplicates).
 */
import { query } from '../db/pool.js'
import {
  CRM_SCHEMA,
  crmQualifiedTable,
  quoteIdent,
  resolveCrmStorageConfig,
  shouldPromoteField,
} from './crmStorage.js'

export interface EntityUniqueGroup {
  /** Stable index suffix / label (snake_case preferred). */
  name: string
  /** Field api_names that must be unique together. */
  fields: string[]
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function sanitizeIndexPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40)
}

/** Parse uniqueGroups array from entities.backend_config. */
export function parseUniqueGroupsFromConfig(backendConfig: unknown): EntityUniqueGroup[] {
  const config = asObject(backendConfig)
  const raw = config.uniqueGroups
  if (!Array.isArray(raw)) return []
  const out: EntityUniqueGroup[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const fields = Array.isArray(row.fields)
      ? row.fields.map(String).map((f) => f.trim()).filter(Boolean)
      : []
    if (!fields.length) continue
    const nameRaw =
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : fields.join('_')
    const name = sanitizeIndexPart(nameRaw) || 'group'
    const key = `${name}:${fields.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, fields })
  }
  return out
}

/**
 * Effective unique groups for an entity: backend_config.uniqueGroups
 * plus one synthetic group per fields.is_unique = true.
 */
export async function loadEntityUniqueGroups(
  entityApiName: string,
): Promise<EntityUniqueGroup[]> {
  const entities = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const fromConfig = parseUniqueGroupsFromConfig(entities[0]?.backend_config)

  const uniqueFields = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
       AND f.is_unique = true
     ORDER BY f.sort, f.api_name`,
    [entityApiName],
  )

  const out = [...fromConfig]
  const covered = new Set(
    fromConfig
      .filter((g) => g.fields.length === 1)
      .map((g) => g.fields[0]!),
  )
  for (const row of uniqueFields) {
    if (covered.has(row.api_name)) continue
    if (!shouldPromoteField(row.api_name, 'STRING') && row.api_name !== 'id') {
      // still allow known envelope skips except we never unique on id/status via is_unique typically
    }
    out.push({
      name: `field_${sanitizeIndexPart(row.api_name)}`,
      fields: [row.api_name],
    })
    covered.add(row.api_name)
  }
  return out
}

export function uniqueIndexName(entityApiName: string, group: EntityUniqueGroup): string {
  return `uq_${sanitizeIndexPart(entityApiName)}_${sanitizeIndexPart(group.name)}`
}

/** Build CREATE UNIQUE INDEX SQL for a typed CRM table (partial: non-archived). */
export function buildUniqueIndexSql(
  entityApiName: string,
  group: EntityUniqueGroup,
  schema: string = CRM_SCHEMA,
  table: string = entityApiName,
  options?: { archive?: 'deleted' | 'status' | 'none' },
): string | null {
  const cols = group.fields.filter((f) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f))
  if (!cols.length) return null
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const idx = quoteIdent(uniqueIndexName(entityApiName, group))
  const colSql = cols.map((c) => quoteIdent(c)).join(', ')
  const archive = options?.archive ?? 'deleted'
  const statusPredicate =
    archive === 'deleted'
      ? `\n    WHERE is_deleted IS NOT TRUE`
      : archive === 'status'
        ? `\n    WHERE status IS DISTINCT FROM 'archived'`
        : ''
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${idx}
    ON ${relation} (${colSql})${statusPredicate}`
}

export async function listExistingUniqueIndexNames(
  entityApiName: string,
  schema: string = CRM_SCHEMA,
): Promise<string[]> {
  const rows = await query<{ indexname: string }>(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = $1
       AND tablename = $2
       AND indexname LIKE $3`,
    [schema, entityApiName, `uq_${sanitizeIndexPart(entityApiName)}_%`],
  )
  return rows.map((r) => r.indexname)
}

export interface UniqueIndexAction {
  type: 'CREATE_UNIQUE_INDEX' | 'DROP_UNIQUE_INDEX'
  entityApiName: string
  indexName: string
  sql: string
  group?: EntityUniqueGroup
}

/** Plan create/drop unique indexes to match registry unique groups. */
export async function planUniqueIndexActions(
  entityApiName: string,
): Promise<UniqueIndexAction[]> {
  const entityRows = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  if (!entityRows[0]) return []
  const storage = resolveCrmStorageConfig(entityRows[0].backend_config, entityApiName)
  if (storage.storage !== 'typed') return []

  const schema = storage.schema || CRM_SCHEMA
  const table = storage.table || entityApiName
  const groups = await loadEntityUniqueGroups(entityApiName)
  const archiveRows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
       AND f.api_name = ANY($2::text[])`,
    [entityApiName, ['is_deleted', 'status']],
  )
  const archiveNames = new Set(archiveRows.map((row) => row.api_name))
  const archive = archiveNames.has('is_deleted')
    ? 'deleted'
    : archiveNames.has('status')
      ? 'status'
      : 'none'
  const desired = new Map<string, { group: EntityUniqueGroup; sql: string }>()
  for (const group of groups) {
    const sql = buildUniqueIndexSql(entityApiName, group, schema, table, {
      archive,
    })
    if (!sql) continue
    desired.set(uniqueIndexName(entityApiName, group), { group, sql })
  }

  const existing = await listExistingUniqueIndexNames(entityApiName, schema)
  const actions: UniqueIndexAction[] = []

  for (const indexName of existing) {
    if (desired.has(indexName)) continue
    actions.push({
      type: 'DROP_UNIQUE_INDEX',
      entityApiName,
      indexName,
      sql: `DROP INDEX IF EXISTS ${quoteIdent(schema)}.${quoteIdent(indexName)}`,
    })
  }

  for (const [indexName, { group, sql }] of desired) {
    if (existing.includes(indexName)) continue
    actions.push({
      type: 'CREATE_UNIQUE_INDEX',
      entityApiName,
      indexName,
      sql,
      group,
    })
  }

  return actions
}

export async function applyUniqueIndexActions(
  actions: UniqueIndexAction[],
): Promise<void> {
  for (const action of actions) {
    await query(action.sql)
  }
}

/** Persist uniqueGroups into entities.backend_config (replaces uniqueGroups key only). */
export async function saveEntityUniqueGroups(
  entityApiName: string,
  groups: EntityUniqueGroup[],
): Promise<EntityUniqueGroup[]> {
  const normalized = groups
    .map((g) => ({
      name: sanitizeIndexPart(g.name || g.fields.join('_')) || 'group',
      fields: g.fields.map((f) => f.trim()).filter(Boolean),
    }))
    .filter((g) => g.fields.length > 0)

  const patch = JSON.stringify({ uniqueGroups: normalized })
  await query(
    `UPDATE public.entities
     SET backend_config = COALESCE(backend_config, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE api_name = $1 AND deleted_at IS NULL`,
    [entityApiName, patch],
  )
  return normalized
}

export async function setFieldIsUnique(
  entityApiName: string,
  fieldApiName: string,
  isUnique: boolean,
): Promise<boolean> {
  const rows = await query<{ api_name: string }>(
    `UPDATE public.fields f
     SET is_unique = $3,
         updated_at = now()
     FROM public.entities e
     WHERE f.entity_id = e.id
       AND e.api_name = $1
       AND e.deleted_at IS NULL
       AND f.api_name = $2
     RETURNING f.api_name`,
    [entityApiName, fieldApiName, isUnique],
  )
  return rows.length > 0
}

/** Map Postgres unique_violation (23505) to a readable message. */
export function formatUniqueViolationError(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const pg = err as { code?: string; constraint?: string; detail?: string; message?: string }
  if (pg.code !== '23505') return null
  const detail = pg.detail || pg.message || 'duplicate key value'
  const constraint = pg.constraint ? ` (${pg.constraint})` : ''
  return `Unique constraint violated${constraint}: ${detail}`
}
