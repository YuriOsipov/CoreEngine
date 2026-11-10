import { reactive } from 'vue'
import type { FieldDefinition, LayoutFieldMetadata } from '@/interfaces'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'
import {
  resolveNumberDisplayOptions,
  type NumberDisplayOptions,
} from '@/modules/entities/utils/recordDisplay'

export function useNumberDisplayOptions(entity: () => string) {
  const options = reactive<Record<string, NumberDisplayOptions>>({})

  async function sync(fields: LayoutFieldMetadata[]): Promise<void> {
    const fieldKeys = new Set(fields.map((field) => field.field))
    for (const key of Object.keys(options)) {
      if (!fieldKeys.has(key)) delete options[key]
    }
    if (fields.length === 0) return

    const definitions = (await getCachedCollectionFields(entity())) as FieldDefinition[]
    const definitionByField = new Map(
      definitions.map((definition) => [definition.field, definition]),
    )

    for (const field of fields) {
      const resolved = resolveNumberDisplayOptions(definitionByField.get(field.field))
      if (resolved) {
        options[field.field] = resolved
      } else {
        delete options[field.field]
      }
    }
  }

  return { options, sync }
}
