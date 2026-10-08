import { reactive } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import type { FieldDefinition } from '@/interfaces'
import {
  effectiveDateDisplayFormat,
  isDateComponent,
} from '@/core/dateFormatting'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'

export function useDateDisplayFormats(entity: () => string) {
  const formats = reactive<Record<string, string>>({})

  async function sync(fields: LayoutFieldMetadata[]): Promise<void> {
    const dateFields = fields.filter((field) => isDateComponent(field.component))
    const dateFieldKeys = new Set(dateFields.map((field) => field.field))

    for (const key of Object.keys(formats)) {
      if (!dateFieldKeys.has(key)) {
        delete formats[key]
      }
    }
    if (dateFields.length === 0) return

    const definitions = (await getCachedCollectionFields(entity())) as FieldDefinition[]
    const definitionByField = new Map(
      definitions.map((definition) => [definition.field, definition]),
    )

    for (const field of dateFields) {
      const format = effectiveDateDisplayFormat(field.format, definitionByField.get(field.field))
      if (format) {
        formats[field.field] = format
      } else {
        delete formats[field.field]
      }
    }
  }

  return { formats, sync }
}
