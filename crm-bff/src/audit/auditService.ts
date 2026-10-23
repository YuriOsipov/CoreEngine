import { query } from '../db/pool.js'

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'SOFT_DELETE'
  | 'DELETE'
  | 'RESTORE'
  | 'RESTORE_REVISION'

export interface AuditActivityRow {
  id: string
  entityApiName: string
  recordId: string
  action: AuditAction
  userId: string | null
  comment: string | null
  createdAt: string
  revisionIds: string[]
}

export interface AuditRevisionRow {
  id: string
  activityId: string | null
  entityApiName: string
  recordId: string
  snapshot: Record<string, unknown>
  parentRevisionId: string | null
  createdAt: string
}

export async function writeAuditEntry(options: {
  entityApiName: string
  recordId: string
  action: AuditAction
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  userId?: string | null
  comment?: string | null
  /** When true, write activity only (no revision snapshot). */
  skipRevisions?: boolean
}): Promise<{ activityId: string; revisionId: string | null }> {
  const snapshot = options.after ?? options.before ?? {}
  const activityRows = await query<{ id: string }>(
    `INSERT INTO public.activities (
       entity_api_name, record_id, action, user_id, comment
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text AS id`,
    [
      options.entityApiName,
      options.recordId,
      options.action,
      options.userId ?? null,
      options.comment ?? null,
    ],
  )
  const activityId = activityRows[0]?.id
  if (!activityId) {
    throw new Error('Failed to write activity')
  }

  let revisionId: string | null = null
  if (
    !options.skipRevisions &&
    (options.action !== 'SOFT_DELETE' || options.before)
  ) {
    const parentRows = await query<{ id: string }>(
      `SELECT id::text AS id
       FROM public.revisions
       WHERE entity_api_name = $1 AND record_id = $2
       ORDER BY id DESC
       LIMIT 1`,
      [options.entityApiName, options.recordId],
    )
    const revisionRows = await query<{ id: string }>(
      `INSERT INTO public.revisions (
         activity_id, entity_api_name, record_id, snapshot, parent_revision_id
       ) VALUES ($1::bigint, $2, $3, $4::jsonb, $5::bigint)
       RETURNING id::text AS id`,
      [
        activityId,
        options.entityApiName,
        options.recordId,
        JSON.stringify(snapshot),
        parentRows[0]?.id ?? null,
      ],
    )
    revisionId = revisionRows[0]?.id ?? null
  }

  return { activityId, revisionId }
}

export async function listRecordActivities(options: {
  entityApiName: string
  recordId: string
  actions?: string[] | null
  limit?: number
  offset?: number
}): Promise<{ nodes: AuditActivityRow[]; totalCount: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
  const offset = Math.max(options.offset ?? 0, 0)
  const actions =
    options.actions?.filter((action) => typeof action === 'string' && action.trim()) ?? []

  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM public.activities a
     WHERE a.entity_api_name = $1
       AND a.record_id = $2
       AND (
         cardinality($3::text[]) = 0
         OR a.action = ANY($3::text[])
       )`,
    [options.entityApiName, options.recordId, actions],
  )
  const totalCount = Number(countRows[0]?.total ?? 0)

  const rows = await query<{
    id: string
    entity_api_name: string
    record_id: string
    action: AuditAction
    user_id: string | null
    comment: string | null
    created_at: Date | string
    revision_ids: string[] | null
  }>(
    `SELECT
       a.id::text AS id,
       a.entity_api_name,
       a.record_id,
       a.action,
       a.user_id::text AS user_id,
       a.comment,
       a.created_at,
       COALESCE(
         (
           SELECT array_agg(r.id::text ORDER BY r.id)
           FROM public.revisions r
           WHERE r.activity_id = a.id
         ),
         ARRAY[]::text[]
       ) AS revision_ids
     FROM public.activities a
     WHERE a.entity_api_name = $1
       AND a.record_id = $2
       AND (
         cardinality($3::text[]) = 0
         OR a.action = ANY($3::text[])
       )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $4 OFFSET $5`,
    [
      options.entityApiName,
      options.recordId,
      actions,
      limit,
      offset,
    ],
  )

  return {
    nodes: rows.map((row) => ({
      id: row.id,
      entityApiName: row.entity_api_name,
      recordId: row.record_id,
      action: row.action,
      userId: row.user_id,
      comment: row.comment,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      revisionIds: Array.isArray(row.revision_ids) ? row.revision_ids : [],
    })),
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
  }
}

export async function listRecordRevisions(options: {
  entityApiName: string
  recordId: string
  limit?: number
}): Promise<AuditRevisionRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000)
  const rows = await query<{
    id: string
    activity_id: string | null
    entity_api_name: string
    record_id: string
    snapshot: Record<string, unknown> | string
    parent_revision_id: string | null
    created_at: Date | string
  }>(
    `SELECT
       id::text AS id,
       activity_id::text AS activity_id,
       entity_api_name,
       record_id,
       snapshot,
       parent_revision_id::text AS parent_revision_id,
       created_at
     FROM public.revisions
     WHERE entity_api_name = $1
       AND record_id = $2
     ORDER BY id ASC
     LIMIT $3`,
    [options.entityApiName, options.recordId, limit],
  )

  return rows.map((row) => {
    const snapshot =
      typeof row.snapshot === 'string'
        ? (JSON.parse(row.snapshot) as Record<string, unknown>)
        : (row.snapshot ?? {})
    return {
      id: row.id,
      activityId: row.activity_id,
      entityApiName: row.entity_api_name,
      recordId: row.record_id,
      snapshot,
      parentRevisionId: row.parent_revision_id,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    }
  })
}
