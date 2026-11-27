/**
 * Admin REST for MCP pending-action approvals (Setup → MCP).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireAdminAccess } from '../auth/accessGuards.js'
import { actorIdFromMe, readRolePreviewHeader } from '../auth/rolePreview.js'
import { recordConfigAudit } from '../audit/configAuditService.js'
import { resolveAppUserPk } from '../mcp/credentials.js'
import {
  listMcpPendingActions,
  rejectMcpPendingAction,
  type McpPendingStatus,
} from '../mcp/pendingActions.js'
import { approveAndExecutePendingAction } from '../mcp/pendingExecute.js'

function authFromRequest(request: FastifyRequest) {
  return {
    authorization:
      typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : null,
    rolePreview: readRolePreviewHeader(
      request.headers as Record<string, unknown>,
    ),
  }
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/Admin access required/i.test(message)) {
    return reply.status(403).send({ error: message })
  }
  if (/Authentication required|Password change/i.test(message)) {
    return reply.status(401).send({ error: message })
  }
  if (/not found/i.test(message)) {
    return reply.status(404).send({ error: message })
  }
  if (/not pending|expired|no longer/i.test(message)) {
    return reply.status(409).send({ error: message })
  }
  return reply.status(500).send({ error: message || 'Internal error' })
}

export async function registerMcpPendingActionsApi(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/mcp/pending-actions', async (request, reply) => {
    try {
      await requireAdminAccess(authFromRequest(request))
      const q = request.query as { status?: string; limit?: string }
      const statusRaw = String(q.status || '').trim()
      const status = statusRaw
        ? (statusRaw as McpPendingStatus)
        : null
      const nodes = await listMcpPendingActions({
        status,
        limit: q.limit ? Number(q.limit) : 50,
      })
      return reply.send({ nodes })
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post(
    '/api/v1/mcp/pending-actions/:id/approve',
    async (request, reply) => {
      try {
        const me = await requireAdminAccess(authFromRequest(request))
        const subject = actorIdFromMe(me)
        if (!subject) {
          return reply.status(401).send({ error: 'Authentication required' })
        }
        const decidedBy = await resolveAppUserPk(subject)
        if (!decidedBy) {
          return reply.status(404).send({ error: 'User not found' })
        }
        const id = String((request.params as { id?: string }).id || '').trim()
        if (!id) return reply.status(400).send({ error: 'id is required' })

        const action = await approveAndExecutePendingAction({
          id,
          decidedByUserId: decidedBy,
        })
        await recordConfigAudit(me, {
          action: 'UPDATE',
          resourceType: 'other',
          resourceKey: `mcp_pending:${id}`,
          summary: `MCP approve ${action.toolName} → ${action.status}`,
          after: {
            id: action.id,
            toolName: action.toolName,
            status: action.status,
            summary: action.summary,
          },
        })
        return reply.send({ action })
      } catch (error) {
        return sendAuthError(reply, error)
      }
    },
  )

  app.post(
    '/api/v1/mcp/pending-actions/:id/reject',
    async (request, reply) => {
      try {
        const me = await requireAdminAccess(authFromRequest(request))
        const subject = actorIdFromMe(me)
        if (!subject) {
          return reply.status(401).send({ error: 'Authentication required' })
        }
        const decidedBy = await resolveAppUserPk(subject)
        if (!decidedBy) {
          return reply.status(404).send({ error: 'User not found' })
        }
        const id = String((request.params as { id?: string }).id || '').trim()
        if (!id) return reply.status(400).send({ error: 'id is required' })
        const body =
          request.body &&
          typeof request.body === 'object' &&
          !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)
            : {}
        const action = await rejectMcpPendingAction({
          id,
          decidedByUserId: decidedBy,
          note: body.note != null ? String(body.note) : null,
        })
        await recordConfigAudit(me, {
          action: 'UPDATE',
          resourceType: 'other',
          resourceKey: `mcp_pending:${id}`,
          summary: `MCP reject ${action.toolName}`,
          after: {
            id: action.id,
            toolName: action.toolName,
            status: action.status,
          },
        })
        return reply.send({ action })
      } catch (error) {
        return sendAuthError(reply, error)
      }
    },
  )
}
