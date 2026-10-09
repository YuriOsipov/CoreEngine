import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'

/** Picklist options taken from a JSON list column on a related record. */
export interface DynamicPicklistSource {
  /** M2O field on the current record, e.g. `item` on visit_item. */
  relationField: string
  /** JSON list field on the related record, e.g. `options` on item. */
  jsonField: string
  /** Column inside each JSON row, e.g. `value`. */
  valueColumn: string
}

export interface DynamicPicklistOption {
  label: string
  value: string
}

export function isDynamicPicklistSource(value: unknown): value is DynamicPicklistSource {
  return parseDynamicPicklistSource(value) !== null
}

export function parseDynamicPicklistSource(value: unknown): DynamicPicklistSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const relationField = String(row.relationField ?? row.relation_field ?? '').trim()
  const jsonField = String(row.jsonField ?? row.json_field ?? '').trim()
  const valueColumn = String(row.valueColumn ?? row.value_column ?? '').trim()
  if (!relationField || !jsonField || !valueColumn) return null
  return { relationField, jsonField, valueColumn }
}

function coerceJsonRows(value: unknown): Record<string, unknown>[] {
  let parsed = value
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim()
    if (!trimmed) return []
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
}

/** Unique non-empty column values, in row order. Label and stored value match. */
export function optionsFromJsonListColumn(
  value: unknown,
  column: string,
): DynamicPicklistOption[] {
  const name = column.trim()
  if (!name) return []

  const seen = new Set<string>()
  const options: DynamicPicklistOption[] = []
  for (const row of coerceJsonRows(value)) {
    const cell = row[name]
    if (cell === null || cell === undefined || cell === '') continue
    const label = typeof cell === 'string' ? cell.trim() : String(cell).trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    options.push({ label, value: label })
  }
  return options
}

function readEmbeddedJsonList(
  record: Record<string, unknown>,
  source: DynamicPicklistSource,
): { hit: boolean; value: unknown } {
  const raw = record[source.relationField]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { hit: false, value: undefined }
  }
  const related = raw as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(related, source.jsonField)) {
    return { hit: false, value: undefined }
  }
  return { hit: true, value: related[source.jsonField] }
}

export async function loadDynamicPicklistOptions(
  entityCollection: string,
  source: DynamicPicklistSource,
  record: Record<string, unknown>,
): Promise<DynamicPicklistOption[]> {
  const embedded = readEmbeddedJsonList(record, source)
  if (embedded.hit) {
    return optionsFromJsonListColumn(embedded.value, source.valueColumn)
  }

  const [{ getCachedRelations }, { bridgeReadItem }] = await Promise.all([
    import('@/modules/entities/services/collectionSchema'),
    import('@/core/graphql/itemsBridge'),
  ])

  let relationValue = record[source.relationField]
  const relationLoaded = Object.prototype.hasOwnProperty.call(record, source.relationField)
  const selfId = extractRelationFieldId(record.id)
  if (!relationLoaded && selfId !== null && entityCollection.trim()) {
    try {
      const self = await bridgeReadItem(entityCollection, selfId, {
        fields: [source.relationField],
      })
      relationValue = self?.[source.relationField]
    } catch {
      relationValue = undefined
    }
  }

  const id = extractRelationFieldId(relationValue)
  if (id === null || !entityCollection.trim()) return []

  const relatedCollection = relatedCollectionForCollectionField(
    await getCachedRelations(),
    entityCollection,
    source.relationField,
  )
  if (!relatedCollection) return []

  try {
    const row = await bridgeReadItem(relatedCollection, id, {
      fields: [source.jsonField],
    })
    return optionsFromJsonListColumn(row?.[source.jsonField], source.valueColumn)
  } catch {
    return []
  }
}
