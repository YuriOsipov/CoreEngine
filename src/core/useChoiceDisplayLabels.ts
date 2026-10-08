import { reactive } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import { fetchFieldRuntimeMetadata } from '@/modules/entities/services/collectionSchema'
import { isChoiceValueField, isChoiceOption } from '@/core/fieldHelpers'

export function useChoiceDisplayLabels(entity: () => string) {
  const labels = reactive<Record<string, Record<string, string>>>({})
  const keys = reactive<Record<string, string>>({})
  const requests = new Set<string>()

  function sync(fields: LayoutFieldMetadata[]): void {
    const choiceKeys = new Set(fields.filter(isChoiceValueField).map((field) => field.field))

    for (const key of Object.keys(labels)) {
      if (!choiceKeys.has(key)) {
        delete labels[key]
        delete keys[key]
      }
    }

    for (const field of fields) {
      void syncOne(field)
    }
  }

  async function syncOne(field: LayoutFieldMetadata): Promise<void> {
    if (!isChoiceValueField(field)) return

    const key = [entity(), field.field, field.component].join('.')
    if (keys[field.field] === key) return
    if (requests.has(key)) return

    keys[field.field] = key
    labels[field.field] = {}
    requests.add(key)

    try {
      const metadata = await fetchFieldRuntimeMetadata(entity(), field.field, field.component)
      const options = metadata.props.options

      if (Array.isArray(options) && keys[field.field] === key) {
        labels[field.field] = options.reduce<Record<string, string>>((acc, option) => {
          if (!isChoiceOption(option)) return acc
          acc[String(option.value)] = option.label
          return acc
        }, {})
      }
    } finally {
      requests.delete(key)
    }
  }

  return { labels, sync }
}
