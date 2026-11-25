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

/** Mirror activity-log UI: stamps / ephemeral keys never count as field deltas. */
const HIDDEN_AUDIT_FIELDS = new Set([
  'id',
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
  'created_at',
  'updated_at',
  // Storage envelope — not business fields on the Path / form surface.
  'status',
  'is_active',
  'is_deleted',
])

function relationRecordId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  if (typeof id === 'string' && id.trim()) return id.trim()
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return null
}

function normalizeAuditValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null

  // Expanded M2O → stable id token (scalar FKs stay plain strings; equality
  // below matches them to this token).
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'id' in (value as object)
  ) {
    const relationId = relationRecordId(value)
    if (relationId !== null) return `id:${relationId}`
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parsed = Date.parse(trimmed)
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
    }
    return trimmed
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value.map((item) => normalizeAuditValue(item))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(record).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (key.startsWith('_')) continue
      normalized[key] = normalizeAuditValue(nested)
    }
    return normalized
  }

  return String(value)
}

function auditValuesEqual(left: unknown, right: unknown): boolean {
  const leftId = relationRecordId(left)
  const rightId = relationRecordId(right)
  if (leftId !== null && rightId !== null && leftId === rightId) {
    const leftExpanded =
      typeof left === 'object' && left !== null && !Array.isArray(left)
    const rightExpanded =
      typeof right === 'object' && right !== null && !Array.isArray(right)
    // Scalar FK vs expanded `{ id }` (or both expanded) → same relation.
    if (leftExpanded || rightExpanded) return true
  }

  const normalizedLeft = normalizeAuditValue(left)
  const normalizedRight = normalizeAuditValue(right)
  if (normalizedLeft === normalizedRight) return true
  if (
    typeof normalizedLeft === 'object' &&
    normalizedLeft !== null &&
    typeof normalizedRight === 'object' &&
    normalizedRight !== null
  ) {
    try {
      return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
    } catch {
      return false
    }
  }
  return false
}

/** Strip ephemeral keys (`__automationToasts`, etc.) before persisting snapshots. */
export function cleanAuditSnapshot(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!key || key.startsWith('_')) continue
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

export function hasVisibleAuditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): boolean {
  const previous = cleanAuditSnapshot(before)
  const next = cleanAuditSnapshot(after)
  const fields = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const field of fields) {
    if (HIDDEN_AUDIT_FIELDS.has(field) || field.startsWith('_')) continue
    if (!auditValuesEqual(previous[field], next[field])) return true
  }
  return false
}

function hasComparableAuditSnapshot(
  data: Record<string, unknown> | null | undefined,
): boolean {
  const snapshot = cleanAuditSnapshot(data)
  return Object.keys(snapshot).some(
    (field) => !HIDDEN_AUDIT_FIELDS.has(field) && !field.startsWith('_'),
  )
}

/**
 * Activity diffs parent revision vs after. The parent must match the mutation
 * `before` snapshot — a sparse parent that merely differs from `after` produces
 * phantom field additions (owner/amount/close_date appearing as — → value).
 */
export function shouldSeedBeforeRevisionParent(options: {
  parentSnapshot: Record<string, unknown> | null
  beforeSnapshot: Record<string, unknown>
}): boolean {
  const beforeAlreadyStored =
    options.parentSnapshot != null &&
    hasComparableAuditSnapshot(options.parentSnapshot) &&
    !hasVisibleAuditChanges(options.beforeSnapshot, options.parentSnapshot)
  return !beforeAlreadyStored
}

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (value == null) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
    return {}
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function insertRevision(options: {
  activityId: string | null
  entityApiName: string
  recordId: string
  snapshot: Record<string, unknown>
  parentRevisionId: string | null
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO public.revisions (
       activity_id, entity_api_name, record_id, snapshot, parent_revision_id
     ) VALUES ($1::bigint, $2, $3, $4::jsonb, $5::bigint)
     RETURNING id::text AS id`,
    [
      options.activityId,
      options.entityApiName,
      options.recordId,
      JSON.stringify(options.snapshot),
      options.parentRevisionId,
    ],
  )
  const id = rows[0]?.id
  if (!id) throw new Error('Failed to write revision')
  return id
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
}): Promise<{ activityId: string | null; revisionId: string | null }> {
  const afterSnapshot = cleanAuditSnapshot(options.after ?? options.before ?? {})
  const beforeSnapshot = options.before ? cleanAuditSnapshot(options.before) : null

  // Stamp-only / identical writes (common for on-open automations) must not
  // create empty "Record updated" rows with no field-level deltas.
  if (
    options.action === 'UPDATE' &&
    beforeSnapshot &&
    !hasVisibleAuditChanges(beforeSnapshot, afterSnapshot)
  ) {
    return { activityId: null, revisionId: null }
  }

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
    const parentRows = await query<{
      id: string
      snapshot: Record<string, unknown> | string | null
    }>(
      `SELECT id::text AS id, snapshot
       FROM public.revisions
       WHERE entity_api_name = $1 AND record_id = $2
       ORDER BY id DESC
       LIMIT 1`,
      [options.entityApiName, options.recordId],
    )

    let parentRevisionId = parentRows[0]?.id ?? null
    const parentSnapshot = parentRows[0]
      ? cleanAuditSnapshot(parseSnapshot(parentRows[0].snapshot))
      : null

    // Seed a before-snapshot parent whenever the latest revision is not the
    // mutation `before`. Do not treat "differs from after" as usable — sparse
    // parents inflate Activity with false field changes.
    if (
      options.action === 'UPDATE' &&
      beforeSnapshot &&
      hasVisibleAuditChanges(beforeSnapshot, afterSnapshot) &&
      shouldSeedBeforeRevisionParent({ parentSnapshot, beforeSnapshot })
    ) {
      parentRevisionId = await insertRevision({
        activityId: null,
        entityApiName: options.entityApiName,
        recordId: options.recordId,
        snapshot: beforeSnapshot,
        parentRevisionId,
      })
    }

    revisionId = await insertRevision({
      activityId,
      entityApiName: options.entityApiName,
      recordId: options.recordId,
      snapshot: afterSnapshot,
      parentRevisionId,
    })
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
