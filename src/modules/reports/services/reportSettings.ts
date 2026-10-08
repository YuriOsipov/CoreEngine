import {
  readSettingRecord,
  readSettingRecords,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import {
  getCachedCollectionFields,
  getCachedFields,
  getCachedRelations,
  translatedFieldLabel,
} from '@/modules/entities/services/collectionSchema'
import { listFilterableFields, type FilterLogic } from '@/modules/config/services/listFilterSettings'
import type { PrimeVueComponentType } from '@/interfaces'
import {
  findRelationForField,
  mapFieldTypeToComponent,
  normalizeSpecial,
} from '@/modules/entities/utils/fieldMapper'
import {
  buildChoiceLabelMap,
  choiceValueLabel,
  extractTemplateFields,
  getPathValue,
  humanizeFieldName,
  relatedRecordDisplayField,
  relatedRecordFallbackLabel,
  renderTemplateLabel,
  setPathValue,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'

const SETTINGS_GROUP = 'report'
const SETTINGS_SUB_GROUP = 'full'

export type ReportAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface ReportFilterCondition {
  id: string
  field: string
  operator: string
  value: unknown
}

export interface ReportPivotValue {
  field: string
  aggregate: ReportAggregate
}

export interface ReportPivotSettings {
  rows: string[]
  columns: string[]
  values: ReportPivotValue[]
}

export interface ReportDefinition {
  id: string
  name: string
  title: string
  collection: string
  filterLogic: FilterLogic
  conditions: ReportFilterCondition[]
  pivot: ReportPivotSettings
  limit?: number
}

export interface ReportSettingRecord {
  id: number | string
  collection: string
  group: string
  name: string
  sub_group: string
  body?: ReportDefinition | string | null
}

export interface ReportWithSetting {
  settingId: number | string
  name: string
  title: string
  collection: string
  config: ReportDefinition
}

export interface ReportFieldOption {
  field: string
  label: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
  sourceField?: string
  nestedField?: string
}

export interface ReportFieldTreeNode {
  key: string
  label: string
  leaf: boolean
  selectable: boolean
  data: ReportFieldOption
  children?: ReportFieldTreeNode[]
}

export interface ReportFieldTreeMetadata {
  fieldsByCollection: Map<string, FieldDefinition[]>
  relations: RelationDefinition[]
}

interface ReportM2OMetadata {
  collections: Map<string, string>
  displayFields: Map<string, string>
  templates: Map<string, string>
  choiceLabels: Map<string, Map<string, string>>
}

interface ReportQueryRequest {
  fields: string[]
  m2o: ReportM2OMetadata
}

interface ResolvedM2OField {
  field: FieldDefinition | undefined
  relatedCollection: string
  relatedFields: FieldDefinition[]
}

export async function listReports(): Promise<ReportWithSetting[]> {
  const records = await readSettingRecords<ReportSettingRecord>({
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
  })

  return records
    .map((record) => {
      const typed = record as ReportSettingRecord
      const config = normalizeReportDefinition(parseReportBody(typed), {
        name: typed.name,
        collection: typed.collection,
      })
      return {
        settingId: typed.id,
        name: typed.name,
        title: config.title || typed.name,
        collection: config.collection || typed.collection,
        config,
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function listReportFields(
  collection: string,
): Promise<ReportFieldOption[]> {
  return (await listReportFieldTreeNodes(collection)).map((node) => node.data)
}

export async function loadReportFieldTreeMetadata(): Promise<ReportFieldTreeMetadata> {
  const [fieldsRaw, relationsRaw] = await Promise.all([
    getCachedFields(),
    getCachedRelations(),
  ])
  const fields = fieldsRaw as FieldDefinition[]
  const relations = relationsRaw as RelationDefinition[]
  const fieldsByCollection = fields.reduce<Map<string, FieldDefinition[]>>(
    (groups, field) => {
      const group = groups.get(field.collection) ?? []
      group.push(field)
      groups.set(field.collection, group)
      return groups
    },
    new Map(),
  )

  return { fieldsByCollection, relations }
}

export async function listReportFieldTreeNodes(
  collection: string,
  parentPath = '',
  parentLabel = '',
  metadata?: ReportFieldTreeMetadata,
): Promise<ReportFieldTreeNode[]> {
  if (!collection) return []
  const fieldMetadata = metadata ?? await loadReportFieldTreeMetadata()

  const targetCollection = parentPath
    ? resolveM2OFieldPathFromMetadata(collection, parentPath, fieldMetadata)?.relatedCollection
    : collection
  if (!targetCollection) return []

  const relatedFields = fieldMetadata.fieldsByCollection.get(targetCollection) ?? []
  const nodes = await Promise.all(
    relatedFields
      .filter((field) => isReportableField(field))
      .map(async (field) =>
        buildReportFieldTreeNode(
          field,
          fieldMetadata.relations,
          parentPath,
          parentLabel,
        ),
      ),
    )

  return nodes
    .filter((node): node is ReportFieldTreeNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function saveReport(
  report: ReportDefinition,
  settingId?: string | number | null,
): Promise<ReportWithSetting> {
  const config = normalizeReportDefinition(report)
  const existing = settingId ? null : await readReportByName(config.name)
  const targetId = settingId ?? existing?.id

  const savedId = await writeSettingUpsert({
    settingId: targetId ? String(targetId) : null,
    entityApiName: config.collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    name: config.name,
    body: config as unknown as Record<string, unknown>,
  })

  return {
    settingId: savedId,
    name: config.name,
    title: config.title,
    collection: config.collection,
    config,
  }
}

export async function executeReport(
  report: ReportDefinition,
): Promise<Record<string, unknown>[]> {
  const config = normalizeReportDefinition(report)
  if (!config.collection) return []

  const request = await reportQueryRequest(config)
  const filter = buildReportFilter(config)

  const rows = await bridgeReadItems(config.collection, {
    limit: config.limit ?? -1,
    fields: request.fields,
    ...(filter ? { filter } : {}),
  })

  return renderReportRows(rows, request.m2o)
}

export async function defaultReportDefinition(
  collection = '',
): Promise<ReportDefinition> {
  const fields = collection ? await listFilterableFields(collection).catch(() => []) : []
  const firstField = fields[0]?.field ?? 'id'

  return normalizeReportDefinition({
    id: `report_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name: '',
    title: '',
    collection,
    filterLogic: 'and',
    conditions: [],
    pivot: {
      rows: firstField ? [firstField] : [],
      columns: [],
      values: [{ field: firstField, aggregate: 'count' }],
    },
    limit: -1,
  })
}

export function normalizeReportDefinition(
  report: Partial<ReportDefinition> | null | undefined,
  fallback: Partial<ReportDefinition> = {},
): ReportDefinition {
  const collection = String(report?.collection || fallback.collection || '')
  const titleCandidate = String(report?.title || fallback.title || '')
  const name = normalizeReportName(report?.name || fallback.name || titleCandidate)
  const title = titleCandidate || name || 'Untitled report'
  const conditions = Array.isArray(report?.conditions)
    ? report.conditions
        .filter((condition) => condition?.field && condition?.operator)
        .map((condition) => ({
          id: condition.id || `rpt_condition_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
        }))
    : []
  const pivot = (report?.pivot ?? {}) as Partial<ReportPivotSettings>
  const values = Array.isArray(pivot.values)
    ? pivot.values
        .filter((value) => value?.field && isReportAggregate(value.aggregate))
        .map((value) => ({
          field: value.field,
          aggregate: value.aggregate,
        }))
    : []

  return {
    id: String(report?.id || fallback.id || `report_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`),
    name,
    title,
    collection,
    filterLogic: report?.filterLogic === 'or' ? 'or' : 'and',
    conditions,
    pivot: {
      rows: normalizeStringList(pivot.rows),
      columns: normalizeStringList(pivot.columns),
      values,
    },
    limit: normalizeLimit(report?.limit),
  }
}

export function buildReportFilter(
  report: ReportDefinition,
): Record<string, unknown> | null {
  const conditions = report.conditions
    .filter((condition) => condition.field && condition.operator)
    .map((condition) =>
      buildFieldFilter(
        condition.field,
        condition.operator,
        normalizeConditionValue(condition),
      ),
    )

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]

  return {
    [report.filterLogic === 'or' ? '_or' : '_and']: conditions,
  }
}

export function normalizeReportName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function readReportByName(name: string): Promise<ReportSettingRecord | null> {
  return readSettingRecord<ReportSettingRecord>({
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    name,
    limit: 1,
  })
}

function parseReportBody(record: ReportSettingRecord): Partial<ReportDefinition> {
  if (!record.body) return {}
  return typeof record.body === 'string'
    ? JSON.parse(record.body) as Partial<ReportDefinition>
    : record.body
}

async function reportQueryRequest(report: ReportDefinition): Promise<ReportQueryRequest> {
  const fields = new Set([
    ...report.pivot.rows,
    ...report.pivot.columns,
    ...report.pivot.values.map((value) => value.field),
    ...report.conditions.map((condition) => condition.field),
  ].filter(Boolean))

  if (fields.size === 0 && report.collection) {
    const metadata = await listFilterableFields(report.collection).catch(() => [])
    for (const field of metadata.slice(0, 8)) {
      fields.add(field.field)
    }
  }

  const fieldNames = Array.from(fields).filter((field) => field !== '*')
  const m2o = await reportM2OMetadata(report.collection, fieldNames)
  return {
    fields: reportRequestFields(fieldNames, m2o),
    m2o,
  }
}

function reportRequestFields(
  fieldNames: string[],
  m2o: ReportM2OMetadata,
): string[] {
  const requestFields = new Set<string>()

  for (const fieldName of fieldNames) {
    const relatedCollection = m2o.collections.get(fieldName)
    if (!relatedCollection) {
      requestFields.add(fieldName)
      continue
    }

    requestFields.add(`${fieldName}.id`)
    const template = m2o.templates.get(fieldName)
    if (template) {
      for (const templateField of extractTemplateFields(template)) {
        requestFields.add(`${fieldName}.${templateField}`)
      }
      continue
    }

    requestFields.add(`${fieldName}.${m2o.displayFields.get(fieldName) ?? 'id'}`)
  }

  return Array.from(requestFields)
}

async function reportM2OMetadata(
  collection: string,
  fieldNames: string[],
): Promise<ReportM2OMetadata> {
  const relationsRaw = await getCachedRelations()
  const relations = relationsRaw as RelationDefinition[]
  const collections = new Map<string, string>()
  const displayFields = new Map<string, string>()
  const templates = new Map<string, string>()
  const choiceLabels = new Map<string, Map<string, string>>()

  for (const fieldName of fieldNames) {
    const resolved = await resolveM2OFieldPath(collection, fieldName, relations)
    if (resolved) {
      collections.set(fieldName, resolved.relatedCollection)
      const template =
        typeof resolved.field?.meta?.options?.template === 'string' &&
        resolved.field.meta.options.template.trim()
          ? resolved.field.meta.options.template
          : undefined
      const templateFields = template ? extractTemplateFields(template) : []
      if (shouldUseTemplateForRelatedLabel(template, templateFields) && template) {
        templates.set(fieldName, template)
      } else {
        displayFields.set(fieldName, relatedRecordDisplayField(resolved.relatedFields))
      }
      continue
    }

    const choiceLabelMap = await resolveChoiceLabelsForPath(collection, fieldName, relations)
    if (choiceLabelMap.size > 0) {
      choiceLabels.set(fieldName, choiceLabelMap)
    }
  }

  return { collections, displayFields, templates, choiceLabels }
}

function renderReportRows(
  rows: Record<string, unknown>[],
  m2o: ReportM2OMetadata,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const rendered = { ...row }

    for (const [field, relatedCollection] of m2o.collections) {
      const value = getPathValue(row, field)
      const record = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : null
      const id = record?.id ?? value
      const template = m2o.templates.get(field)
      const label =
        record && template
          ? renderTemplateLabel(template, record)
          : relatedRecordFallbackLabel(record ?? value, id)

      setPathValue(rendered, field, {
        ...(record ?? {}),
        __crmValueType: 'm2o',
        id,
        label,
        relatedCollection,
      })
    }

    for (const [field, labels] of m2o.choiceLabels) {
      const value = getPathValue(rendered, field)
      const label = choiceValueLabel(value, labels)
      if (label !== undefined) {
        setPathValue(rendered, field, label)
      }
    }

    return rendered
  })
}

async function buildReportFieldTreeNode(
  field: FieldDefinition,
  relations: RelationDefinition[],
  parentPath: string,
  parentLabel: string,
): Promise<ReportFieldTreeNode | null> {
  const relation = findRelationForField(field, relations)
  const component = mapFieldTypeToComponent(field, relation)
  if (!component) return null

  const fallbackLabel =
    field.meta?.note?.trim() ||
    humanizeFieldName(field.field)
  const nodeLabel = await translatedFieldLabel(field, fallbackLabel)
  const path = parentPath ? `${parentPath}.${field.field}` : field.field
  const label = parentLabel ? `${parentLabel} > ${nodeLabel}` : nodeLabel
  const option: ReportFieldOption = {
    field: path,
    label,
    type: field.type,
    component: component as PrimeVueComponentType,
  }

  if (parentPath) {
    option.sourceField = parentPath.split('.')[0]
    option.nestedField = field.field
  }

  if (component === 'AutoComplete' && relation?.related_collection) {
    option.relatedCollection = relation.related_collection
  }

  const canExpand = Boolean(option.relatedCollection)
  return {
    key: path,
    label: nodeLabel,
    leaf: !canExpand,
    selectable: true,
    data: option,
    ...(canExpand ? { children: [] } : {}),
  }
}

async function resolveChoiceLabelsForPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<Map<string, string>> {
  const field = await resolveFieldPath(collection, fieldName, relations)
  return buildChoiceLabelMap(field?.meta?.options?.choices)
}

async function resolveM2OFieldPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<ResolvedM2OField | null> {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return null

  let currentCollection = collection
  let field: FieldDefinition | undefined
  let relation: RelationDefinition | undefined

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = await getCachedCollectionFields(currentCollection) as FieldDefinition[]
    field = fields.find((item) => item.field === part)
    relation = relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )

    const relatedCollection = relation?.related_collection
    const isM2O = isM2ORelation(field, relation)
    if (!isM2O || !relatedCollection) return null

    if (index === parts.length - 1) {
      const relatedFields = await getCachedCollectionFields(relatedCollection) as FieldDefinition[]
      return {
        field,
        relatedCollection,
        relatedFields,
      }
    }

    currentCollection = relatedCollection
  }

  return null
}

function resolveM2OFieldPathFromMetadata(
  collection: string,
  fieldName: string,
  metadata: ReportFieldTreeMetadata,
): ResolvedM2OField | null {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return null

  let currentCollection = collection
  let field: FieldDefinition | undefined
  let relation: RelationDefinition | undefined

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = metadata.fieldsByCollection.get(currentCollection) ?? []
    field = fields.find((item) => item.field === part)
    relation = metadata.relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )

    const relatedCollection = relation?.related_collection
    const isM2O = isM2ORelation(field, relation)
    if (!isM2O || !relatedCollection) return null

    if (index === parts.length - 1) {
      return {
        field,
        relatedCollection,
        relatedFields: metadata.fieldsByCollection.get(relatedCollection) ?? [],
      }
    }

    currentCollection = relatedCollection
  }

  return null
}

