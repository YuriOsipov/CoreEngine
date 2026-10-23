import {
  bridgeReadItems,
  bridgeSoftDeleteItem,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import type {
  CloneRelatedChildPair,
  CloneRelatedFromSettings,
  EntityAction,
  EntityLayoutSchema,
  FieldDefinition,
  LayoutFieldMetadata,
} from '@/interfaces'
import {
  findParentFkField,
  getCachedCollectionFields,
} from '@/modules/entities/services/collectionSchema'
import { writeCreateItem } from '@/modules/entities/services/recordWrites'
import { extractRelationFieldId, scalarId } from '@/modules/entities/utils/recordDisplay'

const SYSTEM_SKIP_FIELDS = new Set([
  'id',
  'status',
  'sort',
  'is_deleted',
  'is_active',
  'date_created',
  'date_updated',
  'user_created',
  'user_updated',
  'created_at',
  'updated_at',
])

const SELF_REF_CANDIDATES = ['parent', 'depends_on'] as const
const SELF_REF_FIELD_SET = new Set<string>(SELF_REF_CANDIDATES)

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/**
 * Self-ref columns are often in the registry but not tracked in Hasura GraphQL.
 * Never request them on clone reads — remap is skipped when absent (safe for
 * stage→visit; stage→stage hierarchy remap needs Hasura to expose the columns).
 */
function fieldsForCloneRead(
  sourceFields: Set<string>,
  extra: Iterable<string> = [],
): string[] {
  return [
    ...new Set(
      ['id', ...sourceFields, ...extra].filter(
        (name) => Boolean(name?.trim()) && !SELF_REF_FIELD_SET.has(name),
      ),
    ),
  ]
}

/** Minimal source projection: parent FK + field-map sources + same-name overlap with target. */
function buildSourceReadFields(
  resolved: ResolvedPair,
  sourceFieldSet: Set<string>,
  targetFieldSet: Set<string>,
): string[] {
  const fields = new Set<string>(['id'])
  if (resolved.sourceParentField) fields.add(resolved.sourceParentField)
  for (const sourceField of Object.values(resolved.fieldMap ?? {})) {
    const trimmed = sourceField?.trim()
    if (trimmed) fields.add(trimmed)
  }
  // If map was saved inverted (source → target as keys), also request those keys.
  for (const maybeSource of Object.keys(resolved.fieldMap ?? {})) {
    const trimmed = maybeSource?.trim()
    if (trimmed && sourceFieldSet.has(trimmed)) fields.add(trimmed)
  }
  for (const name of targetFieldSet) {
    if (sourceFieldSet.has(name) && !SELF_REF_FIELD_SET.has(name)) {
      fields.add(name)
    }
  }
  return fieldsForCloneRead(fields)
}

function omitSelfRefFields(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload }
  for (const key of SELF_REF_CANDIDATES) {
    delete next[key]
  }
  return next
}

function resolveFieldMapAssignment(
  sourceRow: Record<string, unknown>,
  sourceFieldSet: Set<string>,
  targetFieldSet: Set<string>,
  mapKey: string,
  mapValue: string,
): { targetField: string; raw: unknown } | null {
  const key = mapKey.trim()
  const value = mapValue.trim()
  if (!key || !value) return null

  // Canonical: fieldMap is target → source
  let targetField = key
  let sourceField = value
  let raw =
    sourceField in sourceRow ? sourceRow[sourceField] : readPath(sourceRow, sourceField)

  const primaryMiss = raw == null || raw === ''
  // Inverted save (source → target as object keys): try swapping when it fits schema.
  if (
    primaryMiss &&
    sourceFieldSet.has(key) &&
    targetFieldSet.has(value)
  ) {
    targetField = value
    sourceField = key
    raw = sourceField in sourceRow ? sourceRow[sourceField] : readPath(sourceRow, sourceField)
  }

  if (!targetFieldSet.has(targetField)) return null
  if (raw == null || raw === '') return null
  return { targetField, raw }
}

