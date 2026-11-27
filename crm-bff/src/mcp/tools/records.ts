import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createRecord,
  findManyRecords,
  findOneRecord,
  SYSTEM_RECORD_ACCESS,
  updateRecord,
} from '../../adapters/records/facade.js'
import { auditAfterMutation } from '../../audit/auditAfterMutation.js'
import { writeAuditEntry } from '../../audit/auditService.js'
import type { AuthContext } from '../../auth/accessGuards.js'
import { actorIdFromMe } from '../../auth/rolePreview.js'
import { redactRecordForMe } from '../../services/fieldSecurity.js'
import { assertMeEntityPermission } from '../../services/rolePermissions.js'
import { assertToolAccess } from '../auth.js'
import { mcpQueryMaxLimit } from '../limits.js'
import { errorToolResult, jsonToolResult } from '../result.js'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export type McpQueryRecordsArgs = {
  entity: string
  id?: string
  filter?: Record<string, unknown>
  sort?: string[]
  limit?: number
  offset?: number
  fields?: string[]
  search?: string
}

/** Exported for FLS / field-leak tests — same path as the MCP tool. */
export async function runMcpQueryRecords(
  ctx: AuthContext,
  args: McpQueryRecordsArgs,
): Promise<ReturnType<typeof jsonToolResult> | ReturnType<typeof errorToolResult>> {
  try {
    const me = await assertToolAccess(ctx, 'query_records')
    const entity = String(args.entity || '').trim()
    await assertMeEntityPermission(me, entity, 'read', {
      recordId: args.id,
    })

    if (args.id) {
      const row = await findOneRecord(
        entity,
        String(args.id),
        args.fields ?? null,
        { me },
      )
      return jsonToolResult({
        entity,
        record: await redactRecordForMe(me, entity, row),
      })
    }

    const maxLimit = mcpQueryMaxLimit()
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), maxLimit)
    const result = await findManyRecords(entity, {
      filter: args.filter ? asObject(args.filter) : null,
      sort: args.sort ?? null,
      limit,
      offset: Math.max(Number(args.offset) || 0, 0),
      fields: args.fields ?? null,
      search: args.search ?? null,
      access: { me },
    })
    const nodes = []
    for (const row of result.nodes) {
      nodes.push(await redactRecordForMe(me, entity, row))
    }
    return jsonToolResult({
      entity,
      totalCount: result.totalCount,
      nodes,
    })
  } catch (error) {
    return errorToolResult(error)
  }
}

export type McpCreateRecordArgs = {
  entity: string
  data: Record<string, unknown>
  fields?: string[]
}

export async function runMcpCreateRecord(
  ctx: AuthContext,
  args: McpCreateRecordArgs,
): Promise<ReturnType<typeof jsonToolResult> | ReturnType<typeof errorToolResult>> {
  try {
    const me = await assertToolAccess(ctx, 'create_record')
    const entity = String(args.entity || '').trim()
    await assertMeEntityPermission(me, entity, 'create')
    const actorUserId = actorIdFromMe(me)
    const created = await createRecord(
      entity,
      asObject(args.data),
      args.fields ?? null,
      { actorUserId, access: { me } },
    )
    const recordId = String(created.id ?? '')
    if (recordId) {
      await auditAfterMutation({
        audit: async () => {
          await writeAuditEntry({
            entityApiName: entity,
            recordId,
            action: 'CREATE',
            after: created,
            userId: actorUserId,
            comment: 'mcp:create_record',
          })
        },
      })
    }
    return jsonToolResult({
      entity,
      record: await redactRecordForMe(me, entity, created),
    })
  } catch (error) {
    return errorToolResult(error)
  }
}

export type McpUpdateRecordArgs = {
  entity: string
  id: string
  data: Record<string, unknown>
  fields?: string[]
}

export async function runMcpUpdateRecord(
  ctx: AuthContext,
  args: McpUpdateRecordArgs,
): Promise<ReturnType<typeof jsonToolResult> | ReturnType<typeof errorToolResult>> {
  try {
    const me = await assertToolAccess(ctx, 'update_record')
    const entity = String(args.entity || '').trim()
    const id = String(args.id || '').trim()
    await assertMeEntityPermission(me, entity, 'update', { recordId: id })
    const actorUserId = actorIdFromMe(me)
    let before: Record<string, unknown> | null = null
    try {
      before = await findOneRecord(entity, id, null, SYSTEM_RECORD_ACCESS)
    } catch {
      before = null
    }
    const updated = await updateRecord(
      entity,
      id,
      asObject(args.data),
      args.fields ?? null,
      { actorUserId, access: { me } },
    )
    await auditAfterMutation({
      audit: async () => {
        let after: Record<string, unknown> = updated
        try {
          after = await findOneRecord(entity, id, null, SYSTEM_RECORD_ACCESS)
        } catch {
          after = updated
        }
        await writeAuditEntry({
          entityApiName: entity,
          recordId: id,
          action: 'UPDATE',
          before,
          after,
          userId: actorUserId,
          comment: 'mcp:update_record',
        })
      },
    })
    return jsonToolResult({
      entity,
      record: await redactRecordForMe(me, entity, updated),
    })
  } catch (error) {
    return errorToolResult(error)
  }
}

export function registerRecordTools(
  server: McpServer,
  ctx: AuthContext,
): void {
  server.registerTool(
    'query_records',
    {
      title: 'Query records',
      description:
        'List or get records with the caller ACL / FLS / owner RLS (same records facade as GraphQL). Pass id for get-by-id.',
      inputSchema: {
        entity: z.string().describe('Object apiName'),
        id: z.string().optional().describe('Record id for single get'),
        filter: z.record(z.string(), z.unknown()).optional(),
        sort: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        fields: z.array(z.string()).optional(),
        search: z.string().optional(),
      },
    },
    async (args) => runMcpQueryRecords(ctx, args),
  )

  server.registerTool(
    'create_record',
    {
      title: 'Create record',
      description: 'Create a business record (caller needs Create ACL).',
      inputSchema: {
        entity: z.string(),
        data: z.record(z.string(), z.unknown()),
        fields: z.array(z.string()).optional(),
      },
    },
    async (args) => runMcpCreateRecord(ctx, args),
  )

  server.registerTool(
    'update_record',
    {
      title: 'Update record',
      description:
        'Patch a record. Use owner_id to Change Owner (Modify all / current owner / admin).',
      inputSchema: {
        entity: z.string(),
        id: z.string(),
        data: z.record(z.string(), z.unknown()),
        fields: z.array(z.string()).optional(),
      },
    },
    async (args) => runMcpUpdateRecord(ctx, args),
  )
}
