/**
 * Permanently delete archived business records older than a retention window.
 *
 * Soft-delete stamps `date_updated` (and `is_deleted` / status=archived).
 * This job hard-deletes those rows after `retentionDays`, with optional entity
 * allow/deny lists. Disabled-by-default standard task seeds this job type.
 */
import {
  findManyRecords,
  hardDeleteRecord,
  SYSTEM_RECORD_ACCESS,
} from '../adapters/records/index.js'
import { hardDeleteAfterAudit } from '../audit/hardDeleteAfterAudit.js'
import { writeAuditEntry } from '../audit/auditService.js'
import { query } from '../db/pool.js'
import { isFilesAssetCollection } from '../files/fileNames.js'
import { isRolesAssetCollection } from '../roles/roleNames.js'
import { resolveRecordRelation } from '../schema/crmStorage.js'
import { resolveEntityAccountability } from '../schema/entityMeta.js'
import { isUsersAssetCollection } from '../users/userNames.js'

export const PURGE_ARCHIVED_DEFAULT_RETENTION_DAYS = 90
export const PURGE_ARCHIVED_DEFAULT_LIMIT_PER_ENTITY = 500

export interface PurgeArchivedRecordsResult {
  retentionDays: number
  cutoffIso: string
  dryRun: boolean
  entitiesScanned: number
  entitiesSkipped: number
  deleted: number
  failed: number
  candidates: number
  errors: string[]
  byEntity: Record<string, { deleted: number; failed: number; candidates: number }>
}

function positiveInt(value: unknown, fallback: number, max = 10_000): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry).trim()).filter(Boolean)
}

function isAssetCollection(apiName: string): boolean {
  return (
    isUsersAssetCollection(apiName) ||
    isRolesAssetCollection(apiName) ||
    isFilesAssetCollection(apiName)
  )
}

function archivedFilter(
  apiName: string,
  hasDeleted: boolean,
  hasStatus: boolean,
  cutoffIso: string,
): Record<string, unknown> | null {
  if (hasDeleted) {
    return {
      is_deleted: { _eq: true },
      date_updated: { _lt: cutoffIso },
    }
  }
  // Schedule templates (and rare status-only archives) use status=archived.
  if (hasStatus || apiName === 'crm_schedule_template') {
    return {
      status: { _eq: 'archived' },
      date_updated: { _lt: cutoffIso },
    }
  }
  return null
}

async function listPurgeableEntities(allow: string[], deny: Set<string>): Promise<string[]> {
  if (allow.length) {
    return allow.filter((name) => !deny.has(name) && !isAssetCollection(name))
  }
  const rows = await query<{ api_name: string }>(
    `SELECT api_name
     FROM public.entities
     WHERE deleted_at IS NULL
     ORDER BY api_name ASC`,
  )
  return rows
    .map((row) => String(row.api_name))
    .filter((name) => !deny.has(name) && !isAssetCollection(name))
}

async function hardDeleteWithAudit(entity: string, id: string): Promise<void> {
  let before: Record<string, unknown> | null = null
  try {
    const listed = await findManyRecords(entity, {
      filter: { id: { _eq: id } },
      fields: null,
      limit: 1,
      includeDeleted: true,
      access: SYSTEM_RECORD_ACCESS,
    })
    before = listed.nodes[0] ?? null
  } catch {
    before = null
  }

  const accountability = await resolveEntityAccountability(entity)
  await hardDeleteAfterAudit({
    audit: async () => {
      if (accountability === null) return
      await writeAuditEntry({
        entityApiName: entity,
        recordId: id,
        action: 'DELETE',
        before,
        after: null,
        userId: null,
        comment: 'purge_archived_records',
        skipRevisions: accountability === 'activity',
      })
    },
    delete: async () => {
      await hardDeleteRecord(entity, id, SYSTEM_RECORD_ACCESS)
    },
  })
}

export async function purgeArchivedRecords(
  params: Record<string, unknown>,
): Promise<PurgeArchivedRecordsResult> {
  const retentionDays = positiveInt(
    params.retentionDays,
    PURGE_ARCHIVED_DEFAULT_RETENTION_DAYS,
    3650,
  )
  const limitPerEntity = positiveInt(
    params.limitPerEntity,
    PURGE_ARCHIVED_DEFAULT_LIMIT_PER_ENTITY,
    2000,
  )
  const dryRun = params.dryRun === true
  const allow = stringList(params.entities)
  const deny = new Set(stringList(params.excludeEntities))

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)
  const cutoffIso = cutoff.toISOString()

  const entities = await listPurgeableEntities(allow, deny)
  const result: PurgeArchivedRecordsResult = {
    retentionDays,
    cutoffIso,
    dryRun,
    entitiesScanned: 0,
    entitiesSkipped: 0,
    deleted: 0,
    failed: 0,
    candidates: 0,
    errors: [],
    byEntity: {},
  }

  for (const entity of entities) {
    let relation
    try {
      relation = await resolveRecordRelation(entity)
    } catch (error) {
      result.entitiesSkipped += 1
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${entity}: resolve failed — ${message}`)
      continue
    }

    const filter = archivedFilter(
      entity,
      relation.hasDeleted,
      relation.hasStatus,
      cutoffIso,
    )
    if (!filter) {
      result.entitiesSkipped += 1
      continue
    }

    result.entitiesScanned += 1
    const entityStats = { deleted: 0, failed: 0, candidates: 0 }
    result.byEntity[entity] = entityStats

    try {
      const page = await findManyRecords(entity, {
        filter,
        fields: ['id'],
        limit: limitPerEntity,
        offset: 0,
        includeDeleted: true,
        access: SYSTEM_RECORD_ACCESS,
      })
      entityStats.candidates = page.nodes.length
      result.candidates += page.nodes.length

      if (dryRun) continue

      for (const node of page.nodes) {
        const id = node.id == null ? '' : String(node.id)
        if (!id) continue
        try {
          await hardDeleteWithAudit(entity, id)
          entityStats.deleted += 1
          result.deleted += 1
        } catch (error) {
          entityStats.failed += 1
          result.failed += 1
          const message = error instanceof Error ? error.message : String(error)
          if (result.errors.length < 50) {
            result.errors.push(`${entity}/${id}: ${message}`)
          }
        }
      }
    } catch (error) {
      result.entitiesSkipped += 1
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${entity}: list failed — ${message}`)
    }
  }

  return result
}
