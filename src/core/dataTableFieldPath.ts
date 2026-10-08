import { effectiveDateDisplayFormat } from '@/core/dateFormatting'
import {
  fieldDisplayTemplate,
  keysEqual,
} from '@/core/childLookupOptions'
import type {
  FieldDefinition,
  RelationDefinition,
  PrimeVueComponentType,
} from '@/interfaces'
import {
  extractTemplateFields,
  humanizeFieldName,
  relatedRecordDisplayField,
  relatedRecordFallbackLabel,
  choiceValueLabel,
  renderTemplateLabel,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'
import { readPath } from '@/core/utils/object'
import {
  findRelationForField,
  mapFieldTypeToComponent,
} from '@/modules/entities/utils/fieldMapper'

export interface ResolvedDataTableFieldPath {
  path: string
  rootField: string
  nestedField?: string
  rootDefinition: FieldDefinition
  nestedDefinition?: FieldDefinition
  /** Collection where the displayed value field is defined. */
  valueCollection: string
  relatedCollection?: string
  component?: PrimeVueComponentType
  template?: string
  format?: string
  requestFields: string[]
}

export function isNestedFieldPath(path: string): boolean {
  return path.includes('.')
}

export function rootFieldName(path: string): string {
  return path.split('.')[0] ?? path
}

export function resolveColumnFieldPath(
  collection: string,
  path: string,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  relatedFieldsByCollection: Record<string, FieldDefinition[]> = {},
): ResolvedDataTableFieldPath | null {
  const trimmedPath = path.trim()
  if (!trimmedPath) return null

  const parts = trimmedPath.split('.').filter(Boolean)
  const rootSegment = parts[0]
  if (!rootSegment) return null

  const rootDefinition = fields.find((field) =>
    keysEqual(field.field, rootSegment),
  )
  if (!rootDefinition) return null

  const rootField = rootDefinition.field
  const rootRelation = findRelationForField(rootDefinition, relations)

  if (parts.length === 1) {
    const component = mapFieldTypeToComponent(rootDefinition, rootRelation) as
      | PrimeVueComponentType
      | null
    const template =
      typeof rootDefinition.meta?.options?.template === 'string'
        ? rootDefinition.meta.options.template
        : undefined
    const isDateType = ['date', 'dateTime', 'timestamp'].includes(rootDefinition.type)
    const format = isDateType
      ? effectiveDateDisplayFormat(undefined, rootDefinition)
      : undefined

    return {
      path: rootField,
      rootField,
      rootDefinition,
      valueCollection: collection,
      relatedCollection: rootRelation?.related_collection ?? undefined,
      component: component ?? undefined,
      template,
      format,
      requestFields: buildRootRequestFields(rootField, template),
    }
  }

  if (parts.length !== 2) return null

  const nestedSegment = parts[1]
  const relatedCollection =
    rootRelation?.related_collection ?? rootDefinition.schema?.foreign_key_table
  if (!relatedCollection) return null

  const relatedFields = relatedFieldsByCollection[relatedCollection] ?? []
  const nestedDefinition = relatedFields.find((field) =>
    keysEqual(field.field, nestedSegment),
  )
  if (!nestedDefinition) return null

  const nestedField = nestedDefinition.field
  const nestedRelation = findRelationForField(nestedDefinition, relations)
  const nestedRelatedCollection = nestedRelation?.related_collection ?? undefined
  const component = mapFieldTypeToComponent(
    nestedDefinition,
    nestedRelation,
  ) as PrimeVueComponentType | null
  const template = fieldDisplayTemplate(nestedDefinition)
  const isDateType = ['date', 'dateTime', 'timestamp'].includes(nestedDefinition.type)
  const format = isDateType
    ? effectiveDateDisplayFormat(undefined, nestedDefinition)
    : undefined
  const nestedTargetFields = nestedRelatedCollection
    ? relatedFieldsByCollection[nestedRelatedCollection] ?? []
    : []

  return {
    path: `${rootField}.${nestedField}`,
    rootField,
    nestedField,
    rootDefinition,
    nestedDefinition,
    valueCollection: relatedCollection,
    relatedCollection: nestedRelatedCollection,
    component: component ?? undefined,
    template,
    format,
    requestFields: buildNestedRequestFields(
      rootField,
      nestedField,
      template,
      nestedRelatedCollection,
      nestedTargetFields,
    ),
  }
}

export function buildNestedRequestFields(
  rootField: string,
  nestedField: string,
  template?: string,
  nestedRelatedCollection?: string,
  nestedCollectionFields: FieldDefinition[] = [],
): string[] {
  const fields = new Set<string>([
    rootField,
    `${rootField}.id`,
    `${rootField}.${nestedField}`,
  ])

  if (nestedRelatedCollection && nestedCollectionFields.length > 0) {
    fields.add(`${rootField}.${nestedField}.id`)
    fields.add(
      `${rootField}.${nestedField}.${relatedRecordDisplayField(nestedCollectionFields)}`,
    )
  }

  if (template) {
    for (const templateField of extractTemplateFields(template)) {
      fields.add(`${rootField}.${templateField}`)
    }
  }

  return Array.from(fields)
}

export function collectNestedPathRelatedCollections(
  paths: string[],
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  relatedFieldsByCollection: Record<string, FieldDefinition[]> = {},
): Set<string> {
  const collections = new Set<string>()

  for (const path of paths) {
    if (!isNestedFieldPath(path)) continue

    const rootDefinition = fields.find((field) =>
      keysEqual(field.field, rootFieldName(path)),
    )
    if (!rootDefinition) continue

    const rootRelation = findRelationForField(rootDefinition, relations)
    const relatedCollection =
      rootRelation?.related_collection ?? rootDefinition.schema?.foreign_key_table
    if (relatedCollection) collections.add(relatedCollection)

    const nestedSegment = path.split('.')[1]
    if (!nestedSegment || !relatedCollection) continue

    const nestedDefinition = (relatedFieldsByCollection[relatedCollection] ?? []).find(
      (field) => keysEqual(field.field, nestedSegment),
    )
    if (!nestedDefinition) continue

    const nestedRelation = findRelationForField(nestedDefinition, relations)
    if (nestedRelation?.related_collection) {
      collections.add(nestedRelation.related_collection)
    }
  }

  return collections
}

export function applyNestedColumnValues(
  rendered: Record<string, unknown>,
  sourceRow: Record<string, unknown>,
  resolvedPaths: ResolvedDataTableFieldPath[],
  choiceLabels: Map<string, Map<string, string>>,
): void {
  for (const resolved of resolvedPaths) {
    if (!isNestedFieldPath(resolved.path)) continue

    let value = readPath(sourceRow, resolved.path)
    const labels = choiceLabels.get(resolved.path)
    if (labels) {
      const label = choiceValueLabel(value, labels)
      if (label !== undefined) {
        value = label
      }
    } else if (
      value &&
      typeof value === 'object' &&
      resolved.relatedCollection
    ) {
      const record = value as Record<string, unknown>
      const id = record.id ?? value
      const templateFields = resolved.template
        ? extractTemplateFields(resolved.template)
        : []
      const label =
        resolved.template &&
        shouldUseTemplateForRelatedLabel(resolved.template, templateFields)
          ? renderTemplateLabel(resolved.template, record)
          : relatedRecordFallbackLabel(record, id)
      rendered[resolved.path] = {
        __crmValueType: 'm2o',
        id,
        label,
        relatedCollection: resolved.relatedCollection,
      }
      continue
    }

    if (value !== undefined && value !== null && value !== '') {
      rendered[resolved.path] = value
    }
  }
}

export function resolveNestedCellValue(
  row: Record<string, unknown>,
  path: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(row, path)) {
    return row[path]
  }
  return readPath(row, path)
}

export function buildRootRequestFields(
  rootField: string,
  template?: string,
): string[] {
  if (!template) return [rootField]

  const fields = new Set<string>([`${rootField}.id`])
  for (const templateField of extractTemplateFields(template)) {
    fields.add(`${rootField}.${templateField}`)
  }
  return Array.from(fields)
}

export function resolveColumnHeader(
  rootDefinition: FieldDefinition,
  nestedDefinition?: FieldDefinition,
): string {
  const rootLabel =
    rootDefinition.meta?.note?.trim() || humanizeFieldName(rootDefinition.field)
  if (!nestedDefinition) return rootLabel

  const nestedLabel =
    nestedDefinition.meta?.note?.trim() || humanizeFieldName(nestedDefinition.field)
  return `${rootLabel} / ${nestedLabel}`
}

export function nestedDisplayFallbackRequestFields(
  rootField: string,
  relatedFields: FieldDefinition[],
): string[] {
  const displayField = relatedRecordDisplayField(relatedFields)
  return [`${rootField}.id`, `${rootField}.${displayField}`]
}
