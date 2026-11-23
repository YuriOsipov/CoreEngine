/**
 * Parent-owner inheritance for child creates (Salesforce-style master-detail).
 * Opt-in via `backend_config.inheritOwnerFrom` = M2O field api_name.
 *
 * Trusted callers (system, admin, Modify all on the entity) may also pass
 * `owner_id` on create (e.g. n8n Integration creating `incoming_message` for
 * `to_user`). Clients without that privilege still have `owner_id` stripped.
 */
import { fkIdFromValue, loadM2ORelations } from '../adapters/records/relations.js'
import { resolveRecordsStore } from '../adapters/records/registry.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { isSystemRecordAccess } from '../adapters/records/types.js'
import { resolveRoleOwnerBypass } from './rolePermissions.js'
import {
  isAdminMe,
  readRecordOwnerId,
  resolveInheritOwnerFrom,
  ROW_OWNER_FIELD,
} from './rowLevelSecurity.js'

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
    return requested
  }
  return resolveCreateOwnerId(entityApiName, data, actorUserId)
}
