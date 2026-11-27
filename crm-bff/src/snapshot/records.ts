import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { SnapshotHttpError } from './errors.js'
import { isSandboxEnvironment } from './environment.js'
import {
  directRelations,
  orderParentFirst,
  planRecordImport,
  type FkEdge,
} from './relations.js'

const IDENT = /^[a-z][a-z0-9_]*$/

function quoteIdent(ident: string): string {
  const name = ident.trim().toLowerCase()
  if (!IDENT.test(name)) throw new SnapshotHttpError(400, `Unsafe object name: ${ident}`)
  return `"${name}"`
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function loadRelationEdges(): Promise<FkEdge[]> {
  const rows = await query<{
    from_entity: string
    field: string
    to_entity: string
    required: boolean
    meta: unknown
  }>(
    `SELECT e.api_name AS from_entity,
            f.api_name AS field,
            related.api_name AS to_entity,
            COALESCE(f.required, false) AS required,
            r.meta AS meta
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id AND e.deleted_at IS NULL
     JOIN public.relations r ON r.field_id = f.id AND upper(r.kind) = 'M2O'
     JOIN public.entities related ON related.id = r.related_entity_id
     ORDER BY e.api_name, f.api_name`,
  )
  return rows.map((row) => {
    const meta = asObject(row.meta)
    const onDelete = String(meta.on_delete || 'SET NULL')
    return {
      fromEntity: row.from_entity,
      field: row.field,
      toEntity: row.to_entity,
      onDelete,
      required: Boolean(row.required),
    }
  })
}

export async function listDirectRelations(entity: string): Promise<ReturnType<typeof directRelations>> {
  const name = entity.trim().toLowerCase()
  if (!IDENT.test(name)) throw new SnapshotHttpError(400, 'entity is required')
  return directRelations(name, await loadRelationEdges())
}

export type SnapshotRecord = {
  recordId: string
  status: string
  data: Record<string, unknown>
  columns: Record<string, unknown>
}

const SKIP_COLUMNS = new Set([
  'record_id',
  'status',
  'data',
  'created_at',
  'updated_at',
  'date_created',
  'date_updated',
  'owner_id',
  'user_created',
  'user_updated',
])

async function readEntityRecords(entity: string): Promise<SnapshotRecord[]> {
  const table = quoteIdent(entity)
  const exists = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`crm_schema.${entity}`],
  )
  if (!exists[0]?.exists) return []
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM crm_schema.${table} ORDER BY record_id`,
  )
  return rows.map((row) => {
    const columns: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (SKIP_COLUMNS.has(key)) continue
      columns[key] = value
    }
    return {
      recordId: String(row.record_id ?? ''),
      status: row.status == null ? 'published' : String(row.status),
      data: asObject(row.data),
      columns,
    }
  })
}

export async function exportSelectedRecords(input: {
  entities: string[]
  confirmSensitive?: boolean
}): Promise<{ order: string[]; records: Record<string, SnapshotRecord[]> }> {
  const edges = await loadRelationEdges()
  const plan = planRecordImport(input.entities, edges, Boolean(input.confirmSensitive))
  const records: Record<string, SnapshotRecord[]> = {}
  for (const entity of plan.order) {
    records[entity] = await readEntityRecords(entity)
  }
  return { order: plan.order, records }
}

function selfParentField(entity: string, edges: readonly FkEdge[]): string | null {
  const edge = edges.find(
    (item) => item.fromEntity === entity && item.toEntity === entity,
  )
  return edge?.field ?? null
}

function readField(row: SnapshotRecord, field: string): string | null {
  const column = row.columns[field]
  if (typeof column === 'string' && column) return column
  const data = row.data[field]
  if (typeof data === 'string' && data) return data
  return null
}

function writeField(row: SnapshotRecord, field: string, value: string | null): void {
  if (field in row.columns) row.columns[field] = value
  if (field in row.data || !(field in row.columns)) row.data[field] = value
}

export async function importSelectedRecords(
  input: {
    entities: string[]
    records: Record<string, SnapshotRecord[]>
    confirmSensitive?: boolean
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ imported: number }> {
  if (!isSandboxEnvironment(env)) {
    throw new SnapshotHttpError(
      403,
      'Record import is only allowed when APP_ENV=sandbox.',
    )
  }
  const edges = await loadRelationEdges()
  const plan = planRecordImport(input.entities, edges, Boolean(input.confirmSensitive))
  const clearFields = new Map<string, Set<string>>()
  for (const clear of plan.clears) {
    const set = clearFields.get(clear.entity) ?? new Set<string>()
    set.add(clear.field)
    clearFields.set(clear.entity, set)
  }
  const idMap = new Map<string, string>()
  for (const entity of plan.order) {
    for (const row of input.records[entity] ?? []) {
      if (row.recordId) idMap.set(row.recordId, randomUUID())
    }
  }
  let imported = 0
  for (const entity of plan.order) {
    const parentField = selfParentField(entity, edges)
    const rows = orderParentFirst(input.records[entity] ?? [], parentField, (row) =>
      parentField ? readField(row, parentField) : null,
    )
    const fkFields = edges.filter((edge) => edge.fromEntity === entity)
    for (const row of rows) {
      for (const field of clearFields.get(entity) ?? []) writeField(row, field, null)
      for (const edge of fkFields) {
        const current = readField(row, edge.field)
        if (!current) continue
        const mapped = idMap.get(current)
        writeField(row, edge.field, mapped ?? null)
      }
      writeField(row, 'owner_id', null)
      await insertRecord(entity, idMap.get(row.recordId) || randomUUID(), row)
      imported += 1
    }
  }
  return { imported }
}

async function insertRecord(entity: string, recordId: string, row: SnapshotRecord): Promise<void> {
  const table = quoteIdent(entity)
  const cols = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'crm_schema' AND table_name = $1`,
    [entity],
  )
  const have = new Set(cols.map((column) => column.column_name))
  const names = ['record_id']
  const params: unknown[] = [recordId]
  const placeholders = ['$1::uuid']
  if (have.has('status')) {
    names.push('status')
    params.push(row.status || 'published')
    placeholders.push(`$${params.length}`)
  }
  if (have.has('data')) {
    names.push('data')
    params.push(JSON.stringify(row.data ?? {}))
    placeholders.push(`$${params.length}::jsonb`)
  }
  if (have.has('owner_id')) {
    names.push('owner_id')
    params.push(null)
    placeholders.push(`$${params.length}`)
  }
  for (const [key, value] of Object.entries(row.columns)) {
    if (!IDENT.test(key) || !have.has(key) || key === 'record_id' || key === 'owner_id') continue
    names.push(key)
    params.push(value)
    placeholders.push(`$${params.length}`)
  }
  await query(
    `INSERT INTO crm_schema.${table} (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
    params,
  )
}
