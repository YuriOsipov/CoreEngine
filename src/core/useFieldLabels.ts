import { reactive } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import { fetchTranslatedFieldLabel } from '@/modules/entities/services/collectionSchema'

export function useFieldLabels(entity: () => string) {
  const labels = reactive<Record<string, string>>({})

  async function sync(fields: LayoutFieldMetadata[]): Promise<void> {
    const fieldKeys = new Set(fields.map((f) => f.field))
    for (const key of Object.keys(labels)) {
      if (!fieldKeys.has(key)) delete labels[key]
    }
    await Promise.all(
      fields.map(async (field) => {
        labels[field.field] = await fetchTranslatedFieldLabel(entity(), field.field, field.label)
      }),
    )
  }

  function getLabel(field: LayoutFieldMetadata): string {
    return labels[field.field] ?? field.label
  }

  return { labels, sync, getLabel }
}
