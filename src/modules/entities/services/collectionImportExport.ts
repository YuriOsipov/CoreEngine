import { downloadCsv, parseCsv, serializeCsv, type CsvRow, type ParsedCsv } from '@/core/csv'
import {
  bridgeCreateItem,
  bridgeReadItems,
  bridgeReadItemsPage,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import { translateField } from '@/core/translation'
import type { FieldDefinition, RelationDefinition } from '@/interfaces'
import { relationRelatedCollection } from '@/core/relationHelpers'
import {
  getCachedCollectionFields,
  getCachedCollections,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  isFieldReadonly,
  normalizeSpecial,
} from '@/modules/entities/utils/fieldMapper'
import { isFieldM2A } from '@/modules/entities/utils/m2aSchema'
import { isFieldM2M } from '@/modules/entities/utils/m2mSchema'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import {
  DISPLAY_FIELD_CANDIDATES,
  extractRelationFieldId,
  getPathValue,
  humanizeFieldName,
  relatedRecordDisplayField,
} from '@/modules/entities/utils/recordDisplay'
import { keysEqual } from '@/core/utils/object'

/** Soft cap aligned with list bulk-update. */
export const COLLECTION_CSV_MAX_ROWS = 5000

export type ImportMode = 'create' | 'update' | 'upsert'

export interface ImportableField {
  field: string
  label: string
  type: string
  required: boolean
  isPrimaryKey: boolean
  isM2O: boolean
  unique: boolean
}

/** Flat or nested (`item.name`) column available on CSV export. */
export interface ExportableField {
  field: string
  label: string
  /** True when path is `relation.child` (parent/related scalar). */
  isParentPath: boolean
}

/**
 * Salesforce-style M2O link modes for CSV import:
 * 1. recordId — related record primary key
 * 2. name — standard / display name field (may be non-unique)
 * 3. externalId — parent field marked unique (`is_unique`) — CoreEngine stand-in for SF External ID
 * 4. field — any other related scalar used as a lookup key (e.g. item.description)
 */
export type ImportLookupKind = 'recordId' | 'name' | 'externalId' | 'field'

/**
 * Import mapping target: local field, or SF-style M2O lookup via parent field
 * (`item.name` → resolve related Item by name → write `item` id).
 */
export interface ImportMappingTarget {
  /** Flat field (`item`) or lookup path (`item.name`). */
  value: string
  label: string
  /** Local collection field written in the payload. */
  targetField: string
  /** When set, CSV cell is matched on the related collection. */
  lookupRelatedField?: string
  relatedCollection?: string
  isLookup: boolean
  /** Set for M2O link options (id / name / external id). */
  lookupKind?: ImportLookupKind | null
}

export interface ColumnMapping {
  /** CSV header name. */
  column: string
  /** Target field api name, or null to skip. */
  field: string | null
}

export interface ImportIssue {
  row: number
  field?: string
  message: string
}

export interface ImportRowPlan {
  row: number
  action: 'create' | 'update' | 'skip'
  recordId: string | null
  payload: Record<string, unknown>
  issues: ImportIssue[]
}

export interface ImportPreviewResult {
  plans: ImportRowPlan[]
  created: number
  updated: number
  skipped: number
  failed: number
  issues: ImportIssue[]
}

export type ImportLogStatus =
  | 'created'
  | 'updated'
  | 'skipped'
  | 'failed'

export interface ImportLogEntry {
  row: number
  status: ImportLogStatus
  recordId: string | null
  message: string
  values: string
}

export interface ImportRunResult {
  created: number
  updated: number
  skipped: number
  failed: number
  issues: ImportIssue[]
  /** Per-row outcome log (success + skip + fail). */
  log: ImportLogEntry[]
}

export interface ExportCollectionCsvOptions {
  collection: string
  filter?: Record<string, unknown> | null
  search?: string | null
  fields?: string[] | null
  limit?: number
  filename?: string
}

const SKIP_SPECIAL = new Set(['o2m', 'm2m', 'm2a', 'file', 'files', 'translations', 'no-data'])

function getPrimaryKeyField(fields: FieldDefinition[]): string {
  return (
    fields.find((field) => field.schema?.is_primary_key)?.field ??
    fields.find((field) => field.field === 'id')?.field ??
    'id'
  )
}

function isImportableField(
  collection: string,
  field: FieldDefinition,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): boolean {
  const special = normalizeSpecial(field.meta?.special)
  if (special.some((s) => SKIP_SPECIAL.has(s))) return false
  if (isFieldM2A(collection, field.field, fields, relations)) return false
  if (isFieldM2M(collection, field.field, fields, relations)) return false
  if (field.type === 'alias') return false
  if (field.type === 'json' || field.type === 'jsonb') return false
  // System audit timestamps are not useful for import writeback.
  if (
    field.field === 'date_created' ||
    field.field === 'date_updated' ||
    field.field === 'user_created' ||
    field.field === 'user_updated'
  ) {
    return false
  }
  return true
}

function isWritableImportField(field: FieldDefinition, isPrimaryKey: boolean): boolean {
  if (isPrimaryKey) return true
  if (isFieldReadonly(field)) return false
  return true
}

export async function listImportableFields(collection: string): Promise<ImportableField[]> {
  const [fields, relations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const primaryKey = getPrimaryKeyField(fields)
  const out: ImportableField[] = []

  for (const field of fields) {
    if (!isImportableField(collection, field, fields, relations)) continue
    if (field.meta?.restricted || field.meta?.writeRestricted) continue
    const isPrimaryKey = keysEqual(field.field, primaryKey)
    if (!isWritableImportField(field, isPrimaryKey) && !isPrimaryKey) continue
    // Hidden non-PK fields stay out of the default picker unless unique.
    if (field.meta?.hidden && !isPrimaryKey && !field.meta?.unique) continue

    const isM2O = isFieldM2O(collection, field.field, fields, relations)
    out.push({
      field: field.field,
      label: await translateField(field, humanizeFieldName(field.field)),
      type: field.type,
      required: Boolean(field.meta?.required),
      isPrimaryKey,
      isM2O,
      unique: Boolean(field.meta?.unique),
    })
  }

  return out.sort((a, b) => {
    if (a.isPrimaryKey !== b.isPrimaryKey) return a.isPrimaryKey ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

/** Local collection fields that can be written as a CSV cell (or M2O id). */
function isExportableLocalField(
  collection: string,
  field: FieldDefinition,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): boolean {
  if (field.meta?.restricted) return false
  const special = normalizeSpecial(field.meta?.special)
  if (special.some((s) => SKIP_SPECIAL.has(s))) return false
  if (isFieldM2A(collection, field.field, fields, relations)) return false
  if (isFieldM2M(collection, field.field, fields, relations)) return false
  return true
}

function isExportableRelatedScalar(field: FieldDefinition): boolean {
  if (field.meta?.restricted) return false
  const special = normalizeSpecial(field.meta?.special)
  if (special.some((s) => SKIP_SPECIAL.has(s) || s === 'm2o')) return false
  if (field.type === 'alias') return false
  return true
}

function resolveRelatedCollectionName(
  collection: string,
  fieldName: string,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): string | null {
  const relation = relations.find(
    (item) =>
      keysEqual(item.collection, collection) && keysEqual(item.field, fieldName),
  )
  const related =
    relationRelatedCollection(relation) || relation?.related_collection || null
  if (related) return related
  const field = fields.find((item) => keysEqual(item.field, fieldName))
  const special = normalizeSpecial(field?.meta?.special)
  if (special.includes('m2o') && field?.schema?.foreign_key_table) {
    return String(field.schema.foreign_key_table)
  }
  return null
}

/**
 * Export picker: all CSV-capable fields on the source collection
 * (including readonly / audit / hidden), plus one-hop parent paths
 * (e.g. `price_group.name`) for each M2O relation.
 */
export async function listExportableFields(collection: string): Promise<ExportableField[]> {
  const [collectionFields, relations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const primaryKey = getPrimaryKeyField(collectionFields)
  const out: ExportableField[] = []
  const localM2O: Array<{ field: string; label: string }> = []

  for (const field of collectionFields) {
    if (!isExportableLocalField(collection, field, collectionFields, relations)) {
      continue
    }
    const label = await translateField(field, humanizeFieldName(field.field))
    const isM2O = isFieldM2O(collection, field.field, collectionFields, relations)
    out.push({
      field: field.field,
      label,
      isParentPath: false,
    })
    if (isM2O) {
      localM2O.push({ field: field.field, label })
    }
  }

  for (const local of localM2O) {
    const relatedCollection = resolveRelatedCollectionName(
      collection,
      local.field,
      collectionFields,
      relations,
    )
    if (!relatedCollection) continue

    const relatedFields = await getCachedCollectionFields(relatedCollection)
    for (const related of relatedFields) {
      if (!isExportableRelatedScalar(related)) continue
      const relatedLabel = await translateField(
        related,
        humanizeFieldName(related.field),
      )
      out.push({
        field: `${local.field}.${related.field}`,
        label: `${local.label} → ${relatedLabel}`,
        isParentPath: true,
      })
    }
  }

  return out.sort((a, b) => {
    if (a.isParentPath !== b.isParentPath) return a.isParentPath ? 1 : -1
    const aPk = keysEqual(a.field, primaryKey)
    const bPk = keysEqual(b.field, primaryKey)
    if (aPk !== bPk) return aPk ? -1 : 1
    return a.label.localeCompare(b.label) || a.field.localeCompare(b.field)
  })
}

/** Prefer `relation.displayField` when a list column is a bare M2O. */
export async function expandPreferredExportFields(
  collection: string,
  preferred: string[] | null | undefined,
  exportable: ExportableField[],
): Promise<string[]> {
  if (!preferred || preferred.length === 0) {
    return exportable.filter((field) => !field.isParentPath).map((field) => field.field)
  }

  const exportableSet = new Set(exportable.map((field) => field.field))
  const collectionFields = await getCachedCollectionFields(collection)
  const relations = await getCachedRelations()
  const selected: string[] = []

  for (const key of preferred) {
    if (exportableSet.has(key) && !selected.includes(key)) {
      selected.push(key)
    }
    const isM2O = isFieldM2O(collection, key, collectionFields, relations)
    if (!isM2O) continue
    const relatedCollection = resolveRelatedCollectionName(
      collection,
      key,
      collectionFields,
      relations,
    )
    if (!relatedCollection) continue
    const relatedFields = await getCachedCollectionFields(relatedCollection)
    const displayField = relatedRecordDisplayField(relatedFields)
    const path = `${key}.${displayField}`
    if (exportableSet.has(path) && !selected.includes(path)) {
      selected.push(path)
    } else {
      for (const candidate of DISPLAY_FIELD_CANDIDATES) {
        const fallback = `${key}.${candidate}`
        if (exportableSet.has(fallback) && !selected.includes(fallback)) {
          selected.push(fallback)
          break
        }
      }
    }
  }

  return selected.length > 0
    ? selected
    : exportable.filter((field) => !field.isParentPath).map((field) => field.field)
}

export async function resolveDefaultMatchFields(collection: string): Promise<string[]> {
  const [fields, collections] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedCollections(),
  ])
  const primaryKey = getPrimaryKeyField(fields)
  const definition = collections.find((item) => keysEqual(item.collection, collection))
  const groups = definition?.meta?.unique_groups ?? []
  if (groups.length > 0 && Array.isArray(groups[0]?.fields) && groups[0].fields.length > 0) {
    return groups[0].fields.map(String)
  }
  const uniqueField = fields.find(
    (field) =>
      field.meta?.unique && !field.meta?.restricted && !keysEqual(field.field, primaryKey),
  )
  if (uniqueField) return [uniqueField.field]
  return [primaryKey]
}

/**
 * Mapping dropdown options: local fields + every related scalar as an M2O lookup key.
 * Labels highlight Salesforce modes (Record Id / Name / External Id) when they apply.
 */
export async function listImportMappingTargets(
  collection: string,
): Promise<ImportMappingTarget[]> {
  const [localFields, relations, collectionFields] = await Promise.all([
    listImportableFields(collection),
    getCachedRelations(),
    getCachedCollectionFields(collection),
  ])

  const targets: ImportMappingTarget[] = []

  for (const local of localFields) {
    if (!local.isM2O) {
      targets.push({
        value: local.field,
        label: `${local.label} (${local.field})`,
        targetField: local.field,
        isLookup: false,
        lookupKind: null,
      })
      continue
    }

    const relatedCollection = resolveRelatedCollectionName(
      collection,
      local.field,
      collectionFields,
      relations,
    )

    // 1) Record Id (safest / default)
    targets.push({
      value: local.field,
      label: `${local.label} · Record Id (${local.field})`,
      targetField: local.field,
      isLookup: false,
      lookupKind: 'recordId',
      relatedCollection: relatedCollection ?? undefined,
    })

    if (!relatedCollection) continue

    const relatedFields = await getCachedCollectionFields(relatedCollection)
    const relatedPk = getPrimaryKeyField(relatedFields)

    let nameFieldApi =
      relatedRecordDisplayField(relatedFields) ||
      DISPLAY_FIELD_CANDIDATES.find(
        (candidate) =>
          candidate !== 'id' &&
          relatedFields.some((field) => keysEqual(field.field, candidate)),
      ) ||
      null
    if (nameFieldApi && keysEqual(nameFieldApi, relatedPk)) {
      nameFieldApi = null
    }

    // 2–4) All related scalars as lookup keys (Name / External Id / Field)
    for (const related of relatedFields) {
      if (keysEqual(related.field, relatedPk)) continue
      if (!isExportableRelatedScalar(related)) continue

      const relatedLabel = await translateField(
        related,
        humanizeFieldName(related.field),
      )
      const path = `${local.field}.${related.field}`
      const isName = Boolean(nameFieldApi && keysEqual(related.field, nameFieldApi))
      const isExternal = Boolean(related.meta?.unique)
      const lookupKind: ImportLookupKind = isName
        ? 'name'
        : isExternal
          ? 'externalId'
          : 'field'
      const modeLabel =
        lookupKind === 'name'
          ? 'Name'
          : lookupKind === 'externalId'
            ? 'External Id'
            : 'Field'

      targets.push({
        value: path,
        label: `${local.label} · ${modeLabel} · ${relatedLabel} (${path})`,
        targetField: local.field,
        lookupRelatedField: related.field,
        relatedCollection,
        isLookup: true,
        lookupKind,
      })
    }
  }

  return targets
}

export function autoMapColumns(
  headers: string[],
  targets: Array<Pick<ImportMappingTarget, 'value' | 'label'> | ImportableField>,
): ColumnMapping[] {
  const byValue = new Map<string, string>()
  const byLabel = new Map<string, string>()
  for (const target of targets) {
    const value = 'value' in target && typeof target.value === 'string'
      ? target.value
      : (target as ImportableField).field
    const label = target.label
    byValue.set(value.toLowerCase(), value)
    byLabel.set(label.trim().toLowerCase(), value)
  }
  const used = new Set<string>()

  return headers.map((column) => {
    const key = column.trim().toLowerCase()
    const match = byValue.get(key) ?? byLabel.get(key) ?? null
    if (match && !used.has(match)) {
      used.add(match)
      return { column, field: match }
    }
    return { column, field: null }
  })
}

type LookupCache = Map<string, string | null | 'ambiguous'>

function lookupCacheKey(
  relatedCollection: string,
  relatedField: string,
  value: string,
): string {
  return `${relatedCollection}\0${relatedField}\0${value}`
}

async function resolveM2OLookupId(options: {
  relatedCollection: string
  relatedField: string
  value: string
  cache: LookupCache
}): Promise<'ambiguous' | string | null> {
  const trimmed = options.value.trim()
  if (!trimmed) return null
  const key = lookupCacheKey(
    options.relatedCollection,
    options.relatedField,
    trimmed,
  )
  if (options.cache.has(key)) {
    return options.cache.get(key) ?? null
  }

  const relatedFields = await getCachedCollectionFields(options.relatedCollection)
  const relatedPk = getPrimaryKeyField(relatedFields)
  const nodes = await bridgeReadItems(options.relatedCollection, {
    filter: { [options.relatedField]: { _eq: trimmed } },
    fields: [relatedPk],
    limit: 2,
    offset: 0,
  })

  let resolved: string | null | 'ambiguous' = null
  if (nodes.length === 0) {
    resolved = null
  } else if (nodes.length > 1) {
    resolved = 'ambiguous'
  } else {
    const id = extractRelationFieldId(nodes[0]?.[relatedPk])
    resolved = id == null ? null : String(id)
  }
  options.cache.set(key, resolved)
  return resolved
}

function coerceCellValue(
  raw: string,
  fieldMeta: ImportableField | undefined,
): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  if (!fieldMeta) return trimmed

  if (fieldMeta.isM2O) {
    return trimmed
  }

  const type = fieldMeta.type.toLowerCase()
  if (type === 'boolean') {
    const lower = trimmed.toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(lower)) return true
    if (['false', '0', 'no', 'n'].includes(lower)) return false
    return trimmed
  }
  if (
    type === 'integer' ||
    type === 'biginteger' ||
    type === 'float' ||
    type === 'decimal' ||
    type === 'number'
  ) {
    const normalized = trimmed.replace(/,/g, '')
    const num = Number(normalized)
    return Number.isFinite(num) ? num : trimmed
  }
  if (type === 'json' || type === 'jsonb') {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

async function buildPayloadFromRow(
  row: CsvRow,
  rowNumber: number,
  mappings: ColumnMapping[],
  fieldByName: Map<string, ImportableField>,
  targetByValue: Map<string, ImportMappingTarget>,
  lookupCache: LookupCache,
  options: { includePrimaryKey: boolean },
): Promise<{ payload: Record<string, unknown>; issues: ImportIssue[] }> {
  const payload: Record<string, unknown> = {}
  const issues: ImportIssue[] = []
  /** Direct id mappings win over lookup-via-name for the same M2O. */
  const directM2O = new Set<string>()

  for (const mapping of mappings) {
    if (!mapping.field) continue
    const target = targetByValue.get(mapping.field)
    if (!target || target.isLookup) continue
    const meta = fieldByName.get(target.targetField)
    if (!meta) continue
    if (meta.isPrimaryKey && !options.includePrimaryKey) continue
    const raw = row[mapping.column] ?? ''
    const value = coerceCellValue(raw, meta)
    payload[target.targetField] = value
    if (meta.isM2O && value !== null && value !== undefined && value !== '') {
      directM2O.add(target.targetField)
    }
  }

  for (const mapping of mappings) {
    if (!mapping.field) continue
    const target = targetByValue.get(mapping.field)
    if (!target?.isLookup || !target.lookupRelatedField || !target.relatedCollection) {
      continue
    }
    if (directM2O.has(target.targetField)) continue
    if (
      payload[target.targetField] !== undefined &&
      payload[target.targetField] !== null &&
      payload[target.targetField] !== ''
    ) {
      continue
    }

    const raw = String(row[mapping.column] ?? '').trim()
    if (!raw) {
      payload[target.targetField] = null
      continue
    }

    const resolved = await resolveM2OLookupId({
      relatedCollection: target.relatedCollection,
      relatedField: target.lookupRelatedField,
      value: raw,
      cache: lookupCache,
    })

    if (resolved === 'ambiguous') {
      // Only fail if this target is still unresolved after all mappings.
      issues.push({
        row: rowNumber,
        field: target.targetField,
        message: `Multiple records matched ${target.relatedCollection}.${target.lookupRelatedField} = "${raw}".`,
      })
      continue
    }
    if (resolved === null) {
      issues.push({
        row: rowNumber,
        field: target.targetField,
        message: `No ${target.relatedCollection} found where ${target.lookupRelatedField} = "${raw}".`,
      })
      continue
    }
    payload[target.targetField] = resolved
  }

  // Drop lookup errors for targets that another mapping already resolved.
  const blockingIssues = issues.filter((issue) => {
    if (!issue.field) return true
    const value = payload[issue.field]
    return value === null || value === undefined || value === ''
  })

  return { payload, issues: blockingIssues }
}

async function findExistingId(
  collection: string,
  primaryKey: string,
  matchFields: string[],
  payload: Record<string, unknown>,
): Promise<string | null> {
  const filterParts: Record<string, unknown>[] = []
  for (const field of matchFields) {
    const value = payload[field]
    if (value === null || value === undefined || value === '') {
      return null
    }
    filterParts.push({ [field]: { _eq: value } })
  }
  if (filterParts.length === 0) return null

  const filter =
    filterParts.length === 1 ? filterParts[0] : { _and: filterParts }

  const nodes = await bridgeReadItems(collection, {
    filter,
    fields: [primaryKey],
    limit: 2,
    offset: 0,
  })
  if (nodes.length === 0) return null
  const id = extractRelationFieldId(nodes[0]?.[primaryKey])
  return id == null ? null : String(id)
}

export async function buildImportPreview(options: {
  collection: string
  parsed: ParsedCsv
  mappings: ColumnMapping[]
  mode: ImportMode
  matchFields: string[]
}): Promise<ImportPreviewResult> {
  const [fields, mappingTargets] = await Promise.all([
    listImportableFields(options.collection),
    listImportMappingTargets(options.collection),
  ])
  const fieldByName = new Map(fields.map((field) => [field.field, field]))
  const targetByValue = new Map(mappingTargets.map((target) => [target.value, target]))
  const primaryKey =
    fields.find((field) => field.isPrimaryKey)?.field ?? 'id'
  const mappedTargets = options.mappings
    .map((m) => (m.field ? targetByValue.get(m.field) : null))
    .filter((target): target is ImportMappingTarget => Boolean(target))
  const mappedLocalFields = new Set(mappedTargets.map((target) => target.targetField))

  if (mappedTargets.length === 0) {
    return {
      plans: [],
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      issues: [
        {
          row: 0,
          message: 'No columns mapped to fields.',
        },
      ],
    }
  }

  const rows = options.parsed.rows.slice(0, COLLECTION_CSV_MAX_ROWS)
  const plans: ImportRowPlan[] = []
  const issues: ImportIssue[] = []
  const lookupCache: LookupCache = new Map()
  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2 // header is row 1
    const row = rows[index]
    const includePk =
      options.mode === 'update' ||
      options.mode === 'upsert' ||
      mappedLocalFields.has(primaryKey)
    const { payload, issues: lookupIssues } = await buildPayloadFromRow(
      row,
      rowNumber,
      options.mappings,
      fieldByName,
      targetByValue,
      lookupCache,
      { includePrimaryKey: includePk },
    )

    const rowIssues: ImportIssue[] = [...lookupIssues]
    for (const field of fields) {
      if (!field.required) continue
      if (!mappedLocalFields.has(field.field)) continue
      if (field.isPrimaryKey) continue
      const value = payload[field.field]
      if (value === null || value === undefined || value === '') {
        rowIssues.push({
          row: rowNumber,
          field: field.field,
          message: `Required field "${field.label}" is empty.`,
        })
      }
    }

    let action: ImportRowPlan['action'] = 'create'
    let recordId: string | null = null

    if (options.mode === 'create') {
      action = 'create'
      // Do not send PK on create unless the CSV explicitly mapped a non-empty id
      // and the backend accepts client ids — strip empty PK.
      if (payload[primaryKey] === null || payload[primaryKey] === undefined || payload[primaryKey] === '') {
        delete payload[primaryKey]
      }
    } else if (options.mode === 'update') {
      const matchFields =
        options.matchFields.length > 0 ? options.matchFields : [primaryKey]
      recordId = await findExistingId(
        options.collection,
        primaryKey,
        matchFields,
        payload,
      )
      if (!recordId) {
        rowIssues.push({
          row: rowNumber,
          message: 'No matching record found for update.',
        })
        action = 'skip'
      } else {
        action = 'update'
        delete payload[primaryKey]
      }
    } else {
      // upsert
      const matchFields =
        options.matchFields.length > 0 ? options.matchFields : [primaryKey]
      recordId = await findExistingId(
        options.collection,
        primaryKey,
        matchFields,
        payload,
      )
      if (recordId) {
        action = 'update'
        delete payload[primaryKey]
      } else {
        action = 'create'
        if (payload[primaryKey] === null || payload[primaryKey] === undefined || payload[primaryKey] === '') {
          delete payload[primaryKey]
        }
      }
    }

    if (rowIssues.length > 0) {
      failed += 1
      issues.push(...rowIssues)
      plans.push({
        row: rowNumber,
        action: 'skip',
        recordId,
        payload,
        issues: rowIssues,
      })
      skipped += 1
      continue
    }

    if (action === 'create') created += 1
    else if (action === 'update') updated += 1
    else skipped += 1

    plans.push({
      row: rowNumber,
      action,
      recordId,
      payload,
      issues: [],
    })
  }

  if (options.parsed.rows.length > COLLECTION_CSV_MAX_ROWS) {
    issues.push({
      row: 0,
      message: `Only the first ${COLLECTION_CSV_MAX_ROWS} data rows will be imported.`,
    })
  }

  return { plans, created, updated, skipped, failed, issues }
}

function formatPayloadSummary(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .slice(0, 12)
    .map((key) => {
      const value = payload[key]
      if (value === null || value === undefined || value === '') return `${key}=`
      return `${key}=${String(value)}`
    })
    .join('; ')
}

export async function runImport(options: {
  collection: string
  plans: ImportRowPlan[]
  onProgress?: (done: number, total: number) => void
}): Promise<ImportRunResult> {
  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  const issues: ImportIssue[] = []
  const log: ImportLogEntry[] = []
  const runnable = options.plans.filter((plan) => plan.action !== 'skip')
  let done = 0

  for (const plan of options.plans) {
    const values = formatPayloadSummary(plan.payload)
    if (plan.action === 'skip') {
      skipped += 1
      const message =
        plan.issues.map((issue) => issue.message).join(' | ') ||
        'Skipped'
      issues.push(...plan.issues)
      log.push({
        row: plan.row,
        status: 'skipped',
        recordId: plan.recordId,
        message,
        values,
      })
      continue
    }
    try {
      if (plan.action === 'create') {
        const createdRow = await bridgeCreateItem(options.collection, plan.payload)
        const id = extractRelationFieldId(createdRow.id) ?? plan.recordId
        created += 1
        log.push({
          row: plan.row,
          status: 'created',
          recordId: id == null ? null : String(id),
          message: 'Created',
          values,
        })
      } else if (plan.action === 'update' && plan.recordId) {
        await bridgeUpdateItem(options.collection, plan.recordId, plan.payload)
        updated += 1
        log.push({
          row: plan.row,
          status: 'updated',
          recordId: plan.recordId,
          message: 'Updated',
          values,
        })
      } else {
        skipped += 1
        log.push({
          row: plan.row,
          status: 'skipped',
          recordId: plan.recordId,
          message: 'Skipped',
          values,
        })
      }
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      issues.push({
        row: plan.row,
        message,
      })
      log.push({
        row: plan.row,
        status: 'failed',
        recordId: plan.recordId,
        message,
        values,
      })
    }
    done += 1
    options.onProgress?.(done, runnable.length)
  }

  return { created, updated, skipped, failed, issues, log }
}

/** Download a CSV import log (preview dry-run or final run). */
export function downloadImportLog(
  entries: ImportLogEntry[],
  filename = 'import-log.csv',
): void {
  const csv = serializeCsv(
    ['row', 'status', 'record_id', 'message', 'values'],
    entries.map((entry) => ({
      row: entry.row,
      status: entry.status,
      record_id: entry.recordId ?? '',
      message: entry.message,
      values: entry.values,
    })),
  )
  downloadCsv(filename, csv)
}

export function buildPreviewImportLog(plans: ImportRowPlan[]): ImportLogEntry[] {
  return plans.map((plan) => ({
    row: plan.row,
    status:
      plan.action === 'create'
        ? 'created'
        : plan.action === 'update'
          ? 'updated'
          : 'skipped',
    recordId: plan.recordId,
    message:
      plan.issues.map((issue) => issue.message).join(' | ') ||
      (plan.action === 'create'
        ? 'Will create'
        : plan.action === 'update'
          ? 'Will update'
          : 'Will skip'),
    values: formatPayloadSummary(plan.payload),
  }))
}

function flattenExportValue(value: unknown): unknown {
  const id = extractRelationFieldId(value)
  if (id !== null && value !== null && typeof value === 'object') {
    return id
  }
  return value
}

/** GraphQL field list for selected export paths (adds `relation.id` for nested). */
function buildExportRequestFields(selectedPaths: string[]): string[] {
  const request = new Set<string>()
  for (const path of selectedPaths) {
    if (!path.includes('.')) {
      request.add(path)
      continue
    }
    const [root, ...rest] = path.split('.')
    if (!root || rest.length === 0) continue
    request.add(`${root}.id`)
    request.add([root, ...rest].join('.'))
  }
  return Array.from(request)
}

function readExportCell(
  record: Record<string, unknown>,
  path: string,
): unknown {
  if (!path.includes('.')) {
    return flattenExportValue(record[path])
  }
  return flattenExportValue(getPathValue(record, path))
}

export async function exportCollectionCsv(
  options: ExportCollectionCsvOptions,
): Promise<{ rowCount: number; totalCount: number }> {
  const exportable = await listExportableFields(options.collection)
  const exportableSet = new Set(exportable.map((field) => field.field))
  const local = await listImportableFields(options.collection)
  const primaryKey =
    local.find((field) => field.isPrimaryKey)?.field ?? 'id'

  let fields =
    options.fields && options.fields.length > 0
      ? options.fields.filter((field) => exportableSet.has(field))
      : exportable.filter((field) => !field.isParentPath).map((field) => field.field)

  if (!fields.includes(primaryKey)) {
    fields = [primaryKey, ...fields]
  }

  const limit = Math.min(
    Math.max(options.limit ?? COLLECTION_CSV_MAX_ROWS, 1),
    COLLECTION_CSV_MAX_ROWS,
  )

  const page = await bridgeReadItemsPage(options.collection, {
    filter: options.filter ?? null,
    search: options.search ?? null,
    fields: buildExportRequestFields(fields),
    limit,
    offset: 0,
  })

  const rows = page.nodes.map((record) => {
    const out: Record<string, unknown> = {}
    for (const field of fields) {
      out[field] = readExportCell(record, field)
    }
    return out
  })

  const csv = serializeCsv(fields, rows)
  const filename =
    options.filename?.trim() ||
    `${options.collection}-export.csv`
  downloadCsv(filename, csv)

  return { rowCount: rows.length, totalCount: page.totalCount }
}

export function parseCsvFileText(text: string): ParsedCsv {
  return parseCsv(text)
}
