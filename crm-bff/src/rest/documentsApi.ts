/**
 * REST mirror of GraphQL generateDocument for n8n.
 * POST /api/v1/documents/generate
 * Contract: docs/generate-document-api.md
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { bearerToken } from '../auth/tokenClaims.js'
import {
  generateDocument,
  type GenerateDocumentInput,
} from '../documents/generateDocument.js'

function authHeaderFromRequest(request: FastifyRequest): string | null {
  return typeof request.headers.authorization === 'string'
    ? request.headers.authorization
    : null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function registerDocumentsRestApi(
  app: FastifyInstance,
): Promise<void> {
  app.post('/api/v1/documents/generate', async (request, reply) => {
    const authHeader = authHeaderFromRequest(request)
    if (!bearerToken(authHeader)) {
      return reply
        .status(401)
        .send({ error: 'Authorization Bearer token required' })
    }

    const body = asObject(request.body)
    const input: GenerateDocumentInput = {
      collectionName: String(body.collectionName ?? '').trim(),
      recordId: String(body.recordId ?? '').trim(),
      templateId: String(body.templateId ?? '').trim(),
      outputFormat:
        body.outputFormat == null ? null : String(body.outputFormat),
      documentStatus:
        body.documentStatus == null ? null : String(body.documentStatus),
      persist: body.persist == null ? null : Boolean(body.persist),
      renderOutput:
        body.renderOutput == null ? null : Boolean(body.renderOutput),
      valuesOverride:
        body.valuesOverride &&
        typeof body.valuesOverride === 'object' &&
        !Array.isArray(body.valuesOverride)
          ? (body.valuesOverride as Record<string, unknown>)
          : null,
      upsertMode: body.upsertMode == null ? null : String(body.upsertMode),
    }

    try {
      const result = await generateDocument(input)
      return reply.send(result)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Document generate failed'
      if (/required/i.test(message)) {
        return reply.status(400).send({ error: message })
      }
      if (/not implemented yet/i.test(message)) {
        // Phase 0: contract is live; implementation pending.
        return reply.status(501).send({ error: message })
      }
      if (/not found/i.test(message)) {
        return reply.status(404).send({ error: message })
      }
      if (/permission denied|authentication|unauthorized/i.test(message)) {
        return reply.status(403).send({ error: message })
      }
      request.log.error({ err: error }, 'REST generateDocument failed')
      return reply.status(502).send({ error: message })
    }
  })
}
