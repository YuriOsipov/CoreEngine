import { reactive } from 'vue'
import type { Ref } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  fetchRelatedCollectionOptionById,
} from '@/modules/entities/services/collectionSchema'
import { isAutoCompleteField, isRelationPickerField } from '@/core/fieldHelpers'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

export interface AutoCompleteOption {
  label: string
  value: string | number
}

export function useAutoComplete(formState: Ref<Record<string, unknown>>) {
  const selections = reactive<Record<string, AutoCompleteOption | null>>({})
  const templates = reactive<Record<string, string | undefined>>({})

  function updateValue(field: LayoutFieldMetadata, value: AutoCompleteOption | null): void {
    selections[field.field] = value
    formState.value = {
      ...formState.value,
      [field.field]: value?.value ?? null,
    }
  }

  function seedSelection(fieldName: string, option: AutoCompleteOption): void {
    selections[fieldName] = option
    formState.value = {
      ...formState.value,
      [fieldName]: option.value,
    }
  }

  function relationPickerFields(fields: LayoutFieldMetadata[]): LayoutFieldMetadata[] {
    return fields.filter(
      (field) => isAutoCompleteField(field) || isRelationPickerField(field),
    )
  }

  function syncSelections(fields: LayoutFieldMetadata[]): void {
    const autoCompleteKeys = new Set(
      relationPickerFields(fields).map((f) => f.field),
    )

    for (const key of Object.keys(selections)) {
      if (!autoCompleteKeys.has(key)) {
        delete selections[key]
        delete templates[key]
      }
    }

    for (const field of relationPickerFields(fields)) {
      let value = formState.value[field.field]
      const relationId = extractRelationFieldId(value)
      if (relationId !== null && value !== relationId) {
        formState.value = {
          ...formState.value,
          [field.field]: relationId,
        }
        value = relationId
      } else if (
        relationId === null &&
        value !== null &&
        value !== undefined &&
        typeof value === 'object'
      ) {
        formState.value = {
          ...formState.value,
          [field.field]: null,
        }
        value = null
      } else if (value === 0 || value === '0') {
        formState.value = {
          ...formState.value,
          [field.field]: null,
        }
        value = null
      }

      if (value === null || value === undefined || value === '') {
        selections[field.field] = null
        continue
      }
      if (selections[field.field]?.value === value) continue
      // Keep a provisional option so AutoComplete is not null while the label
      // loads — a null modelValue can emit clear and wipe prefilled FKs.
      selections[field.field] = {
        label: String(value),
        value: value as string | number,
      }
    }
  }

  async function syncSelectionLabel(
    field: LayoutFieldMetadata,
    template?: string,
  ): Promise<void> {
    const value = extractRelationFieldId(formState.value[field.field])
    if (!field.relatedCollection || value === null) {
      return
    }
    const existing = selections[field.field]
    if (
      existing?.value === value &&
      existing.label &&
      existing.label !== String(value)
    ) {
      return
    }

    const option = await fetchRelatedCollectionOptionById(
      field.relatedCollection,
      value,
      template,
    )
    if (option) {
      selections[field.field] = option
      if (extractRelationFieldId(formState.value[field.field]) === null) {
        formState.value = {
          ...formState.value,
          [field.field]: option.value,
        }
      }
    }
  }

  async function onAutoComplete(
    field: LayoutFieldMetadata,
    template: string | undefined,
  ): Promise<void> {
    templates[field.field] = template
    await syncSelectionLabel(field, template)
  }

  return {
    selections,
    templates,
    updateValue,
    seedSelection,
    syncSelections,
    syncSelectionLabel,
    onAutoComplete,
  }
}
