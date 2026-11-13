/**
 * crm_schema DDL sync engine: registry fields/relations → physical columns,
 * indexes, optional FKs, and jsonb `data` backfill.
 *
 * Used by schema-sync (Setup) and migrate-entity-records (--apply).
 */
import { query } from '../db/pool.js'
import {
  CRM_SCHEMA,
  clearCrmStorageCache,
  crmQualifiedTable,
  isNumericPgType,
  loadPromotedFields,
  normalizeOnDelete,
  quoteIdent,
  resolveCrmStorageConfig,
  type CrmPromotedField,
  type OnDeleteAction,
} from './crmStorage.js'

export type DdlActionType =
  | 'ENSURE_SCHEMA'
  | 'CREATE_TABLE'
  | 'ADD_COLUMN'
  | 'COERCE_FK_TEXT'
  | 'COERCE_COLUMN_TYPE'
  | 'CREATE_INDEX'
  | 'CREATE_FK'
  | 'BACKFILL_COLUMN'
  | 'ENSURE_TRIGGER'

export interface DdlAction {
  type: DdlActionType
  entityApiName: string
  fieldApiName?: string
  sql: string
  message: string
}

export interface TypedColumnInfo {
  columnName: string
  dataType: string
  udtName: string
  numericPrecision: number | null
  numericScale: number | null
}

export interface DdlDriftItem {
  kind:
    | 'ENTITY_MISSING_IN_BACKEND'
    | 'FIELD_MISSING_IN_BACKEND'
    | 'FIELD_TYPE_MISMATCH'
    | 'FIELD_CREATED'
    | 'RELATION_CREATED'
  entityApiName: string
  fieldApiName?: string
  registryValue?: string | null
  backendValue?: string | null
  message: string
}

export interface PlanEntityDdlOptions {
  /** Plan M2O/junction FOREIGN KEY constraints (default true for schema-sync). */
  includeFk?: boolean
  /** Plan UPDATE … SET col FROM data->>'col' for newly added columns (default true). */
  includeBackfill?: boolean
  schema?: string
  table?: string
}

function sanitizeIdentPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_')
}

async function resolveEntityTypedStorage(
  entityApiName: string,
  options: Pick<PlanEntityDdlOptions, 'schema' | 'table'>,
): Promise<{ schema: string; table: string }> {
  if (options.schema && options.table) {
    return { schema: options.schema, table: options.table }
  }
  const rows = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const config = resolveCrmStorageConfig(rows[0]?.backend_config, entityApiName)
  return {
    schema: options.schema || config.schema || CRM_SCHEMA,
    table: options.table || config.table || entityApiName,
  }
}

function normalizePgType(
  dataType: string,
  udtName: string,
  numericPrecision?: number | null,
  numericScale?: number | null,
): string {
  const dt = String(dataType || '').toLowerCase()
  const udt = String(udtName || '').toLowerCase()
  if (dt === 'boolean' || udt === 'bool') return 'boolean'
  if (dt === 'bigint' || udt === 'int8') return 'bigint'
  if (dt === 'integer' || udt === 'int4') return 'integer'
  if (dt === 'double precision' || udt === 'float8') return 'double precision'
  if (dt === 'real' || udt === 'float4') return 'real'
  if (dt === 'numeric' || udt === 'numeric') {
    const p =
      numericPrecision != null && Number.isFinite(Number(numericPrecision))
        ? Math.trunc(Number(numericPrecision))
        : null
    const s =
      numericScale != null && Number.isFinite(Number(numericScale))
        ? Math.trunc(Number(numericScale))
        : null
    if (p != null && s != null) return `numeric(${p},${s})`
    return 'numeric'
  }
  if (dt === 'jsonb' || udt === 'jsonb') return 'jsonb'
  if (dt === 'json' || udt === 'json') return 'json'
  if (dt === 'date' || udt === 'date') return 'date'
  if (dt === 'timestamp with time zone' || udt === 'timestamptz') return 'timestamptz'
  if (dt === 'timestamp without time zone' || udt === 'timestamp') return 'timestamp'
  if (dt === 'text' || udt === 'text') return 'text'
  if (dt === 'character varying' || udt === 'varchar') return 'text'
  if (dt === 'uuid' || udt === 'uuid') return 'uuid'
  return udt || dt || 'unknown'
}

