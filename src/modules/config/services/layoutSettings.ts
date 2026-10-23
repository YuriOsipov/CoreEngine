import type {
  CloneRelatedChildPair,
  EntityAction,
  EntityFormSaveOptions,
  EntityLayoutSchema,
  EntityRoleOption,
  LayoutFieldChildLookup,
  LayoutFieldMetadata,
  SavedEntityForm,
} from '@/interfaces'
import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { currentUserRole } from '@/core/currentUser'
import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import {
  DuplicateRoleScopedLayoutError,
  loadAppRoles,
  normalizeSavedRoleScopedLayout,
  parseSettingRoleId,
  sortRoleScopedLayouts,
} from '@/core/settingRoleUtils'
import { getCachedCollectionFields, getCachedRelations } from '@/modules/entities/services/collectionSchema'
import { isFilesField } from '@/core/fieldHelpers'
import {
  findRelationForField,
  mapFieldTypeToComponent,
} from '@/modules/entities/utils/fieldMapper'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'

const SETTINGS_GROUP = 'entity'
const SETTINGS_SUB_GROUP = 'full'
const FIELD_SETTINGS_GROUP = 'field'
const COMPACT_SETTINGS_GROUP = 'entity'
const LEGACY_COMPACT_SETTINGS_GROUPS = ['entoty'] as const
const COMPACT_SETTINGS_SUB_GROUP = 'compact'

export class DuplicateEntityFormRoleError extends DuplicateRoleScopedLayoutError {
  constructor() {
    super()
    this.name = 'DuplicateEntityFormRoleError'
  }
}

export interface CompactRecordField {
  id: string
  field: string
  label: string
  component: LayoutFieldMetadata['component']
  format?: string
  relatedCollection?: string
}

export interface CompactRelatedCollectionCount {
  id: string
  field: string
  label: string
  relatedCollection: string
}

export interface CompactRecordDetailsSchema {
  entity: string
  version: number
  fields: CompactRecordField[]
  relatedCounts: CompactRelatedCollectionCount[]
}

interface LayoutSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: EntityLayoutSchema | CompactRecordDetailsSchema | LayoutFieldChildLookup | string | null
}

export async function loadEntityForms(collection: string): Promise<SavedEntityForm[]> {
  const records = await readEntityLayoutSettingRecords(collection)
  return sortRoleScopedLayouts(records.map((record) => normalizeSavedRoleScopedLayout(record)))
}

/** Builder/setup only — loads an entity layout by record ID without role scoping. */
export async function loadEntityLayoutById(
  collection: string,
  formId: string,
): Promise<EntityLayoutSchema | null> {
  const record = await readEntityLayoutSettingRecordById(collection, formId)
  return parseEntityLayoutBody(collection, record)
}

export async function resolveEntityLayoutForRole(
  collection: string,
  roleId: string | null,
): Promise<EntityLayoutSchema | null> {
  const record = await resolveEntityLayoutSettingRecord(collection, roleId)
  return parseEntityLayoutBody(collection, record, roleId)
}

export async function resolveEntityLayoutForCurrentUser(
  collection: string,
): Promise<EntityLayoutSchema | null> {
  const roleId = await currentUserRole()
  return resolveEntityLayoutForRole(collection, roleId)
}

export async function loadEntityLayoutSetting(
  collection: string,
): Promise<EntityLayoutSchema | null> {
  return resolveEntityLayoutForCurrentUser(collection)
}

export async function saveEntityLayoutSetting(
  collection: string,
  schema: EntityLayoutSchema,
  options: EntityFormSaveOptions,
): Promise<SavedEntityForm> {
  const name = options.name.trim()
  if (!name) {
    throw new Error('Entity form name is required')
  }

  const roleId = null
  const forms = await loadEntityForms(collection)
  const layoutId = options.layoutId ?? options.formId ?? null
  const duplicate = forms.find(
    (form) => form.name.trim().toLowerCase() === name.toLowerCase()
      && form.id !== String(layoutId ?? ''),
  )
  if (duplicate) {
    throw new DuplicateEntityFormRoleError()
  }

  const body: EntityLayoutSchema = stripChildLookupFromLayout({
    ...schema,
    entity: collection,
  })
  const existing = layoutId
    ? await readEntityLayoutSettingRecordById(collection, String(layoutId))
    : null

  const savedId = await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    name,
    body: body as unknown as Record<string, unknown>,
  })

  return {
    id: savedId,
    name,
    roleId,
    roleName: forms.find((form) => form.roleId === roleId)?.roleName ?? null,
  }
}

