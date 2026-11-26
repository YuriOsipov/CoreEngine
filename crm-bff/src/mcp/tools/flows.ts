import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  findOneRecord,
  SYSTEM_RECORD_ACCESS,
  updateRecord,
} from '../../adapters/records/facade.js'
import { auditAfterMutation } from '../../audit/auditAfterMutation.js'
import { writeAuditEntry } from '../../audit/auditService.js'
import type { AuthContext } from '../../auth/accessGuards.js'
import { actorIdFromMe } from '../../auth/rolePreview.js'
import { listFailedFlowDispatches } from '../../flows/flowDispatchLog.js'
import { runLocalFlow } from '../../flows/localFlows.js'
import { assertMeEntityPermission } from '../../services/rolePermissions.js'
import { assertToolAccess } from '../auth.js'
import { errorToolResult, jsonToolResult } from '../result.js'
import { assertConfirm } from '../toolPolicy.js'

const DEFAULT_MESSAGE_COLLECTION = 'message'
const DEFAULT_CONNECTION_KEY = 'dispatch_outbound_message'

export function registerFlowTools(
  server: McpServer,
  ctx: AuthContext,
): void {
  server.registerTool(
    'inspect_flow_logs',
    {
      title: 'Inspect flow logs',
      description:
        'List recent failed Connection / runLocalFlow dispatches (app_flow_dispatches). Admin only.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      try {
        await assertToolAccess(ctx, 'inspect_flow_logs')
        const rows = await listFailedFlowDispatches(args.limit ?? 50)
        return jsonToolResult({ failed: rows })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )

  server.registerTool(
    'retry_message',
    {
      title: 'Retry message',
      description:
        'Re-dispatch one Message via Connection (default dispatch_outbound_message). Requires confirm: true.',
      inputSchema: {
        recordId: z.string().describe('Message record id'),
        collection: z
          .string()
          .optional()
          .describe('Message collection apiName (default message)'),
        connectionKey: z
          .string()
          .optional()
          .describe('Setup → External Flows key (default dispatch_outbound_message)'),
        confirm: z
          .boolean()
          .describe('Must be true to re-dispatch'),
      },
    },
    async (args) => {
      try {
        const me = await assertToolAccess(ctx, 'retry_message')
        assertConfirm('retry_message', { confirm: args.confirm })
        const collection =
          String(args.collection || '').trim() || DEFAULT_MESSAGE_COLLECTION
        const connectionKey =
          String(args.connectionKey || '').trim() || DEFAULT_CONNECTION_KEY
        const recordId = String(args.recordId || '').trim()
        if (!recordId) throw new Error('recordId is required')

        await assertMeEntityPermission(me, collection, 'update', {
          recordId,
        })
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

        const patch = {
          delivery_status: 'sending',
        }
        const updated = await updateRecord(
          collection,
          recordId,
          patch,
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
          },
          { kind: 'user', me },
        )

        return jsonToolResult({
          ok: true,
          collection,
          recordId,
          connectionKey,
          flowResult,
        })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )
}
