import { DOC_VALUE_PARENT_M2O_FIELDS } from '@/interfaces/documents'

export function resolveDocValueParentField(
  parentCollection: string,
): string | null {
  return DOC_VALUE_PARENT_M2O_FIELDS[parentCollection] ?? null
}

export function coerceDocValueParentRecordId(
  parentId: string,
): string | number {
  const trimmed = parentId.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

/**
 * Prefer a dedicated M2O (e.g. `visit`) only when the id matches that column's
 * scalar type. Legacy `doc_value.visit` is bigint — UUID visit ids must use
 * polymorphic `parent_collection` + `parent_id` instead.
 */
function canUseDedicatedParentM2O(
  parentField: string | null,
  parentId: string,
): parentField is string {
  if (!parentField) return false
  return typeof coerceDocValueParentRecordId(parentId) === 'number'
}

export function buildDocValueParentFilter(
  parentCollection: string,
  parentId: string,
): Record<string, unknown> {
  const parentField = resolveDocValueParentField(parentCollection)
  if (canUseDedicatedParentM2O(parentField, parentId)) {
    return {
      [parentField]: { _eq: coerceDocValueParentRecordId(parentId) },
    }
  }

  return {
    parent_collection: { _eq: parentCollection },
    parent_id: { _eq: String(parentId).trim() },
  }
}

export function buildDocValueParentPayload(
  parentCollection: string,
  parentId: string,
): Record<string, string | number> {
  const parentField = resolveDocValueParentField(parentCollection)
  if (canUseDedicatedParentM2O(parentField, parentId)) {
    return {
      [parentField]: coerceDocValueParentRecordId(parentId),
    }
  }

  return {
    parent_collection: parentCollection,
    parent_id: String(parentId).trim(),
  }
}
