import type { LayoutFieldMetadata } from '@/interfaces'

export function generateFieldId(): string {
  return `fld_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function defaultValueForField(field: LayoutFieldMetadata): unknown {
  switch (field.component) {
    case 'InputNumber':
      return null
    case 'Checkbox':
    case 'ToggleSwitch':
      return false
    case 'MultiSelect':
      return []
    case 'Select':
    case 'Dropdown':
    case 'SelectButton':
    case 'RadioButton':
    case 'AutoComplete':
    case 'ChildLookup':
      return null
    case 'DatePicker':
    case 'Calendar':
      return null
    case 'DataTable':
      return null
    case 'CrmTreeTable':
      return []
    case 'CrmScheduler':
      return null
    case 'CrmDocEngine':
      return null
    case 'CrmActivityLog':
      return null
    case 'Files':
      return null
    case 'M2ABuilder':
      return []
    case 'Repeater':
      return []
    case 'Address':
      return {
        country: '',
        state: '',
        city: '',
        address: '',
        postCode: '',
      }
    case 'JsonList':
      return []
    case 'JsonCode':
      return null
    case 'BlockLayout':
      return null
    default:
      return ''
  }
}

export function buildFormStateFromSchema(
  fields: LayoutFieldMetadata[],
): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.component === 'BlockLayout') continue
    state[field.field] = defaultValueForField(field)
  }
  return state
}