export async function deleteEntityForm(
  collection: string,
  formId: string,
): Promise<void> {
  const existing = await readEntityLayoutSettingRecordById(collection, formId)
  if (!existing) return

  const forms = await loadEntityForms(collection)
  if (forms.length <= 1) {
    throw new Error('Cannot delete the last block layout')
  }

  await writeSettingDelete(String(existing.id))
}

export async function loadCompactLayouts(collection: string): Promise<SavedEntityForm[]> {
  const records = await readCompactLayoutSettingRecords(collection)
  return sortRoleScopedLayouts(records.map((record) => normalizeSavedRoleScopedLayout(record)))
}

export async function deleteCompactLayout(
  collection: string,
  layoutId: string,
): Promise<void> {
  const existing = await readCompactLayoutSettingRecordById(collection, layoutId)
  if (!existing) return

  const roleId = parseSettingRoleId(existing.role)
  if (roleId === null) {
    throw new Error('Cannot delete the default compact layout')
  }

  await writeSettingDelete(String(existing.id))
}

export async function loadEntityRoles(): Promise<EntityRoleOption[]> {
  return loadAppRoles()
}

/**
 * Saves a compact layout Setting.
 * Persists the FormBuilder canvas (`EntityLayoutSchema`) plus derived
 * `fields` / `relatedCounts` so the designer round-trips and runtime tooltips work.
 */
export async function saveCompactRecordDetailsSetting(
  collection: string,
  layoutSchema: EntityLayoutSchema,
  options: EntityFormSaveOptions,
): Promise<SavedEntityForm> {
  const name = options.name.trim() || collection
  const roleId = options.roleId ?? null
  const layoutId = options.layoutId ?? options.formId ?? null

  const layouts = await loadCompactLayouts(collection)
  const duplicateRole = layouts.find(
    (layout) => layout.roleId === roleId && layout.id !== String(layoutId ?? ''),
  )
  if (duplicateRole) {
    throw new DuplicateEntityFormRoleError()
  }

  const compact = await buildCompactDetailsSchema(collection, layoutSchema)
  const body = {
    ...layoutSchema,
    entity: collection,
    version: layoutSchema.version ?? 1,
    actions: [],
    fields: compact.fields,
    relatedCounts: compact.relatedCounts,
  }

  const existing = layoutId
    ? await readCompactLayoutSettingRecordById(collection, String(layoutId))
    : await readCompactRecordDetailsSettingRecord(collection, roleId)

  const savedId = await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: COMPACT_SETTINGS_GROUP,
    subGroup: COMPACT_SETTINGS_SUB_GROUP,
    roleId,
    name,
    body: body as unknown as Record<string, unknown>,
  })

  return {
    id: savedId,
    name,
    roleId,
    roleName: layouts.find((layout) => layout.roleId === roleId)?.roleName ?? null,
  }
}

/** Builder/setup — loads compact layout canvas by Setting id. */
export async function loadCompactLayoutById(
  collection: string,
  layoutId: string,
): Promise<EntityLayoutSchema | null> {
  const record = await readCompactLayoutSettingRecordById(collection, layoutId)
  if (!record?.body) return null

  const parsed = parseSettingBody(record.body)
  if (!parsed || typeof parsed !== 'object') return null

  const body = parsed as Partial<EntityLayoutSchema> & Partial<CompactRecordDetailsSchema>
  if (Array.isArray(body.sections) && body.sections.length > 0) {
    return parseEntityLayoutBody(collection, {
      ...record,
      body: {
        entity: collection,
        version: body.version ?? 1,
        actions: Array.isArray(body.actions) ? body.actions : [],
        sections: body.sections,
        systemInfo: body.systemInfo,
      },
    })
  }

  const compact = normalizeCompactRecordDetailsSchema(collection, {
    entity: collection,
    version: body.version ?? 1,
    fields: Array.isArray(body.fields) ? body.fields : [],
    relatedCounts: Array.isArray(body.relatedCounts) ? body.relatedCounts : [],
  })
  return parseEntityLayoutBody(
    collection,
    { ...record, body: layoutSchemaFromCompactDetails(collection, compact) },
  )
}

