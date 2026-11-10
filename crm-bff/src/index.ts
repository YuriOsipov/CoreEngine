import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { createYoga, createSchema } from 'graphql-yoga'
import { typeDefs } from './schema/typeDefs.js'
import { resolvers } from './resolvers/index.js'
import { pool } from './db/pool.js'
import {
  loadAsset,
  updateFileRecord,
  uploadFileBuffer,
  deleteFileRecord,
  linkFileToRecord,
} from './adapters/filesAdapter.js'
import {
  bffLogin,
  bffLogout,
  bffRefresh,
} from './auth/localAuth.js'
import { bearerToken, decodeJwtClaims } from './auth/tokenClaims.js'
import { authJwtSecret, verifyAccessToken } from './auth/jwt.js'
import { resolveFlowsBackend, triggerFlow } from './flows/flowsAdapter.js'
import { startTaskScheduler } from './tasks/scheduler.js'
import { registerRecordsRestApi } from './rest/recordsApi.js'
import { registerDocumentsRestApi } from './rest/documentsApi.js'
import { describePlatformMail } from './mail/platformMail.js'

const port = Number(process.env.PORT || 4000)
const corsOriginAllowlist = (
  process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/** Reflect Vite (and similar) local origins so bumping ports does not break login. */
function isLocalDevOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
}

function resolveCorsOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow: boolean) => void,
): void {
  if (!origin) {
    cb(null, true)
    return
  }
  if (corsOriginAllowlist.includes('*') || corsOriginAllowlist.includes(origin)) {
    cb(null, true)
    return
  }
  if (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin)) {
    cb(null, true)
    return
  }
  cb(null, false)
}

const schema = createSchema({
  typeDefs,
  resolvers,
})

const yoga = createYoga<{ authorization: string | null }>({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: true,
  maskedErrors: process.env.NODE_ENV === 'production',
  context: ({ request }) => ({
    authorization: request.headers.get('authorization'),
    // Reserved for future event-hook skip: request.headers.get('x-crm-automation')
  }),
  // CORS is handled by @fastify/cors below. Yoga's plugin only accepts
  // string/string[] origins (not a callback) and would 500 on GraphQL.
  cors: false,
})

const app = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024,
})

await app.register(cors, {
  origin: resolveCorsOrigin,
  credentials: true,
  // Browser file upload uses POST; metadata update uses PATCH; remove uses DELETE.
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})

await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
})

app.route({
  url: yoga.graphqlEndpoint,
  method: ['GET', 'POST', 'OPTIONS'],
  handler: async (request, reply) => {
    const response = await yoga.handleNodeRequestAndResponse(request, reply)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    reply.status(response.status)
    reply.send(Buffer.from(await response.arrayBuffer()))
    return reply
  },
})

app.get('/health', async () => {
  const result = await pool.query('SELECT 1 AS ok')
  return { ok: result.rows[0]?.ok === 1, service: 'crm-bff' }
})

app.post('/auth/login', async (request, reply) => {
  const body = (request.body ?? {}) as {
    email?: unknown
    password?: unknown
  }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return reply.status(400).send({ error: 'email and password are required' })
  }

  const result = await bffLogin({ email, password })
  if (!result.ok) {
    return reply.status(result.status).send({ error: result.error })
  }
  return result.session
})

app.post('/auth/refresh', async (request, reply) => {
  const body = (request.body ?? {}) as { refresh_token?: unknown }
  const refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token.trim() : ''
  if (!refreshToken) {
    return reply.status(400).send({ error: 'refresh_token is required' })
  }

  const result = await bffRefresh({ refreshToken })
  if (!result.ok) {
    return reply.status(result.status).send({ error: result.error })
  }
  return result.session
})

app.post('/auth/logout', async (request, reply) => {
  const body = (request.body ?? {}) as { refresh_token?: unknown }
  const refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token.trim() : ''
  if (!refreshToken) {
    return reply.status(400).send({ error: 'refresh_token is required' })
  }

  const result = await bffLogout({ refreshToken })
  if (!result.ok) {
    return reply.status(result.status).send({ error: result.error })
  }
  return { ok: true }
})

function readMultipartString(
  fields: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!fields) return null
  const raw = fields[key]
  const item = Array.isArray(raw) ? raw[0] : raw
  if (typeof item === 'string') {
    const value = item.trim()
    return value || null
  }
  if (item && typeof item === 'object' && 'value' in item) {
    const value = (item as { value?: unknown }).value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed || null
    }
  }
  return null
}

app.post('/files', async (request, reply) => {
  const file = await request.file()
  if (!file) {
    return reply.status(400).send({ error: 'file is required' })
  }

  try {
    const buffer = await file.toBuffer()
    const authHeader =
      typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : null
    const token = bearerToken(authHeader)
    let uploadedBy: string | null = null
    if (token) {
      try {
        uploadedBy = verifyAccessToken(token)?.id ?? null
      } catch {
        uploadedBy = decodeJwtClaims(token)?.id ?? null
      }
    }
    const parentCollection = readMultipartString(
      file.fields as unknown as Record<string, unknown> | undefined,
      'parent_collection',
    )
    const parentRecordId = readMultipartString(
      file.fields as unknown as Record<string, unknown> | undefined,
      'parent_record_id',
    )
    const uploaded = await uploadFileBuffer({
      filename: file.filename,
      mimeType: file.mimetype,
      buffer,
      uploadedBy,
      parentCollection,
      parentRecordId,
    })
    return reply.send(uploaded)
  } catch (error) {
    request.log.error({ err: error }, 'file upload failed')
    const message = error instanceof Error ? error.message : 'Upload failed'
    return reply.status(502).send({ error: message })
  }
})