type ResolvedPair = CloneRelatedChildPair & {
  sourceParentField: string
  /** FK on target → action/layout parent. Empty when target only links via source (e.g. visit.stage). */
  targetParentField: string
}

export interface RunClonePairsOptions {
  pairs: CloneRelatedChildPair[]
  sourceParentId: string
  targetParentId: string
  sourceParentCollection: string
  targetParentCollection: string
  /** Parent record used for {@link CloneRelatedChildPair.parentFieldMap}. */
  parentRecord?: Record<string, unknown>
  /** Soft-delete existing target children for each pair before cloning. */
  replaceExisting?: boolean
}

function asRecordId(value: unknown): string | null {
  const fromRelation = extractRelationFieldId(value)
  if (fromRelation != null) return String(fromRelation)
  const id = scalarId(value)
  return id == null ? null : String(id)
}

/**
 * Normalize values for GraphQL writes: M2O objects → id string; drop other plain objects
 * (Hasura: "expected String, but encountered Object").
 */
function coerceCloneWriteValue(value: unknown): unknown {
  if (value == null || value === '') return value
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const id = asRecordId(entry)
      return id ?? entry
    })
  }
  if (typeof value === 'object') {
    const id = asRecordId(value)
    return id
  }
  return value
}

function layoutFields(schema: EntityLayoutSchema | null | undefined): LayoutFieldMetadata[] {
  if (!schema?.sections?.length) return []
  return schema.sections.flatMap((section) =>
    (section.groups ?? []).flatMap((group) => group.fields ?? []),
  )
}

function cloneSourceFields(schema: EntityLayoutSchema | null | undefined): LayoutFieldMetadata[] {
  return layoutFields(schema).filter(
    (field) => field.cloneRelatedFrom === true && Boolean(field.field?.trim()),
  )
}

function normalizeSettings(
  settings: CloneRelatedFromSettings | null | undefined,
): CloneRelatedChildPair[] {
  if (!settings?.children?.length) return []
  return settings.children.filter(
    (pair) =>
      Boolean(pair.sourceCollection?.trim()) && Boolean(pair.targetCollection?.trim()),
  )
}

async function resolvePairFks(
  pair: CloneRelatedChildPair,
  sourceParentCollection: string,
  targetParentCollection: string,
): Promise<ResolvedPair | null> {
  const inferredSource = sourceParentCollection
    ? await findParentFkField(pair.sourceCollection, sourceParentCollection)
    : null
  const inferredTarget = targetParentCollection
    ? await findParentFkField(pair.targetCollection, targetParentCollection)
    : null
  const inferredLink = await findParentFkField(
    pair.targetCollection,
    pair.sourceCollection,
  )
  const sourceParentField =
    inferredSource?.trim() || pair.sourceParentField?.trim() || ''
  const targetParentField =
    inferredTarget?.trim() || pair.targetParentField?.trim() || ''
  const sourceLinkField =
    inferredLink?.trim() || pair.sourceLinkField?.trim() || undefined

  // Source must hang off the clone parent. Target must hang off the parent
  // and/or link to the source row (e.g. visit.stage → pm_stage).
  if (!sourceParentField) return null
  if (!targetParentField && !sourceLinkField) return null

  return {
    ...pair,
    sourceParentField,
    targetParentField,
    sourceLinkField,
  }
}

/** ALIAS / list-* relation faces — never copy on clone (children use nested pairs). */
function isRelationAliasField(definition: FieldDefinition): boolean {
  if (String(definition.type || '').toUpperCase() === 'ALIAS') return true
  const iface = String(definition.meta?.interface || '').toLowerCase()
  return (
    iface === 'list-o2m' ||
    iface === 'list-m2m' ||
    iface === 'list-m2a' ||
    iface === 'files' ||
    iface === 'list'
  )
}

