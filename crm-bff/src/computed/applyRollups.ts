import { resolveRecordsStore } from '../adapters/records/registry.js'
import { fkIdFromValue } from '../adapters/records/relations.js'
import { applyFormulasOnWrite } from './applyFormulas.js'
import {
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
  const row = rows[0]
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

async function writeParentRollup(
  meta: RollupFieldMeta,
  parentId: string,
  visited: Set<string>,
): Promise<void> {
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
 * After a child record create/update/delete, refresh parent rollup fields.
 * Reparents recompute both old and new parents.
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
