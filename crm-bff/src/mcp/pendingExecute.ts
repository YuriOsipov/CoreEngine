/**
 * Execute approved MCP pending actions as the original requester.
 */
import {
  findOneRecord,
  SYSTEM_RECORD_ACCESS,
  updateRecord,
} from '../adapters/records/facade.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import { auditAfterMutation } from '../audit/auditAfterMutation.js'
import { writeAuditEntry } from '../audit/auditService.js'
import { recordConfigAudit } from '../audit/configAuditService.js'
import { actorIdFromMe } from '../auth/rolePreview.js'
import { query } from '../db/pool.js'
import { runLocalFlow } from '../flows/localFlows.js'
import { updateEntityMeta } from '../schema/entityMeta.js'
import { createRegistryEntity } from '../schema/entityRegistry.js'
import {
  createRegistryField,
  updateRegistryField,
  type RegistryFieldInput,
} from '../schema/fieldRegistry.js'
import { upsertLayoutSettingRow } from '../schema/layoutSettings.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'
import { mcpSchemaWriteEnabled } from './limits.js'
import {
  claimMcpPendingForApproval,
  finalizeClaimedPending,
  getMcpPendingAction,
  loadRequesterMe,
  type McpPendingActionRow,
  type McpPendingToolName,
} from './pendingActions.js'

const DEFAULT_MESSAGE_COLLECTION = 'message'
const DEFAULT_CONNECTION_KEY = 'dispatch_outbound_message'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function executeRetryMessage(
  me: MeUser,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collection =
    String(payload.collection || '').trim() || DEFAULT_MESSAGE_COLLECTION
  const connectionKey =
    String(payload.connectionKey || '').trim() || DEFAULT_CONNECTION_KEY
  const recordId = String(payload.recordId || '').trim()
  if (!recordId) throw new Error('recordId is required')

  await assertMeEntityPermission(me, collection, 'update', { recordId })
  const actorUserId = actorIdFromMe(me)

  let before: Record<string, unknown>
  try {
    before = await findOneRecord(
      collection,
      recordId,
      null,
      SYSTEM_RECORD_ACCESS,
    )
  } catch {
    throw new Error(`${collection} record not found: ${recordId}`)
  }

  const updated = await updateRecord(
    collection,
    recordId,
    { delivery_status: 'sending' },
    null,
    { actorUserId, access: { me } },
  )
  await auditAfterMutation({
    audit: async () => {
      await writeAuditEntry({
        entityApiName: collection,
        recordId,
        action: 'UPDATE',
        before,
        after: updated,
        userId: actorUserId,
        comment: `mcp:retry_message connectionKey=${connectionKey} (approved)`,
      })
    },
  })

  const idempotencyKey = `ce-message-${recordId}-mcp-retry-${Date.now()}`
  const flowResult = await runLocalFlow(
    connectionKey,
    {
      source: 'mcp',
      trigger: 'retry_message',
      collection,
      recordId,
      idempotencyKey,
      record: { ...updated, delivery_status: 'sending' },
      pendingApproved: true,
    },
    { kind: 'user', me },
  )

  return {
    ok: true,
    collection,
    recordId,
    connectionKey,
    flowResult,
  }
}