app.patch<{
  Params: { id: string }
  Body: Record<string, unknown>
}>('/files/:id', async (request, reply) => {
  try {
    const data = await updateFileRecord(request.params.id, request.body ?? {})
    return reply.send(data)
  } catch (error) {
    request.log.error({ err: error }, 'file update failed')
    const message = error instanceof Error ? error.message : 'File update failed'
    return reply.status(502).send({ error: message })
  }
})

app.post<{
  Params: { id: string }
  Body: {
    parent_collection?: string
    parent_record_id?: string
  }
}>('/files/:id/link', async (request, reply) => {
  try {
    const parentCollection = String(request.body?.parent_collection || '').trim()
    const parentRecordId = String(request.body?.parent_record_id || '').trim()
    if (!parentCollection || !parentRecordId) {
      return reply.status(400).send({
        error: 'parent_collection and parent_record_id are required',
      })
    }

    const authHeader =
      typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : null
    const token = bearerToken(authHeader)
    let createdBy: string | null = null
    if (token) {
      try {
        createdBy = verifyAccessToken(token)?.id ?? null
      } catch {
        createdBy = decodeJwtClaims(token)?.id ?? null
      }
    }

    const data = await linkFileToRecord({
      fileId: request.params.id,
      parentCollection,
      parentRecordId,
      createdBy,
    })
    return reply.send(data)
  } catch (error) {
    request.log.error({ err: error }, 'file link failed')
    const message = error instanceof Error ? error.message : 'File link failed'
    const status = message.startsWith('File not found') ? 404 : 502
    return reply.status(status).send({ error: message })
  }
})

app.delete<{
  Params: { id: string }
  Querystring: { parent_collection?: string; parent_record_id?: string }
}>('/files/:id', async (request, reply) => {
  try {
    const parentCollection = String(request.query.parent_collection || '').trim()
    const parentRecordId = String(request.query.parent_record_id || '').trim()
    const deleted = await deleteFileRecord(
      request.params.id,
      parentCollection && parentRecordId
        ? { collection: parentCollection, recordId: parentRecordId }
        : null,
    )
    if (!deleted) {
      return reply.status(404).send({ error: 'File not found' })
    }
    return reply.send({ ok: true })
  } catch (error) {
    request.log.error({ err: error }, 'file delete failed')
    const message = error instanceof Error ? error.message : 'File delete failed'
    return reply.status(502).send({ error: message })
  }
})

app.get<{
  Params: { id: string }
  Querystring: Record<string, string>
}>('/assets/:id', async (request, reply) => {
  const search = new URLSearchParams(request.query).toString()
  try {
    const asset = await loadAsset(request.params.id, search)
    if (!asset) {
      return reply.status(404).send({ error: 'File not found' })
    }
    if (asset.contentType) {
      reply.type(asset.contentType)
    }
    if (asset.filename) {
      reply.header(
        'content-disposition',
        `inline; filename="${asset.filename.replace(/"/g, '')}"`,
      )
    }
    reply.header('cache-control', 'private, max-age=3600')
    return reply.send(asset.buffer)
  } catch (error) {
    request.log.error({ err: error }, 'asset proxy failed')
    const message = error instanceof Error ? error.message : 'Asset fetch failed'
    return reply.status(502).send({ error: message })
  }
})

app.post('/flows/trigger/:key', async (request, reply) => {
  const key = String((request.params as { key?: string }).key || '').trim()
  const authHeader =
    typeof request.headers.authorization === 'string'
      ? request.headers.authorization
      : undefined
  const { status, body } = await triggerFlow(
    key,
    request.body ?? {},
    authHeader,
    request.headers as Record<string, string | string[] | undefined>,
  )
  return reply.status(status).send(body)
})

await registerRecordsRestApi(app)
await registerDocumentsRestApi(app)

async function start() {
  try {
    // Fail fast: login/refresh call signAccessToken and otherwise surface as HTTP 500.
    authJwtSecret()
    await app.listen({ port, host: '0.0.0.0' })
    app.log.info(`GraphQL ready at http://localhost:${port}/graphql`)
    app.log.info(`Auth proxy at http://localhost:${port}/auth/login`)
    app.log.info(
      `Flow triggers at http://localhost:${port}/flows/trigger/:key (backend=${resolveFlowsBackend()})`,
    )
    app.log.info(`Files upload at http://localhost:${port}/files`)
    app.log.info(`Assets proxy at http://localhost:${port}/assets/:id`)
    app.log.info(
      `REST records at http://localhost:${port}/api/v1/:collection[/:id] (GET/POST/PUT/PATCH/DELETE)`,
    )
    app.log.info(`REST SOQL query at http://localhost:${port}/api/v1/query`)
    app.log.info(
      `REST generate document at http://localhost:${port}/api/v1/documents/generate`,
    )
    startTaskScheduler()
    app.log.info('Task scheduler started (TASK_SCHEDULER_ENABLED, default on)')
    app.log.info(describePlatformMail())
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

void start()
