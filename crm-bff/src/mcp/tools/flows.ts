import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AuthContext } from '../../auth/accessGuards.js'
import { actorIdFromMe } from '../../auth/rolePreview.js'
import {
  listFailedFlowDispatches,
  type FlowDispatchRow,
} from '../../flows/flowDispatchLog.js'
import { sanitizeFlowErrorMessage } from '../../flows/flowErrorSanitize.js'
import { assertMeEntityPermission } from '../../services/rolePermissions.js'
import { assertToolAccess } from '../auth.js'
import { enqueueMcpPendingAction } from '../pendingActions.js'
import { summarizePendingPayload } from '../pendingExecute.js'
import { errorToolResult, jsonToolResult } from '../result.js'

/** Drop request bodies / keep admin error text sanitized for MCP clients. */
function redactFlowLogForMcp(row: FlowDispatchRow): Omit<FlowDispatchRow, 'requestBody'> & {
  requestBody: null
} {
  return {
    ...row,
    error: row.error ? sanitizeFlowErrorMessage(row.error) : null,
    requestBody: null,
  }
}

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
        'List recent failed External Flow / runLocalFlow dispatches (app_flow_dispatches). Admin only. Request bodies are omitted (PII).',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      try {
        await assertToolAccess(ctx, 'inspect_flow_logs')
        const rows = await listFailedFlowDispatches(args.limit ?? 50)
        return jsonToolResult({
          failed: rows.map(redactFlowLogForMcp),
        })
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
        'Request re-dispatch of one Message via External Flow. Does not run immediately — enqueues a pending action for a human admin to approve in Setup → MCP.',
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
      },
    },
    async (args) => {
      try {
        const me = await assertToolAccess(ctx, 'retry_message')
        const collection =
          String(args.collection || '').trim() || DEFAULT_MESSAGE_COLLECTION
        const connectionKey =
          String(args.connectionKey || '').trim() || DEFAULT_CONNECTION_KEY
        const recordId = String(args.recordId || '').trim()
        if (!recordId) throw new Error('recordId is required')

        await assertMeEntityPermission(me, collection, 'update', {
          recordId,
        })

        const payload = { recordId, collection, connectionKey }
        const summary = summarizePendingPayload('retry_message', payload)
        console.warn('[mcp] retry_message enqueue', {
          userId: actorIdFromMe(me),
          collection,
          recordId,
          connectionKey,
        })
        const pending = await enqueueMcpPendingAction({
          toolName: 'retry_message',
          summary,
          payload,
          me,
        })
        return jsonToolResult({
          status: 'pending_approval',
          pendingActionId: pending.id,
          summary: pending.summary,
          expiresAt: pending.expiresAt,
          message:
            'Queued for human approval in Setup → MCP. Not executed yet.',
        })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )
}
