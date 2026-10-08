import type { FieldDefinition } from '@/interfaces'
import { keysEqual } from '@/core/relationHelpers'
import { resolveFieldPath } from '@/modules/entities/utils/relatedTransferSchema'

export function mergeFilterClauses(
  first: Record<string, unknown> | null,
  second: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (first && second) return { _and: [first, second] }
  return first ?? second
}

function availableFieldsHas(availableFields: Set<string>, fieldKey: string): boolean {
  const root = fieldKey.split('.')[0] ?? fieldKey
  if (availableFields.has(root) || availableFields.has(fieldKey)) return true
  for (const field of availableFields) {
    if (keysEqual(field, root) || keysEqual(field, fieldKey)) return true
  }
  return false
}

export function filterKnownFields(fields: string[], availableFields: Set<string> | null): string[] {
  if (!availableFields || availableFields.size === 0) return fields
  return fields.filter((field) => availableFieldsHas(availableFields, field.split('.')[0] ?? field))
}

export function sanitizeFilterFields(
  filter: Record<string, unknown> | null,
  availableFields: Set<string> | null,
): Record<string, unknown> | null {
  if (!filter || !availableFields || availableFields.size === 0) return filter
  const sanitized = sanitizeFilterValue(filter, availableFields)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : null
}

export function sanitizeFilterValue(value: unknown, availableFields: Set<string>): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeFilterValue(item, availableFields))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }

  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('_')) {
      const sanitized = sanitizeFilterValue(item, availableFields)
      if (sanitized !== undefined) {
        result[key] = sanitized
      }
      continue
    }

    if (!availableFieldsHas(availableFields, key)) continue
    const sanitized = sanitizeFilterValue(item, availableFields)
    if (sanitized !== undefined) {
      result[key] = sanitized
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

export function normalizeFilterFieldKeys(
  filter: Record<string, unknown> | null,
  fields: FieldDefinition[] | null,
): Record<string, unknown> | null {
  const normalized = normalizeFilterValueKeys(filter, fields)
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : null
}

export function normalizeFilterValueKeys(
  value: unknown,
  fields: FieldDefinition[] | null,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFilterValueKeys(item, fields))
  }
  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextKey = key.startsWith('_') ? key : resolveFieldPath(fields, key)
    result[nextKey] = normalizeFilterValueKeys(item, fields)
  }
  return result
}

export function splitLookupFilterForSource(
  filter: Record<string, unknown> | null | undefined,
): { sourceLinkField: string; parentFilter: Record<string, unknown> | null } | null {
  if (!filter) return null

  const sourceLink = findSourceLinkCondition(filter)
  if (!sourceLink) return null

  return {
    sourceLinkField: sourceLink.field,
    parentFilter: removeSourceTokenConditions(filter),
  }
}

export function findSourceLinkCondition(value: unknown): { field: string } | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findSourceLinkCondition(item)
      if (match) return match
    }
    return null
  }

  if (!value || typeof value !== 'object') return null

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!key.startsWith('_') && containsSourceToken(item)) {
      return { field: key }
    }
    const nested = findSourceLinkCondition(item)
    if (nested) return nested
  }

  return null
}

export function removeSourceTokenConditions(value: unknown): Record<string, unknown> | null {
  const cleaned = removeSourceTokenValue(value)
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
    ? cleaned as Record<string, unknown>
    : null
}

function removeSourceTokenValue(value: unknown): unknown {
  if (typeof value === 'string') return /^\$source\./.test(value.trim()) ? undefined : value
  if (Array.isArray(value)) {
    const items = value
      .map(removeSourceTokenValue)
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!key.startsWith('_') && containsSourceToken(item)) {
      continue
    }
    const cleaned = removeSourceTokenValue(item)
    if (cleaned !== undefined) {
      result[key] = cleaned
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

export function containsSourceToken(value: unknown): boolean {
  if (typeof value === 'string') return /^\$source\./.test(value.trim())
  if (Array.isArray(value)) return value.some(containsSourceToken)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsSourceToken)
  }
  return false
}

export function lookupFilterFields(filter: Record<string, unknown> | null): string[] {
  const fields = new Set<string>()
  collectLookupFilterFields(filter, fields)
  return Array.from(fields)
}

function collectLookupFilterFields(value: unknown, fields: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLookupFilterFields(item, fields)
    }
    return
  }

  if (!value || typeof value !== 'object') return

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('_')) {
      collectLookupFilterFields(item, fields)
      continue
    }

    fields.add(key)
    collectLookupFilterFields(item, fields)
  }
}

export function lookupFilterTokens(value: unknown): string[] {
  const tokens = new Set<string>()
  collectLookupFilterTokens(value, tokens)
  return Array.from(tokens)
}

export function collectLookupFilterTokens(value: unknown, tokens: Set<string>): void {
  if (typeof value === 'string') {
    if (/^\$(parent|source)\.([A-Za-z0-9_.-]+)$/.test(value.trim())) {
      tokens.add(value.trim())
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectLookupFilterTokens(item, tokens)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectLookupFilterTokens(item, tokens)
    }
  }
}

export function collectSourceTokenFields(value: unknown, fields: Set<string>): void {
  if (typeof value === 'string') {
    const match = /^\$source\.([A-Za-z0-9_.-]+)$/.exec(value.trim())
    if (match) {
      fields.add(match[1].split('.')[0])
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSourceTokenFields(item, fields)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectSourceTokenFields(item, fields)
    }
  }
}

export function intersectLookupSourceIds(sets: Array<Set<string>>): Set<string> | null {
  if (sets.length === 0) return null

  const [first, ...rest] = sets
  const result = new Set(first)
  for (const set of rest) {
    for (const id of Array.from(result)) {
      if (!set.has(id)) {
        result.delete(id)
      }
    }
  }

  return result
}

export function sourceIdFilter(
  primaryKey: string,
  allowedSourceIds: Set<string> | null,
): Record<string, unknown> | null {
  if (!allowedSourceIds) return null
  return {
    [primaryKey]: {
      _in: Array.from(allowedSourceIds),
    },
  }
}
