/**
 * Apply promoted-column DDL on the Hasura Postgres source.
 * Hasura often uses a separate database from the BFF registry pool
 * (see docs/hasura/docker-compose.yaml — database `hasura` vs `supabase`).
 */
import { query } from '../../../../db/pool.js'
import {
  CRM_SCHEMA,
  loadPromotedFields,
  pgTypeForFieldType,
  resolveCrmStorageConfig,
  shouldPromoteField,
} from '../../../../schema/crmStorage.js'
import { hasuraAdminSecret, hasuraGraphqlUrl } from './client.js'
import { reloadHasuraMetadata } from './metadata.js'

export interface HasuraDdlAction {
  type: 'ADD_COLUMN' | 'CREATE_INDEX'
  fieldApiName?: string
  sql: string
  message: string
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}

/** SQL string literal — never use JSON.stringify (double quotes = identifiers in Postgres). */
function quoteLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Normalize schema names from entity backend_config.
 * Fixes common misconfig `crm.schema` → `crm_schema`.
 */
function normalizePgSchema(raw: string | null | undefined, fallback: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return fallback
  if (trimmed === 'crm.schema' || trimmed === 'crm-schema') return CRM_SCHEMA
  return trimmed
}

function queryUrl(): string {
  const graphql = hasuraGraphqlUrl()
  if (graphql.endsWith('/v1/graphql')) {
    return `${graphql.slice(0, -'/v1/graphql'.length)}/v2/query`
  }
  return `${graphql.replace(/\/$/, '')}/v2/query`
}

export async function hasuraRunSql(sql: string, source = 'default'): Promise<unknown> {
  const secret = hasuraAdminSecret()
  const response = await fetch(queryUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-hasura-admin-secret': secret } : {}),
    },
    body: JSON.stringify({
      type: 'run_sql',
      args: { source, sql },
    }),
  })
  const text = await response.text()
  let json: unknown = text
  try {
    json = JSON.parse(text)
  } catch {
    /* keep text */
  }
  if (!response.ok) {
    throw new Error(`Hasura run_sql HTTP ${response.status}: ${text}`)
  }
  const payload = asObject(json)
  if (payload.result_type === 'CommandOk' || payload.result_type === 'TuplesOk') {
    return json
  }
  throw new Error(`Hasura run_sql failed: ${text}`)
}

export async function listHasuraTableColumns(
  schema: string,
  table: string,
  source = 'default',
): Promise<Set<string>> {
  const result = (await hasuraRunSql(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = ${quoteLiteral(schema)}
       AND table_name = ${quoteLiteral(table)}
     ORDER BY 1`,
    source,
  )) as { result?: string[][] }
  const rows = result.result ?? []
  const out = new Set<string>()
  for (let i = 1; i < rows.length; i += 1) {
    const name = rows[i]?.[0]
    if (name) out.add(name)
  }
  return out
}

async function resolveHasuraTable(
  entityApiName: string,
): Promise<{ schema: string; table: string }> {
  const rows = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const backend = asObject(rows[0]?.backend_config)
  const hasura = asObject(backend.hasura)
  const storage = resolveCrmStorageConfig(backend, entityApiName)
  const schema = normalizePgSchema(
    (typeof hasura.schema === 'string' && hasura.schema.trim()) ||
      (typeof backend.schema === 'string' && backend.schema.trim()) ||
      storage.schema,
    CRM_SCHEMA,
  )
  const table =
    (typeof hasura.table === 'string' && hasura.table.trim()) ||
    (typeof backend.table === 'string' && backend.table.trim()) ||
    storage.table ||
    entityApiName
  return { schema, table }
}

/** Plan ADD COLUMN / index for promoted fields missing on the Hasura source table. */
export async function planHasuraEntityDdl(
  entityApiName: string,
): Promise<HasuraDdlAction[]> {
  const { schema, table } = await resolveHasuraTable(entityApiName)
  const existing = await listHasuraTableColumns(schema, table)
  const promoted = await loadPromotedFields(entityApiName)
  const relation = `${quoteIdent(schema)}.${quoteIdent(table)}`
  const actions: HasuraDdlAction[] = []

  for (const field of promoted) {
    if (!shouldPromoteField(field.apiName, field.fieldType)) continue
    if (existing.has(field.apiName)) continue
    const pgType = field.pgType || pgTypeForFieldType(field.fieldType)
    actions.push({
      type: 'ADD_COLUMN',
      fieldApiName: field.apiName,
      sql: `ALTER TABLE ${relation}
  ADD COLUMN IF NOT EXISTS ${quoteIdent(field.apiName)} ${pgType}`,
      message: `Hasura ADD ${entityApiName}.${field.apiName} (${pgType})`,
    })
    if (field.needsFkIndex || field.needsBtreeIndex) {
      const indexName = `idx_${table}_${field.apiName}`.replace(/[^a-zA-Z0-9_]/g, '_')
      actions.push({
        type: 'CREATE_INDEX',
        fieldApiName: field.apiName,
        sql: `CREATE INDEX IF NOT EXISTS ${quoteIdent(indexName)}
  ON ${relation} (${quoteIdent(field.apiName)})`,
        message: `Hasura INDEX ${indexName}`,
      })
    }
  }
  return actions
}

export async function applyHasuraDdlActions(
  actions: HasuraDdlAction[],
): Promise<{ applied: number; errors: Array<{ action: HasuraDdlAction; error: string }> }> {
  let applied = 0
  const errors: Array<{ action: HasuraDdlAction; error: string }> = []
  for (const action of actions) {
    try {
      await hasuraRunSql(action.sql)
      applied += 1
    } catch (err) {
      errors.push({
        action,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { applied, errors }
}

/**
 * Bring Hasura source table columns in line with registry promoted fields,
 * then reload metadata so GraphQL exposes new columns.
 */
export async function syncHasuraEntityColumns(
  entityApiName: string,
  options?: { dryRun?: boolean },
): Promise<{
  dryRun: boolean
  actions: HasuraDdlAction[]
  applied: number
  errors: Array<{ field?: string; error: string }>
  reloaded: boolean
}> {
  const dryRun = options?.dryRun === true
  const actions = await planHasuraEntityDdl(entityApiName)
  if (dryRun || !actions.length) {
    return {
      dryRun,
      actions,
      applied: 0,
      errors: [],
      reloaded: false,
    }
  }
  const result = await applyHasuraDdlActions(actions)
  let reloaded = false
  if (result.applied > 0) {
    await reloadHasuraMetadata()
    reloaded = true
  }
  return {
    dryRun: false,
    actions,
    applied: result.applied,
    errors: result.errors.map((e) => ({
      field: e.action.fieldApiName,
      error: e.error,
    })),
    reloaded,
  }
}