export async function loadCompactRecordDetailsSetting(
  collection: string,
  roleId?: string | null,
): Promise<CompactRecordDetailsSchema | null> {
  const resolvedRoleId =
    roleId === undefined ? await currentUserRole() : (roleId ?? null)
  let record = await readCompactRecordDetailsSettingRecord(collection, resolvedRoleId)

  if (!record && resolvedRoleId !== null) {
    record = await readCompactRecordDetailsSettingRecord(collection, null)
  }

  return await parseCompactRecordDetailsBody(collection, record?.body)
}

/** Builder/runtime — loads a compact layout by Setting record ID (no role scoping). */
export async function loadCompactRecordDetailsById(
  collection: string,
  layoutId: string,
): Promise<CompactRecordDetailsSchema | null> {
  const record = await readCompactLayoutSettingRecordById(collection, layoutId)
  return await parseCompactRecordDetailsBody(collection, record?.body)
}

export async function buildCompactDetailsSchema(
  collection: string,
  schema: EntityLayoutSchema,
): Promise<CompactRecordDetailsSchema> {
  const fields: CompactRecordField[] = []
  const relatedCounts: CompactRelatedCollectionCount[] = []
  const seenFields = new Set<string>()
  const seenCounts = new Set<string>()

  function appendLayoutField(field: LayoutFieldMetadata): void {
    if (field.component === 'BlockLayout') return

    if (field.component === 'DataTable') {
      if (field.relatedCollection && !seenCounts.has(field.field)) {
        seenCounts.add(field.field)
        relatedCounts.push({
          id: field.id,
          field: field.field,
          label: field.label,
          relatedCollection: field.relatedCollection,
        })
      }
      return
    }

    if (seenFields.has(field.field)) return
    seenFields.add(field.field)
    fields.push({
      id: field.id,
      field: field.field,
      label: field.label,
      component: field.component,
      format: field.format,
      relatedCollection: field.relatedCollection,
    })
  }

  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (field.component === 'BlockLayout') {
          const blockLayoutId = field.blockLayoutId?.trim()
          if (!blockLayoutId) continue
          const nested = await loadEntityLayoutById(collection, blockLayoutId)
          if (!nested) continue
          for (const nestedField of layoutFields(nested)) {
            appendLayoutField(nestedField)
          }
          continue
        }
        appendLayoutField(field)
      }
    }
  }

  return {
    entity: collection,
    version: 1,
    fields,
    relatedCounts,
  }
}

export async function loadChildLookupFieldSettings(
  collection: string,
  fieldNames: string[],
  roleId: string | null = null,
): Promise<Record<string, LayoutFieldChildLookup>> {
  const records = await readChildLookupSettingRecords(collection, fieldNames, roleId)
  const settings: Record<string, LayoutFieldChildLookup> = {}

  for (const record of records) {
    const childLookup = normalizeChildLookupSetting(parseSettingBody(record.body))
    if (childLookup) {
      settings[record.sub_group] = childLookup
    }
  }

  return settings
}

/** Upsert or delete the canonical per-field child-lookup setting (Field config). */
export async function saveChildLookupFieldSetting(
  collection: string,
  fieldApiName: string,
  settings: LayoutFieldChildLookup | null,
  roleId: string | null = null,
): Promise<void> {
  const fieldName = fieldApiName.trim()
  if (!fieldName) return

  const existingRecords = await readChildLookupSettingRecords(
    collection,
    [fieldName],
    roleId,
  )
  const existing = existingRecords.find((record) => record.sub_group === fieldName)
    ?? existingRecords[0]
    ?? null

  const body = settings ? normalizeChildLookupSetting(settings) : null
  if (!body) {
    for (const record of existingRecords) {
      await writeSettingDelete(String(record.id))
    }
    return
  }

  await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: FIELD_SETTINGS_GROUP,
    subGroup: fieldName,
    roleId,
    name: fieldName,
    body: body as unknown as Record<string, unknown>,
  })

  for (const record of existingRecords) {
    if (existing && String(record.id) === String(existing.id)) continue
    await writeSettingDelete(String(record.id))
  }
}