/** Scalar (and M2O) field api_names safe to copy between source/target rows. */
function cloneableFieldNames(definitions: FieldDefinition[]): Set<string> {
  return new Set(
    definitions
      .filter((d) => d.field && !isRelationAliasField(d))
      .map((d) => d.field),
  )
}

function readPath(row: Record<string, unknown>, path: string): unknown {
  const parts = path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  let current: unknown = row
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function splitGroupKey(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const id = asRecordId(value)
    if (id) return id
    return JSON.stringify(value)
  }
  return String(value)
}

function buildClonePayload(
  sourceRow: Record<string, unknown>,
  sourceFields: Set<string>,
  targetFields: Set<string>,
  pair: ResolvedPair,
  parentTargetId: string,
  parentRecord?: Record<string, unknown>,
  splitKey?: string,
): Record<string, unknown> {
  const skip = new Set<string>([
    ...SYSTEM_SKIP_FIELDS,
    ...SELF_REF_CANDIDATES,
    ...(pair.skipFields ?? []),
    pair.sourceParentField,
  ])
  if (pair.targetParentField) skip.add(pair.targetParentField)
  if (pair.sourceLinkField) skip.add(pair.sourceLinkField)
  for (const targetField of Object.keys(pair.parentFieldMap ?? {})) {
    skip.add(targetField)
  }
  const splitTargetField = pair.splitBy?.targetField?.trim()
  if (splitTargetField) skip.add(splitTargetField)

  const payload: Record<string, unknown> = {}
  if (pair.targetParentField) {
    payload[pair.targetParentField] = parentTargetId
  }

  if (pair.sourceLinkField) {
    const sourceId = asRecordId(sourceRow.id)
    if (sourceId) payload[pair.sourceLinkField] = sourceId
  }

  const fieldMapEntries = Object.entries(pair.fieldMap ?? {}).filter(
    ([targetField, sourceField]) => Boolean(targetField?.trim()) && Boolean(sourceField?.trim()),
  )
  const reservedFieldMapTargets = new Set<string>()
  for (const [mapKey, mapValue] of fieldMapEntries) {
    if (targetFields.has(mapKey)) reservedFieldMapTargets.add(mapKey)
    // Inverted maps use source as key and target as value.
    if (sourceFields.has(mapKey) && targetFields.has(mapValue)) {
      reservedFieldMapTargets.add(mapValue)
    }
  }

  for (const name of targetFields) {
    if (skip.has(name) || reservedFieldMapTargets.has(name)) continue
    if (!sourceFields.has(name) && !(name in sourceRow)) continue
    if (name in sourceRow) {
      const coerced = coerceCloneWriteValue(sourceRow[name])
      if (coerced != null && coerced !== '') payload[name] = coerced
    }
  }

  for (const [targetField, parentField] of Object.entries(pair.parentFieldMap ?? {})) {
    if (!targetField?.trim() || !parentField?.trim()) continue
    if (!targetFields.has(targetField) || !parentRecord) continue
    if (reservedFieldMapTargets.has(targetField)) continue
    if (parentField in parentRecord) {
      const coerced = coerceCloneWriteValue(parentRecord[parentField])
      if (coerced != null && coerced !== '') payload[targetField] = coerced
    }
  }

  // Same-name fields from the clone parent (project → visit patient/facility, etc.).
  if (parentRecord) {
    for (const name of targetFields) {
      if (skip.has(name) || reservedFieldMapTargets.has(name)) continue
      if (!(name in parentRecord)) continue
      const coerced = coerceCloneWriteValue(parentRecord[name])
      if (coerced == null || coerced === '') continue
      payload[name] = coerced
    }
  }

  // Field map last so source→target overrides always win (supports inverted saved maps).
  for (const [mapKey, mapValue] of fieldMapEntries) {
    const resolvedMap = resolveFieldMapAssignment(
      sourceRow,
      sourceFields,
      targetFields,
      mapKey,
      mapValue,
    )
    if (!resolvedMap) continue
    const coerced = coerceCloneWriteValue(resolvedMap.raw)
    if (coerced == null || coerced === '') continue
    payload[resolvedMap.targetField] = coerced
  }

  if (splitTargetField && splitKey != null && targetFields.has(splitTargetField)) {
    payload[splitTargetField] = splitKey
  }

  if (!('status' in payload) && targetFields.has('status')) {
    payload.status = 'published'
  }
  if (!('is_deleted' in payload) && targetFields.has('is_deleted')) {
    payload.is_deleted = false
  }
  if (!('is_active' in payload) && targetFields.has('is_active')) {
    payload.is_active = true
  }

  return payload
}

