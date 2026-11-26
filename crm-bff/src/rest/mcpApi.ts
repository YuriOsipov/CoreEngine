/**
 * MCP Streamable HTTP endpoint for CoreEngine.
 * POST/GET/DELETE /api/v1/mcp — gated by MCP_HTTP_ENABLED.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  PASSWORD_CHANGE_REQUIRED,
  requireAuthenticatedUser,
} from '../auth/accessGuards.js'
import { readRolePreviewHeader } from '../auth/rolePreview.js'
import { createCoreEngineMcpServer } from '../mcp/server.js'

function isMcpHttpEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.MCP_HTTP_ENABLED || ''))
}

function authHeaderFromRequest(request: FastifyRequest): string | null {
  return typeof request.headers.authorization === 'string'
    ? request.headers.authorization
    : null
}

function buildWebRequest(request: FastifyRequest): Request {
  const host =
    typeof request.headers.host === 'string' && request.headers.host
      ? request.headers.host
      : 'localhost'
  const proto =
    request.protocol === 'https' ||
    String(request.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      ?.trim() === 'https'
      ? 'https'
      : 'http'
  const url = `${proto}://${host}${request.url}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value == null) continue
    if (key.toLowerCase() === 'content-length') continue
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry)
    } else {
      headers.set(key, value)
    }
  }

  const method = request.method.toUpperCase()
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    if (request.body !== undefined && request.body !== null) {
      const bodyText =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body)
      init.body = bodyText
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
    }
  }
  return new Request(url, init)
}

async function sendWebResponse(
  reply: FastifyReply,
  response: Response,
): Promise<void> {
  reply.status(response.status)
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return
    void reply.header(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  await reply.send(buffer)
}

export async function registerMcpApi(app: FastifyInstance): Promise<void> {
  if (!isMcpHttpEnabled()) {
    app.log.info('MCP HTTP disabled (set MCP_HTTP_ENABLED=true to enable)')
    return
  }

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await requireAuthenticatedUser({
        authorization: authHeaderFromRequest(request),
        rolePreview: readRolePreviewHeader(
          request.headers as Record<string, unknown>,
        ),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === PASSWORD_CHANGE_REQUIRED) {
        return reply.status(403).send({ error: PASSWORD_CHANGE_REQUIRED })
      }
      return reply
        .status(401)
        .send({ error: 'Authorization Bearer token required' })
    }

    const ctx = {
      authorization: authHeaderFromRequest(request),
      rolePreview: readRolePreviewHeader(
        request.headers as Record<string, unknown>,
      ),
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createCoreEngineMcpServer(ctx)
    try {
      await server.connect(transport)
      const webRequest = buildWebRequest(request)
      const response = await transport.handleRequest(webRequest)
      if (!response) {
        return reply.status(500).send({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Empty MCP response' },
          id: null,
        })
      }
      await sendWebResponse(reply, response)
    } catch (error) {
      request.log.error(error)
      if (!reply.sent) {
        return reply.status(500).send({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal MCP server error',
          },
          id: null,
        })
      }
    } finally {
      try {
        await transport.close()
      } catch {
        /* ignore */
      }
      try {
        await server.close()
      } catch {
        /* ignore */
      }
    }
  }

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/api/v1/mcp',
    handler,
  })

  app.log.info('MCP Streamable HTTP at /api/v1/mcp')
}