export async function deleteChildLookupFieldSetting(
  collection: string,
  fieldApiName: string,
  roleId: string | null = null,
): Promise<void> {
  await saveChildLookupFieldSetting(collection, fieldApiName, null, roleId)
}

async function parseEntityLayoutBody(
  collection: string,
  record: LayoutSettingRecord | null,
  roleId: string | null = null,
): Promise<EntityLayoutSchema | null> {
  if (!record?.body) return null

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as EntityLayoutSchema)
      : (record.body as EntityLayoutSchema)

  const normalized = await normalizeLayoutSchema(collection, {
    ...body,
    entity: collection,
  })

  return hydrateChildLookupFieldSettings(
    collection,
    normalized,
    roleId ?? parseSettingRoleId(record.role),
  )
}

async function resolveEntityLayoutSettingRecord(
  collection: string,
  roleId: string | null,
): Promise<LayoutSettingRecord | null> {
  if (roleId) {
    const roleMatch = await readEntityLayoutSettingRecordByRole(collection, roleId)
    if (roleMatch) return roleMatch
  }

  return readEntityLayoutSettingRecordByRole(collection, null)
}

async function readEntityLayoutSettingRecords(
  collection: string,
): Promise<LayoutSettingRecord[]> {
  return readSettingRecords<LayoutSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP, 'enity'],
    subGroup: SETTINGS_SUB_GROUP,
  })
}

async function readEntityLayoutSettingRecordById(
  collection: string,
  formId: string,
): Promise<LayoutSettingRecord | null> {
  return readSettingRecord<LayoutSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP, 'enity'],
    subGroup: SETTINGS_SUB_GROUP,
    id: formId,
    limit: 1,
  })
}

async function readEntityLayoutSettingRecordByRole(
  collection: string,
  roleId: string | null,
): Promise<LayoutSettingRecord | null> {
  return readSettingRecord<LayoutSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP, 'enity'],
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    limit: 1,
  })
}

async function readCompactRecordDetailsSettingRecord(
  collection: string,
  roleId: string | null,
): Promise<LayoutSettingRecord | null> {
  return readSettingRecord<LayoutSettingRecord>({
    collection,
    groups: [COMPACT_SETTINGS_GROUP, ...LEGACY_COMPACT_SETTINGS_GROUPS],
    subGroup: COMPACT_SETTINGS_SUB_GROUP,
    roleId,
    limit: 1,
  })
}

async function readCompactLayoutSettingRecords(
  collection: string,
): Promise<LayoutSettingRecord[]> {
  return readSettingRecords<LayoutSettingRecord>({
    collection,
    groups: [COMPACT_SETTINGS_GROUP, ...LEGACY_COMPACT_SETTINGS_GROUPS],
    subGroup: COMPACT_SETTINGS_SUB_GROUP,
  })
}

async function readCompactLayoutSettingRecordById(
  collection: string,
  layoutId: string,
): Promise<LayoutSettingRecord | null> {
  return readSettingRecord<LayoutSettingRecord>({
    collection,
    groups: [COMPACT_SETTINGS_GROUP, ...LEGACY_COMPACT_SETTINGS_GROUPS],
    subGroup: COMPACT_SETTINGS_SUB_GROUP,
    id: layoutId,
    limit: 1,
  })
}

