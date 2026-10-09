import { resolveRecordsStore } from '../adapters/records/registry.js'
import { fkIdFromValue } from '../adapters/records/relations.js'
import { applyFormulasOnWrite } from './applyFormulas.js'
import {
  isLiveRollup,
  loadRollupFields,
  loadRollupsByChildEntity,
  type RollupConfig,
  type RollupFieldMeta,
} from './fieldMeta.js'

function parentIdFromRecord(
  record: Record<string, unknown> | null | undefined,
  parentField: string,
): string | null {
  if (!record) return null
  return fkIdFromValue(record[parentField])
}

function recordId(record: Record<string, unknown>): string | null {
  const raw = record.id ?? record.record_id
  if (raw == null || raw === '') return null
  return String(raw)
}

function fieldsWantRollup(
  fields: string[] | null | undefined,
  apiName: string,
): boolean {
  if (!fields?.length) return true
  if (fields.some((field) => field === '*' || field === '*.*')) return true
  return fields.some((field) => {
    const base = field.split(/[.:(]/)[0] ?? field
    return base === apiName
  })
}

function mergeRollupFilter(
  rollup: RollupConfig,
  parentIds: string[],
): Record<string, unknown> {
  const parentClause = {
    [rollup.parentField]: { _in: parentIds },
  }
  if (!rollup.filter || !Object.keys(rollup.filter).length) {
    return parentClause
  }
  return {
    _and: [rollup.filter, parentClause],
  }
}

async function aggregateRollupValue(
  rollup: RollupConfig,
  parentId: string,
): Promise<number> {
  const filter: Record<string, unknown> = {
    ...(rollup.filter ?? {}),
    [rollup.parentField]: { _eq: parentId },
  }
  const op = rollup.op.toLowerCase()
  const valueField = rollup.op === 'COUNT' ? '*' : rollup.valueField || '*'
  const store = await resolveRecordsStore(rollup.childEntity)
  const rows = await store.aggregate(rollup.childEntity, {
    aggregate: { [op]: valueField },
    filter,
    limit: 1,
  })
  return readAggregateNumber(rows[0], op, valueField)
}

function readAggregateNumber(
  row: Record<string, unknown> | undefined,
  op: string,
  valueField: string,
): number {
  if (!row) return 0
  const bucket = row[op]
  if (bucket && typeof bucket === 'object' && !Array.isArray(bucket)) {
    const record = bucket as Record<string, unknown>
    const raw = record[valueField] ?? record['*'] ?? 0
    const num = Number(raw)
    return Number.isFinite(num) ? num : 0
  }
  const num = Number(bucket)
  return Number.isFinite(num) ? num : 0
}

/**
 * Batch-compute one live rollup for many parents via groupBy on the parent FK.
 */
async function aggregateRollupByParents(
  rollup: RollupConfig,
  parentIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!parentIds.length) return out

  const op = rollup.op.toLowerCase()
  const valueField = rollup.op === 'COUNT' ? '*' : rollup.valueField || '*'
  const store = await resolveRecordsStore(rollup.childEntity)
  const rows = await store.aggregate(rollup.childEntity, {
    aggregate: { [op]: valueField },
    groupBy: [rollup.parentField],
    filter: mergeRollupFilter(rollup, parentIds),
    limit: -1,
  })

  for (const row of rows) {
    const parentId = fkIdFromValue(row[rollup.parentField])
    if (!parentId) continue
    out.set(parentId, readAggregateNumber(row, op, valueField))
  }
  return out
}

async function writeParentRollup(
  meta: RollupFieldMeta,
  parentId: string,
  visited: Set<string>,
): Promise<void> {
  if (isLiveRollup(meta.rollup)) return

  const visitKey = `${meta.parentEntity}:${parentId}:${meta.apiName}`
  if (visited.has(visitKey)) return
  visited.add(visitKey)

  const value = await aggregateRollupValue(meta.rollup, parentId)
  const store = await resolveRecordsStore(meta.parentEntity)
  let existing: Record<string, unknown> | null = null
  try {
    existing = await store.findOne(meta.parentEntity, parentId, null)
  } catch {
    return
  }

  const current = existing?.[meta.apiName]
  const currentNum = current == null || current === '' ? null : Number(current)
  if (
    currentNum !== null &&
    Number.isFinite(currentNum) &&
    Math.abs(currentNum - value) < 1e-9
  ) {
    return
  }

  let patch: Record<string, unknown> = { [meta.apiName]: value }
  patch = await applyFormulasOnWrite(meta.parentEntity, patch, existing)
  const before = existing
  await store.update(meta.parentEntity, parentId, patch, null)
  const after = { ...asObject(existing), ...patch, id: parentId }
  await recomputeRollupsForChildChange(
    meta.parentEntity,
    { before, after },
    visited,
  )
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * After a child record create/update/delete, refresh stored (non-live) parent
 * rollup fields. Live rollups are computed on read instead.
 */
export async function recomputeRollupsForChildChange(
  childEntityApiName: string,
  change: {
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  },
  visited: Set<string> = new Set(),
): Promise<void> {
  const rollups = await loadRollupsByChildEntity(childEntityApiName)
  if (!rollups.length) return

  for (const meta of rollups) {
    if (isLiveRollup(meta.rollup)) continue

    const parentIds = new Set<string>()
    const beforeId = parentIdFromRecord(change.before, meta.rollup.parentField)
    const afterId = parentIdFromRecord(change.after, meta.rollup.parentField)
    if (beforeId) parentIds.add(beforeId)
    if (afterId) parentIds.add(afterId)

    for (const parentId of parentIds) {
      await writeParentRollup(meta, parentId, visited)
    }
  }
}

/**
 * Attach live rollup values onto parent records (list/detail read path).
 * Uses one grouped aggregate per rollup field for the parent id set.
 */
export async function attachLiveRollupsOnRead(
  parentEntityApiName: string,
  records: Record<string, unknown>[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  if (!records.length) return records

  const rollupFields = await loadRollupFields(parentEntityApiName)
  const liveFields = rollupFields.filter(
    (field) =>
      isLiveRollup(field.rollup) && fieldsWantRollup(fields, field.apiName),
  )
  if (!liveFields.length) return records

  const parentIds = records
    .map((record) => recordId(record))
    .filter((id): id is string => Boolean(id))
  if (!parentIds.length) return records

  const valueByField = new Map<string, Map<string, number>>()
  for (const field of liveFields) {
    valueByField.set(
      field.apiName,
      await aggregateRollupByParents(field.rollup, parentIds),
    )
  }

  return records.map((record) => {
    const id = recordId(record)
    if (!id) return record
    const next = { ...record }
    for (const field of liveFields) {
      next[field.apiName] = valueByField.get(field.apiName)?.get(id) ?? 0
    }
    return next
  })
}
