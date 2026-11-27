/**
 * Admin snapshot API. Apply writes configuration only.
 * Record import runs only when APP_ENV=sandbox.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireAdminAccess } from '../auth/accessGuards.js'
import { readRolePreviewHeader } from '../auth/rolePreview.js'
import { SnapshotHttpError } from '../snapshot/errors.js'
import { exportConfigSnapshot } from '../snapshot/exportSnapshot.js'
import { applyConfigSnapshot } from '../snapshot/applySnapshot.js'
import {
  exportSelectedRecords,
  importSelectedRecords,
  listDirectRelations,
} from '../snapshot/records.js'

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

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof SnapshotHttpError) {
    return reply.status(error.status).send({ error: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/Admin access required/i.test(message)) {
    return reply.status(403).send({ error: message })
  }
  if (/Authentication required|Password change/i.test(message)) {
    return reply.status(401).send({ error: message })
  }
  return reply.status(500).send({ error: message || 'Internal error' })
}

export async function registerSnapshotApi(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/snapshot', async (request, reply) => {
    try {
      await requireAdminAccess(authFromRequest(request))
      return reply.send(await exportConfigSnapshot())
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/v1/snapshot/relations', async (request, reply) => {
    try {
      await requireAdminAccess(authFromRequest(request))
      const entity = String((request.query as { entity?: string }).entity || '')
      return reply.send(await listDirectRelations(entity))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/snapshot/records', async (request, reply) => {
    try {
      await requireAdminAccess(authFromRequest(request))
      const body = (request.body ?? {}) as {
        entities?: string[]
        confirmSensitive?: boolean
      }
      return reply.send(
        await exportSelectedRecords({
          entities: body.entities ?? [],
          confirmSensitive: body.confirmSensitive,
        }),
      )
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/snapshot/records/import', async (request, reply) => {
    try {
      await requireAdminAccess(authFromRequest(request))
      const body = (request.body ?? {}) as {
        entities?: string[]
        records?: Record<string, never>
        confirmSensitive?: boolean
      }
      return reply.send(
        await importSelectedRecords({
          entities: body.entities ?? [],
          records: body.records ?? {},
          confirmSensitive: body.confirmSensitive,
        }),
      )
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/snapshot/apply', async (request, reply) => {
    try {
      await requireAdminAccess(authFromRequest(request))
      return reply.send(await applyConfigSnapshot(request.body))
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