async function hydrateChildLookupFieldSettings(
  collection: string,
  schema: EntityLayoutSchema,
  roleId: string | null,
): Promise<EntityLayoutSchema> {
  const fields = layoutFields(schema)
  if (fields.length === 0) return schema

  const fieldNames = fields.map((field) => field.field)
  let settingRecords = await readChildLookupSettingRecords(collection, fieldNames, roleId)
  const byFieldName = new Map<string, LayoutSettingRecord>()
  for (const record of settingRecords) {
    if (!byFieldName.has(record.sub_group)) {
      byFieldName.set(record.sub_group, record)
    }
  }

  // Migrate legacy layout-embedded childLookup into canonical field settings.
  let migrated = false
  for (const field of fields) {
    if (byFieldName.has(field.field)) continue
    const embedded = normalizeChildLookupSetting(field.childLookup)
    if (!embedded) continue
    await saveChildLookupFieldSetting(collection, field.field, embedded, roleId)
    migrated = true
  }

  if (migrated) {
    settingRecords = await readChildLookupSettingRecords(collection, fieldNames, roleId)
    byFieldName.clear()
    for (const record of settingRecords) {
      if (!byFieldName.has(record.sub_group)) {
        byFieldName.set(record.sub_group, record)
      }
    }
  }

  const [definitions, relations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const fieldByName = new Map(definitions.map((definition) => [definition.field, definition]))

  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        fields: group.fields.map((field) => {
          const record = byFieldName.get(field.field)
          const childLookup = normalizeChildLookupSetting(parseSettingBody(record?.body))
          if (!childLookup) {
            if (!field.childLookup && field.component !== 'ChildLookup') return field
            const definition = fieldByName.get(field.field)
            const relation = definition ? findRelationForField(definition, relations) : undefined
            const nativeComponent = definition
              ? (mapFieldTypeToComponent(definition, relation) ?? field.component)
              : field.component === 'ChildLookup'
                ? 'Select'
                : field.component
            const { childLookup: _removed, ...rest } = field
            return { ...rest, component: nativeComponent }
          }

          const isM2O = isFieldM2O(collection, field.field, definitions, relations)
          if (isM2O) {
            return { ...field, component: 'ChildLookup', childLookup }
          }

          const definition = fieldByName.get(field.field)
          const relation = definition ? findRelationForField(definition, relations) : undefined
          const nativeComponent = definition
            ? (mapFieldTypeToComponent(definition, relation) ?? field.component)
            : field.component
          const component = field.component === 'ChildLookup' ? nativeComponent : field.component

          return { ...field, component, childLookup }
        }),
      })),
    })),
  }
}

function stripChildLookupFromLayout(schema: EntityLayoutSchema): EntityLayoutSchema {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        fields: group.fields.map((field) => {
          if (!field.childLookup && field.component !== 'ChildLookup') return field
          const { childLookup: _removed, ...rest } = field
          return {
            ...rest,
            ...(field.component === 'ChildLookup' ? { component: 'Select' as const } : {}),
          }
        }),
      })),
    })),
  }
}

async function readChildLookupSettingRecords(
  collection: string,
  fieldNames: string[],
  roleId: string | null,
): Promise<LayoutSettingRecord[]> {
  const uniqueFieldNames = Array.from(new Set(fieldNames.filter(Boolean)))
  if (uniqueFieldNames.length === 0) return []

  const roleScoped = await readSettingRecords<LayoutSettingRecord>({
    collection,
    groups: [FIELD_SETTINGS_GROUP],
    subGroup: uniqueFieldNames,
    roleId,
  })
  if (roleScoped.length > 0 || roleId === null) return roleScoped

  return readSettingRecords<LayoutSettingRecord>({
    collection,
    groups: [FIELD_SETTINGS_GROUP],
    subGroup: uniqueFieldNames,
    roleId: null,
  })
}

