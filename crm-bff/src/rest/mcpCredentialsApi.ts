/**
 * Admin REST for dedicated MCP credentials (Setup → MCP).
 * GET/POST /api/v1/mcp/credentials, DELETE /api/v1/mcp/credentials/:id
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireAdminAccess } from '../auth/accessGuards.js'
import { actorIdFromMe, readRolePreviewHeader } from '../auth/rolePreview.js'
import { recordConfigAudit } from '../audit/configAuditService.js'
import {
  createMcpCredential,
  listMcpCredentials,
  resolveAppUserPk,
  revokeMcpCredential,
} from '../mcp/credentials.js'

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

export async function registerMcpCredentialsApi(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/mcp/credentials', async (request, reply) => {
    try {
      const me = await requireAdminAccess(authFromRequest(request))
      const subject = actorIdFromMe(me)
      if (!subject) return reply.status(401).send({ error: 'Authentication required' })
      const userPk = await resolveAppUserPk(subject)
      if (!userPk) return reply.status(404).send({ error: 'User not found' })
      const nodes = await listMcpCredentials(userPk)
      return reply.send({ nodes })
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post('/api/v1/mcp/credentials', async (request, reply) => {
    try {
      const me = await requireAdminAccess(authFromRequest(request))
      const subject = actorIdFromMe(me)
      if (!subject) return reply.status(401).send({ error: 'Authentication required' })
      const userPk = await resolveAppUserPk(subject)
      if (!userPk) return reply.status(404).send({ error: 'User not found' })

      const body =
        request.body && typeof request.body === 'object' && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {}
      const created = await createMcpCredential({
        userId: userPk,
        label: String(body.label || ''),
        scopes: body.scopes,
        expiresInHours: Number(body.expiresInHours),
      })
      await recordConfigAudit(me, {
        action: 'CREATE',
        resourceType: 'other',
        resourceKey: `mcp_credential:${created.credential.id}`,
        summary: `MCP create credential ${created.credential.label}`,
        after: {
          id: created.credential.id,
          label: created.credential.label,
          scopes: created.credential.scopes,
          expiresAt: created.credential.expiresAt,
        },
      })
      // Token plaintext returned once — never listed again.
      return reply.status(201).send({
        credential: created.credential,
        token: created.token,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/label is required/i.test(message)) {
        return reply.status(400).send({ error: message })
      }
      return sendAuthError(reply, error)
    }
  })

  app.delete(
    '/api/v1/mcp/credentials/:id',
    async (request, reply) => {
      try {
        const me = await requireAdminAccess(authFromRequest(request))
        const subject = actorIdFromMe(me)
        if (!subject) return reply.status(401).send({ error: 'Authentication required' })
        const userPk = await resolveAppUserPk(subject)
        if (!userPk) return reply.status(404).send({ error: 'User not found' })
        const id = String((request.params as { id?: string }).id || '').trim()
        if (!id) return reply.status(400).send({ error: 'id is required' })
        const ok = await revokeMcpCredential({ id, userId: userPk })
        if (!ok) return reply.status(404).send({ error: 'Credential not found' })
        await recordConfigAudit(me, {
          action: 'DELETE',
          resourceType: 'other',
          resourceKey: `mcp_credential:${id}`,
          summary: `MCP revoke credential ${id}`,
        })
        return reply.send({ ok: true })
      } catch (error) {
        return sendAuthError(reply, error)
      }
    },
  )
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/Admin access required/i.test(message)) {
    return reply.status(403).send({ error: message })
  }
  if (/Authentication required|Password change/i.test(message)) {
    return reply.status(401).send({ error: message })
  }
  return reply.status(500).send({ error: message || 'Internal error' })
}
