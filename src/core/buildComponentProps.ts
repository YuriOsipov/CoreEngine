import type { LayoutFieldMetadata } from '@/interfaces'
import { isDateComponent, primeVueDatePickerFormat } from '@/core/dateFormatting'

export function buildComponentProps(
  field: LayoutFieldMetadata,
  runtimeFieldProps: Record<string, unknown>,
  readonly: boolean | undefined,
  readonlyFieldNames: Set<string>,
  parentName: string | undefined,
  parentId: string | number | undefined | null,
  runtimeFieldReadonly = false,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...runtimeFieldProps,
    id: field.field,
    fluid: true,
  }

  if (readonly) {
    base.disabled = true
  }
  if (readonlyFieldNames.has(field.field)) {
    base.disabled = true
  }
  if (field.readonly === true) {
    base.disabled = true
  }
  if (runtimeFieldReadonly) {
    base.disabled = true
  }
  if (field.field === parentName && parentId !== undefined && parentId !== null) {
    base.disabled = true
  }
  delete base.choiceSource
  delete base.sensitivitySource

  if (field.component === 'AutoComplete') {
    delete base.suggestions
    delete base.optionValue
    delete base.allowCreate
    delete base.forceSelection
  }
  if (isDateComponent(field.component) && field.format?.trim()) {
    base.dateFormat = primeVueDatePickerFormat(field.format)
  }

  return base
}