function parseSettingBody(
  body: LayoutSettingRecord['body'] | undefined,
): unknown {
  if (!body) return null
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

function normalizeChildLookupSetting(
  settings: unknown,
): LayoutFieldChildLookup | null {
  if (!settings || typeof settings !== 'object') return null
  const body = settings as Partial<LayoutFieldChildLookup>
  const sourceField = String(body.sourceField ?? '').trim()
  if (!sourceField) return null

  const collection = String(body.collection ?? '').trim()
  const childSourceField = String(body.childSourceField ?? '').trim()
  const valueField = String(body.valueField ?? '').trim()
  const filter =
    body.filter && typeof body.filter === 'object' && !Array.isArray(body.filter)
      ? (body.filter as Record<string, unknown>)
      : null
  const hasFilter = Boolean(filter && Object.keys(filter).length > 0)
  // Lookup-query mode requires collection + valueField. Child source field is
  // optional when a Lookup filter scopes rows (direct related-entity picklists).
  // Source-field-only mode (scalar default) only needs sourceField (+ optional default).
  if (collection && !valueField) {
    return null
  }
  if (collection && !childSourceField && !hasFilter) {
    return null
  }

  return {
    collection,
    sourceField,
    childSourceField,
    valueField,
    defaultValueField: body.defaultValueField ?? '',
    parentField: body.parentField ?? '',
    filter,
  }
}

function layoutFields(schema: EntityLayoutSchema): LayoutFieldMetadata[] {
  return schema.sections.reduce<LayoutFieldMetadata[]>(
    (fields, section) => [
      ...fields,
      ...section.groups.reduce<LayoutFieldMetadata[]>(
        (groupFields, group) => [...groupFields, ...group.fields],
        [],
      ),
    ],
    [],
  )
}

async function normalizeLayoutSchema(
  collection: string,
  schema: EntityLayoutSchema,
): Promise<EntityLayoutSchema> {
  const baseSchema: EntityLayoutSchema = {
    ...schema,
    entity: collection,
    version: schema.version ?? 1,
    actions: normalizeEntityActions(schema.actions),
    systemInfo: {
      enabled: schema.systemInfo?.enabled !== false,
      collapsed: schema.systemInfo?.collapsed ?? false,
    },
  }

  try {
    const [fieldsRaw, relationsRaw] = await Promise.all([
      getCachedCollectionFields(collection),
      getCachedRelations(),
    ])
    const fields = fieldsRaw as unknown as FieldDefinition[]
    const relations = relationsRaw as unknown as RelationDefinition[]
    const fieldByName = new Map(fields.map((field) => [field.field, field]))

    return {
      ...baseSchema,
      sections: baseSchema.sections.map((section) => ({
        ...section,
        groups: section.groups.map((group) => ({
          ...group,
          fields: group.fields.map((field) =>
            normalizeLayoutField(field, fieldByName, relations),
          ),
        })),
      })),
    }
  } catch {
    return {
      ...baseSchema,
      sections: baseSchema.sections.map((section) => ({
        ...section,
        groups: section.groups.map((group) => ({
          ...group,
          fields: group.fields,
        })),
      })),
    }
  }
}

function normalizeCloneRelatedChildren(
  children: CloneRelatedChildPair[] | null | undefined,
): CloneRelatedChildPair[] {
  if (!Array.isArray(children)) return []
  return children
    .filter(
      (pair) =>
        pair &&
        typeof pair === 'object' &&
        Boolean(String(pair.sourceCollection ?? '').trim()) &&
        Boolean(String(pair.targetCollection ?? '').trim()),
    )
    .map((pair) => {
      const nested = normalizeCloneRelatedChildren(pair.children)
      return {
        sourceCollection: String(pair.sourceCollection).trim(),
        targetCollection: String(pair.targetCollection).trim(),
        skipFields: Array.isArray(pair.skipFields)
          ? pair.skipFields.map((field) => String(field).trim()).filter(Boolean)
          : [],
        fieldMap:
          pair.fieldMap && typeof pair.fieldMap === 'object'
            ? Object.fromEntries(
                Object.entries(pair.fieldMap).filter(
                  ([key, value]) => key.trim() && String(value ?? '').trim(),
                ),
              )
            : {},
        parentFieldMap:
          pair.parentFieldMap && typeof pair.parentFieldMap === 'object'
            ? Object.fromEntries(
                Object.entries(pair.parentFieldMap).filter(
                  ([key, value]) => key.trim() && String(value ?? '').trim(),
                ),
              )
            : undefined,
        splitBy: pair.splitBy?.field?.trim()
          ? {
              field: pair.splitBy.field.trim(),
              targetField: pair.splitBy.targetField?.trim() || undefined,
              includeValues: Array.isArray(pair.splitBy.includeValues)
                ? pair.splitBy.includeValues
                    .map((value) => String(value).trim())
                    .filter(Boolean)
                : undefined,
            }
          : undefined,
        children: nested.length ? nested : undefined,
      }
    })
}

const DEFAULT_BULK_UPDATE_FORMULA = '{{source}} * {{prompt}}'

function normalizeBulkUpdateFormula(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_BULK_UPDATE_FORMULA
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'multiply') return DEFAULT_BULK_UPDATE_FORMULA
  if (trimmed === 'percentOff') return '{{source}} * (1 - {{prompt}} / 100)'
  return trimmed
}

