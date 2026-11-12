import type { PrimeVueComponentType } from '@/interfaces'
import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { isAddressFieldDefinition } from '@/core/addressField'
import {
  isJsonCodeFieldDefinition,
  isJsonListFieldDefinition,
} from '@/core/jsonField'
import { isSensitivityMatrixFieldDefinition } from '@/core/sensitivityField'
import { isRepeaterFieldDefinition } from '@/core/repeaterField'
import { isSystemAuditUserFieldName } from '@/core/layoutFieldRules'
import {
  isUsersLayoutExcludedField,
  USERS_ASSET_COLLECTION,
} from '@/core/usersField'
import { keysEqual } from '@/core/utils/object'
import type { PaletteItem } from './fieldPalette'

function fieldHasRollupCompute(field: FieldDefinition): boolean {
  const options = field.meta?.options
  if (!options || typeof options !== 'object') return false
  const record = options as Record<string, unknown>
  const mode = String(record.computeMode ?? record.compute_mode ?? '')
    .trim()
    .toLowerCase()
  if (mode === 'rollup') return true
  return Boolean(record.rollup && typeof record.rollup === 'object')
}

const SKIP_SPECIAL = new Set([
  'o2m',
  'translations',
  'no-data',
])

const SYSTEM_FIELD_NAMES = new Set([
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
])

/** Registry may return meta.special as a string or string[]. */
export function normalizeSpecial(
  special: string[] | string | null | undefined,
): string[] {
  if (!special) return []
  if (Array.isArray(special)) return special
  return [special]
}

function mapInterfaceToComponent(
  metaInterface: string | null | undefined,
  typeComponent: PrimeVueComponentType | null,
): PrimeVueComponentType | null {
  if (!metaInterface) return null
  const i = metaInterface.toLowerCase()

  // List choices, e.g. patient.sex.
  if (i.includes('select-dropdown')) return 'Select'
  if (i.includes('select')) return 'Select'

  if (i.includes('wysiwyg') || i.includes('rich-text-html')) {
    return typeComponent === 'InputText' || typeComponent === 'Textarea'
      ? 'Editor'
      : null
  }

  if (i.includes('textarea')) {
    return typeComponent === 'InputText' || typeComponent === 'Textarea'
      ? 'Textarea'
      : null
  }

  // Common datetime/date UIs.
  if (i.includes('datetime') || i.includes('date')) {
    return typeComponent === 'DatePicker' ? 'DatePicker' : null
  }

  // Common boolean UIs.
  if (i.includes('toggle') || i.includes('boolean') || i.includes('checkbox')) {
    return typeComponent === 'Checkbox' ? 'Checkbox' : null
  }

  if (i.includes('currency') || i.includes('number') || i.includes('numeric') || i.includes('slider')) {
    // Currency must stay numeric even if registry type was mis-mapped.
    return 'InputNumber'
  }

  if (i.includes('calculated') || i.includes('formula') || i.includes('computed')) {
    return typeComponent
  }

  if (i.includes('input') || i.includes('text')) {
    return typeComponent === 'InputText' ? 'InputText' : null
  }

  return null
}

/**
 * Maps a registry field type (and relation metadata) to a PrimeVue component name.
 */
export function mapFieldTypeToComponent(
  field: FieldDefinition,
  relation?: RelationDefinition,
): PrimeVueComponentType | null {
  const special = normalizeSpecial(field.meta?.special)

  if (special.some((s) => SKIP_SPECIAL.has(s))) {
    return null
  }

  if (special.includes('m2a')) {
    return 'M2ABuilder'
  }

  if (special.includes('m2m')) {
    return 'M2MMultiSelect'
  }

  if (isRepeaterFieldDefinition(field)) {
    return 'Repeater'
  }

  if (isAddressFieldDefinition(field)) {
    return 'Address'
  }

  if (isSensitivityMatrixFieldDefinition(field)) {
    return 'SensitivityMatrix'
  }

  if (isJsonListFieldDefinition(field)) {
    return 'JsonList'
  }

  if (isJsonCodeFieldDefinition(field)) {
    return 'JsonCode'
  }

  if (field.type === 'alias') {
    // Live rollups are ALIAS (no physical column) but still render as numbers.
    if (fieldHasRollupCompute(field) || isCalculatedFieldInterface(field.meta?.interface)) {
      const options = field.meta?.options
      const resultType =
        options && typeof options === 'object'
          ? String(
              (options as Record<string, unknown>).resultType ??
                (options as Record<string, unknown>).result_type ??
                '',
            )
              .trim()
              .toLowerCase()
          : ''
      if (resultType.includes('int') || resultType === 'integer') {
        return 'InputNumber'
      }
      if (
        resultType.includes('float') ||
        resultType.includes('decimal') ||
        resultType.includes('number')
      ) {
        return 'InputNumber'
      }
      return mapPrimitiveTypeComponent(resultType || 'float') ?? 'InputNumber'
    }
    return null
  }

  if (special.includes('file') || special.includes('files')) {
    return 'Files'
  }

  if (special.includes('m2o') || relation?.related_collection) {
    return 'AutoComplete'
  }

  const typeComponent = mapPrimitiveTypeComponent(field.type)
  const byInterface = mapInterfaceToComponent(
    field.meta?.interface,
    typeComponent,
  )

  if (byInterface) return byInterface
  return typeComponent
}