function columnNormalizedType(col: TypedColumnInfo): string {
  return normalizePgType(
    col.dataType,
    col.udtName,
    col.numericPrecision,
    col.numericScale,
  )
}

function typesCompatible(expected: string, actual: string): boolean {
  const e = expected.toLowerCase()
  const a = actual.toLowerCase()
  if (e === a) return true
  // FK / id scalars are always text in crm_schema.
  if (e === 'text' && (a === 'text' || a === 'uuid' || a === 'varchar')) return true
  if (e === 'bigint' && (a === 'bigint' || a === 'integer')) return true
  return false
}

/** USING expression for safe column type coercion during DDL sync. */
function coerceUsingExpr(columnIdent: string, expectedPgType: string): string {
  const expected = expectedPgType.toLowerCase()
  const textExpr = `NULLIF(btrim(${columnIdent}::text), '')`
  if (expected === 'double precision' || expected === 'real' || isNumericPgType(expected)) {
    return `CASE
      WHEN ${textExpr} IS NULL THEN NULL
      WHEN ${textExpr} ~ '^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$'
        THEN ${textExpr}::${expected}
      ELSE NULL
    END`
  }
  if (expected === 'bigint' || expected === 'integer') {
    return `CASE
      WHEN ${textExpr} IS NULL THEN NULL
      WHEN ${textExpr} ~ '^-?[0-9]+$' THEN ${textExpr}::${expected}
      ELSE NULL
    END`
  }
  if (expected === 'boolean') {
    return `CASE
      WHEN lower(${textExpr}) IN ('true', 't', '1', 'yes') THEN true
      WHEN lower(${textExpr}) IN ('false', 'f', '0', 'no') THEN false
      ELSE NULL
    END`
  }
  if (expected === 'timestamptz' || expected === 'timestamp' || expected === 'date') {
    return `${textExpr}::${expected}`
  }
  if (expected === 'jsonb' || expected === 'json') {
    return `${textExpr}::${expected}`
  }
  if (expected === 'text') {
    return `${columnIdent}::text`
  }
  return `${columnIdent}::${expected}`
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${schema}.${table}`],
  )
  return Boolean(rows[0]?.exists)
}

async function schemaExists(schema: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_namespace WHERE nspname = $1
     ) AS exists`,
    [schema],
  )
  return Boolean(rows[0]?.exists)
}

export async function listTypedTableColumns(
  schema: string,
  table: string,
): Promise<TypedColumnInfo[]> {
  return query<TypedColumnInfo>(
    `SELECT column_name AS "columnName",
            data_type AS "dataType",
            udt_name AS "udtName",
            numeric_precision AS "numericPrecision",
            numeric_scale AS "numericScale"
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  )
}

async function listIndexNames(schema: string, table: string): Promise<Set<string>> {
  const rows = await query<{ indexname: string }>(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = $1
       AND tablename = $2`,
    [schema, table],
  )
  return new Set(rows.map((r) => r.indexname))
}

