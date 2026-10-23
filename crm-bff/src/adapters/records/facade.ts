import { isFilesAssetCollection } from '../../files/fileNames.js'
import {
  FORM_ROLES_ENTITY,
  isFormRolesEntity,
  isRolesAssetCollection,
} from '../../roles/roleNames.js'
import { isUsersAssetCollection } from '../../users/userNames.js'
import { listRoles } from '../../services/rolesService.js'
import { listUsers } from '../usersAdapter.js'
import { findFile, findFiles } from '../filesAdapter.js'
import type { RecordsListParams, RecordsListResult } from './types.js'
import { resolveRecordsStore } from './registry.js'
import { resolveCanonicalEntityApiName } from './entityName.js'
import {
  fkIdFromValue,
  loadM2ARelations,
  loadM2ORelations,
  loadO2MRelations,
  readRecordField,
  splitRelationFields,
  writeRecordField,
} from './relations.js'
import {
  applyM2ANestedWrites,
  peelM2AAliasFields,
} from './m2aNestedWrite.js'
import {
  applyO2MNestedWrites,
  peelO2MAliasFields,
} from './o2mNestedWrite.js'
import { applyFormulasOnWrite, stripRollupWrites } from '../../computed/applyFormulas.js'
import {
  applyAutoNumbersOnCreate,
  loadAutoNumberFields,
  stripAutoNumberWrites,
} from '../../computed/applyAutoNumber.js'
import {
  attachLiveRollupsOnRead,
  recomputeRollupsForChildChange,
} from '../../computed/applyRollups.js'
import { isLiveRollup, loadRollupFields } from '../../computed/fieldMeta.js'
import {
  applyRecordAutomations,
  attachAutomationToasts,
} from '../../computed/applyRecordAutomations.js'
import {
  enforceCascadeRestore,
  enforceSoftDeleteConstraints,
} from './softDeleteConstraints.js'
import { loadPromotedFields } from '../../schema/crmStorage.js'

export { clearRecordsBackendCache, resolveRecordsBackend, resolveRecordsStore } from './registry.js'
export type { RecordsBackend } from './registry.js'
export type { RecordsListParams, RecordsListResult, RecordsStore } from './types.js'
export { clearRecordRelationsCache } from './relations.js'

export type RecordWriteOptions = {
  /** Authenticated actor (`backend_user_id`) for Created By / Last Modified By. */
  actorUserId?: string | null
}

function stripClientAuditUserFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!('user_created' in data) && !('user_updated' in data)) return data
  const next: Record<string, unknown> = { ...data }
  delete next.user_created
  delete next.user_updated
  return next
}

/** Stamp Created By / Last Modified By from the authenticated actor (server-owned). */
async function stampAuditUsers(
  entityApiName: string,
  data: Record<string, unknown>,
  mode: 'create' | 'update',
  actorUserId?: string | null,
): Promise<Record<string, unknown>> {
  const actor =
    typeof actorUserId === 'string' && actorUserId.trim()
      ? actorUserId.trim()
      : ''
  if (!actor) return data

  const promoted = await loadPromotedFields(entityApiName)
  const names = new Set(promoted.map((field) => field.apiName))
  const next: Record<string, unknown> = { ...data }
  if (mode === 'create') {
    if (names.has('user_created')) next.user_created = actor
    if (names.has('user_updated')) next.user_updated = actor
  } else if (names.has('user_updated')) {
    next.user_updated = actor
  }
  return next
}

/**
 * Expand single-level (and, via recursion, deeper) M2O relations for records.
 */
