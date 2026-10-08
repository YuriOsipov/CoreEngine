import { query } from '../db/pool.js'
import { isRegistryPlatformEntity } from '../schema/platformEntities.js'
import {
  applyDdlActions,
  ddlActionsIndicateDrift,
  detectTypedTableDrift,
  planEntityDdlSync,
  summarizeDdlActions,
  type DdlAction,
} from '../schema/ddlSync.js'
import {
  applyUniqueIndexActions,
  planUniqueIndexActions,
} from '../schema/uniqueGroups.js'
import {
  planHasuraEntityDdl,
  syncHasuraEntityColumns,
} from '../adapters/records/backends/hasura/ddl.js'

export type SyncStatus = 'OK' | 'DRIFT' | 'ERROR' | 'PENDING'

export interface SchemaDriftItem {
  kind:
    | 'ENTITY_MISSING_IN_BACKEND'
    | 'FIELD_MISSING_IN_BACKEND'
    | 'FIELD_MISSING_IN_REGISTRY'
    | 'FIELD_TYPE_MISMATCH'
    | 'FIELD_CREATED'
    | 'ENTITY_CREATED'
    | 'RELATION_CREATED'
    | 'FIELD_SKIPPED'
  entityApiName: string
  fieldApiName?: string
  registryValue?: string | null
  backendValue?: string | null
  message: string
}

export interface EntityDriftReport {
  entityId: string
  entityApiName: string
  backendTarget: string
  status: SyncStatus
  drift: SchemaDriftItem[]
}

export interface EntitySyncStateRow {
  entityId: string
  entityApiName: string
  lastSyncedVersion: number | null
  lastSyncedAt: string | null
  status: SyncStatus
  lastError: string | null
  backendSnapshot: Record<string, unknown>
  updatedAt: string
}

