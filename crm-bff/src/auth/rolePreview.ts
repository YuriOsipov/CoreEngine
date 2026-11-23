/**
 * Admin "View as role" preview for API enforcement.
 *
 * Real admins may send `X-Role-Preview: <app_role_id>` (or `__default_role__`).
 * Record / schema ACL then uses that role instead of admin bypass. GraphQL `me`
 * and Setup admin guards must not apply this — the session stays admin for UI
 * chrome / Setup, while `rolePreviewActorId` exposes the effective RLS actor.
 *
 * Owner RLS, object ACL, and field security use the previewed identity:
 * `me.id` becomes a sample active user of that role (or a deny sentinel when
 * none exist). Created By / Last Modified By and activity-log rows use the
 * real admin via `auditActorId` / `actorIdFromMe`.
 */
import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'

export const ROLE_PREVIEW_HEADER = 'x-role-preview'
export const ROLE_PREVIEW_DEFAULT = '__default_role__'

/** Owner / share filters never match this id — used when no sample user exists. */
export const ROLE_PREVIEW_NO_USER_ID = '__role_preview_no_user__'

export type AuthContextWithPreview = {
  authorization: string | null
  rolePreview?: string | null
}

export function readRolePreviewHeader(
  headers: Record<string, unknown> | undefined | null,
): string | null {
  if (!headers) return null
  const raw = headers[ROLE_PREVIEW_HEADER] ?? headers['X-Role-Preview']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isAdmin(me: MeUser): boolean {
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

/**
 * Prefer `auditActorId` when set (real admin session id); else `me.id`.
 * Use for Created By / Last Modified By and GraphQL activity-log `userId`.
 */
export function actorIdFromMe(
  me: { id?: string | null; auditActorId?: string | null } | null | undefined,
): string | null {
  const audit =
    typeof me?.auditActorId === 'string' ? me.auditActorId.trim() : ''
  if (audit) return audit
  const id = typeof me?.id === 'string' ? me.id.trim() : ''
  return id || null
}

/**
 * Preview sample user id under View-as-role (`me.id`). Used for Owner RLS /
 * `$CURRENT_USER` simulation — not for Created By (use {@link actorIdFromMe}).
 */
export function effectiveActorIdFromMe(
  me: { id?: string | null; auditActorId?: string | null } | null | undefined,
): string | null {
  const id = typeof me?.id === 'string' ? me.id.trim() : ''
  if (id && id !== ROLE_PREVIEW_NO_USER_ID) return id
  return actorIdFromMe(me)
}

async function loadPreviewRole(roleRef: string): Promise<{
  id: string
  name: string | null
  isAdmin: boolean
  canAuthorReports: boolean
} | null> {
  const rows = await query<{
    id: string
    name: string | null
    is_admin: boolean
    can_author_reports: boolean
  }>(
    `SELECT id::text AS id,
            name,
            COALESCE(is_admin, false) AS is_admin,
            COALESCE(can_author_reports, false) AS can_author_reports
     FROM public.app_roles
     WHERE id::text = $1 OR backend_role_id = $1
     LIMIT 1`,
    [roleRef],
  )
  const row = rows[0]
  if (!row?.id) return null
  const isAdmin = Boolean(row.is_admin)
  return {
    id: row.id,
    name: row.name?.trim() || null,
    isAdmin,
    canAuthorReports: isAdmin || Boolean(row.can_author_reports),
  }
}

type PreviewActor = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
}

/**
 * Pick an active user with this role for Owner RLS / $CURRENT_USER simulation.
 * Prefers someone other than the admin session actor when possible.
 */
async function loadSampleUserForRole(
  roleId: string,
  preferNotActorId: string | null,
): Promise<PreviewActor | null> {
  const rows = await query<{
    actor_id: string
    first_name: string | null
    last_name: string | null
    email: string | null
  }>(
    `SELECT COALESCE(NULLIF(u.backend_user_id, ''), u.id::text) AS actor_id,
            u.first_name,
            u.last_name,
            u.email
     FROM public.app_users u
     WHERE u.role_id::text = $1
       AND COALESCE(u.is_active, true) = true
       AND u.backend_user_id IS NOT NULL
       AND NULLIF(TRIM(u.backend_user_id), '') IS NOT NULL
     ORDER BY
       CASE
         WHEN $2::text IS NOT NULL
          AND COALESCE(NULLIF(u.backend_user_id, ''), u.id::text) = $2::text
         THEN 1
         ELSE 0
       END,
       LOWER(COALESCE(u.email, '')),
       u.id::text
     LIMIT 1`,
    [roleId, preferNotActorId],
  )
  const row = rows[0]
  const id = row?.actor_id?.trim()
  if (!id) return null
  return {
    id,
    firstName: row.first_name?.trim() || null,
    lastName: row.last_name?.trim() || null,
    email: row.email?.trim() || null,
  }
}

function withAuditActor(me: MeUser, next: MeUser): MeUser {
  const sessionId =
    typeof me.auditActorId === 'string' && me.auditActorId.trim()
      ? me.auditActorId.trim()
      : typeof me.id === 'string' && me.id.trim()
        ? me.id.trim()
        : null
  return {
    ...next,
    auditActorId: sessionId,
  }
}

/**
 * Strip admin bypass, bind `roleId`, and adopt a sample user id for Owner RLS.
 * Non-admins cannot escalate via the header (ignored).
 */
export async function applyRolePreview(
  me: MeUser,
  rolePreview: string | null | undefined,
): Promise<MeUser> {
  const raw = typeof rolePreview === 'string' ? rolePreview.trim() : ''
  if (!raw) return me
  if (!isAdmin(me)) return me

  const sessionId =
    typeof me.id === 'string' && me.id.trim() ? me.id.trim() : null

  if (raw === ROLE_PREVIEW_DEFAULT) {
    return withAuditActor(me, {
      ...me,
      id: ROLE_PREVIEW_NO_USER_ID,
      adminAccess: false,
      roleAdminAccess: false,
      canAuthorReports: false,
      roleId: null,
      roleName: null,
    })
  }

  const role = await loadPreviewRole(raw)
  if (!role) {
    throw new Error(`Invalid role preview: ${raw}`)
  }

  const sample = role.isAdmin
    ? null
    : await loadSampleUserForRole(role.id, sessionId)

  const actorId = sample?.id || (role.isAdmin ? sessionId : ROLE_PREVIEW_NO_USER_ID)

  return withAuditActor(me, {
    ...me,
    id: actorId || ROLE_PREVIEW_NO_USER_ID,
    firstName: sample?.firstName ?? me.firstName,
    lastName: sample?.lastName ?? me.lastName,
    email: sample?.email ?? me.email,
    adminAccess: false,
    roleAdminAccess: role.isAdmin,
    canAuthorReports: role.canAuthorReports,
    roleId: role.id,
    roleName: role.name,
  })
}
