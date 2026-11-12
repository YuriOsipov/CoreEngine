import { findManyRecords, updateRecord } from '../adapters/recordsAdapter.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { readRecordField } from '../adapters/records/relations.js'
import {
  BulkUpdateRelatedError,
  evaluateBulkUpdateFormula,
} from './bulkUpdateRelated.js'

export interface BulkUpdateFilteredInput {
  collection: string
  /** GraphQL-style filter; used when recordIds is empty. */
  filter?: Record<string, unknown> | null
  /** Explicit ids (visible scope); takes precedence over filter when non-empty. */
  recordIds?: string[] | null
  targetField: string
  sourcePath: string
  formula?: string | null
  multiplier: number
  actorUserId?: string | null
  /** Verified caller — field security on list + writes. */
  access: RecordAccess
  /** Soft cap to avoid runaway updates. Default 5000. */
  maxRecords?: number
}

export interface BulkUpdateFilteredResult {
  createdCount: number
  updatedCount: number
  skippedCount: number
}

function resolvePathValue(
  record: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return undefined

  let current: unknown = record
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = readRecordField(current as Record<string, unknown>, part)
  }
  return current
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Patch rows in `collection` matching filter or explicit ids:
 * targetField = evaluate(formula, sourcePath, prompt).
 */
export async function bulkUpdateFilteredFromAction(
  input: BulkUpdateFilteredInput,
): Promise<BulkUpdateFilteredResult> {
  const collection = input.collection.trim()
  const targetField = input.targetField.trim()
  const sourcePath = input.sourcePath.trim()
  const multiplier = input.multiplier
  const maxRecords =
    typeof input.maxRecords === 'number' && input.maxRecords > 0
      ? Math.min(Math.floor(input.maxRecords), 10_000)
      : 5000

  if (!collection) {
    throw new BulkUpdateRelatedError(400, 'collection is required')
  }
  if (!targetField || !sourcePath) {
    throw new BulkUpdateRelatedError(400, 'targetField and sourcePath are required')
  }
  if (!Number.isFinite(multiplier)) {
    throw new BulkUpdateRelatedError(400, 'multiplier must be a finite number')
  }
  if (!input.access) {
    throw new BulkUpdateRelatedError(400, 'access is required')
  }
  const access = input.access

  const formula = input.formula?.trim() || '{{source}} * {{prompt}}'
  evaluateBulkUpdateFormula(formula, 1, 1)

  const recordIds = (input.recordIds ?? [])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean)

  const sourceRoot = sourcePath.split('.')[0]?.trim() || sourcePath
  const fields = Array.from(
    new Set(['id', targetField, sourcePath, sourceRoot].filter(Boolean)),
  )

  let nodes: Record<string, unknown>[] = []
  if (recordIds.length > 0) {
    const limited = recordIds.slice(0, maxRecords)
    const result = await findManyRecords(collection, {
      filter: { id: { _in: limited } },
      fields,
      limit: -1,
      access,
    })
    nodes = result.nodes
  } else {
    const filter =
      input.filter && typeof input.filter === 'object' && !Array.isArray(input.filter)
        ? input.filter
        : undefined
    const result = await findManyRecords(collection, {
      filter,
      fields,
      limit: maxRecords,
      access,
    })
    nodes = result.nodes
  }

  let updatedCount = 0
  let skippedCount = 0

  for (const row of nodes) {
    const id = row.id == null ? '' : String(row.id)
    if (!id) {
      skippedCount += 1
      continue
    }

    const sourceNumber = asFiniteNumber(resolvePathValue(row, sourcePath))
    if (sourceNumber == null) {
      skippedCount += 1
      continue
    }

    let nextValue: number
    try {
      nextValue = evaluateBulkUpdateFormula(formula, sourceNumber, multiplier)
    } catch {
      skippedCount += 1
      continue
    }

    await updateRecord(
      collection,
      id,
      { [targetField]: nextValue },
      ['id', targetField],
      { actorUserId: input.actorUserId ?? null, access },
    )
    updatedCount += 1
  }

  return { createdCount: 0, updatedCount, skippedCount }
}
