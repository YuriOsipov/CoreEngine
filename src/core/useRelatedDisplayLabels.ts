import { reactive } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
} from '@/modules/entities/services/collectionSchema'
import {
  isRelatedValueField,
  relatedFieldRelationId,
  formatFieldDisplayValue,
} from '@/core/fieldHelpers'

export function useRelatedDisplayLabels(entity: () => string) {
  const labels = reactive<Record<string, string>>({})
  const keys = reactive<Record<string, string>>({})
  const requests = new Set<string>()

  function cacheKey(field: LayoutFieldMetadata, value: string | number): string {
    return [entity(), field.field, field.relatedCollection ?? '', value].join('.')
  }

  function sync(
    fields: LayoutFieldMetadata[],
    getValue: (field: LayoutFieldMetadata) => unknown,
  ): void {
    const relatedKeys = new Set(
      fields.filter((field) => field.relatedCollection).map((field) => field.field),
    )

    for (const key of Object.keys(labels)) {
      if (!relatedKeys.has(key)) {
        delete labels[key]
        delete keys[key]
      }
    }

    for (const field of fields) {
      void syncOne(field, getValue)
    }
  }

  async function syncOne(
    field: LayoutFieldMetadata,
    getValue: (field: LayoutFieldMetadata) => unknown,
  ): Promise<void> {
    const value = getValue(field)
    if (!isRelatedValueField(field, value)) return
    const relatedCollection = field.relatedCollection
    if (!relatedCollection) return

    const relationId = relatedFieldRelationId(value)
    if (relationId === null) return

    const key = cacheKey(field, relationId)
    if (keys[field.field] === key) return
    if (requests.has(key)) return

    keys[field.field] = key
    labels[field.field] = ''
    requests.add(key)

    try {
      const metadata = await fetchFieldRuntimeMetadata(entity(), field.field, field.component)
      const option = await fetchRelatedCollectionOptionById(
        relatedCollection,
        relationId,
        metadata.template,
      )

      if (keys[field.field] === key) {
        labels[field.field] = option?.label ?? formatFieldDisplayValue(relationId)
      }
    } finally {
      requests.delete(key)
    }
  }

  return { labels, keys, cacheKey, sync }
}
