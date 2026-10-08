import type { M2ARelationMeta } from './relations.js'
import { loadM2ARelations } from './relations.js'
import { resolveRecordsStore } from './registry.js'

export type M2ANestedByField = Map<string, unknown[]>

export interface PeeledM2APayload {
  parentData: Record<string, unknown>
  nested: M2ANestedByField
}

function isTempJunctionId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('temp-')
}

/** Link-shaped item id only — nested target creates are refused. */
export function m2aLinkItemId(item: unknown): string {
  if (item == null || item === '') {
    throw new Error('M2A nested write requires item id (link shape)')
  }
  if (typeof item === 'object') {
    const record = item as Record<string, unknown>
    if (record.id == null || record.id === '') {
      throw new Error(
        'M2A nested write supports link shape only (item.id required; nested creates are not supported)',
      )
    }
    return String(record.id)
  }
  return String(item)
}

/**
 * Strip M2A alias fields from a parent write payload so they are not stored in JSONB.
 */
export async function peelM2AAliasFields(
  entityApiName: string,
  data: Record<string, unknown>,
): Promise<PeeledM2APayload> {
  const rels = await loadM2ARelations(entityApiName)
  if (!rels.length) {
    return { parentData: data, nested: new Map() }
  }

  const parentData = { ...data }
  const nested: M2ANestedByField = new Map()

  for (const rel of rels) {
    if (!(rel.fieldApiName in parentData)) continue
    const value = parentData[rel.fieldApiName]
    delete parentData[rel.fieldApiName]
    if (value == null) continue
    if (!Array.isArray(value)) {
      throw new Error(
        `M2A field "${rel.fieldApiName}" on "${entityApiName}" expects an array`,
      )
    }
    nested.set(rel.fieldApiName, value)
  }

  return { parentData, nested }
}

function relByField(
  rels: M2ARelationMeta[],
  field: string,
): M2ARelationMeta | undefined {
  return rels.find((rel) => rel.fieldApiName === field)
}

/**
 * Apply link-shaped M2A junction ops for each peeled alias.
 * Ops: create (no id / temp id), update (persistent id), delete (`delete: true`).
 */
export async function applyM2ANestedWrites(
  entityApiName: string,
  parentId: string,
  nested: M2ANestedByField,
): Promise<void> {
  if (!nested.size) return

  const rels = await loadM2ARelations(entityApiName)
  for (const [field, rows] of nested) {
    const rel = relByField(rels, field)
    if (!rel) {
      throw new Error(`Unknown M2A alias "${field}" on "${entityApiName}"`)
    }
    await applyAliasOps(rel, parentId, rows)
  }
}

async function applyAliasOps(
  rel: M2ARelationMeta,
  parentId: string,
  rows: unknown[],
): Promise<void> {
  const store = await resolveRecordsStore(rel.junctionEntityApiName)
  let createIndex = 0
  for (const raw of rows) {
    if (raw == null || typeof raw !== 'object') {
      throw new Error(
        `M2A "${rel.fieldApiName}" row must be an object (got ${typeof raw})`,
      )
    }
    const row = raw as Record<string, unknown>
    const junctionId =
      row.id != null && row.id !== '' && !isTempJunctionId(row.id)
        ? String(row.id)
        : null

    if (row.delete === true) {
      if (!junctionId) {
        throw new Error(
          `M2A "${rel.fieldApiName}" delete requires a persistent junction id`,
        )
      }
      await store.hardDelete(rel.junctionEntityApiName, junctionId)
      continue
    }

    const collection =
      typeof row[rel.collectionField] === 'string'
        ? String(row[rel.collectionField]).trim()
        : typeof row.collection === 'string'
          ? String(row.collection).trim()
          : ''
    if (!collection) {
      throw new Error(
        `M2A "${rel.fieldApiName}" row requires "${rel.collectionField}"`,
      )
    }

    const itemRaw =
      rel.itemField in row ? row[rel.itemField] : row.item
    const itemId = m2aLinkItemId(itemRaw)

    const sortRaw =
      rel.sortField && rel.sortField in row
        ? row[rel.sortField]
        : row.sort
    const sortValue =
      sortRaw == null || sortRaw === ''
        ? createIndex
        : Number(sortRaw)

    const payload: Record<string, unknown> = {
      [rel.parentFkField]: parentId,
      [rel.collectionField]: collection,
      [rel.itemField]: itemId,
    }
    if (rel.sortField) {
      payload[rel.sortField] = Number.isFinite(sortValue) ? sortValue : createIndex
    }

    if ('hide_block' in row || 'hideBlock' in row) {
      const hideRaw = 'hide_block' in row ? row.hide_block : row.hideBlock
      payload.hide_block =
        hideRaw === true ||
        hideRaw === 1 ||
        hideRaw === '1' ||
        hideRaw === 'true'
    }

    if (junctionId) {
      await store.update(rel.junctionEntityApiName, junctionId, payload)
    } else {
      await store.create(rel.junctionEntityApiName, payload)
      createIndex += 1
    }
  }
}
