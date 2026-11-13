import {
  createRecord,
  findManyRecords,
  findOneRecord,
  updateRecord,
} from '../adapters/recordsAdapter.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { SYSTEM_RECORD_ACCESS } from '../adapters/records/types.js'
import {
  loadM2ORelations,
  loadO2MRelations,
  readRecordField,
} from '../adapters/records/relations.js'

export interface BulkUpdateRelatedInput {
  collection: string
  recordId: string
  relatedCollection: string
  targetField: string
  sourcePath: string
  multiplier: number
  /**
   * Expression with `{{source}}` / `{{prompt}}`, or legacy presets
   * `multiply` / `percentOff`.
   */
  formula?: string | null
  /** Optional peer collection to upsert from (e.g. item). */
  sourceCollection?: string | null
  /** M2O on related pointing at source (e.g. item). Required with sourceCollection. */
  sourceLinkField?: string | null
  /** When sourceCollection is set, filter source with is_active = true. Default true. */
  activeSourcesOnly?: boolean | null
  actorUserId?: string | null
  /** Verified caller — field security on list + writes. */
  access: RecordAccess
}

export interface BulkUpdateRelatedResult {
  createdCount: number
  updatedCount: number
  skippedCount: number
}

export class BulkUpdateRelatedError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'BulkUpdateRelatedError'
  }
}

const DEFAULT_FORMULA = '{{source}} * {{prompt}}'

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

function asRecordId(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim()
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id
    if (id == null) return ''
    return String(id).trim()
  }
  return ''
}

function resolveFormulaTemplate(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed || trimmed === 'multiply') return DEFAULT_FORMULA
  if (trimmed === 'percentOff') return '{{source}} * (1 - {{prompt}} / 100)'
  return trimmed
}

/**
 * Replace {{source}} / {{prompt}}, normalize unicode math ops, then evaluate
 * a number-only arithmetic expression (+ - * / parentheses).
 */
