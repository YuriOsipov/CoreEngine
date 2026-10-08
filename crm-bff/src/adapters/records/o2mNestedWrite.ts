import type { O2MRelationMeta } from './relations.js'
import { loadO2MRelations } from './relations.js'
import { resolveRecordsStore } from './registry.js'

export type O2MNestedByField = Map<string, unknown[]>

export interface PeeledO2MPayload {
  parentData: Record<string, unknown>
  nested: O2MNestedByField
}

function isTempJunctionId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('temp-')
}

/** Link-shaped related id (file_id / role_id / …) — nested creates refused. */
export function o2mLinkRelatedId(
  value: unknown,
  fieldName: string,
): string {
  if (value == null || value === '') {
    throw new Error(`O2M nested write requires ${fieldName} id (link shape)`)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.id == null || record.id === '') {
      throw new Error(
        `O2M nested write supports link shape only (${fieldName}.id required; nested creates are not supported)`,
      )
    }
    return String(record.id)
  }
  return String(value)
}

/**
 * Strip O2M / files alias fields from a parent write payload so they are not stored in JSONB.
 */
export async function peelO2MAliasFields(
  entityApiName: string,
  data: Record<string, unknown>,
): Promise<PeeledO2MPayload> {
  const rels = await loadO2MRelations(entityApiName)
  if (!rels.length) {
    return { parentData: data, nested: new Map() }
  }

  const parentData = { ...data }
  const nested: O2MNestedByField = new Map()

  for (const rel of rels) {
    if (!(rel.fieldApiName in parentData)) continue
    const value = parentData[rel.fieldApiName]
    delete parentData[rel.fieldApiName]
    if (value == null) continue
    if (!Array.isArray(value)) {
      throw new Error(
        `O2M field "${rel.fieldApiName}" on "${entityApiName}" expects an array`,
      )
    }
    nested.set(rel.fieldApiName, value)
  }

  return { parentData, nested }
}

function relByField(
  rels: O2MRelationMeta[],
  field: string,
): O2MRelationMeta | undefined {
  return rels.find((rel) => rel.fieldApiName === field)
}

/**
 * Apply link-shaped O2M / files junction ops for each peeled alias.
 * Ops: create (no id / temp id), update (persistent id), delete (`delete: true`).
 */
export async function applyO2MNestedWrites(
  entityApiName: string,
  parentId: string,
  nested: O2MNestedByField,
): Promise<void> {
  if (!nested.size) return

  const rels = await loadO2MRelations(entityApiName)
  for (const [field, rows] of nested) {
    const rel = relByField(rels, field)
    if (!rel) {
      throw new Error(`Unknown O2M alias "${field}" on "${entityApiName}"`)
    }
    await applyAliasOps(rel, parentId, rows)
  }
}

async function applyAliasOps(
  rel: O2MRelationMeta,
  parentId: string,
  rows: unknown[],
): Promise<void> {
  if (!rel.junctionField) {
    throw new Error(
      `O2M "${rel.fieldApiName}" nested write requires junction_field (link shape)`,
    )
  }

  const store = await resolveRecordsStore(rel.junctionEntityApiName)

  let createIndex = 0
  for (const raw of rows) {
    if (raw == null || typeof raw !== 'object') {
      throw new Error(
        `O2M "${rel.fieldApiName}" row must be an object (got ${typeof raw})`,
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
          `O2M "${rel.fieldApiName}" delete requires a persistent junction id`,
        )
      }
      await store.hardDelete(rel.junctionEntityApiName, junctionId)
      continue
    }

    const relatedRaw =
      rel.junctionField in row ? row[rel.junctionField] : undefined
    const relatedId = o2mLinkRelatedId(relatedRaw, rel.junctionField)

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
      [rel.junctionField]: relatedId,
    }
    if (rel.sortField) {
      payload[rel.sortField] = Number.isFinite(sortValue) ? sortValue : createIndex
    }

    if (junctionId) {
      await store.update(rel.junctionEntityApiName, junctionId, payload)
    } else {
      // Idempotent M2M/O2M link: same parent + related must not create a second row.
      const existing = await store.findMany(rel.junctionEntityApiName, {
        filter: {
          _and: [
            { [rel.parentFkField]: { _eq: parentId } },
            { [rel.junctionField]: { _eq: relatedId } },
          ],
        },
        fields: ['id'],
        limit: 1,
        includeDeleted: true,
      })
      if (existing.nodes.some((node) => node.id != null && node.id !== '')) {
        continue
      }
      await store.create(rel.junctionEntityApiName, payload)
      createIndex += 1
    }
  }
}