async function constraintExists(name: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = $1
     ) AS exists`,
    [name],
  )
  return Boolean(rows[0]?.exists)
}

/** Returns `schema.table` for an FK constraint, or null if missing. */
async function foreignKeyTarget(constraintName: string): Promise<string | null> {
  const rows = await query<{ ref: string | null }>(
    `SELECT
       CASE
         WHEN c.oid IS NULL THEN NULL
         ELSE n.nspname || '.' || rel.relname
       END AS ref
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.confrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE c.conname = $1
       AND c.contype = 'f'
     LIMIT 1`,
    [constraintName],
  )
  return rows[0]?.ref ?? null
}

/**
 * Postgres `pg_constraint.confdeltype` → ON DELETE action.
 * a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
 */
async function foreignKeyOnDelete(
  constraintName: string,
): Promise<OnDeleteAction | null> {
  const rows = await query<{ confdeltype: string | null }>(
    `SELECT c.confdeltype::text AS confdeltype
     FROM pg_constraint c
     WHERE c.conname = $1
       AND c.contype = 'f'
     LIMIT 1`,
    [constraintName],
  )
  const code = rows[0]?.confdeltype
  if (!code) return null
  if (code === 'c') return 'CASCADE'
  if (code === 'n') return 'SET NULL'
  // Treat NO ACTION like RESTRICT for Setup (both block parent delete).
  if (code === 'r' || code === 'a') return 'RESTRICT'
  return 'RESTRICT'
}

async function triggerExists(
  schema: string,
  table: string,
  triggerName: string,
): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal
         AND n.nspname = $1
         AND c.relname = $2
         AND t.tgname = $3
     ) AS exists`,
    [schema, table, triggerName],
  )
  return Boolean(rows[0]?.exists)
}

function planUpdatedAtTrigger(
  entityApiName: string,
  schema: string,
  table: string,
  force: boolean,
  exists: boolean,
): DdlAction[] {
  if (!force && exists) return []
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const triggerName = `trg_${sanitizeIdentPart(entityApiName)}_updated_at`
  return [
    {
      type: 'ENSURE_TRIGGER',
      entityApiName,
      sql: `DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON ${relation}`,
      message: `Drop legacy trigger ${triggerName}`,
    },
    {
      type: 'ENSURE_TRIGGER',
      entityApiName,
      sql: `CREATE TRIGGER ${quoteIdent(triggerName)}
     BEFORE UPDATE ON ${relation}
     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()`,
      message: `Create updated_at trigger ${triggerName}`,
    },
  ]
}

function buildCreateTableSql(
  entityApiName: string,
  promoted: CrmPromotedField[],
  schema: string,
  table: string,
  envelope: { includeStatus: boolean; includeDeleted: boolean; includeActive: boolean },
): string {
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const cols = [
    'record_id text PRIMARY KEY',
    ...(envelope.includeStatus ? [`status text NOT NULL DEFAULT 'published'`] : []),
    ...(envelope.includeDeleted
      ? ['is_deleted boolean NOT NULL DEFAULT false']
      : []),
    ...(envelope.includeActive ? ['is_active boolean NOT NULL DEFAULT true'] : []),
    `data jsonb NOT NULL DEFAULT '{}'::jsonb`,
    'created_at timestamptz NOT NULL DEFAULT now()',
    'updated_at timestamptz NOT NULL DEFAULT now()',
    ...promoted.map((f) => `${quoteIdent(f.apiName)} ${f.pgType}`),
  ]
  return `CREATE TABLE IF NOT EXISTS ${relation} (\n  ${cols.join(',\n  ')}\n)`
}

