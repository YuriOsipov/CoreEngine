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
    // Form always controls clear; do not let field metadata hide it.
    delete base.showClear
  }
  // Checkbox is a fixed-size control; fluid stretches / clips it in the form grid.
  // Label `for` must target inputId (the real <input>), not the root id.
  if (field.component === 'Checkbox' || field.component === 'ToggleSwitch') {
    delete base.fluid
    base.inputId = field.field
    delete base.id
  }
  if (isDateComponent(field.component) && field.format?.trim()) {
    base.dateFormat = primeVueDatePickerFormat(field.format)
  }

  return base
}