export interface SyncJobRow {
  id: string
  entityId: string | null
  jobType: string
  status: string
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

async function loadRegistryEntities(entityApiName?: string | null) {
  return query<{
    id: string
    api_name: string
    backend_target: string
    sync_version: number
    backend_config: unknown
  }>(
    `SELECT
       id::text AS id,
       api_name,
       backend_target,
       sync_version,
       backend_config
     FROM public.entities
     WHERE deleted_at IS NULL
       AND ($1::text IS NULL OR api_name = $1)
     ORDER BY api_name ASC`,
    [entityApiName ?? null],
  )
}

async function upsertSyncState(report: EntityDriftReport, syncVersion: number): Promise<void> {
  await query(
    `INSERT INTO public.entity_sync_state (
       entity_id, last_synced_version, last_synced_at, status, last_error, backend_snapshot
     ) VALUES (
       $1::uuid, $2, now(), $3, $4, $5::jsonb
     )
     ON CONFLICT (entity_id) DO UPDATE SET
       last_synced_version = EXCLUDED.last_synced_version,
       last_synced_at = EXCLUDED.last_synced_at,
       status = EXCLUDED.status,
       last_error = EXCLUDED.last_error,
       backend_snapshot = EXCLUDED.backend_snapshot,
       updated_at = now()`,
    [
      report.entityId,
      syncVersion,
      report.status,
      report.status === 'ERROR'
        ? report.drift.map((item) => item.message).join('; ') || 'error'
        : null,
      JSON.stringify({
        backendTarget: report.backendTarget,
        drift: report.drift,
      }),
    ],
  )
}

function mapJob(row: Record<string, unknown>): SyncJobRow {
  return {
    id: String(row.id),
    entityId: row.entity_id == null ? null : String(row.entity_id),
    jobType: String(row.job_type),
    status: String(row.status),
    payload: (row.payload as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown>) ?? null,
    error: row.error == null ? null : String(row.error),
    startedAt:
      row.started_at == null
        ? null
        : row.started_at instanceof Date
          ? row.started_at.toISOString()
          : String(row.started_at),
    finishedAt:
      row.finished_at == null
        ? null
        : row.finished_at instanceof Date
          ? row.finished_at.toISOString()
          : String(row.finished_at),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  }
}

function serializeDdlActions(actions: DdlAction[]) {
  return summarizeDdlActions(actions).map((a) => ({
    type: a.type,
    fieldApiName: a.fieldApiName ?? null,
    message: a.message,
    sql: a.sql,
  }))
}

/**
 * Compare registry promoted fields to crm_schema physical columns (SUPABASE typed).
 * PLATFORM entities report OK (dedicated tables). JSONB opt-out reports informational drift.
 */
export async function detectSchemaDrift(options?: {
  entityApiName?: string | null
}): Promise<EntityDriftReport[]> {
  const entities = await loadRegistryEntities(options?.entityApiName)
  const reports: EntityDriftReport[] = []

  for (const entity of entities) {
    if (
      entity.backend_target === 'PLATFORM' ||
      entity.backend_target === 'DIRECTUS' ||
      isRegistryPlatformEntity(entity.api_name)
    ) {
      reports.push({
        entityId: entity.id,
        entityApiName: entity.api_name,
        backendTarget: entity.backend_target,
        status: 'OK',
        drift: [],
      })
      continue
    }

    // HASURA: rows live on Hasura's Postgres source (often a separate DB from BFF).
    if (entity.backend_target === 'HASURA') {
      try {
        const hasuraActions = await planHasuraEntityDdl(entity.api_name)
        const items: SchemaDriftItem[] = hasuraActions
          .filter((a) => a.type === 'ADD_COLUMN')
          .map((a) => ({
            kind: 'FIELD_MISSING_IN_BACKEND' as const,
            entityApiName: entity.api_name,
            fieldApiName: a.fieldApiName,
            message: a.message,
          }))
        const status: SyncStatus = items.length ? 'DRIFT' : 'OK'
        const report: EntityDriftReport = {
          entityId: entity.id,
          entityApiName: entity.api_name,
          backendTarget: entity.backend_target,
          status,
          drift: items,
        }
        reports.push(report)
        await upsertSyncState(report, entity.sync_version)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const report: EntityDriftReport = {
          entityId: entity.id,
          entityApiName: entity.api_name,
          backendTarget: entity.backend_target,
          status: 'ERROR',
          drift: [
            {
              kind: 'ENTITY_MISSING_IN_BACKEND',
              entityApiName: entity.api_name,
              message: `Hasura drift check failed: ${message}`,
            },
          ],
        }
        reports.push(report)
        await upsertSyncState(report, entity.sync_version)
      }
      continue
    }

    if (entity.backend_target !== 'SUPABASE') {
      reports.push({
        entityId: entity.id,
        entityApiName: entity.api_name,
        backendTarget: entity.backend_target,
        status: 'ERROR',
        drift: [
          {
            kind: 'ENTITY_MISSING_IN_BACKEND',
            entityApiName: entity.api_name,
            message: `Unsupported backend_target=${entity.backend_target}`,
          },
        ],
      })
      continue
    }

    try {
      const drift = await detectTypedTableDrift(
        entity.api_name,
        entity.backend_config,
      )
      const uniqueActions = await planUniqueIndexActions(entity.api_name)
      const ddlActions = await planEntityDdlSync(entity.api_name, {
        includeFk: true,
        includeBackfill: true,
      })
      const hasUniqueDrift = uniqueActions.some((a) => a.type === 'CREATE_UNIQUE_INDEX')
      const hasDdlDrift = ddlActionsIndicateDrift(ddlActions)
      const status: SyncStatus =
        drift.length || hasUniqueDrift || hasDdlDrift ? 'DRIFT' : 'OK'

      const items: SchemaDriftItem[] = [
        ...drift.map((d) => ({
          kind: d.kind,
          entityApiName: d.entityApiName,
          fieldApiName: d.fieldApiName,
          registryValue: d.registryValue,
          backendValue: d.backendValue,
          message: d.message,
        })),
      ]
      for (const action of summarizeDdlActions(ddlActions)) {
        if (action.type === 'ADD_COLUMN') {
          items.push({
            kind: 'FIELD_MISSING_IN_BACKEND',
            entityApiName: entity.api_name,
            fieldApiName: action.fieldApiName,
            message: action.message,
          })
        } else if (action.type === 'CREATE_TABLE') {
          items.push({
            kind: 'ENTITY_MISSING_IN_BACKEND',
            entityApiName: entity.api_name,
            message: action.message,
          })
        } else if (action.type === 'CREATE_FK' && !action.sql.trim().startsWith('--')) {
          items.push({
            kind: 'RELATION_CREATED',
            entityApiName: entity.api_name,
            fieldApiName: action.fieldApiName,
            message: action.message,
          })
        } else if (
          action.type === 'CREATE_INDEX' ||
          action.type === 'COERCE_FK_TEXT' ||
          action.type === 'BACKFILL_COLUMN'
        ) {
          items.push({
            kind: 'FIELD_CREATED',
            entityApiName: entity.api_name,
            fieldApiName: action.fieldApiName,
            message: action.message,
          })
        }
      }
      for (const action of uniqueActions) {
        if (action.type !== 'CREATE_UNIQUE_INDEX') continue
        items.push({
          kind: 'FIELD_CREATED',
          entityApiName: entity.api_name,
          message: `Unique index pending: ${action.indexName}`,
        })
      }

      // De-dupe FIELD_MISSING from both detectTypedTableDrift and ADD_COLUMN plan.
      const seen = new Set<string>()
      const deduped = items.filter((item) => {
        const key = `${item.kind}:${item.fieldApiName ?? ''}:${item.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      reports.push({
        entityId: entity.id,
        entityApiName: entity.api_name,
        backendTarget: entity.backend_target,
        status,
        drift: deduped,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reports.push({
        entityId: entity.id,
        entityApiName: entity.api_name,
        backendTarget: entity.backend_target,
        status: 'ERROR',
        drift: [
          {
            kind: 'ENTITY_MISSING_IN_BACKEND',
            entityApiName: entity.api_name,
            message,
          },
        ],
      })
    }
  }

  return reports
}

export async function runSchemaDriftCheck(options?: {
  entityApiName?: string | null
}): Promise<SyncJobRow> {
  const created = await query<{ id: string }>(
    `INSERT INTO public.sync_jobs (entity_id, job_type, status, payload, started_at)
     VALUES (
       (SELECT id FROM public.entities WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1),
       'DETECT_DRIFT',
       'RUNNING',
       $2::jsonb,
       now()
     )
     RETURNING id::text AS id`,
    [
      options?.entityApiName ?? null,
      JSON.stringify({ entityApiName: options?.entityApiName ?? null }),
    ],
  )
  const jobId = created[0]?.id
  if (!jobId) throw new Error('Failed to create sync job')

  try {
    const reports = await detectSchemaDrift({
      entityApiName: options?.entityApiName,
    })
    const entities = await loadRegistryEntities(options?.entityApiName)
    const versionById = new Map(entities.map((row) => [row.id, row.sync_version]))
    for (const report of reports) {
      await upsertSyncState(report, versionById.get(report.entityId) ?? 1)
    }

    const summary = {
      entityCount: reports.length,
      okCount: reports.filter((row) => row.status === 'OK').length,
      driftCount: reports.filter((row) => row.status === 'DRIFT').length,
      errorCount: reports.filter((row) => row.status === 'ERROR').length,
      message:
        'Compared registry promoted fields to crm_schema columns (+ unique indexes)',
      reports: reports.map((row) => ({
        entityApiName: row.entityApiName,
        status: row.status,
        driftCount: row.drift.length,
      })),
    }

    const updated = await query(
      `UPDATE public.sync_jobs
       SET status = 'SUCCEEDED',
           result = $2::jsonb,
           finished_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [jobId, JSON.stringify(summary)],
    )
    return mapJob(updated[0]!)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const updated = await query(
      `UPDATE public.sync_jobs
       SET status = 'FAILED',
           error = $2,
           finished_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [jobId, message],
    )
    return mapJob(updated[0]!)
  }
}

/**
 * Apply (or dry-run) registry → crm_schema DDL + unique indexes for one entity.
 */
export async function runSchemaSync(options: {
  entityApiName: string
  dryRun?: boolean
}): Promise<SyncJobRow> {
  const entityApiName = options.entityApiName.trim()
  if (!entityApiName) throw new Error('entityApiName is required for SYNC_ENTITY')
  const dryRun = options.dryRun !== false

  const created = await query<{ id: string }>(
    `INSERT INTO public.sync_jobs (entity_id, job_type, status, payload, started_at)
     VALUES (
       (SELECT id FROM public.entities WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1),
       'SYNC_ENTITY',
       'RUNNING',
       $2::jsonb,
       now()
     )
     RETURNING id::text AS id`,
    [entityApiName, JSON.stringify({ entityApiName, dryRun })],
  )
  const jobId = created[0]?.id
  if (!jobId) throw new Error('Failed to create sync job')

  try {
    const entities = await loadRegistryEntities(entityApiName)
    const entity = entities[0]
    if (!entity) throw new Error(`Entity not found in registry: ${entityApiName}`)

    if (entity.backend_target === 'PLATFORM' || isRegistryPlatformEntity(entity.api_name)) {
      const updated = await query(
        `UPDATE public.sync_jobs
         SET status = 'SUCCEEDED',
             result = $2::jsonb,
             finished_at = now()
         WHERE id = $1::uuid
         RETURNING *`,
        [
          jobId,
          JSON.stringify({
            dryRun,
            message: 'PLATFORM backend — dedicated registry tables; no crm_schema DDL',
            actions: [],
            ddlActions: [],
          }),
        ],
      )
      return mapJob(updated[0]!)
    }

    if (entity.backend_target === 'DIRECTUS') {
      const updated = await query(
        `UPDATE public.sync_jobs
         SET status = 'SUCCEEDED',
             result = $2::jsonb,
             finished_at = now()
         WHERE id = $1::uuid
         RETURNING *`,
        [
          jobId,
          JSON.stringify({
            dryRun,
            message:
              'DIRECTUS backend — production rows via Directus GraphQL; no local crm_schema DDL',
            actions: [],
            ddlActions: [],
          }),
        ],
      )
      return mapJob(updated[0]!)
    }

    if (entity.backend_target === 'HASURA') {
      const hasuraSync = await syncHasuraEntityColumns(entityApiName, { dryRun })
      await upsertSyncState(
        {
          entityId: entity.id,
          entityApiName: entity.api_name,
          backendTarget: entity.backend_target,
          status: hasuraSync.errors.length ? 'ERROR' : 'OK',
          drift: hasuraSync.errors.map((e) => ({
            kind: 'FIELD_MISSING_IN_BACKEND' as const,
            entityApiName: entity.api_name,
            fieldApiName: e.field,
            message: e.error,
          })),
        },
        entity.sync_version,
      )
      const message = dryRun
        ? `Hasura dry-run: ${hasuraSync.actions.length} DDL action(s)`
        : `Hasura applied: ${hasuraSync.applied} statement(s)` +
          (hasuraSync.reloaded ? '; metadata reloaded' : '') +
          (hasuraSync.errors.length
            ? `; ${hasuraSync.errors.length} error(s)`
            : '')
      const updated = await query(
        `UPDATE public.sync_jobs
         SET status = 'SUCCEEDED',
             result = $2::jsonb,
             error = NULL,
             finished_at = now()
         WHERE id = $1::uuid
         RETURNING *`,
        [
          jobId,
          JSON.stringify({
            dryRun,
            message,
            ddlActions: hasuraSync.actions.map((a) => ({
              type: a.type,
              fieldApiName: a.fieldApiName ?? null,
              message: a.message,
              sql: a.sql,
            })),
            apply: {
              applied: hasuraSync.applied,
              errors: hasuraSync.errors,
              reloaded: hasuraSync.reloaded,
            },
          }),
        ],
      )
      return mapJob(updated[0]!)
    }

    if (entity.backend_target !== 'SUPABASE') {
      const message = `Unsupported backend_target=${entity.backend_target}; set entity to SUPABASE, HASURA, DIRECTUS, or PLATFORM`
      const updated = await query(
        `UPDATE public.sync_jobs
         SET status = 'FAILED',
             result = $2::jsonb,
             error = $3,
             finished_at = now()
         WHERE id = $1::uuid
         RETURNING *`,
        [jobId, JSON.stringify({ dryRun, message }), message],
      )
      return mapJob(updated[0]!)
    }

    const ddlActions = await planEntityDdlSync(entityApiName, {
      includeFk: true,
      includeBackfill: true,
    })
    const uniqueActions = await planUniqueIndexActions(entityApiName)

    let applyResult: {
      applied: number
      skipped: number
      errors: Array<{ action: DdlAction; error: string }>
    } | null = null

    if (!dryRun) {
      applyResult = await applyDdlActions(ddlActions)
      if (uniqueActions.length) {
        await applyUniqueIndexActions(uniqueActions)
      }
      await upsertSyncState(
        {
          entityId: entity.id,
          entityApiName: entity.api_name,
          backendTarget: entity.backend_target,
          status: 'OK',
          drift: [],
        },
        entity.sync_version,
      )
    }

    const meaningful = summarizeDdlActions(ddlActions)
    const message = dryRun
      ? `Dry-run: ${meaningful.length} DDL action(s), ${uniqueActions.length} unique-index action(s)`
      : `Applied: ${applyResult?.applied ?? 0} DDL statement(s), ${uniqueActions.length} unique-index action(s)` +
        (applyResult?.errors.length
          ? `; ${applyResult.errors.length} FK warning(s)`
          : '')

    const updated = await query(
      `UPDATE public.sync_jobs
       SET status = 'SUCCEEDED',
           result = $2::jsonb,
           error = NULL,
           finished_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [
        jobId,
        JSON.stringify({
          dryRun,
          message,
          ddlActions: serializeDdlActions(ddlActions),
          actions: uniqueActions.map((a) => ({
            type: a.type,
            indexName: a.indexName,
            fields: a.group?.fields ?? null,
            sql: a.sql,
          })),
          apply: applyResult
            ? {
                applied: applyResult.applied,
                skipped: applyResult.skipped,
                fkErrors: applyResult.errors.map((e) => ({
                  field: e.action.fieldApiName,
                  error: e.error,
                })),
              }
            : null,
        }),
      ],
    )
    return mapJob(updated[0]!)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const updated = await query(
      `UPDATE public.sync_jobs
       SET status = 'FAILED',
           error = $2,
           finished_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [jobId, message],
    )
    return mapJob(updated[0]!)
  }
}

export async function listEntitySyncStates(): Promise<EntitySyncStateRow[]> {
  const rows = await query(
    `SELECT
       s.entity_id::text AS entity_id,
       e.api_name AS entity_api_name,
       s.last_synced_version,
       s.last_synced_at,
       s.status,
       s.last_error,
       s.backend_snapshot,
       s.updated_at
     FROM public.entity_sync_state s
     JOIN public.entities e ON e.id = s.entity_id
     WHERE e.deleted_at IS NULL
     ORDER BY e.api_name ASC`,
  )

  return rows.map((row) => ({
    entityId: String(row.entity_id),
    entityApiName: String(row.entity_api_name),
    lastSyncedVersion:
      row.last_synced_version == null ? null : Number(row.last_synced_version),
    lastSyncedAt:
      row.last_synced_at == null
        ? null
        : row.last_synced_at instanceof Date
          ? row.last_synced_at.toISOString()
          : String(row.last_synced_at),
    status: String(row.status) as SyncStatus,
    lastError: row.last_error == null ? null : String(row.last_error),
    backendSnapshot: (row.backend_snapshot as Record<string, unknown>) ?? {},
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  }))
}

export async function listSyncJobs(limit = 20): Promise<SyncJobRow[]> {
  const rows = await query(
    `SELECT *
     FROM public.sync_jobs
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  )
  return rows.map((row) => mapJob(row))
}