function remapSelfRefs(
  sourceRow: Record<string, unknown>,
  idMap: Map<string, string>,
  targetFields: Set<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  // Skip when target GraphQL/registry has no self-ref columns (e.g. visit).
  if (targetFields.has('parent') && 'parent' in sourceRow) {
    const parentSourceId = asRecordId(sourceRow.parent)
    patch.parent = parentSourceId ? idMap.get(parentSourceId) ?? null : null
  }
  if (targetFields.has('depends_on') && 'depends_on' in sourceRow) {
    const raw = sourceRow.depends_on
    const deps = Array.isArray(raw) ? raw : []
    patch.depends_on = deps
      .map((dep) => asRecordId(dep))
      .filter((id): id is string => Boolean(id))
      .map((id) => idMap.get(id))
      .filter((id): id is string => Boolean(id))
  }
  return patch
}

async function listChildren(
  collection: string,
  parentField: string,
  parentId: string,
  fields: string[],
): Promise<Record<string, unknown>[]> {
  const requestFields = fields.includes('id') ? fields : ['id', ...fields]
  return bridgeReadItems(collection, {
    filter: { [parentField]: { _eq: parentId } },
    fields: requestFields,
    limit: 5000,
    sort: ['id'],
  })
}

/**
 * Existing target rows for a pair under the clone parent.
 * Prefer direct parent FK; otherwise find targets linked to this parent's source children.
 */
async function listExistingTargetRows(
  resolved: ResolvedPair,
  parentTargetId: string,
): Promise<Record<string, unknown>[]> {
  if (resolved.targetParentField) {
    return bridgeReadItems(resolved.targetCollection, {
      filter: { [resolved.targetParentField]: { _eq: parentTargetId } },
      fields: ['id'],
      limit: 5000,
    })
  }

  const linkField = resolved.sourceLinkField?.trim()
  if (!linkField) return []

  const sourceRows = await listChildren(
    resolved.sourceCollection,
    resolved.sourceParentField,
    parentTargetId,
    ['id'],
  )
  const sourceIds = sourceRows
    .map((row) => asRecordId(row.id))
    .filter((id): id is string => Boolean(id))
  if (!sourceIds.length) return []

  return bridgeReadItems(resolved.targetCollection, {
    filter: { [linkField]: { _in: sourceIds } },
    fields: ['id'],
    limit: 5000,
  })
}

async function deleteChildrenDeep(
  pair: CloneRelatedChildPair,
  parentTargetId: string,
  sourceParentCollection: string,
  targetParentCollection: string,
): Promise<void> {
  const resolved = await resolvePairFks(pair, sourceParentCollection, targetParentCollection)
  if (!resolved) return

  const existing = await listExistingTargetRows(resolved, parentTargetId)

  for (const row of existing) {
    const id = asRecordId(row.id)
    if (!id) continue
    for (const nested of pair.children ?? []) {
      await deleteChildrenDeep(nested, id, pair.sourceCollection, pair.targetCollection)
    }
    await bridgeSoftDeleteItem(resolved.targetCollection, id)
  }
}

