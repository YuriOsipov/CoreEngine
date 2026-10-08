import { reactive } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import { fetchFieldRuntimeMetadata } from '@/modules/entities/services/collectionSchema'
import {
  isAutoCompleteField,
  isDataTableField,
  isFilesField,
  isSchedulerField,
} from '@/core/fieldHelpers'

export function useRuntimeFieldMetadata(entity: () => string) {
  const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
  const runtimeRequired = reactive<Record<string, boolean>>({})
  const runtimeReadonly = reactive<Record<string, boolean>>({})
  const runtimeFormula = reactive<Record<string, string>>({})
  const metadataKeys = reactive<Record<string, string>>({})
  const metadataRequests = new Set<string>()

  async function sync(
    fields: LayoutFieldMetadata[],
    onAutoComplete?: (field: LayoutFieldMetadata, template: string | undefined) => Promise<void>,
  ): Promise<void> {
    const fieldKeys = new Set(fields.map((f) => f.field))

    for (const key of Object.keys(runtimeFieldProps)) {
      if (!fieldKeys.has(key)) {
        delete runtimeFieldProps[key]
        delete runtimeRequired[key]
        delete runtimeReadonly[key]
        delete runtimeFormula[key]
        delete metadataKeys[key]
      }
    }

    for (const field of fields) {
      if (
        isDataTableField(field) ||
        isSchedulerField(field) ||
        isFilesField(field)
      ) {
        continue
      }

      const cacheKey = `${entity()}.${field.field}.${field.component}`
      if (metadataKeys[field.field] === cacheKey) continue
      if (metadataRequests.has(cacheKey)) continue

      metadataKeys[field.field] = cacheKey
      metadataRequests.add(cacheKey)

      try {
        const metadata = await fetchFieldRuntimeMetadata(entity(), field.field, field.component)
        runtimeFieldProps[field.field] = metadata.props
        runtimeRequired[field.field] = metadata.required
        runtimeReadonly[field.field] = metadata.readonly
        const formula = metadata.formula ?? metadata.template
        if (formula) {
          runtimeFormula[field.field] = formula
        } else {
          delete runtimeFormula[field.field]
        }
        if (isAutoCompleteField(field)) {
          await onAutoComplete?.(field, metadata.template)
        }
      } finally {
        metadataRequests.delete(cacheKey)
      }
    }
  }

  return { runtimeFieldProps, runtimeRequired, runtimeReadonly, runtimeFormula, sync }
}
