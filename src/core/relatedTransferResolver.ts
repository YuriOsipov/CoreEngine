import { readPath } from '@/core/utils/object'

export interface RelatedTransferResolveContext {
  parentRecord?: Record<string, unknown>
  parentId?: string | number
  sourceRecord?: Record<string, unknown>
  sourcePrimaryKey?: string
}

const TOKEN_PATTERN = /^\$(parent|source)\.([A-Za-z0-9_.-]+)$/
const NO_VALUE_OPERATORS = new Set(['_null', '_nnull'])
const LOGICAL_OPERATORS = new Set(['_and', '_or'])

export function resolveRelatedTransferValue(
  value: unknown,
  context: RelatedTransferResolveContext,
): unknown {
  if (typeof value === 'string') {
    const token = TOKEN_PATTERN.exec(value.trim())
    if (!token) return value
    return resolveToken(token[1], token[2], context)
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => resolveRelatedTransferValue(item, context))
      .filter((item) => item !== undefined)
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (resolved, [key, item]) => {
        const nextValue = resolveRelatedTransferValue(item, context)
        if (nextValue !== undefined) {
          resolved[key] = nextValue
        }
        return resolved
      },
      {},
    )
  }

  return value
}

export function resolveRelatedTransferFilter(
  filter: Record<string, unknown> | null | undefined,
  context: RelatedTransferResolveContext,
): Record<string, unknown> | null {
  if (!filter) return null
  const resolved = pruneEmptyFilter(resolveRelatedTransferValue(filter, context))
  return isPlainRecord(resolved) && Object.keys(resolved).length > 0
    ? resolved
    : null
}

function resolveToken(
  source: string,
  path: string,
  context: RelatedTransferResolveContext,
): unknown {
  if (source === 'parent' && path === 'id' && context.parentId !== undefined) {
    return context.parentId
  }
  if (source === 'source' && path === 'id' && context.sourcePrimaryKey) {
    return readPath(context.sourceRecord, context.sourcePrimaryKey)
  }

  const record = source === 'parent' ? context.parentRecord : context.sourceRecord
  return readPath(record, path)
}

/** Coerce M2O/relation objects to a scalar id for GraphQL filter operands. */
function coerceFilterOperand(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined
  if (Array.isArray(value)) {
    const items = value
      .map((item) => coerceFilterOperand(item))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (isPlainRecord(value)) {
    const id = value.id
    if (id !== undefined && id !== null && id !== '') return id
  }
  return value
}

function pruneEmptyFilter(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map(pruneEmptyFilter)
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }

  if (!isPlainRecord(value)) {
    return value === null || value === undefined ? undefined : value
  }

  const entries = Object.entries(value)
    .map(([key, item]) => {
      if (
        key.startsWith('_') &&
        !LOGICAL_OPERATORS.has(key) &&
        !NO_VALUE_OPERATORS.has(key)
      ) {
        return [key, pruneEmptyFilter(coerceFilterOperand(item))] as const
      }
      return [key, pruneEmptyFilter(item)] as const
    })
    .filter(([, item]) => item !== undefined)

  if (entries.length === 0) return undefined

  if (
    entries.length === 1 &&
    LOGICAL_OPERATORS.has(entries[0][0]) &&
    Array.isArray(entries[0][1]) &&
    entries[0][1].length === 0
  ) {
    return undefined
  }

  return Object.fromEntries(entries)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