function mapPrimitiveTypeComponent(type: string): PrimeVueComponentType | null {
  switch (type) {
    case 'string':
    case 'uuid':
    case 'hash':
    case 'csv':
      return 'InputText'
    case 'integer':
    case 'bigInteger':
    case 'float':
    case 'decimal':
      return 'InputNumber'
    case 'text':
      return 'Textarea'
    case 'date':
    case 'dateTime':
    case 'timestamp':
    case 'time':
      return 'DatePicker'
    case 'boolean':
      return 'Checkbox'
    default:
      return null
  }
}

export function isLayoutEligibleField(field: FieldDefinition): boolean {
  if (field.meta?.hidden) return false
  if (SYSTEM_FIELD_NAMES.has(field.field)) return false
  if (isUsersLayoutExcludedField(field.collection, field.field)) return false
  return mapFieldTypeToComponent(field) !== null
}

const CALCULATED_INTERFACE_HINTS = ['calculated', 'formula', 'computed'] as const

export function isCalculatedFieldInterface(interfaceName: string | null | undefined): boolean {
  if (!interfaceName) return false
  const normalized = interfaceName.toLowerCase()
  return CALCULATED_INTERFACE_HINTS.some((hint) => normalized.includes(hint))
}

/** Fields that must not be edited in entity forms (meta.readonly, calculated UI, etc.). */
export function isFieldReadonly(field: FieldDefinition): boolean {
  if (field.meta?.readonly === true) return true
  if (isCalculatedFieldInterface(field.meta?.interface)) return true
  const options = field.meta?.options
  if (options && typeof options === 'object') {
    const mode = String(
      (options as Record<string, unknown>).computeMode ??
        (options as Record<string, unknown>).compute_mode ??
        '',
    )
      .trim()
      .toLowerCase()
    if (mode === 'formula' || mode === 'rollup' || mode === 'autonumber') return true
  }
  return false
}

export function findRelationForField(
  field: FieldDefinition,
  relations: RelationDefinition[],
): RelationDefinition | undefined {
  const found = relations.find(
    (r) =>
      keysEqual(r.collection, field.collection) &&
      keysEqual(r.field, field.field),
  )
  if (found) return found
  // Registry seeds audit FKs without relation rows; BFF synthesizes M2O → users
  // on read — mirror that here so list/table columns expand to names.
  if (isSystemAuditUserFieldName(field.field)) {
    return {
      collection: field.collection,
      field: field.field,
      related_collection: USERS_ASSET_COLLECTION,
      meta: { kind: 'M2O' },
    }
  }
  return undefined
}

export function buildPaletteItemFromField(
  field: FieldDefinition,
  relations: RelationDefinition[],
): PaletteItem | null {
  const relation = findRelationForField(field, relations)
  const component = mapFieldTypeToComponent(field, relation)
  if (!component) return null

  const label =
    field.meta?.note?.trim() ||
    humanizeFieldName(field.field)

  const item: PaletteItem = {
    id: `palette-${field.collection}-${field.field}`,
    label,
    component,
    fieldKey: field.field,
    fieldType: field.type,
    description: `${field.type}${relation?.related_collection ? ` → ${relation.related_collection}` : ''}`,
  }

  if (component === 'AutoComplete' && relation?.related_collection) {
    item.relatedCollection = relation.related_collection
  }

  if (component === 'M2MMultiSelect' && relation?.related_collection) {
    item.relatedCollection = relation.related_collection
  }

  if (component === 'Files') {
    const special = normalizeSpecial(field.meta?.special)
    item.multiple = special.includes('files')
    const iface = String(field.meta?.interface || '').toLowerCase()
    const options =
      field.meta?.options && typeof field.meta.options === 'object'
        ? (field.meta.options as Record<string, unknown>)
        : null
    const filesOpt =
      options?.files && typeof options.files === 'object'
        ? (options.files as Record<string, unknown>)
        : null
    const fromOptions = Array.isArray(filesOpt?.allowedMimeTypes)
      ? (filesOpt!.allowedMimeTypes as unknown[])
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      : []
    if (fromOptions.length) {
      item.allowedMimeTypes = fromOptions
    } else if (
      special.includes('file') &&
      (iface === 'file-image' || iface.includes('file-image'))
    ) {
      item.allowedMimeTypes = ['image/']
    }
    // maxFileSizeMb lives on Setup options; palette does not need it for drag/drop.
    if (special.includes('file') && relation?.related_collection) {
      item.relatedCollection = relation.related_collection
    } else if (special.includes('files')) {
      const junctionRelation = relations.find(
        (entry) =>
          entry.meta?.one_collection === field.collection &&
          entry.meta?.one_field === field.field,
      )
      item.relatedCollection =
        junctionRelation?.meta?.many_collection ??
        junctionRelation?.collection ??
        undefined
    }
  }

  if (component === 'M2ABuilder') {
    const m2aRelation = relations.find(
      (relation) =>
        relation.meta?.one_collection === field.collection &&
        relation.meta?.one_field === field.field,
    )
    item.relatedCollection = m2aRelation?.meta?.many_collection ?? undefined
  }

  return item
}

export function buildPaletteFromFields(
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): PaletteItem[] {
  return fields
    .filter(isLayoutEligibleField)
    .map((field) => buildPaletteItemFromField(field, relations))
    .filter((item): item is PaletteItem => item !== null)
    .sort((a, b) => a.label.localeCompare(b.label))
}

function humanizeFieldName(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