async function expandM2O(
  entity: string,
  nodes: Record<string, unknown>[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  if (!nodes.length || !fields?.length) return nodes
  if (!fields.some((field) => field.includes('.'))) return nodes

  const rels = await loadM2ORelations(entity)
  if (!rels.length) return nodes

  const m2oFields = new Set(rels.map((rel) => rel.fieldApiName))
  const { relations } = splitRelationFields(fields, m2oFields)
  if (!relations.size) return nodes

  for (const [field, subFields] of relations) {
    const rel = rels.find((entry) => entry.fieldApiName === field)
    if (!rel) continue

    const idSet = new Set<string>()
    for (const node of nodes) {
      const fk = fkIdFromValue(readRecordField(node, field))
      if (fk) idSet.add(fk)
    }
    // No readable FKs on this page — leave existing values alone.
    // Writing null here wiped self-FK trees (e.g. item_group.parent) when
    // nested fields like parent.id were requested but scalars lived only on
    // promoted columns / were missing from the projected row.
    if (!idSet.size) {
      continue
    }

    const ids = [...idSet]
    const relFields = subFields.length
      ? Array.from(new Set(['id', ...subFields]))
      : null
    const related = await findManyRecords(rel.relatedEntityApiName, {
      filter: { id: { _in: ids } },
      fields: relFields,
      limit: ids.length,
      includeDeleted: true,
    })

    const byId = new Map<string, Record<string, unknown>>()
    for (const relatedNode of related.nodes) {
      const rid = fkIdFromValue(relatedNode.id)
      if (rid) byId.set(rid, relatedNode)
    }

    for (const node of nodes) {
      const fk = fkIdFromValue(readRecordField(node, field))
      if (!fk) {
        writeRecordField(node, field, null)
        continue
      }
      // Keep scalar FK when related row is missing so callers can still resolve
      // (common for file assets not yet registered in public.files).
      writeRecordField(node, field, byId.get(fk) ?? fk)
    }
  }

  return nodes
}

function collectItemSubFields(subFields: string[], itemField: string): string[] | null {
  // Bare alias (`blocks`) → full polymorphic hydrate (null fields), matching O2M bare expand.
  if (!subFields.length) return null

  const nested: string[] = []
  let wantsAll = false
  for (const sub of subFields) {
    if (sub === itemField || sub === `${itemField}.*`) {
      wantsAll = true
      continue
    }
    if (sub.startsWith(`${itemField}.`)) {
      const rest = sub.slice(itemField.length + 1)
      if (rest === '*') {
        wantsAll = true
      } else if (rest) {
        nested.push(rest)
      }
    }
  }
  if (wantsAll) return null
  // Junction-only subfields (e.g. `blocks.id`) keep a shallow item id.
  if (!nested.length) return ['id']
  return Array.from(new Set(['id', ...nested]))
}

async function hydratePolymorphicItems(
  rows: Record<string, unknown>[],
  collectionField: string,
  itemField: string,
  itemFields: string[] | null,
): Promise<Record<string, unknown>[]> {
  const byCollection = new Map<string, Set<string>>()
  for (const row of rows) {
    const collection =
      typeof row[collectionField] === 'string' ? String(row[collectionField]).trim() : ''
    const itemId = fkIdFromValue(row[itemField])
    if (!collection || !itemId) continue
    const bucket = byCollection.get(collection) ?? new Set<string>()
    bucket.add(itemId)
    byCollection.set(collection, bucket)
  }

  const loaded = new Map<string, Record<string, unknown>>()
  for (const [collection, ids] of byCollection) {
    const related = await findManyRecords(collection, {
      filter: { id: { _in: [...ids] } },
      fields: itemFields,
      limit: ids.size,
      includeDeleted: true,
    })
    for (const node of related.nodes) {
      const id = fkIdFromValue(node.id)
      if (!id) continue
      loaded.set(`${collection}:${id}`, node)
    }
  }

  return rows.map((row) => {
    const collection =
      typeof row[collectionField] === 'string' ? String(row[collectionField]).trim() : ''
    const itemId = fkIdFromValue(row[itemField])
    if (!collection || !itemId) return row
    const item = loaded.get(`${collection}:${itemId}`)
    return {
      ...row,
      [itemField]: item ?? itemId,
    }
  })
}

/**
 * Expand M2A alias fields (junction rows + polymorphic item hydrate).
 * Requested via bare field (`blocks`) or nested (`blocks.item.*`).
 */
async function expandM2A(
  entity: string,
  nodes: Record<string, unknown>[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  if (!nodes.length || !fields?.length) return nodes

  const rels = await loadM2ARelations(entity)
  if (!rels.length) return nodes

  const m2aFields = new Set(rels.map((rel) => rel.fieldApiName))
  const wantsM2A = fields.some((field) => {
    if (m2aFields.has(field)) return true
    const dot = field.indexOf('.')
    return dot > 0 && m2aFields.has(field.slice(0, dot))
  })
  if (!wantsM2A) return nodes

  const { relations } = splitRelationFields(fields, m2aFields)
  if (!relations.size) return nodes

  for (const [field, subFields] of relations) {
    const rel = rels.find((entry) => entry.fieldApiName === field)
    if (!rel) continue

    const parentIds = nodes
      .map((node) => fkIdFromValue(node.id))
      .filter((id): id is string => Boolean(id))
    if (!parentIds.length) {
      for (const node of nodes) node[field] = []
      continue
    }

    const junctionFields = Array.from(
      new Set([
        'id',
        rel.parentFkField,
        rel.collectionField,
        rel.itemField,
        ...(rel.sortField ? [rel.sortField] : []),
        'hide_block',
      ]),
    )

    const junction = await findManyRecords(rel.junctionEntityApiName, {
      filter: { [rel.parentFkField]: { _in: parentIds } },
      fields: junctionFields,
      sort: rel.sortField ? [rel.sortField] : ['id'],
      limit: -1,
      includeDeleted: false,
    })

    const itemFields = collectItemSubFields(subFields, rel.itemField)
    const hydrated = await hydratePolymorphicItems(
      junction.nodes,
      rel.collectionField,
      rel.itemField,
      itemFields,
    )

    const byParent = new Map<string, Record<string, unknown>[]>()
    for (const row of hydrated) {
      const parentId = fkIdFromValue(row[rel.parentFkField])
      if (!parentId) continue
      const list = byParent.get(parentId) ?? []
      list.push(row)
      byParent.set(parentId, list)
    }

    for (const node of nodes) {
      const parentId = fkIdFromValue(node.id)
      node[field] = parentId ? (byParent.get(parentId) ?? []) : []
    }
  }

  return nodes
}

/**
 * Expand O2M / files alias fields (junction rows + nested M2O on junction FKs).
 * Requested via bare field (`attachments`) or nested (`attachments.file_id.*`).
 */
async function expandO2M(
  entity: string,
  nodes: Record<string, unknown>[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  if (!nodes.length || !fields?.length) return nodes

  const rels = await loadO2MRelations(entity)
  if (!rels.length) return nodes

  const o2mFields = new Set(rels.map((rel) => rel.fieldApiName))
  const wantsO2M = fields.some((field) => {
    if (o2mFields.has(field)) return true
    const dot = field.indexOf('.')
    return dot > 0 && o2mFields.has(field.slice(0, dot))
  })
  if (!wantsO2M) return nodes

  const { relations } = splitRelationFields(fields, o2mFields)
  if (!relations.size) return nodes

  for (const [field, subFields] of relations) {
    const rel = rels.find((entry) => entry.fieldApiName === field)
    if (!rel) continue

    const parentIds = nodes
      .map((node) => fkIdFromValue(node.id))
      .filter((id): id is string => Boolean(id))
    if (!parentIds.length) {
      for (const node of nodes) node[field] = []
      continue
    }

    const junctionFields = new Set<string>(['id', rel.parentFkField])
    if (rel.junctionField) junctionFields.add(rel.junctionField)
    if (rel.sortField) junctionFields.add(rel.sortField)

    if (!subFields.length) {
      if (rel.junctionField) junctionFields.add(`${rel.junctionField}.*`)
    } else {
      for (const sub of subFields) {
        if (!sub || sub === '*') {
          if (rel.junctionField) junctionFields.add(`${rel.junctionField}.*`)
          continue
        }
        junctionFields.add(sub)
        const base = sub.split('.')[0]
        if (base) junctionFields.add(base)
      }
    }

    const junction = await findManyRecords(rel.junctionEntityApiName, {
      filter: { [rel.parentFkField]: { _in: parentIds } },
      fields: Array.from(junctionFields),
      sort: rel.sortField ? [rel.sortField] : ['id'],
      limit: -1,
      includeDeleted: false,
    })

    const byParent = new Map<string, Record<string, unknown>[]>()
    for (const row of junction.nodes) {
      const parentId = fkIdFromValue(row[rel.parentFkField])
      if (!parentId) continue
      const list = byParent.get(parentId) ?? []
      list.push(row)
      byParent.set(parentId, list)
    }

    for (const node of nodes) {
      const parentId = fkIdFromValue(node.id)
      node[field] = parentId ? (byParent.get(parentId) ?? []) : []
    }
  }

  return nodes
}

async function expandRecordRelations(
  entity: string,
  nodes: Record<string, unknown>[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  const withM2O = await expandM2O(entity, nodes, fields)
  const withO2M = await expandO2M(entity, withM2O, fields)
  return expandM2A(entity, withO2M, fields)
}

function idsFromFilter(filter: Record<string, unknown> | null | undefined): string[] {
  if (!filter || typeof filter !== 'object') return []
  const idFilter = filter.id
  if (idFilter == null) return []
  if (typeof idFilter === 'string' || typeof idFilter === 'number') {
    return [String(idFilter)]
  }
  if (typeof idFilter === 'object') {
    const obj = idFilter as Record<string, unknown>
    if (obj._eq != null) return [String(obj._eq)]
    if (Array.isArray(obj._in)) return obj._in.map(String)
  }
  return []
}

async function findManyFileAssets(
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  const ids = idsFromFilter(params.filter ?? null)
  if (!ids.length) {
    return { nodes: [], totalCount: 0 }
  }
  const nodes = await findFiles(ids, params.fields ?? undefined)
  return { nodes, totalCount: nodes.length }
}

function projectRoleNode(
  role: { id: string; name: string },
  fields?: string[] | null,
): Record<string, unknown> {
  const full: Record<string, unknown> = { id: role.id, name: role.name }
  if (!fields?.length) return full
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const base = field.split('.')[0]
    if (base && base in full) out[base] = full[base]
  }
  if (!('id' in out)) out.id = full.id
  return out
}

async function findManyRoleAssets(
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  const roles = await listRoles()
  const ids = idsFromFilter(params.filter ?? null)
  const search = String(params.search || '')
    .trim()
    .toLowerCase()
  let filtered = roles
  if (ids.length) {
    const idSet = new Set(ids)
    filtered = filtered.filter((role) => idSet.has(String(role.id)))
  }
  if (search) {
    filtered = filtered.filter((role) =>
      String(role.name || '')
        .toLowerCase()
        .includes(search),
    )
  }
  const limit = params.limit != null && params.limit >= 0 ? params.limit : filtered.length
  const offset = params.offset ?? 0
  const slice = filtered.slice(offset, offset + limit)
  const nodes = slice.map((role) => projectRoleNode(role, params.fields))
  return { nodes, totalCount: filtered.length }
}

async function findManyUserAssets(
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  const ids = idsFromFilter(params.filter ?? null)
  const search = String(params.search || '').trim() || null
  const limit =
    params.limit != null && params.limit >= 0
      ? params.limit
      : ids.length > 0
        ? ids.length
        : 20
  const nodes = await listUsers({
    ids: ids.length ? ids : null,
    search,
    fields: params.fields ?? null,
    limit,
    sort: params.sort ?? null,
  })
  return { nodes, totalCount: nodes.length }
}

function normalizeEntityApiName(entity: string): string {
  if (isFormRolesEntity(entity)) return FORM_ROLES_ENTITY
  return entity
}

async function resolveEntity(entity: string): Promise<string> {
  return resolveCanonicalEntityApiName(normalizeEntityApiName(entity))
}

/** Store backends only see physical columns; aliases / live rollups hydrate after. */
async function physicalStoreFields(
  entity: string,
  fields?: string[] | null,
): Promise<string[] | null | undefined> {
  if (!fields?.length) return fields
  const [m2a, o2m, rollups] = await Promise.all([
    loadM2ARelations(entity),
    loadO2MRelations(entity),
    loadRollupFields(entity),
  ])
  const aliases = new Set([
    ...m2a.map((rel) => rel.fieldApiName),
    ...o2m.map((rel) => rel.fieldApiName),
    ...rollups
      .filter((field) => isLiveRollup(field.rollup))
      .map((field) => field.apiName),
  ])
  if (!aliases.size) return fields
  return fields.filter((field) => {
    const base = field.split(/[.:(]/)[0] ?? field
    return !aliases.has(base)
  })
}

export async function findManyRecords(
  entity: string,
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  if (isFilesAssetCollection(entity)) {
    return findManyFileAssets(params)
  }
  if (isRolesAssetCollection(entity)) {
    return findManyRoleAssets(params)
  }
  if (isUsersAssetCollection(entity)) {
    return findManyUserAssets(params)
  }
  const apiName = await resolveEntity(entity)
  const store = await resolveRecordsStore(apiName)
  const storeParams = {
    ...params,
    fields: await physicalStoreFields(apiName, params.fields),
  }
  const result = await store.findMany(apiName, storeParams)
  result.nodes = await expandRecordRelations(apiName, result.nodes, params.fields)
  result.nodes = await attachLiveRollupsOnRead(apiName, result.nodes, params.fields)
  return result
}

export async function findOneRecord(
  entity: string,
  id: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  if (isFilesAssetCollection(entity)) {
    const row = await findFile(id, fields ?? undefined)
    if (!row) throw new Error(`File not found: ${id}`)
    return row
  }
  if (isRolesAssetCollection(entity)) {
    const roles = await listRoles()
    const role = roles.find((entry) => String(entry.id) === String(id))
    if (!role) throw new Error(`Role not found: ${id}`)
    return projectRoleNode(role, fields)
  }
  if (isUsersAssetCollection(entity)) {
    const rows = await listUsers({
      ids: [String(id)],
      fields: fields ?? null,
      limit: 1,
    })
    const row = rows[0]
    if (!row) throw new Error(`User not found: ${id}`)
    return row
  }
  const apiName = await resolveEntity(entity)
  const store = await resolveRecordsStore(apiName)
  const storeFields = await physicalStoreFields(apiName, fields)
  const record = await store.findOne(apiName, id, storeFields)
  const [expanded] = await expandRecordRelations(apiName, [record], fields)
  const [withRollups] = await attachLiveRollupsOnRead(
    apiName,
    [expanded ?? record],
    fields,
  )
  return withRollups ?? expanded ?? record
}

export async function createRecord(
  entity: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
  options?: RecordWriteOptions,
): Promise<Record<string, unknown>> {
  const apiName = await resolveEntity(entity)
  const store = await resolveRecordsStore(apiName)
  const withoutClientAudit = stripClientAuditUserFields(data)
  const strippedRollups = await stripRollupWrites(apiName, withoutClientAudit)
  const stripped = await stripAutoNumberWrites(apiName, strippedRollups)
  const withFormulas = await applyFormulasOnWrite(apiName, stripped, null)
  const autoNumberFields = await loadAutoNumberFields(apiName)
  const maxAttempts = autoNumberFields.length > 0 ? 5 : 1

  let lastError: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const withAutoNumbers = await applyAutoNumbersOnCreate(apiName, withFormulas)
    const automationResult = await applyRecordAutomations(
      apiName,
      withAutoNumbers,
      null,
      'create',
    )
    const m2a = await peelM2AAliasFields(apiName, automationResult.patch)
    const o2m = await peelO2MAliasFields(apiName, m2a.parentData)
    const parentData = await stampAuditUsers(
      apiName,
      o2m.parentData,
      'create',
      options?.actorUserId,
    )
    try {
      const created = await store.create(apiName, parentData, null)
      const parentId = created.id == null ? null : String(created.id)
      if (!parentId) throw new Error(`createRecord("${apiName}"): missing id`)
      await applyM2ANestedWrites(apiName, parentId, m2a.nested)
      await applyO2MNestedWrites(apiName, parentId, o2m.nested)
      await recomputeRollupsForChildChange(apiName, {
        before: null,
        after: created,
      })
      const record = await findOneRecord(apiName, parentId, fields)
      return attachAutomationToasts(record, automationResult.toasts)
    } catch (err) {
      lastError = err
      if (
        attempt >= maxAttempts - 1 ||
        !isAutoNumberNameUniqueViolation(err)
      ) {
        throw err
      }
      console.warn(
        `[createRecord] ${apiName}: auto-number name collision (attempt ${attempt + 1}/${maxAttempts}), retrying`,
      )
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`createRecord("${apiName}"): failed after retries`)
}

function isAutoNumberNameUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    /uq_[a-z0-9_]+_field_name/i.test(message) ||
    (/Uniqueness violation/i.test(message) && /\bname\b/i.test(message)) ||
    (/duplicate key/i.test(message) && /\bname\b/i.test(message))
  )
}

export async function updateRecord(
  entity: string,
  id: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
  options?: RecordWriteOptions,
): Promise<Record<string, unknown>> {
  const apiName = await resolveEntity(entity)
  const store = await resolveRecordsStore(apiName)
  let existing: Record<string, unknown> | null = null
  try {
    existing = await store.findOne(apiName, String(id), null)
  } catch {
    existing = null
  }
  const withoutClientAudit = stripClientAuditUserFields(data)
  const strippedRollups = await stripRollupWrites(apiName, withoutClientAudit)
  const stripped = await stripAutoNumberWrites(apiName, strippedRollups)
  const withFormulas = await applyFormulasOnWrite(apiName, stripped, existing)
  const automationResult = await applyRecordAutomations(
    apiName,
    withFormulas,
    existing,
    'update',
  )
  const m2a = await peelM2AAliasFields(apiName, automationResult.patch)
  const o2m = await peelO2MAliasFields(apiName, m2a.parentData)
  const parentData = await stampAuditUsers(
    apiName,
    o2m.parentData,
    'update',
    options?.actorUserId,
  )
  const updated = await store.update(apiName, id, parentData, null)
  await applyM2ANestedWrites(apiName, String(id), m2a.nested)
  await applyO2MNestedWrites(apiName, String(id), o2m.nested)
  await recomputeRollupsForChildChange(apiName, {
    before: existing,
    after: updated,
  })
  const record = await findOneRecord(apiName, String(id), fields)
  return attachAutomationToasts(record, automationResult.toasts)
}

export async function softDeleteRecord(
  entity: string,
  id: string,
  visited: Set<string> = new Set(),
  options?: RecordWriteOptions,
): Promise<Record<string, unknown>> {
  const apiName = await resolveEntity(entity)
  const recordId = String(id)
  const visitKey = `${apiName}:${recordId}`
  if (visited.has(visitKey)) {
    const store = await resolveRecordsStore(apiName)
    try {
      return asObject(await store.findOne(apiName, recordId, null))
    } catch {
      return {}
    }
  }
  visited.add(visitKey)

  await enforceSoftDeleteConstraints(apiName, recordId, async (childEntity, childId) => {
    await softDeleteRecord(childEntity, childId, visited, options)
  })

  const store = await resolveRecordsStore(apiName)
  let existing: Record<string, unknown> | null = null
  try {
    existing = await store.findOne(apiName, recordId, null)
  } catch {
    existing = null
  }
  const automationResult = await applyRecordAutomations(
    apiName,
    {},
    existing,
    'delete',
  )
  // Stamp Last Modified By / date so archived lists can show who/when deleted.
  // Schedule templates keep Status; every other object archives with is_deleted.
  let archivePatch: Record<string, unknown> =
    apiName === 'crm_schedule_template'
      ? { status: 'archived', date_updated: new Date().toISOString() }
      : { is_deleted: true, date_updated: new Date().toISOString() }
  archivePatch = await stampAuditUsers(
    apiName,
    archivePatch,
    'update',
    options?.actorUserId,
  )
  const deleted = await store.update(apiName, recordId, archivePatch, null)
  await recomputeRollupsForChildChange(apiName, {
    before: existing,
    after: deleted,
  })
  return attachAutomationToasts(
    asObject(deleted),
    automationResult.toasts,
  )
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function restoreRecord(
  entity: string,
  id: string,
  visited: Set<string> = new Set(),
): Promise<Record<string, unknown>> {
  const apiName = await resolveEntity(entity)
  const recordId = String(id)
  const visitKey = `${apiName}:${recordId}`
  if (visited.has(visitKey)) {
    const store = await resolveRecordsStore(apiName)
    try {
      return asObject(await store.findOne(apiName, recordId, null))
    } catch {
      return {}
    }
  }
  visited.add(visitKey)

  const store = await resolveRecordsStore(apiName)
  let existing: Record<string, unknown> | null = null
  try {
    existing = await store.findOne(apiName, recordId, null)
  } catch {
    existing = null
  }
  const restored = await store.restore(apiName, recordId)
  await recomputeRollupsForChildChange(apiName, {
    before: existing,
    after: restored,
  })

  // After parent is live again, restore archived CASCADE children (depth-first).
  await enforceCascadeRestore(apiName, recordId, async (childEntity, childId) => {
    await restoreRecord(childEntity, childId, visited)
  })

  return restored
}

export async function hardDeleteRecord(
  entity: string,
  id: string,
): Promise<boolean> {
  const apiName = await resolveEntity(entity)
  const store = await resolveRecordsStore(apiName)
  let existing: Record<string, unknown> | null = null
  try {
    existing = await store.findOne(apiName, String(id), null)
  } catch {
    existing = null
  }
  const ok = await store.hardDelete(apiName, id)
  if (ok && existing) {
    await recomputeRollupsForChildChange(apiName, {
      before: existing,
      after: null,
    })
  }
  return ok
}

export async function aggregateRecords(
  entity: string,
  options: {
    aggregate: Record<string, unknown>
    groupBy?: string[] | null
    filter?: Record<string, unknown> | null
    limit?: number
  },
): Promise<Record<string, unknown>[]> {
  const apiName = await resolveEntity(entity)
  const store = await resolveRecordsStore(apiName)
  return store.aggregate(apiName, options)
}
