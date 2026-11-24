/**
 * Parent-owner inheritance for child creates (Salesforce-style master-detail).
 * Opt-in via `backend_config.inheritOwnerFrom` = M2O field api_name.
 *
 * Trusted callers (system, admin, Modify all on the entity) may also pass
 * `owner_id` on create (e.g. n8n Integration creating `incoming_message` for
 * `to_user`). Clients without that privilege still have `owner_id` stripped.
 *
 * Applied owner ids must be an active `app_users` row (`is_active`, matched on
 * `backend_user_id` or id). The stored value is `backend_user_id` — the same
 * id Owner RLS compares to `me.id`. On update, a caller who may not reassign
 * gets `Permission denied` instead of a silent no-op.
 */
import { fkIdFromValue, loadM2ORelations } from '../adapters/records/relations.js'
import { resolveRecordsStore } from '../adapters/records/registry.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { isSystemRecordAccess } from '../adapters/records/types.js'
import { query } from '../db/pool.js'
import { resolveRoleOwnerBypass } from './rolePermissions.js'
import {
  isAdminMe,
  readRecordOwnerId,
  resolveInheritOwnerFrom,
  ROW_OWNER_FIELD,
} from './rowLevelSecurity.js'

/** Returned when Change Owner targets a missing, inactive, or unknown user. */
export const ACTIVE_OWNER_REQUIRED = 'Owner must be an active user'

/** Returned when the caller may not change `owner_id` on update. */
export const OWNER_REASSIGN_DENIED = 'Permission denied'

/** True when the caller may set `owner_id` on create (admin / system / Modify all). */
export async function canAssignOwnerOnCreate(
  access: RecordAccess,
  entityApiName: string,
): Promise<boolean> {
  if (isSystemRecordAccess(access)) return true
  const me = access.me
  if (!me) return false
  if (isAdminMe(me)) return true
  const scope = await resolveRoleOwnerBypass(me, entityApiName)
  return scope.modifyAll
}

/**
 * True when the caller may reassign `owner_id` on update.
 * Same trusted callers as create, plus the **current owner** (so a departing
 * rep can hand off their book before deactivate; managers use Modify all).
 */
export async function canAssignOwnerOnUpdate(
  access: RecordAccess,
  entityApiName: string,
  existingOwnerId?: string | null,
): Promise<boolean> {
  if (await canAssignOwnerOnCreate(access, entityApiName)) return true
  const meId =
    typeof access.me?.id === 'string' ? access.me.id.trim() : ''
  const owner =
    typeof existingOwnerId === 'string' ? existingOwnerId.trim() : ''
  return Boolean(meId && owner && meId === owner)
}

/**
 * `backend_user_id` for an active app user addressed by that id or by
 * `app_users.id`. Missing, inactive, and unknown ids return null.
 */
export async function resolveActiveOwnerId(
  requestedOwnerId: string,
): Promise<string | null> {
  const id = requestedOwnerId.trim()
  if (!id) return null
  const rows = await query<{ actor_id: string | null }>(
    `SELECT TRIM(u.backend_user_id) AS actor_id
     FROM public.app_users u
     WHERE u.is_active = true
       AND NULLIF(TRIM(u.backend_user_id), '') IS NOT NULL
       AND (
         TRIM(u.backend_user_id) = $1
         OR u.id::text = $1
       )
     ORDER BY CASE WHEN TRIM(u.backend_user_id) = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [id],
  )
  const actor = typeof rows[0]?.actor_id === 'string' ? rows[0].actor_id.trim() : ''
  return actor || null
}

/** Active-user owner id, or {@link ACTIVE_OWNER_REQUIRED}. */
export async function assertActiveOwnerId(requestedOwnerId: string): Promise<string> {
  const actor = await resolveActiveOwnerId(requestedOwnerId)
  if (!actor) throw new Error(ACTIVE_OWNER_REQUIRED)
  return actor
}

/**
 * Owner id to persist on update, or null when `owner_id` was omitted or unchanged.
 * Unauthorized changes throw {@link OWNER_REASSIGN_DENIED}. A real change must
 * name an active app user.
 */
export async function resolveOwnerReassignment(
  access: RecordAccess,
  entityApiName: string,
  existingOwnerId: string | null | undefined,
  requestedOwnerId: string | null | undefined,
): Promise<string | null> {
  const requested =
    typeof requestedOwnerId === 'string' ? requestedOwnerId.trim() : ''
  if (!requested) return null
  const existing =
    typeof existingOwnerId === 'string' ? existingOwnerId.trim() : ''
  if (requested === existing) return null
  const allowed = await canAssignOwnerOnUpdate(
    access,
    entityApiName,
    existing || null,
  )
  if (!allowed) throw new Error(OWNER_REASSIGN_DENIED)
  return assertActiveOwnerId(requested)
}

/**
 * Resolve `owner_id` for a new row: parent owner's id when inheritance is
 * configured and the parent FK is present; otherwise the creating actor.
 * Does not change audit `user_created` (stamped separately as the actor).
 */
export async function resolveCreateOwnerId(
  entityApiName: string,
  data: Record<string, unknown>,
  actorUserId?: string | null,
): Promise<string> {
  const actor =
    typeof actorUserId === 'string' && actorUserId.trim()
      ? actorUserId.trim()
      : ''
  const parentField = await resolveInheritOwnerFrom(entityApiName)
  if (!parentField) return actor
  const parentId = fkIdFromValue(data[parentField])
  if (!parentId) return actor
  const rels = await loadM2ORelations(entityApiName)
  const rel = rels.find((entry) => entry.fieldApiName === parentField)
  if (!rel?.relatedEntityApiName) return actor
  try {
    const store = await resolveRecordsStore(rel.relatedEntityApiName)
    const parent = await store.findOne(rel.relatedEntityApiName, parentId, [
      ROW_OWNER_FIELD,
    ])
    return readRecordOwnerId(parent) || actor
  } catch (error) {
    console.warn(
      `[createRecord] ${entityApiName}: inheritOwnerFrom ${parentField} failed`,
      error,
    )
    return actor
  }
}

/**
 * Effective create owner: explicit `owner_id` when the caller may assign it,
 * else inherit / actor from {@link resolveCreateOwnerId}.
 */
export async function resolveEffectiveCreateOwnerId(
  entityApiName: string,
  data: Record<string, unknown>,
  access: RecordAccess,
  actorUserId?: string | null,
  requestedOwnerId?: string | null,
): Promise<string> {
  const requested =
    typeof requestedOwnerId === 'string' && requestedOwnerId.trim()
      ? requestedOwnerId.trim()
      : fkIdFromValue(data[ROW_OWNER_FIELD])
  if (requested && (await canAssignOwnerOnCreate(access, entityApiName))) {
    return assertActiveOwnerId(requested)
  }
  return resolveCreateOwnerId(entityApiName, data, actorUserId)
}