async function cloneSourceRowsOntoParent(
  pair: CloneRelatedChildPair,
  sourceRows: Record<string, unknown>[],
  targetParentId: string,
  sourceParentCollection: string,
  targetParentCollection: string,
  parentRecord?: Record<string, unknown>,
): Promise<Map<string, string>> {
  const resolved = await resolvePairFks(pair, sourceParentCollection, targetParentCollection)
  if (!resolved) return new Map()

  const [sourceDefs, targetDefs] = await Promise.all([
    getCachedCollectionFields(resolved.sourceCollection),
    getCachedCollectionFields(resolved.targetCollection),
  ])
  const sourceFieldSet = cloneableFieldNames(sourceDefs)
  const targetFieldSet = cloneableFieldNames(targetDefs)

  const idMap = new Map<string, string>()

  for (const sourceRow of sourceRows) {
    const sourceId = asRecordId(sourceRow.id)
    if (!sourceId) continue
    const payload = buildClonePayload(
      sourceRow,
      sourceFieldSet,
      targetFieldSet,
      resolved,
      targetParentId,
      parentRecord,
    )
    const created = await writeCreateItem(
      resolved.targetCollection,
      omitSelfRefFields(payload),
    )
    const newId = asRecordId(created.id)
    if (newId) idMap.set(sourceId, newId)
  }

  for (const sourceRow of sourceRows) {
    const sourceId = asRecordId(sourceRow.id)
    const newId = sourceId ? idMap.get(sourceId) : null
    if (!sourceId || !newId) continue
    const patch = remapSelfRefs(sourceRow, idMap, targetFieldSet)
    if (Object.keys(patch).length) {
      await bridgeUpdateItem(resolved.targetCollection, newId, patch)
    }
  }

  for (const sourceRow of sourceRows) {
    const sourceId = asRecordId(sourceRow.id)
    const newId = sourceId ? idMap.get(sourceId) : null
    if (!sourceId || !newId) continue
    for (const nested of pair.children ?? []) {
      await clonePairOntoParent(
        nested,
        sourceId,
        newId,
        pair.sourceCollection,
        pair.targetCollection,
        parentRecord,
      )
    }
  }

  return idMap
}