export function evaluateBulkUpdateFormula(
  formula: string,
  source: number,
  prompt: number,
): number {
  const template = resolveFormulaTemplate(formula)
  let expr = template
    .replace(/\{\{\s*source\s*\}\}/gi, `(${source})`)
    .replace(/\{\{\s*prompt\s*\}\}/gi, `(${prompt})`)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

  if (!expr) {
    throw new BulkUpdateRelatedError(400, 'Formula is empty')
  }
  if (/\{\{/.test(expr)) {
    throw new BulkUpdateRelatedError(
      400,
      'Formula may only use {{source}} and {{prompt}} tokens',
    )
  }
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) {
    throw new BulkUpdateRelatedError(
      400,
      'Formula may only contain numbers, {{source}}, {{prompt}}, and + - * / ( )',
    )
  }

  let result: unknown
  try {
    // Charset validated above — evaluate arithmetic only.
    result = Function(`"use strict"; return (${expr});`)()
  } catch {
    throw new BulkUpdateRelatedError(400, `Invalid formula: ${template}`)
  }

  const numeric = asFiniteNumber(result)
  if (numeric == null) {
    throw new BulkUpdateRelatedError(400, `Formula did not return a number: ${template}`)
  }
  return numeric
}

async function resolveParentFkField(
  parentCollection: string,
  relatedCollection: string,
): Promise<string> {
  const o2m = await loadO2MRelations(parentCollection)
  const match = o2m.find(
    (rel) => rel.junctionEntityApiName === relatedCollection && Boolean(rel.parentFkField),
  )
  if (match?.parentFkField) return match.parentFkField

  const m2o = await loadM2ORelations(relatedCollection)
  const reverse = m2o.find((rel) => rel.relatedEntityApiName === parentCollection)
  if (reverse?.fieldApiName) return reverse.fieldApiName

  throw new BulkUpdateRelatedError(
    400,
    `No relation found from "${parentCollection}" to related "${relatedCollection}".`,
  )
}

async function bulkUpsertRelatedFromSource(
  input: BulkUpdateRelatedInput & {
    collection: string
    recordId: string
    relatedCollection: string
    targetField: string
    sourcePath: string
    sourceCollection: string
    sourceLinkField: string
    formula: string
  },
): Promise<BulkUpdateRelatedResult> {
  const {
    collection,
    recordId,
    relatedCollection,
    targetField,
    sourcePath,
    sourceCollection,
    sourceLinkField,
    formula,
    multiplier,
  } = input

  const parentFkField = await resolveParentFkField(collection, relatedCollection)
  const m2o = await loadM2ORelations(relatedCollection)
  const linkRel = m2o.find((rel) => rel.fieldApiName === sourceLinkField)
  if (!linkRel) {
    throw new BulkUpdateRelatedError(
      400,
      `sourceLinkField "${sourceLinkField}" is not an M2O on "${relatedCollection}".`,
    )
  }
  if (
    linkRel.relatedEntityApiName
    && linkRel.relatedEntityApiName !== sourceCollection
  ) {
    throw new BulkUpdateRelatedError(
      400,
      `sourceLinkField "${sourceLinkField}" points to "${linkRel.relatedEntityApiName}", not "${sourceCollection}".`,
    )
  }

  const activeSourcesOnly = input.activeSourcesOnly !== false
  const sourceFilter = activeSourcesOnly
    ? { is_active: { _eq: true } }
    : null
  const sourceRoot = sourcePath.split('.')[0]?.trim() || sourcePath
  const sourceFields = Array.from(
    new Set(['id', sourcePath, sourceRoot].filter(Boolean)),
  )

  const access = input.access ?? SYSTEM_RECORD_ACCESS
  const writeOpts = {
    actorUserId: input.actorUserId ?? null,
    access,
  }

  const { nodes: sourceNodes } = await findManyRecords(sourceCollection, {
    filter: sourceFilter,
    fields: sourceFields,
    limit: -1,
    access,
  })

  const relatedFields = Array.from(
    new Set(['id', sourceLinkField, targetField].filter(Boolean)),
  )
  const { nodes: relatedNodes } = await findManyRecords(relatedCollection, {
    filter: { [parentFkField]: { _eq: recordId } },
    fields: relatedFields,
    limit: -1,
    access,
  })

  const relatedBySourceId = new Map<string, Record<string, unknown>>()
  for (const row of relatedNodes) {
    const linkId = asRecordId(readRecordField(row, sourceLinkField))
    if (!linkId) continue
    if (!relatedBySourceId.has(linkId)) relatedBySourceId.set(linkId, row)
  }

  let createdCount = 0
  let updatedCount = 0
  let skippedCount = 0

  for (const sourceRow of sourceNodes) {
    const sourceId = asRecordId(sourceRow.id)
    if (!sourceId) {
      skippedCount += 1
      continue
    }

    const sourceRaw = resolvePathValue(sourceRow, sourcePath)
    const sourceNumber = asFiniteNumber(sourceRaw)
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

    const existing = relatedBySourceId.get(sourceId)
    if (existing) {
      const id = asRecordId(existing.id)
      if (!id) {
        skippedCount += 1
        continue
      }
      await updateRecord(
        relatedCollection,
        id,
        { [targetField]: nextValue },
        ['id', targetField],
        writeOpts,
      )
      updatedCount += 1
      continue
    }

    await createRecord(
      relatedCollection,
      {
        [parentFkField]: recordId,
        [sourceLinkField]: sourceId,
        [targetField]: nextValue,
      },
      ['id'],
      writeOpts,
    )
    createdCount += 1
  }

  return { createdCount, updatedCount, skippedCount }
}

/**
 * For each related row under the parent: evaluate formula(sourcePath, prompt).
 * Skips rows where the source path is missing or non-numeric.
 *
 * When sourceCollection + sourceLinkField are set: load source rows, upsert
 * related rows for the parent, then apply the formula (sourcePath on source).
 */
export async function bulkUpdateRelatedFromAction(
  input: BulkUpdateRelatedInput,
): Promise<BulkUpdateRelatedResult> {
  const collection = input.collection.trim()
  const recordId = String(input.recordId ?? '').trim()
  const relatedCollection = input.relatedCollection.trim()
  const targetField = input.targetField.trim()
  const sourcePath = input.sourcePath.trim()
  const multiplier = input.multiplier
  const formula = resolveFormulaTemplate(input.formula)
  const sourceCollection = String(input.sourceCollection ?? '').trim()
  const sourceLinkField = String(input.sourceLinkField ?? '').trim()

  if (!collection || !recordId) {
    throw new BulkUpdateRelatedError(400, 'collection and recordId are required')
  }
  if (!relatedCollection || !targetField || !sourcePath) {
    throw new BulkUpdateRelatedError(
      400,
      'relatedCollection, targetField, and sourcePath are required',
    )
  }
  if (!Number.isFinite(multiplier)) {
    throw new BulkUpdateRelatedError(400, 'multiplier must be a finite number')
  }
  if (!input.access) {
    throw new BulkUpdateRelatedError(400, 'access is required')
  }
  const access = input.access
  if (sourceCollection && !sourceLinkField) {
    throw new BulkUpdateRelatedError(
      400,
      'sourceLinkField is required when sourceCollection is set',
    )
  }
  if (!sourceCollection && sourceLinkField) {
    throw new BulkUpdateRelatedError(
      400,
      'sourceCollection is required when sourceLinkField is set',
    )
  }

  // Validate formula once before looping rows.
  evaluateBulkUpdateFormula(formula, 1, 1)

  // Parent must be readable under owner RLS — do not mutate related rows of
  // someone else's parent when the parent entity is owner-secured.
  try {
    await findOneRecord(collection, recordId, ['id'], access)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parent record not accessible'
    throw new BulkUpdateRelatedError(403, message)
  }

  if (sourceCollection && sourceLinkField) {
    return bulkUpsertRelatedFromSource({
      ...input,
      collection,
      recordId,
      relatedCollection,
      targetField,
      sourcePath,
      sourceCollection,
      sourceLinkField,
      formula,
    })
  }

  const parentFkField = await resolveParentFkField(collection, relatedCollection)
  const sourceRoot = sourcePath.split('.')[0]?.trim() || sourcePath
  const fields = Array.from(
    new Set(['id', targetField, sourcePath, sourceRoot].filter(Boolean)),
  )

  const { nodes } = await findManyRecords(relatedCollection, {
    filter: { [parentFkField]: { _eq: recordId } },
    fields,
    limit: -1,
    access,
  })

  let updatedCount = 0
  let skippedCount = 0

  for (const row of nodes) {
    const id = row.id == null ? '' : String(row.id)
    if (!id) {
      skippedCount += 1
      continue
    }

    const sourceRaw = resolvePathValue(row, sourcePath)
    const sourceNumber = asFiniteNumber(sourceRaw)
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
      relatedCollection,
      id,
      { [targetField]: nextValue },
      ['id', targetField],
      { actorUserId: input.actorUserId ?? null, access },
    )
    updatedCount += 1
  }

  return { createdCount: 0, updatedCount, skippedCount }
}
