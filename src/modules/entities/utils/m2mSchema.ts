import type { FieldDefinition, RelationDefinition } from '@/interfaces'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

export interface M2MSelectOption {
  label: string
  value: string | number
}

export function findM2MRelation(
  collection: string,
  field: string,
  relations: RelationDefinition[],
): RelationDefinition | undefined {
  return relations.find((relation) => {
    if (relation.collection === collection && relation.field === field) {
      return true
    }
    return (
      relation.meta?.one_collection === collection &&
      relation.meta?.one_field === field
    )
  })
}

export function isFieldM2M(
  collection: string,
  field: string,
  _fields: FieldDefinition[],
  relations: RelationDefinition[],
): boolean {
  const relation = findM2MRelation(collection, field, relations)
  if (!relation) return false
  const kind = String(relation.meta?.kind ?? '').toUpperCase()
  if (kind === 'M2M') return true
  return Boolean(
    relation.meta?.many_collection &&
      relation.meta?.junction_field &&
      relation.meta?.many_field &&
      relation.meta?.one_field === field,
  )
}

export function m2mJunctionFieldName(
  collection: string,
  field: string,
  relations: RelationDefinition[],
): string | null {
  const relation = findM2MRelation(collection, field, relations)
  const junctionField = relation?.meta?.junction_field
  return typeof junctionField === 'string' && junctionField.trim()
    ? junctionField.trim()
    : null
}

function optionLabel(value: unknown, fallbackId: string): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const name =
      record.name ??
      record.label ??
      record.title ??
      record.display_name ??
      record.email
    if (name != null && String(name).trim()) return String(name)
  }
  return fallbackId
}

/** Normalize loaded junction rows / option arrays into multi-select options. */
export function m2mValueToOptions(
  value: unknown,
  junctionField: string | null,
): M2MSelectOption[] {
  if (!Array.isArray(value) || value.length === 0) return []

  const options: M2MSelectOption[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (entry == null) continue

    if (typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      if (
        'label' in record &&
        'value' in record &&
        record.value != null &&
        record.value !== ''
      ) {
        const id = String(record.value)
        if (seen.has(id)) continue
        seen.add(id)
        options.push({
          label: String(record.label ?? id),
          value: record.value as string | number,
        })
        continue
      }

      const relatedRaw =
        junctionField && junctionField in record
          ? record[junctionField]
          : record.id
      const relatedId = extractRelationFieldId(relatedRaw)
      if (relatedId == null) continue
      const id = String(relatedId)
      if (seen.has(id)) continue
      seen.add(id)
      options.push({
        label: optionLabel(relatedRaw, id),
        value: relatedId,
      })
      continue
    }

    const id = String(entry)
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ label: id, value: entry as string | number })
  }

  return options
}

/**
 * Build nested O2M/M2M write ops from current options vs original junction rows.
 * Creates missing links; deletes removed links (requires original junction ids).
 */
export function m2mOptionsToNestedPayload(
  selected: unknown,
  original: unknown,
  junctionField: string,
): Array<Record<string, unknown>> {
  const selectedOptions = m2mValueToOptions(selected, junctionField)
  const selectedIds = new Set(selectedOptions.map((opt) => String(opt.value)))

  const originalRows = Array.isArray(original) ? original : []
  const nested: Array<Record<string, unknown>> = []
  const keptRelatedIds = new Set<string>()

  for (const row of originalRows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const junctionId =
      record.id != null && record.id !== '' ? String(record.id) : null
    const relatedId = extractRelationFieldId(
      junctionField in record ? record[junctionField] : null,
    )
    if (!relatedId) continue
    const relatedKey = String(relatedId)

    if (!selectedIds.has(relatedKey)) {
      if (junctionId) {
        nested.push({ id: junctionId, delete: true })
      }
      continue
    }

    keptRelatedIds.add(relatedKey)
  }

  for (const option of selectedOptions) {
    const relatedKey = String(option.value)
    if (keptRelatedIds.has(relatedKey)) continue
    nested.push({ [junctionField]: option.value })
  }

  return nested
}