function buildBackfillSql(
  entityApiName: string,
  field: CrmPromotedField,
  schema: string,
  table: string,
): string {
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const col = quoteIdent(field.apiName)
  const key = field.apiName.replace(/'/g, "''")
  const raw = `data->>'${key}'`

  if (isNumericPgType(field.pgType) || field.pgType === 'double precision') {
    return `UPDATE ${relation}
  SET ${col} = CASE
    WHEN ${raw} ~ '^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (${raw})::${field.pgType}
    ELSE NULL
  END
  WHERE ${col} IS NULL
    AND data ? '${key}'
    AND NULLIF(${raw}, '') IS NOT NULL`
  }

  switch (field.pgType) {
    case 'boolean':
      return `UPDATE ${relation}
  SET ${col} = CASE
    WHEN lower(${raw}) IN ('true', '1') THEN true
    WHEN lower(${raw}) IN ('false', '0') THEN false
    ELSE NULL
  END
  WHERE ${col} IS NULL
    AND data ? '${key}'
    AND NULLIF(${raw}, '') IS NOT NULL`
    case 'bigint':
      return `UPDATE ${relation}
  SET ${col} = CASE
    WHEN ${raw} ~ '^-?[0-9]+$' THEN (${raw})::bigint
    ELSE NULL
  END
  WHERE ${col} IS NULL
    AND data ? '${key}'
    AND NULLIF(${raw}, '') IS NOT NULL`
    case 'jsonb':
      // Parentheses required: `data->>'k'::jsonb` casts the key literal, not the value.
      return `UPDATE ${relation}
  SET ${col} = CASE
    WHEN jsonb_typeof(data->'${key}') IS NOT NULL THEN data->'${key}'
    WHEN NULLIF(${raw}, '') IS NOT NULL THEN (${raw})::jsonb
    ELSE NULL
  END
  WHERE ${col} IS NULL
    AND data ? '${key}'`
    case 'date':
      return `UPDATE ${relation}
  SET ${col} = CASE
    WHEN NULLIF(${raw}, '') IS NOT NULL THEN (${raw})::date
    ELSE NULL
  END
  WHERE ${col} IS NULL
    AND data ? '${key}'
    AND NULLIF(${raw}, '') IS NOT NULL`
    case 'timestamptz':
      return `UPDATE ${relation}
  SET ${col} = CASE
    WHEN NULLIF(${raw}, '') IS NOT NULL THEN (${raw})::timestamptz
    ELSE NULL
  END
  WHERE ${col} IS NULL
    AND data ? '${key}'
    AND NULLIF(${raw}, '') IS NOT NULL`
    case 'text':
    default:
      return `UPDATE ${relation}
  SET ${col} = NULLIF(${raw}, '')
  WHERE ${col} IS NULL
    AND data ? '${key}'
    AND NULLIF(${raw}, '') IS NOT NULL`
  }
}

async function entityHasRegistryField(
  entityApiName: string,
  fieldApiName: string,
): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.fields f
       JOIN public.entities e ON e.id = f.entity_id
       WHERE e.api_name = $1
         AND e.deleted_at IS NULL
         AND f.api_name = $2
     ) AS exists`,
    [entityApiName, fieldApiName],
  )
  return Boolean(rows[0]?.exists)
}

/** Envelope columns from CREATE TABLE; archive/status columns follow the registry. */
function planEnvelopeColumns(
  entityApiName: string,
  schema: string,
  table: string,
  byName: Map<string, string>,
  envelope: { includeStatus: boolean; includeDeleted: boolean; includeActive: boolean },
): DdlAction[] {
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const specs: Array<{ name: string; ddl: string; include: boolean }> = [
    { name: 'data', ddl: `jsonb NOT NULL DEFAULT '{}'::jsonb`, include: true },
    {
      name: 'created_at',
      ddl: 'timestamptz NOT NULL DEFAULT now()',
      include: true,
    },
    {
      name: 'updated_at',
      ddl: 'timestamptz NOT NULL DEFAULT now()',
      include: true,
    },
    {
      name: 'status',
      ddl: `text NOT NULL DEFAULT 'published'`,
      include: envelope.includeStatus,
    },
    {
      name: 'is_deleted',
      ddl: 'boolean NOT NULL DEFAULT false',
      include: envelope.includeDeleted,
    },
    {
      name: 'is_active',
      ddl: 'boolean NOT NULL DEFAULT true',
      include: envelope.includeActive,
    },
  ]
  const actions: DdlAction[] = []
  for (const spec of specs) {
    if (!spec.include || byName.has(spec.name)) continue
    actions.push({
      type: 'ADD_COLUMN',
      entityApiName,
      fieldApiName: spec.name,
      sql: `ALTER TABLE ${relation}
       ADD COLUMN IF NOT EXISTS ${quoteIdent(spec.name)} ${spec.ddl}`,
      message: `Add envelope column ${entityApiName}.${spec.name}`,
    })
  }
  return actions
}

function planStandardIndexes(
  entityApiName: string,
  promoted: CrmPromotedField[],
  schema: string,
  table: string,
  existingIndexes: Set<string> | null,
  options?: { hasStatusColumn?: boolean; hasDeletedColumn?: boolean },
): DdlAction[] {
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const actions: DdlAction[] = []
  const pushIndex = (indexName: string, sql: string, message: string) => {
    if (existingIndexes?.has(indexName)) return
    actions.push({
      type: 'CREATE_INDEX',
      entityApiName,
      sql,
      message,
    })
  }

  if (options?.hasStatusColumn) {
    const statusIdx = `${sanitizeIdentPart(entityApiName)}_status_idx`
    pushIndex(
      statusIdx,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(statusIdx)} ON ${relation} (status)`,
      `Index ${statusIdx}`,
    )
  }
  if (options?.hasDeletedColumn) {
    const deletedIdx = `${sanitizeIdentPart(entityApiName)}_is_deleted_idx`
    pushIndex(
      deletedIdx,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(deletedIdx)} ON ${relation} (is_deleted)`,
      `Index ${deletedIdx}`,
    )
  }
  const updatedIdx = `${sanitizeIdentPart(entityApiName)}_updated_idx`
  pushIndex(
    updatedIdx,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(updatedIdx)} ON ${relation} (updated_at DESC)`,
    `Index ${updatedIdx}`,
  )
  const dataIdx = `${sanitizeIdentPart(entityApiName)}_data_gin_idx`
  pushIndex(
    dataIdx,
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(dataIdx)} ON ${relation} USING gin (data)`,
    `Index ${dataIdx}`,
  )

  for (const field of promoted) {
    if (!field.needsBtreeIndex && !field.needsFkIndex) continue
    const idxName = `${sanitizeIdentPart(entityApiName)}_${sanitizeIdentPart(field.apiName)}_idx`
    pushIndex(
      idxName,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(idxName)}
       ON ${relation} (${quoteIdent(field.apiName)})`,
      field.needsFkIndex
        ? `FK index ${entityApiName}.${field.apiName}`
        : `Indexed field ${entityApiName}.${field.apiName}`,
    )
  }

  const m2aCollection = promoted.find((f) => f.apiName === 'collection' && f.needsFkIndex)
  const m2aItem = promoted.find((f) => f.apiName === 'item' && f.needsFkIndex)
  if (m2aCollection && m2aItem) {
    const idxName = `${sanitizeIdentPart(entityApiName)}_collection_item_idx`
    pushIndex(
      idxName,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(idxName)}
       ON ${relation} (${quoteIdent('collection')}, ${quoteIdent('item')})`,
      `M2A composite index ${entityApiName}(collection, item)`,
    )
  }

  return actions
}

async function planForeignKeys(
  entityApiName: string,
  promoted: CrmPromotedField[],
  schema: string,
  table: string,
): Promise<DdlAction[]> {
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const actions: DdlAction[] = []

  for (const field of promoted) {
    if (!field.canDeclareFk || !field.relatedEntityApiName) continue
    const related = field.relatedEntityApiName
    // Related table may live in another schema (e.g. pm_schema vs crm_schema).
    const relatedStorage = await resolveEntityTypedStorage(related, {})
    const relatedExists = await tableExists(relatedStorage.schema, relatedStorage.table)
    if (!relatedExists) {
      actions.push({
        type: 'CREATE_FK',
        entityApiName,
        fieldApiName: field.apiName,
        sql: `-- skip FK ${entityApiName}.${field.apiName}: related table ${relatedStorage.schema}.${relatedStorage.table} missing`,
        message: `Skip FK ${entityApiName}.${field.apiName} → ${relatedStorage.schema}.${relatedStorage.table} (table missing)`,
      })
      continue
    }

    const constraint = `fk_${sanitizeIdentPart(entityApiName)}_${sanitizeIdentPart(field.apiName)}`
    const relatedTable = crmQualifiedTable(
      { schema: relatedStorage.schema, table: relatedStorage.table },
      related,
    )
    const expectedRef = `${relatedStorage.schema}.${relatedStorage.table}`
    const onDelete = normalizeOnDelete(field.onDelete)
    const existingRef = await foreignKeyTarget(constraint)
    const existingOnDelete = existingRef
      ? await foreignKeyOnDelete(constraint)
      : null
    const targetOk = existingRef === expectedRef
    const ruleOk = existingOnDelete === onDelete
    if (targetOk && ruleOk) continue
    if (existingRef) {
      const reason = !targetOk
        ? `was → ${existingRef}`
        : `ON DELETE ${existingOnDelete ?? '?'} → ${onDelete}`
      actions.push({
        type: 'CREATE_FK',
        entityApiName,
        fieldApiName: field.apiName,
        sql: `ALTER TABLE ${relation} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraint)}`,
        message: `Drop FK ${constraint} (${reason})`,
      })
    }

    const sql = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = '${constraint.replace(/'/g, "''")}'
  ) THEN
    ALTER TABLE ${relation}
      ADD CONSTRAINT ${quoteIdent(constraint)}
      FOREIGN KEY (${quoteIdent(field.apiName)})
      REFERENCES ${relatedTable} (record_id)
      ON DELETE ${onDelete}
      NOT VALID;
  END IF;
END $$;`

    actions.push({
      type: 'CREATE_FK',
      entityApiName,
      fieldApiName: field.apiName,
      sql,
      message: `FK ${constraint}: ${entityApiName}.${field.apiName} → ${expectedRef}.record_id ON DELETE ${onDelete}`,
    })
  }

  return actions
}

