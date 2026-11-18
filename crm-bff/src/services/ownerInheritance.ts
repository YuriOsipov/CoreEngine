/**
 * Parent-owner inheritance for child creates (Salesforce-style master-detail).
 * Opt-in via `backend_config.inheritOwnerFrom` = M2O field api_name.
 */
import { fkIdFromValue, loadM2ORelations } from '../adapters/records/relations.js'
import { resolveRecordsStore } from '../adapters/records/registry.js'
import {
  readRecordOwnerId,
  resolveInheritOwnerFrom,
  ROW_OWNER_FIELD,
} from './rowLevelSecurity.js'

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