function normalizeEntityActions(actions: EntityLayoutSchema['actions']): EntityAction[] {
  if (!Array.isArray(actions)) return []

  return actions
    .filter((action) => action && typeof action === 'object')
    .map((action) => {
      const isDocument =
        action.displayType === 'document' || action.behavior === 'openDocument'

      if (isDocument) {
        return {
          id: action.id || `action_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
          name: action.name || action.label || 'document_action',
          label: action.label || action.name || 'Document',
          displayType: 'document' as const,
          behavior: 'openDocument' as const,
          document: {
            templateId: action.document?.templateId ?? null,
            skipInteractiveFill: action.document?.skipInteractiveFill === true,
            viewMode: action.document?.viewMode === 'pdf' ? 'pdf' : 'html',
            autoSave: action.document?.autoSave === true,
          },
        }
      }

      if (action.behavior === 'cloneRelated') {
        return {
          id: action.id || `action_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
          name: action.name || action.label || 'clone_structure',
          label: action.label || action.name || 'Clone structure',
          displayType: action.displayType === 'detailLink' ? 'detailLink' : 'detailButton',
          behavior: 'cloneRelated' as const,
          cloneRelated: {
            children: normalizeCloneRelatedChildren(action.cloneRelated?.children),
            confirmBeforeRun: action.cloneRelated?.confirmBeforeRun ?? true,
            successMessage:
              action.cloneRelated?.successMessage ?? 'Structure cloned.',
            refreshRecordAfterRun: action.cloneRelated?.refreshRecordAfterRun ?? true,
            replaceExisting: action.cloneRelated?.replaceExisting === true
              || action.cloneRelated?.replaceExisting === 1
              || action.cloneRelated?.replaceExisting === 'true'
              || action.cloneRelated?.replaceExisting === '1',
          },
        }
      }

      if (action.behavior === 'bulkUpdateRelated') {
        const bulk = action.bulkUpdateRelated
        const sourceCollection =
          typeof bulk?.sourceCollection === 'string'
            ? bulk.sourceCollection.trim()
            : ''
        const sourceLinkField =
          typeof bulk?.sourceLinkField === 'string'
            ? bulk.sourceLinkField.trim()
            : ''
        return {
          id: action.id || `action_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
          name: action.name || action.label || 'bulk_update_related',
          label: action.label || action.name || 'Bulk update related',
          displayType: action.displayType === 'detailLink' ? 'detailLink' : 'detailButton',
          behavior: 'bulkUpdateRelated' as const,
          bulkUpdateRelated: {
            relatedCollection:
              typeof bulk?.relatedCollection === 'string'
                ? bulk.relatedCollection.trim()
                : '',
            targetField:
              typeof bulk?.targetField === 'string' ? bulk.targetField.trim() : '',
            sourcePath:
              typeof bulk?.sourcePath === 'string' ? bulk.sourcePath.trim() : '',
            ...(sourceCollection
              ? {
                  sourceCollection,
                  sourceLinkField,
                  activeSourcesOnly: bulk?.activeSourcesOnly !== false,
                }
              : {}),
            formula: normalizeBulkUpdateFormula(bulk?.formula),
            promptLabel:
              typeof bulk?.promptLabel === 'string' ? bulk.promptLabel.trim() : '',
            confirmBeforeRun: bulk?.confirmBeforeRun ?? true,
            successMessage:
              bulk?.successMessage ?? 'Related records updated.',
            refreshRecordAfterRun: bulk?.refreshRecordAfterRun ?? true,
          },
        }
      }

      return {
        id: action.id || `action_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
        name: action.name || action.label || 'custom_action',
        label: action.label || action.name || 'Custom Action',
        displayType: action.displayType === 'detailLink' ? 'detailLink' : 'detailButton',
        behavior: 'flow' as const,
        flow: {
          webhook: action.flow?.webhook ?? '',
          method: 'POST',
          confirmBeforeRun: action.flow?.confirmBeforeRun ?? true,
          successMessage: action.flow?.successMessage ?? 'Action completed.',
          refreshRecordAfterRun: action.flow?.refreshRecordAfterRun ?? true,
        },
        payload: {
          includeCollection: action.payload?.includeCollection ?? true,
          includeRecordId: action.payload?.includeRecordId ?? true,
          includeRecord: action.payload?.includeRecord ?? false,
        },
      }
    })
}

function layoutFieldRelatedCollection(
  field: LayoutFieldMetadata,
  fieldByName: Map<string, FieldDefinition>,
  relations: RelationDefinition[],
): string | undefined {
  if (field.relatedCollection) return field.relatedCollection

  const definition = fieldByName.get(field.field)
  if (!definition) return undefined

  const relation = findRelationForField(definition, relations)
  return relation?.related_collection ?? undefined
}

function normalizeLayoutField(
  field: LayoutFieldMetadata,
  fieldByName: Map<string, FieldDefinition>,
  relations: RelationDefinition[],
): LayoutFieldMetadata {
  const relatedCollection = layoutFieldRelatedCollection(field, fieldByName, relations)

  if (
    field.component === 'DataTable' ||
    field.component === 'CrmTreeTable' ||
    field.component === 'CrmScheduler' ||
    field.component === 'CrmDocEngine' ||
    field.component === 'ChildLookup' ||
    field.component === 'M2ABuilder' ||
    field.component === 'BlockLayout' ||
    isFilesField(field)
  ) {
    return relatedCollection ? { ...field, relatedCollection } : field
  }

  const definition = fieldByName.get(field.field)
  if (!definition) return field

  const relation = findRelationForField(definition, relations)
  const component = mapFieldTypeToComponent(definition, relation)
  if (!component) return field

  return {
    ...field,
    component,
    relatedCollection:
      component === 'AutoComplete' && relatedCollection
        ? relatedCollection
        : undefined,
  }
}

function normalizeCompactRecordDetailsSchema(
  collection: string,
  schema: CompactRecordDetailsSchema,
): CompactRecordDetailsSchema {
  return {
    entity: collection,
    version: schema.version ?? 1,
    fields: Array.isArray(schema.fields) ? schema.fields : [],
    relatedCounts: Array.isArray(schema.relatedCounts) ? schema.relatedCounts : [],
  }
}

async function parseCompactRecordDetailsBody(
  collection: string,
  body: LayoutSettingRecord['body'] | undefined,
): Promise<CompactRecordDetailsSchema | null> {
  const parsed = parseSettingBody(body)
  if (!parsed || typeof parsed !== 'object') return null

  const record = parsed as Partial<EntityLayoutSchema> & Partial<CompactRecordDetailsSchema>

  if (Array.isArray(record.sections) && record.sections.length > 0) {
    return buildCompactDetailsSchema(collection, {
      entity: collection,
      version: record.version ?? 1,
      actions: Array.isArray(record.actions) ? record.actions : [],
      sections: record.sections,
      systemInfo: record.systemInfo,
    })
  }

  return normalizeCompactRecordDetailsSchema(collection, {
    entity: collection,
    version: record.version ?? 1,
    fields: Array.isArray(record.fields) ? record.fields : [],
    relatedCounts: Array.isArray(record.relatedCounts) ? record.relatedCounts : [],
  })
}

function layoutSchemaFromCompactDetails(
  collection: string,
  compact: CompactRecordDetailsSchema,
): EntityLayoutSchema {
  const fields: LayoutFieldMetadata[] = [
    ...compact.fields.map((field) => ({
      id: field.id,
      field: field.field,
      label: field.label,
      component: field.component,
      format: field.format,
      relatedCollection: field.relatedCollection,
    })),
    ...compact.relatedCounts.map((item) => ({
      id: item.id,
      field: item.field,
      label: item.label,
      component: 'DataTable' as const,
      relatedCollection: item.relatedCollection,
    })),
  ]

  return {
    entity: collection,
    version: compact.version ?? 1,
    actions: [],
    sections: [
      {
        id: 'main',
        title: collection
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (char) => char.toUpperCase()),
        columns: 12,
        groups: [
          {
            id: 'group_general',
            title: 'General',
            fields,
            collapsed: false,
            inlineLabels: true,
          },
        ],
      },
    ],
  }
}