/**
 * Plan DDL to bring the entity's typed table in line with registry promoted fields.
 * Uses entities.backend_config schema/table (e.g. pm_schema), not always crm_schema.
 * Idempotent; dry-run safe (no writes).
 */
export async function planEntityDdlSync(
  entityApiName: string,
  options: PlanEntityDdlOptions = {},
): Promise<DdlAction[]> {
  const includeFk = options.includeFk !== false
  const includeBackfill = options.includeBackfill !== false
  const { schema, table } = await resolveEntityTypedStorage(entityApiName, options)
  const promoted = await loadPromotedFields(entityApiName)
  const relation = crmQualifiedTable({ schema, table }, entityApiName)
  const actions: DdlAction[] = []

  // Skip CREATE SCHEMA when it already exists — app roles often lack CREATE on
  // the database, and IF NOT EXISTS still requires that privilege in Postgres.
  if (!(await schemaExists(schema))) {
    actions.push({
      type: 'ENSURE_SCHEMA',
      entityApiName,
      sql: `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`,
      message: `Ensure schema ${schema}`,
    })
  }

  const exists = await tableExists(schema, table)
  const envelopeFlags = {
    includeStatus: await entityHasRegistryField(entityApiName, 'status'),
    includeDeleted: await entityHasRegistryField(entityApiName, 'is_deleted'),
    includeActive: await entityHasRegistryField(entityApiName, 'is_active'),
  }

  if (!exists) {
    actions.push({
      type: 'CREATE_TABLE',
      entityApiName,
      sql: buildCreateTableSql(entityApiName, promoted, schema, table, envelopeFlags),
      message: `Create table ${schema}.${table} (${promoted.length} promoted columns)`,
    })

    actions.push(...planUpdatedAtTrigger(entityApiName, schema, table, true, false))
    actions.push(
      ...planStandardIndexes(entityApiName, promoted, schema, table, null, {
        hasStatusColumn: envelopeFlags.includeStatus,
        hasDeletedColumn: envelopeFlags.includeDeleted,
      }),
    )

    if (includeFk) {
      actions.push(...(await planForeignKeys(entityApiName, promoted, schema, table)))
    }
    return actions
  }

  const columns = await listTypedTableColumns(schema, table)
  const byName = new Map(
    columns.map((c) => [c.columnName, columnNormalizedType(c)]),
  )
  const envelope = planEnvelopeColumns(
    entityApiName,
    schema,
    table,
    byName,
    envelopeFlags,
  )
  actions.push(...envelope)
  const hasStatusColumn =
    byName.has('status') || envelope.some((action) => action.fieldApiName === 'status')
  const hasDeletedColumn =
    byName.has('is_deleted') ||
    envelope.some((action) => action.fieldApiName === 'is_deleted')
  const existingIndexes = await listIndexNames(schema, table)
  const triggerName = `trg_${sanitizeIdentPart(entityApiName)}_updated_at`
  const hasTrigger = await triggerExists(schema, table, triggerName)
  actions.push(...planUpdatedAtTrigger(entityApiName, schema, table, false, hasTrigger))

  for (const field of promoted) {
    if (!byName.has(field.apiName)) {
      actions.push({
        type: 'ADD_COLUMN',
        entityApiName,
        fieldApiName: field.apiName,
        sql: `ALTER TABLE ${relation}
       ADD COLUMN IF NOT EXISTS ${quoteIdent(field.apiName)} ${field.pgType}`,
        message: `Add column ${entityApiName}.${field.apiName} (${field.pgType})`,
      })
      if (includeBackfill) {
        actions.push({
          type: 'BACKFILL_COLUMN',
          entityApiName,
          fieldApiName: field.apiName,
          sql: buildBackfillSql(entityApiName, field, schema, table),
          message: `Backfill ${entityApiName}.${field.apiName} from data->>'${field.apiName}'`,
        })
      }
      continue
    }

    const actual = byName.get(field.apiName)!
    if (field.needsFkIndex && actual !== 'text') {
      actions.push({
        type: 'COERCE_FK_TEXT',
        entityApiName,
        fieldApiName: field.apiName,
        sql: `ALTER TABLE ${relation}
       ALTER COLUMN ${quoteIdent(field.apiName)} TYPE text
       USING NULLIF(${quoteIdent(field.apiName)}::text, '')`,
        message: `Coerce FK column ${entityApiName}.${field.apiName} ${actual} → text`,
      })
      continue
    }

    const expected = field.needsFkIndex ? 'text' : field.pgType
    if (!typesCompatible(expected, actual)) {
      const col = quoteIdent(field.apiName)
      actions.push({
        type: 'COERCE_COLUMN_TYPE',
        entityApiName,
        fieldApiName: field.apiName,
        sql: `ALTER TABLE ${relation}
       ALTER COLUMN ${col} TYPE ${expected}
       USING ${coerceUsingExpr(col, expected)}`,
        message: `Coerce column ${entityApiName}.${field.apiName} ${actual} → ${expected}`,
      })
    }
  }

  actions.push(
    ...planStandardIndexes(entityApiName, promoted, schema, table, existingIndexes, {
      hasStatusColumn,
      hasDeletedColumn,
    }),
  )

  if (includeFk) {
    actions.push(...(await planForeignKeys(entityApiName, promoted, schema, table)))
  }

  return actions
}