async function resolveFieldPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<FieldDefinition | undefined> {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return undefined

  let currentCollection = collection
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = await getCachedCollectionFields(currentCollection) as FieldDefinition[]
    const field = fields.find((item) => item.field === part)
    if (!field) return undefined
    if (index === parts.length - 1) return field

    const relation = relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )
    if (!isM2ORelation(field, relation) || !relation?.related_collection) {
      return undefined
    }
    currentCollection = relation.related_collection
  }

  return undefined
}

function isM2ORelation(
  field: FieldDefinition | undefined,
  relation: RelationDefinition | undefined,
): boolean {
  const special = normalizeSpecial(field?.meta?.special)
  return Boolean(relation?.related_collection) && (
    special.includes('m2o') || Boolean(relation?.related_collection)
  )
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function normalizeConditionValue(condition: ReportFilterCondition): unknown {
  if (condition.operator === '_null' || condition.operator === '_nnull') return true
  return condition.value
}

function buildFieldFilter(
  field: string,
  operator: string,
  value: unknown,
): Record<string, unknown> {
  const parts = field.split('.').filter(Boolean)
  const leaf = { [operator]: value }

  return parts
    .slice()
    .reverse()
    .reduce<Record<string, unknown>>(
      (filter, part) => ({ [part]: filter }),
      leaf,
    )
}

function normalizeLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return -1
}

function isReportAggregate(value: unknown): value is ReportAggregate {
  return ['count', 'sum', 'avg', 'min', 'max'].includes(String(value))
}

function isReportableField(field: FieldDefinition): boolean {
  if (field.meta?.hidden) return false
  if (field.type === 'alias') return false
  if (['user_updated', 'date_updated'].includes(field.field)) return false
  return true
}