async function groupNestedRowsBySplit(
  pair: ResolvedPair,
  sourceRowId: string,
): Promise<Map<string, Record<string, unknown>[]>> {
  const splitField = pair.splitBy?.field?.trim()
  const nestedPair = pair.children?.[0]
  const groups = new Map<string, Record<string, unknown>[]>()
  if (!splitField || !nestedPair) return groups

  const nestedResolved = await resolvePairFks(
    nestedPair,
    pair.sourceCollection,
    pair.targetCollection,
  )
  if (!nestedResolved) return groups

  const nestedDefs = await getCachedCollectionFields(nestedPair.sourceCollection)
  const nestedFieldSet = cloneableFieldNames(nestedDefs)
  const requestFields = fieldsForCloneRead(nestedFieldSet, [splitField])

  const nestedRows = await listChildren(
    nestedPair.sourceCollection,
    nestedResolved.sourceParentField,
    sourceRowId,
    requestFields,
  )

  const include = (pair.splitBy?.includeValues ?? [])
    .map((value) => String(value).trim())
    .filter(Boolean)
  const includeSet = include.length ? new Set(include) : null

  for (const row of nestedRows) {
    const key = splitGroupKey(readPath(row, splitField))
    if (!key) continue
    if (includeSet && !includeSet.has(key)) continue
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  return groups
}

async function clonePairOntoParent(
  pair: CloneRelatedChildPair,
  sourceParentId: string,
  targetParentId: string,
  sourceParentCollection: string,
  targetParentCollection: string,
  parentRecord?: Record<string, unknown>,
): Promise<number> {
  const resolved = await resolvePairFks(pair, sourceParentCollection, targetParentCollection)
  if (!resolved) return 0

  const [sourceDefs, targetDefs] = await Promise.all([
    getCachedCollectionFields(resolved.sourceCollection),
    getCachedCollectionFields(resolved.targetCollection),
  ])
  const sourceFieldSet = cloneableFieldNames(sourceDefs)
  const targetFieldSet = cloneableFieldNames(targetDefs)

  const requestFields = buildSourceReadFields(
    resolved,
    sourceFieldSet,
    targetFieldSet,
  )

  const sourceRows = await listChildren(
    resolved.sourceCollection,
    resolved.sourceParentField,
    sourceParentId,
    requestFields,
  )

  const splitField = resolved.splitBy?.field?.trim()
  const nestedSplitPair = resolved.children?.[0]
  const useNestedSplit = Boolean(splitField && nestedSplitPair)

  if (!useNestedSplit) {
    let rows = sourceRows
    if (splitField) {
      const include = (resolved.splitBy?.includeValues ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean)
      const includeSet = include.length ? new Set(include) : null
      rows = sourceRows.filter((row) => {
        const key = splitGroupKey(readPath(row, splitField))
        if (!key) return false
        return includeSet ? includeSet.has(key) : true
      })
    }
    const idMap = await cloneSourceRowsOntoParent(
      pair,
      rows,
      targetParentId,
      sourceParentCollection,
      targetParentCollection,
      parentRecord,
    )
    return idMap.size
  }

  const idMap = new Map<string, string>()
  let createdCount = 0

  for (const sourceRow of sourceRows) {
    const sourceId = asRecordId(sourceRow.id)
    if (!sourceId) continue

    const groups = await groupNestedRowsBySplit(resolved, sourceId)
    if (!groups.size) continue

    for (const [groupKey, groupRows] of groups) {
      const payload = buildClonePayload(
        sourceRow,
        sourceFieldSet,
        targetFieldSet,
        resolved,
        targetParentId,
        parentRecord,
        groupKey,
      )
      const created = await writeCreateItem(
        resolved.targetCollection,
        omitSelfRefFields(payload),
      )
      const newId = asRecordId(created.id)
      if (!newId) continue
      createdCount += 1
      if (!idMap.has(sourceId)) idMap.set(sourceId, newId)

      for (const nested of pair.children ?? []) {
        if (
          nested.sourceCollection === nestedSplitPair?.sourceCollection &&
          nested.targetCollection === nestedSplitPair?.targetCollection
        ) {
          await cloneSourceRowsOntoParent(
            nested,
            groupRows,
            newId,
            pair.sourceCollection,
            pair.targetCollection,
            parentRecord,
          )
        } else {
          await clonePairOntoParent(
            nested,
            sourceId,
            newId,
            pair.sourceCollection,
            pair.targetCollection,
            parentRecord,
          )
        }
      }
    }
  }

  return createdCount
}

export interface RunClonePairsResult {
  created: number
  skippedExisting: boolean
  unresolvedPairs: number
}

/**
 * Execute configured clone pairs generically (no hard-coded collections).
 * Used by M2O clone-related-from and by layout `cloneRelated` actions.
 */
export async function runClonePairs(options: RunClonePairsOptions): Promise<RunClonePairsResult> {
  const pairs = options.pairs.filter(
    (pair) =>
      Boolean(pair.sourceCollection?.trim()) && Boolean(pair.targetCollection?.trim()),
  )
  if (!pairs.length) {
    return { created: 0, skippedExisting: false, unresolvedPairs: 0 }
  }

  if (options.replaceExisting) {
    for (const pair of pairs) {
      await deleteChildrenDeep(
        pair,
        options.targetParentId,
        options.sourceParentCollection,
        options.targetParentCollection,
      )
    }
  } else {
    let hasExisting = false
    for (const pair of pairs) {
      const resolved = await resolvePairFks(
        pair,
        options.sourceParentCollection,
        options.targetParentCollection,
      )
      if (!resolved) continue
      const existing = await listExistingTargetRows(resolved, options.targetParentId)
      if (existing.length) {
        hasExisting = true
        break
      }
    }
    if (hasExisting) {
      return { created: 0, skippedExisting: true, unresolvedPairs: 0 }
    }
  }

  let created = 0
  let unresolvedPairs = 0
  for (const pair of pairs) {
    const resolved = await resolvePairFks(
      pair,
      options.sourceParentCollection,
      options.targetParentCollection,
    )
    if (!resolved) {
      unresolvedPairs += 1
      continue
    }
    const createdForPair = await clonePairOntoParent(
      pair,
      options.sourceParentId,
      options.targetParentId,
      options.sourceParentCollection,
      options.targetParentCollection,
      options.parentRecord,
    )
    created += createdForPair
  }

  return { created, skippedExisting: false, unresolvedPairs }
}

/**
 * Layout action: clone structure from the current record onto itself
 * (e.g. stages → visits / appointments) using action.cloneRelated settings.
 */
export async function applyCloneRelatedAction(
  action: EntityAction,
  collection: string,
  record: Record<string, unknown>,
): Promise<RunClonePairsResult> {
  const recordId = asRecordId(record.id)
  if (!recordId) {
    throw new Error('Record id is required to run clone structure.')
  }
  const pairs = normalizeSettings(action.cloneRelated)
  if (!pairs.length) {
    throw new Error('Clone structure mapping is empty. Configure child pairs in the layout action.')
  }
  const result = await runClonePairs({
    pairs,
    sourceParentId: recordId,
    targetParentId: recordId,
    sourceParentCollection: collection,
    targetParentCollection: collection,
    parentRecord: record,
    replaceExisting: isTruthyFlag(action.cloneRelated?.replaceExisting),
  })

  if (result.skippedExisting) {
    throw new Error(
      'Target records already exist for this mapping. Enable “Replace existing target rows” on the action, or delete the existing visits first.',
    )
  }
  if (result.unresolvedPairs === pairs.length) {
    throw new Error(
      'Could not resolve parent/source links for any clone pair. Ensure the source has an M2O to this record and the target has an M2O to the source (e.g. visit.stage → Project Stage).',
    )
  }
  if (result.created === 0) {
    throw new Error(
      'No rows were created. Check that the source collection has child records, and that Target / nested pairs are configured correctly.',
    )
  }

  return result
}

/**
 * Clone related children from M2O source fields marked `cloneRelatedFrom` on the layout.
 *
 * - Create: clone when source id is set.
 * - Update: if the M2O value changed, delete existing target children for configured pairs,
 *   then clone from the new source (or only delete when cleared).
 *
 * Parent FK fields are inferred from schema relations (source child → M2O collection,
 * target child → current collection).
 */
export async function applyCloneRelatedFromLayout(
  collection: string,
  record: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  layout?: EntityLayoutSchema | null,
): Promise<void> {
  const recordId = asRecordId(record.id)
  if (!recordId) return

  let schema = layout ?? null
  if (!schema) {
    const resolved = await resolvePreferredBlockLayoutForCurrentUser(collection)
    schema = resolved.blockLayout
  }
  if (!schema) return

  const sourceFields = cloneSourceFields(schema)
  if (!sourceFields.length) return

  for (const field of sourceFields) {
    const pairs = normalizeSettings(field.cloneRelatedFromSettings)
    if (!pairs.length) continue

    const m2oSourceCollection = field.relatedCollection?.trim() || ''
    const newSourceId = asRecordId(record[field.field])
    const oldSourceId = previous ? asRecordId(previous[field.field]) : null

    if (previous) {
      if (oldSourceId === newSourceId) continue
      for (const pair of pairs) {
        await deleteChildrenDeep(pair, recordId, m2oSourceCollection, collection)
      }
      if (!newSourceId) continue
      for (const pair of pairs) {
        await clonePairOntoParent(
          pair,
          newSourceId,
          recordId,
          m2oSourceCollection,
          collection,
          record,
        )
      }
      continue
    }

    if (!newSourceId) continue

    await runClonePairs({
      pairs,
      sourceParentId: newSourceId,
      targetParentId: recordId,
      sourceParentCollection: m2oSourceCollection,
      targetParentCollection: collection,
      parentRecord: record,
      replaceExisting: false,
    })
  }
}