/** Apply planned DDL actions. Skips comment-only `-- skip` SQL. */
export async function applyDdlActions(actions: DdlAction[]): Promise<{
  applied: number
  skipped: number
  errors: Array<{ action: DdlAction; error: string }>
}> {
  let applied = 0
  let skipped = 0
  const errors: Array<{ action: DdlAction; error: string }> = []

  for (const action of actions) {
    const sql = action.sql.trim()
    if (!sql || sql.startsWith('--')) {
      skipped += 1
      continue
    }
    try {
      await query(sql)
      applied += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // FK failures are non-fatal (orphan data, type edge cases).
      if (action.type === 'CREATE_FK') {
        errors.push({ action, error: message })
        skipped += 1
        continue
      }
      throw err
    }
  }

  clearCrmStorageCache()
  return { applied, skipped, errors }
}

/**
 * Compare registry promoted fields to physical crm_schema columns.
 * Returns drift items (empty when in sync).
 */
export async function detectTypedTableDrift(
  entityApiName: string,
  backendConfig?: unknown,
): Promise<DdlDriftItem[]> {
  const config = resolveCrmStorageConfig(backendConfig, entityApiName)
  if (config.storage !== 'typed') {
    return [
      {
        kind: 'ENTITY_MISSING_IN_BACKEND',
        entityApiName,
        message: `Entity uses jsonb storage (public.business_records); typed DDL sync skipped`,
        registryValue: 'typed expected for DDL',
        backendValue: 'jsonb',
      },
    ]
  }

  const schema = config.schema || CRM_SCHEMA
  const table = config.table || entityApiName
  const promoted = await loadPromotedFields(entityApiName)
  const exists = await tableExists(schema, table)
  const drift: DdlDriftItem[] = []

  if (!exists) {
    drift.push({
      kind: 'ENTITY_MISSING_IN_BACKEND',
      entityApiName,
      message: `Typed table ${schema}.${table} does not exist`,
      registryValue: entityApiName,
      backendValue: null,
    })
    for (const field of promoted) {
      drift.push({
        kind: 'FIELD_MISSING_IN_BACKEND',
        entityApiName,
        fieldApiName: field.apiName,
        registryValue: field.pgType,
        backendValue: null,
        message: `Column ${field.apiName} missing (table absent)`,
      })
    }
    return drift
  }

  const columns = await listTypedTableColumns(schema, table)
  const byName = new Map(
    columns.map((c) => [c.columnName, columnNormalizedType(c)]),
  )

  for (const field of promoted) {
    const actual = byName.get(field.apiName)
    if (!actual) {
      drift.push({
        kind: 'FIELD_MISSING_IN_BACKEND',
        entityApiName,
        fieldApiName: field.apiName,
        registryValue: field.pgType,
        backendValue: null,
        message: `Column ${schema}.${table}.${field.apiName} missing`,
      })
      continue
    }
    const expected = field.needsFkIndex ? 'text' : field.pgType
    if (!typesCompatible(expected, actual)) {
      drift.push({
        kind: 'FIELD_TYPE_MISMATCH',
        entityApiName,
        fieldApiName: field.apiName,
        registryValue: expected,
        backendValue: actual,
        message: `Column ${field.apiName} type mismatch: registry=${expected} backend=${actual}`,
      })
    }
  }

  return drift
}

/** Filter plan to meaningful actions for dry-run / job summaries. */
export function summarizeDdlActions(actions: DdlAction[]): DdlAction[] {
  return actions.filter((a) => {
    if (a.type === 'ENSURE_SCHEMA') return false
    if (a.type === 'ENSURE_TRIGGER' && a.sql.trim().startsWith('DROP TRIGGER')) return false
    return true
  })
}

/**
 * Actions that imply physical drift (columns/indexes/FKs/table).
 * Used to decide DRIFT vs OK after planning.
 */
export function ddlActionsIndicateDrift(actions: DdlAction[]): boolean {
  return actions.some((a) =>
    [
      'CREATE_TABLE',
      'ADD_COLUMN',
      'COERCE_FK_TEXT',
      'CREATE_INDEX',
      'CREATE_FK',
      'BACKFILL_COLUMN',
      'ENSURE_TRIGGER',
    ].includes(a.type) && !a.sql.trim().startsWith('--'),
  )
}
