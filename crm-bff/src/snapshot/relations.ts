import { SnapshotHttpError } from './errors.js'

export type FkEdge = {
  fromEntity: string
  field: string
  toEntity: string
  onDelete: string
  required: boolean
}

const SENSITIVE_ENTITIES = new Set([
  'users',
  'message',
  'incoming_message',
  'files',
  'file',
  'audit',
  'activity',
  'config_audit',
  'config_audits',
])

export function isSensitiveEntity(apiName: string): boolean {
  const name = apiName.trim().toLowerCase()
  if (!name) return false
  if (SENSITIVE_ENTITIES.has(name)) return true
  return name.includes('audit')
}

export function directRelations(entity: string, edges: readonly FkEdge[]): {
  outgoing: FkEdge[]
  incoming: FkEdge[]
} {
  const name = entity.trim().toLowerCase()
  return {
    outgoing: edges.filter(
      (edge) => edge.fromEntity === name && edge.toEntity !== name,
    ),
    incoming: edges.filter(
      (edge) => edge.toEntity === name && edge.fromEntity !== name,
    ),
  }
}

function selectedSet(entities: readonly string[]): Set<string> {
  return new Set(entities.map((name) => name.trim().toLowerCase()).filter(Boolean))
}

function blocksWhenMissing(edge: FkEdge): boolean {
  if (edge.required) return true
  return edge.onDelete.toUpperCase().includes('RESTRICT')
}

/** Parents before children. Selected objects only. */
export function recordCopyOrder(
  entities: readonly string[],
  edges: readonly FkEdge[],
): string[] {
  const selected = selectedSet(entities)
  const names = [...selected]
  const indegree = new Map(names.map((name) => [name, 0]))
  const next = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.fromEntity === edge.toEntity) continue
    if (!selected.has(edge.fromEntity) || !selected.has(edge.toEntity)) continue
    indegree.set(edge.fromEntity, (indegree.get(edge.fromEntity) ?? 0) + 1)
    const list = next.get(edge.toEntity) ?? []
    list.push(edge.fromEntity)
    next.set(edge.toEntity, list)
  }
  const queue = names.filter((name) => (indegree.get(name) ?? 0) === 0).sort()
  const ordered: string[] = []
  while (queue.length) {
    const name = queue.shift()!
    ordered.push(name)
    for (const child of next.get(name) ?? []) {
      const left = (indegree.get(child) ?? 1) - 1
      indegree.set(child, left)
      if (left === 0) {
        queue.push(child)
        queue.sort()
      }
    }
  }
  for (const name of [...names].sort()) {
    if (!ordered.includes(name)) ordered.push(name)
  }
  return ordered
}

export type RecordCopyPlan = {
  order: string[]
  clears: Array<{ entity: string; field: string; target: string }>
}

/**
 * SET NULL links to an unselected object are cleared.
 * Required or RESTRICT links must include that object.
 */
export function planRecordImport(
  entities: readonly string[],
  edges: readonly FkEdge[],
  confirmSensitive = false,
): RecordCopyPlan {
  const selected = selectedSet(entities)
  if (!selected.size) {
    throw new SnapshotHttpError(400, 'Select at least one object to copy.')
  }
  const sensitive = [...selected].filter(isSensitiveEntity)
  if (sensitive.length && !confirmSensitive) {
    throw new SnapshotHttpError(
      400,
      `Confirm before copying sensitive objects: ${sensitive.join(', ')}`,
    )
  }
  const clears: RecordCopyPlan['clears'] = []
  for (const edge of edges) {
    if (!selected.has(edge.fromEntity)) continue
    if (edge.fromEntity === edge.toEntity) continue
    if (selected.has(edge.toEntity)) continue
    if (blocksWhenMissing(edge)) {
      throw new SnapshotHttpError(
        400,
        `${edge.fromEntity}.${edge.field} requires ${edge.toEntity}. Select ${edge.toEntity} before copying.`,
      )
    }
    if (edge.onDelete.toUpperCase().includes('SET NULL') || !blocksWhenMissing(edge)) {
      clears.push({
        entity: edge.fromEntity,
        field: edge.field,
        target: edge.toEntity,
      })
    }
  }
  return { order: recordCopyOrder([...selected], edges), clears }
}

export function orderParentFirst<T extends { recordId: string }>(
  rows: readonly T[],
  parentField: string | null,
  readParent: (row: T) => string | null,
): T[] {
  if (!parentField) return [...rows]
  const byId = new Map(rows.map((row) => [row.recordId, row]))
  const seen = new Set<string>()
  const ordered: T[] = []
  function visit(row: T): void {
    if (seen.has(row.recordId)) return
    seen.add(row.recordId)
    const parentId = readParent(row)
    const parent = parentId ? byId.get(parentId) : undefined
    if (parent) visit(parent)
    ordered.push(row)
  }
  for (const row of rows) visit(row)
  return ordered
}