export async function executeUpsertObjectSchema(
  me: MeUser,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!mcpSchemaWriteEnabled()) {
    throw new Error(
      'upsert_object_schema is disabled until MCP_SCHEMA_WRITE_ENABLED=true',
    )
  }
  const apiName = String(payload.apiName || '').trim()
  if (!apiName) throw new Error('apiName is required')
  const createIfMissing = payload.createIfMissing !== false
  const label =
    payload.label != null ? String(payload.label) : undefined
  const displayTemplate =
    payload.displayTemplate != null
      ? String(payload.displayTemplate)
      : undefined
  const icon = payload.icon != null ? String(payload.icon) : undefined
  const note = payload.note != null ? String(payload.note) : undefined
  const fields = Array.isArray(payload.fields) ? payload.fields : []

  const existing = await query<{ api_name: string }>(
    `SELECT api_name FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
    [apiName],
  )

  let createdEntity = false
  if (!existing[0]) {
    if (!createIfMissing) throw new Error(`Entity not found: ${apiName}`)
    const created = await createRegistryEntity({
      apiName,
      label: label || apiName,
      icon,
      note,
    })
    createdEntity = true
    await recordConfigAudit(me, {
      action: 'CREATE',
      resourceType: 'entity',
      resourceKey: created.apiName,
      summary: `MCP create entity ${created.apiName} (approved)`,
      after: { apiName: created.apiName, label: created.label },
    })
  } else if (
    label != null ||
    displayTemplate != null ||
    icon != null ||
    note != null
  ) {
    await updateEntityMeta(apiName, {
      label,
      displayTemplate,
      icon,
      note,
    })
    await recordConfigAudit(me, {
      action: 'UPDATE',
      resourceType: 'entity',
      resourceKey: apiName,
      summary: `MCP update entity meta ${apiName} (approved)`,
      after: {
        label: label ?? null,
        displayTemplate: displayTemplate ?? null,
        icon: icon ?? null,
        note: note ?? null,
      },
    })
  }

  const fieldResults: Array<Record<string, unknown>> = []
  for (const raw of fields) {
    const field = asObject(raw)
    const fieldApi = String(field.apiName || '').trim()
    if (!fieldApi) continue
    const existingField = await query<{ id: string; api_name: string }>(
      `SELECT f.id::text AS id, f.api_name
       FROM public.fields f
       JOIN public.entities e ON e.id = f.entity_id
       WHERE e.api_name = $1 AND f.api_name = $2
       LIMIT 1`,
      [apiName, fieldApi],
    )
    const input: RegistryFieldInput = {
      apiName: fieldApi,
      label: String(field.label || fieldApi),
      type: String(field.type || 'STRING'),
      interface: String(field.interface || 'input'),
      required: field.required as boolean | undefined,
      readonly: field.readonly as boolean | undefined,
      hidden: field.hidden as boolean | undefined,
      sensitivity:
        field.sensitivity != null ? Number(field.sensitivity) : undefined,
      isUnique: field.isUnique as boolean | undefined,
      isIndexed: field.isIndexed as boolean | undefined,
      options: (field.options as Record<string, unknown> | null) ?? null,
      displayOptions:
        (field.displayOptions as Record<string, unknown> | null) ?? null,
      relationKind: field.relationKind
        ? String(field.relationKind)
        : undefined,
      relatedEntity: field.relatedEntity
        ? String(field.relatedEntity)
        : undefined,
      junctionEntity: field.junctionEntity
        ? String(field.junctionEntity)
        : undefined,
    }

    if (existingField[0]) {
      if (field.updateExisting === false) {
        fieldResults.push({
          apiName: fieldApi,
          skipped: true,
          reason: 'exists',
        })
        continue
      }
      const updated = await updateRegistryField(existingField[0].id, input, {
        entityApiName: apiName,
      })
      await recordConfigAudit(me, {
        action: 'UPDATE',
        resourceType: 'field',
        resourceKey: `${apiName}.${fieldApi}`,
        summary: `MCP update field ${apiName}.${fieldApi} (approved)`,
        after: {
          apiName: updated.apiName,
          sensitivity: updated.sensitivity,
        },
      })
      fieldResults.push({
        apiName: updated.apiName,
        action: 'updated',
        sensitivity: updated.sensitivity,
      })
    } else {
      const created = await createRegistryField(apiName, input)
      await recordConfigAudit(me, {
        action: 'CREATE',
        resourceType: 'field',
        resourceKey: `${apiName}.${fieldApi}`,
        summary: `MCP create field ${apiName}.${fieldApi} (approved)`,
        after: {
          apiName: created.apiName,
          sensitivity: created.sensitivity,
        },
      })
      fieldResults.push({
        apiName: created.apiName,
        action: 'created',
        sensitivity: created.sensitivity,
      })
    }
  }

  return { apiName, createdEntity, fields: fieldResults }
}

export async function executeUpdateRoleLayout(
  me: MeUser,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!mcpSchemaWriteEnabled()) {
    throw new Error(
      'update_role_layout is disabled until MCP_SCHEMA_WRITE_ENABLED=true',
    )
  }
  const saved = await upsertLayoutSettingRow({
    settingId: payload.settingId ? String(payload.settingId) : undefined,
    entityApiName: String(payload.entityApiName || '').trim(),
    groupKey: String(payload.groupKey || '').trim(),
    subGroup: payload.subGroup != null ? String(payload.subGroup) : null,
    roleId: payload.roleId != null ? String(payload.roleId) : null,
    name: payload.name != null ? String(payload.name) : null,
    body: asObject(payload.body),
  })
  const settingId = String(
    asObject(saved.payload).__meta &&
      asObject(asObject(saved.payload).__meta).settingId
      ? asObject(asObject(saved.payload).__meta).settingId
      : saved.id,
  )
  await recordConfigAudit(me, {
    action: 'UPDATE',
    resourceType: 'layout',
    resourceKey: settingId,
    summary: `MCP upsert layout ${saved.entityApiName}/${saved.groupKey} (approved)`,
    after: {
      entityApiName: saved.entityApiName,
      groupKey: saved.groupKey,
      roleId: saved.roleId,
      settingId,
    },
  })
  return { ...saved, settingId }
}

async function runTool(
  toolName: McpPendingToolName,
  me: MeUser,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (toolName === 'retry_message') return executeRetryMessage(me, payload)
  if (toolName === 'upsert_object_schema') {
    return executeUpsertObjectSchema(me, payload)
  }
  return executeUpdateRoleLayout(me, payload)
}

/** Admin-approved execution of a pending MCP action. */
export async function approveAndExecutePendingAction(input: {
  id: string
  decidedByUserId: string
}): Promise<McpPendingActionRow> {
  const claimed = await claimMcpPendingForApproval(input)
  try {
    const requester = await loadRequesterMe(claimed.requestedByUserId)
    if (
      (claimed.toolName === 'upsert_object_schema' ||
        claimed.toolName === 'update_role_layout') &&
      !requester.adminAccess
    ) {
      throw new Error('Requester no longer has admin access')
    }
    const result = await runTool(
      claimed.toolName,
      requester,
      claimed.payload,
    )
    return await finalizeClaimedPending({
      id: claimed.id,
      status: 'executed',
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      return await finalizeClaimedPending({
        id: claimed.id,
        status: 'failed',
        result: { error: message },
      })
    } catch {
      const existing = await getMcpPendingAction(claimed.id)
      if (existing) return existing
      throw error
    }
  }
}

export function summarizePendingPayload(
  toolName: McpPendingToolName,
  payload: Record<string, unknown>,
): string {
  if (toolName === 'retry_message') {
    const collection =
      String(payload.collection || '').trim() || DEFAULT_MESSAGE_COLLECTION
    const recordId = String(payload.recordId || '').trim() || '?'
    const connectionKey =
      String(payload.connectionKey || '').trim() || DEFAULT_CONNECTION_KEY
    return `Retry ${collection}/${recordId} via ${connectionKey}`
  }
  if (toolName === 'upsert_object_schema') {
    const apiName = String(payload.apiName || '').trim() || '?'
    const fieldCount = Array.isArray(payload.fields) ? payload.fields.length : 0
    return `Upsert schema ${apiName}` + (fieldCount ? ` (${fieldCount} fields)` : '')
  }
  const entity = String(payload.entityApiName || '').trim() || '?'
  const group = String(payload.groupKey || '').trim() || '?'
  return `Update layout ${entity}/${group}`
}
