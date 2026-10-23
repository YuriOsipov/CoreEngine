/**
 * Soft-delete (archive) must honor M2O Delete Constraint metadata.
 * Postgres ON DELETE only runs on hard DELETE; archive sets is_deleted
 * (or status = archived on schedule templates).
 */
import { query } from '../../db/pool.js'
import {
  normalizeOnDelete,
  type OnDeleteAction,
} from '../../schema/crmStorage.js'
import { resolveRecordsStore } from './registry.js'

export interface IncomingOnDeleteRelation {
  childEntityApiName: string
  childEntityLabel: string
  fieldApiName: string
  fieldLabel: string
  onDelete: OnDeleteAction
}

export interface SoftDeleteBlocker {
  entity: string
  entityLabel: string
  field: string
  fieldLabel: string
  count: number
}

export class SoftDeleteRestrictedError extends Error {
  readonly code = 'DELETE_RESTRICTED' as const
  readonly blockers: SoftDeleteBlocker[]

  constructor(message: string, blockers: SoftDeleteBlocker[]) {
    super(message)
    this.name = 'SoftDeleteRestrictedError'
    this.blockers = blockers
  }
}

/** Incoming M2O FKs that point at `parentEntityApiName` (child.field → parent). */
export async function loadIncomingOnDeleteRelations(
  parentEntityApiName: string,
): Promise<IncomingOnDeleteRelation[]> {
  const rows = await query<{
    child_entity: string
    child_label: string
    field_api_name: string
    field_label: string
    on_delete: string | null
  }>(
    `SELECT e.api_name AS child_entity,
            COALESCE(NULLIF(BTRIM(e.label), ''), e.api_name) AS child_label,
            f.api_name AS field_api_name,
            COALESCE(NULLIF(BTRIM(f.label), ''), f.api_name) AS field_label,
            r.meta->>'on_delete' AS on_delete
     FROM public.relations r
     JOIN public.fields f ON f.id = r.field_id
     JOIN public.entities e ON e.id = r.entity_id
     LEFT JOIN public.entities related ON related.id = r.related_entity_id
     WHERE e.deleted_at IS NULL
       AND UPPER(COALESCE(r.kind, '')) = 'M2O'
       AND (
         related.api_name = $1
         OR COALESCE(r.meta->>'one_collection', '') = $1
       )
     ORDER BY e.api_name, f.api_name`,
    [parentEntityApiName],
  )

  return rows.map((row) => ({
    childEntityApiName: String(row.child_entity),
    childEntityLabel: String(row.child_label || row.child_entity),
    fieldApiName: String(row.field_api_name),
    fieldLabel: String(row.field_label || row.field_api_name),
    onDelete: normalizeOnDelete(row.on_delete),
  }))
}

function formatRestrictMessage(
  parentEntityApiName: string,
  blockers: SoftDeleteBlocker[],
): string {
  const parts = blockers.map((b) => {
    const noun = b.count === 1 ? 'record' : 'records'
    return `${b.count} ${b.entityLabel} ${noun} (via ${b.fieldLabel})`
  })
  return `Cannot archive ${parentEntityApiName}: still referenced by ${parts.join('; ')}.`
}

async function countActiveChildren(
  childEntity: string,
  fieldApiName: string,
  parentId: string,
): Promise<number> {
  const store = await resolveRecordsStore(childEntity)
  const result = await store.findMany(childEntity, {
    filter: { [fieldApiName]: { _eq: parentId } },
    fields: ['id'],
    limit: 1,
    offset: 0,
  })
  return result.totalCount
}

async function listChildIds(
  childEntity: string,
  fieldApiName: string,
  parentId: string,
  options: { includeDeleted?: boolean; archivedOnly?: boolean } = {},
): Promise<string[]> {
  const store = await resolveRecordsStore(childEntity)
  const ids: string[] = []
  const pageSize = 100
  let offset = 0
  const filter: Record<string, unknown> = {
    [fieldApiName]: { _eq: parentId },
  }
  if (options.archivedOnly) {
    if (childEntity === 'crm_schedule_template') {
      filter.status = { _eq: 'archived' }
    } else {
      filter.is_deleted = { _eq: true }
    }
  }
  for (;;) {
    const result = await store.findMany(childEntity, {
      filter,
      fields: ['id'],
      limit: pageSize,
      offset,
      includeDeleted: options.includeDeleted === true || options.archivedOnly === true,
    })
    for (const node of result.nodes) {
      const id = node.id
      if (id != null && id !== '') ids.push(String(id))
    }
    if (result.nodes.length < pageSize) break
    offset += pageSize
    if (offset > 10_000) break
  }
  return ids
}

export type SoftDeleteChildFn = (
  entity: string,
  id: string,
) => Promise<void>

export type RestoreChildFn = (
  entity: string,
  id: string,
) => Promise<void>

/**
 * Enforce Delete Constraint semantics for archive:
 * - RESTRICT: block when active children still reference the parent
 * - SET NULL: clear FK on active children
 * - CASCADE: recursively soft-delete active children
 */
export async function enforceSoftDeleteConstraints(
  parentEntityApiName: string,
  parentId: string,
  softDeleteChild: SoftDeleteChildFn,
): Promise<void> {
  const incoming = await loadIncomingOnDeleteRelations(parentEntityApiName)
  if (!incoming.length) return

  const blockers: SoftDeleteBlocker[] = []
  for (const rel of incoming) {
    if (rel.onDelete !== 'RESTRICT') continue
    const count = await countActiveChildren(
      rel.childEntityApiName,
      rel.fieldApiName,
      parentId,
    )
    if (count > 0) {
      blockers.push({
        entity: rel.childEntityApiName,
        entityLabel: rel.childEntityLabel,
        field: rel.fieldApiName,
        fieldLabel: rel.fieldLabel,
        count,
      })
    }
  }

  if (blockers.length) {
    throw new SoftDeleteRestrictedError(
      formatRestrictMessage(parentEntityApiName, blockers),
      blockers,
    )
  }

  for (const rel of incoming) {
    if (rel.onDelete === 'SET NULL') {
      const childIds = await listChildIds(
        rel.childEntityApiName,
        rel.fieldApiName,
        parentId,
      )
      if (!childIds.length) continue
      const store = await resolveRecordsStore(rel.childEntityApiName)
      for (const childId of childIds) {
        await store.update(rel.childEntityApiName, childId, {
          [rel.fieldApiName]: null,
        })
      }
      continue
    }

    if (rel.onDelete === 'CASCADE') {
      const childIds = await listChildIds(
        rel.childEntityApiName,
        rel.fieldApiName,
        parentId,
      )
      for (const childId of childIds) {
        await softDeleteChild(rel.childEntityApiName, childId)
      }
    }
  }
}

/**
 * Cascade restore: re-activate archived children that still reference the parent
 * via M2O relations with on_delete = CASCADE.
 */
export async function enforceCascadeRestore(
  parentEntityApiName: string,
  parentId: string,
  restoreChild: RestoreChildFn,
): Promise<void> {
  const incoming = await loadIncomingOnDeleteRelations(parentEntityApiName)
  const cascadeRels = incoming.filter((rel) => rel.onDelete === 'CASCADE')
  if (!cascadeRels.length) return

  for (const rel of cascadeRels) {
    const childIds = await listChildIds(
      rel.childEntityApiName,
      rel.fieldApiName,
      parentId,
      { archivedOnly: true },
    )
    for (const childId of childIds) {
      await restoreChild(rel.childEntityApiName, childId)
    }
  }
}
