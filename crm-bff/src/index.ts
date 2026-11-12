import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import { NoSchemaIntrospectionCustomRule } from 'graphql'
import { createYoga, createSchema, type Plugin } from 'graphql-yoga'
import { createQueryLimitsRule, queryLimitOptionsFromEnv } from './graphql/queryLimits.js'
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
  bffChangePassword,
  bffLogin,
  bffLogout,
  bffRefresh,
} from './auth/localAuth.js'
import { assertProductionBootstrapPasswordsSafe } from './auth/bootstrapPasswordGuard.js'
import { assertFieldSensitivitySchemaReady } from './services/fieldSecurity.js'
import { assertProductionFlowAuthConfig } from './flows/flowAuth.js'
import { authJwtSecret } from './auth/jwt.js'
import { bearerToken } from './auth/tokenClaims.js'
import { requireAuthenticatedUser } from './auth/accessGuards.js'
import { readRolePreviewHeader } from './auth/rolePreview.js'
import { rateLimitConsume, rateLimitPeek, rateLimitReset } from './auth/rateLimit.js'
import {
  assertFileParentWritable,
  assertFileReadable,
  assertFileWritable,
} from './files/fileAccess.js'
import { postgresFileHasParentLink } from './adapters/postgresFiles.js'
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

/**
 * `CORS_ORIGIN=*` with `credentials: true` would reflect any Origin. Never treat
 * `*` as allow-all; production refuses to start if it is listed.
 */
function assertCorsConfigSafe(): void {
  // audit-ignore: CORS-WILDCARD * is refused in production below; never treated as allow-all
  if (!corsOriginAllowlist.includes('*')) return
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to start in production: CORS_ORIGIN must not include "*" when credentials are enabled. List explicit origins.',
    )
  }
  console.warn(
    '[cors] CORS_ORIGIN contains "*" — ignored while credentials are enabled; list explicit origins',
  )
}

function resolveCorsOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow: boolean) => void,
): void {
  if (!origin) {
    cb(null, true)
    return
  }
  if (corsOriginAllowlist.includes(origin)) {
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

const isProduction = process.env.NODE_ENV === 'production'
/** GRAPHQL_INTROSPECTION=true re-enables introspection + GraphiQL in production. */
const graphqlIntrospection =
  !isProduction || /^(1|true|yes|on)$/i.test(process.env.GRAPHQL_INTROSPECTION || '')
const queryLimitsRule = createQueryLimitsRule(queryLimitOptionsFromEnv())

const graphqlGuardsPlugin: Plugin = {
  onValidate({ addValidationRule }) {
    addValidationRule(queryLimitsRule)
    if (!graphqlIntrospection) addValidationRule(NoSchemaIntrospectionCustomRule)
  },
}

/** Server context is supplied per request by the Fastify route (clientKey = request.ip). */
const yoga = createYoga<{
  authorization: string | null
  rolePreview: string | null
  clientKey: string
}>({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: graphqlIntrospection,
  graphiql: graphqlIntrospection,
  maskedErrors: isProduction,
  plugins: [graphqlGuardsPlugin],
  // CORS is handled by @fastify/cors below. Yoga's plugin only accepts
  // string/string[] origins (not a callback) and would 500 on GraphQL.
  cors: false,
})

/**
 * TRUST_PROXY: unset/false = use socket address only (X-Forwarded-For ignored).
 * true | hop count | comma-separated IPs/CIDRs (e.g. "loopback,uniquelocal") when
 * the BFF sits behind nginx / a load balancer.
 */
function resolveTrustProxy(): boolean | string[] | ((address: string, hop: number) => boolean) {
  const raw = (process.env.TRUST_PROXY || '').trim()
  if (!raw || /^(0|false|no|off)$/i.test(raw)) return false
  if (/^(true|yes|on)$/i.test(raw)) return true
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw)
    return (_address, hop) => hop < hops
  }
  return raw.split(',').map((value) => value.trim()).filter(Boolean)
}

const MB = 1024 * 1024
/** Default for unauthenticated / small JSON routes (auth, flows, health). */
const DEFAULT_BODY_LIMIT = 1 * MB
/** Authenticated data routes (layouts, documents, bulk records). */
const DATA_BODY_LIMIT = Math.max(1, Number(process.env.BFF_DATA_BODY_LIMIT_MB) || 20) * MB

const app = Fastify({
  logger: {
    redact: {
      paths: ['req.headers.authorization', 'req.query.access_token'],
      censor: '[Redacted]',
    },
    serializers: {
      req(request) {
        const url =
          typeof request.url === 'string'
            ? request.url.replace(/([?&]access_token=)[^&]*/gi, '$1[Redacted]')
            : request.url
        return {
          method: request.method,
          url,
          host: request.headers?.host,
          remoteAddress: request.socket?.remoteAddress,
          remotePort: request.socket?.remotePort,
        }
      },
    },
  },
  bodyLimit: DEFAULT_BODY_LIMIT,
  trustProxy: resolveTrustProxy(),
})

// Must be registered before any route so it sees every route definition.
app.addHook('onRoute', (route) => {
  if (route.bodyLimit != null) return
  if (route.url === '/files') {
    route.bodyLimit = 50 * MB
  } else if (route.url === '/graphql' || route.url.startsWith('/api/')) {
    route.bodyLimit = DATA_BODY_LIMIT
  }
})

await app.register(helmet, {
  // API responses: no scripts, never framed. /assets overrides with its own sandbox CSP.
  // GraphiQL (dev only) needs inline scripts, so CSP is off while introspection is on.
  contentSecurityPolicy: graphqlIntrospection
    ? false
    : {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
  // Framing is controlled via CSP frame-ancestors (PDF previews embed /assets cross-port in dev).
  xFrameOptions: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  strictTransportSecurity: isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true }
    : false,
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
    const response = await yoga.handleNodeRequestAndResponse(request, reply, {
      authorization: authHeaderFromFastify(request),
      rolePreview: rolePreviewFromFastify(request),
      clientKey: request.ip || 'anon',
    })
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

/** request.ip honours X-Forwarded-For only from proxies allowed by TRUST_PROXY. */
function clientKeyFromRequest(request: { ip?: string }): string {
  return typeof request.ip === 'string' && request.ip ? request.ip : 'anon'
}

const LOGIN_ACCOUNT_MAX_FAILURES = 10
const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60_000

app.post('/auth/login', async (request, reply) => {
  const limit = rateLimitConsume(
    `login:${clientKeyFromRequest(request)}`,
    20,
    60_000,
  )
  if (!limit.ok) {
    reply.header('retry-after', String(limit.retryAfterSec))
    return reply.status(429).send({ error: 'Too many login attempts' })
  }
  const body = (request.body ?? {}) as {
    email?: unknown
    password?: unknown
  }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return reply.status(400).send({ error: 'email and password are required' })
  }

  // Per IP+email failure throttle. Email-only keys would let an attacker lock
  // a victim account from any network; scoping to the client IP avoids that.
  const accountKey = `login-account:${clientKeyFromRequest(request)}:${email.toLowerCase()}`
  const accountLock = rateLimitPeek(accountKey, LOGIN_ACCOUNT_MAX_FAILURES)
  if (!accountLock.ok) {
    reply.header('retry-after', String(accountLock.retryAfterSec))
    return reply.status(429).send({ error: 'Too many login attempts' })
  }

  const result = await bffLogin({ email, password })
  if (!result.ok) {
    if (result.status === 401) {
      rateLimitConsume(accountKey, LOGIN_ACCOUNT_MAX_FAILURES, LOGIN_ACCOUNT_WINDOW_MS)
    }
    return reply.status(result.status).send({ error: result.error })
  }
  rateLimitReset(accountKey)
  return result.session
})

app.post('/auth/refresh', async (request, reply) => {
  const limit = rateLimitConsume(
    `refresh:${clientKeyFromRequest(request)}`,
    60,
    60_000,
  )
  if (!limit.ok) {
    reply.header('retry-after', String(limit.retryAfterSec))
    return reply.status(429).send({ error: 'Too many refresh attempts' })
  }
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

  const bodyAccessToken = (request.body as { access_token?: unknown } | null)?.access_token
  const accessToken =
    bearerToken(authHeaderFromFastify(request)) ||
    (typeof bodyAccessToken === 'string' ? bodyAccessToken.trim() : '')
  const result = await bffLogout({ refreshToken, accessToken: accessToken || null })
  if (!result.ok) {
    return reply.status(result.status).send({ error: result.error })
  }
  return { ok: true }
})

app.post('/auth/change-password', async (request, reply) => {
  const limit = rateLimitConsume(
    `change-password:${clientKeyFromRequest(request)}`,
    10,
    60_000,
  )
  if (!limit.ok) {
    reply.header('retry-after', String(limit.retryAfterSec))
    return reply.status(429).send({ error: 'Too many password change attempts' })
  }

  let me
  try {
    me = await requireAuthenticatedUser(authContextFromFastify(request), {
      allowPasswordChange: true,
      applyRolePreview: false,
    })
  } catch {
    return reply.status(401).send({ error: 'Authentication required' })
  }

  const body = (request.body ?? {}) as {
    current_password?: unknown
    new_password?: unknown
  }
  const currentPassword =
    typeof body.current_password === 'string' ? body.current_password : ''
  const newPassword =
    typeof body.new_password === 'string' ? body.new_password : ''
  if (!currentPassword || !newPassword) {
    return reply
      .status(400)
      .send({ error: 'current_password and new_password are required' })
  }

  const result = await bffChangePassword({
    userId: String(me.id),
    currentPassword,
    newPassword,
  })
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

function rolePreviewFromFastify(request: {
  headers: Record<string, unknown>
}): string | null {
  return readRolePreviewHeader(request.headers)
}

function authContextFromFastify(request: {
  headers: Record<string, unknown>
}): { authorization: string | null; rolePreview: string | null } {
  return {
    authorization: authHeaderFromFastify(request),
    rolePreview: rolePreviewFromFastify(request),
  }
}

function authHeaderFromFastify(request: { headers: Record<string, unknown> }): string | null {
  const raw = request.headers.authorization
  return typeof raw === 'string' ? raw : null
}

/**
 * <img>/<iframe src> cannot send Authorization. Allow a short-lived access_token
 * query on GET /assets only (same JWT as Bearer). Prefer the header when present.
 */
function authContextForAssetRequest(request: {
  headers: Record<string, unknown>
  query: Record<string, string>
}): { authorization: string | null; rolePreview: string | null } {
  const header = authHeaderFromFastify(request)
  if (header) {
    return {
      authorization: header,
      rolePreview: rolePreviewFromFastify(request),
    }
  }
  const token = String(request.query.access_token || '').trim()
  return {
    authorization: token ? `Bearer ${token}` : null,
    rolePreview: rolePreviewFromFastify(request),
  }
}

function sendSafeHttpError(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  request: { log: { error: (obj: unknown, msg: string) => void } },
  error: unknown,
  fallback: string,
  status = 502,
) {
  const message = error instanceof Error ? error.message : fallback
  if (
    /permission denied|authentication required|password change required/i.test(
      message,
    )
  ) {
    return reply.status(403).send({ error: message })
  }
  if (/not found/i.test(message)) {
    return reply.status(404).send({ error: message })
  }
  request.log.error({ err: error }, fallback)
  return reply.status(status).send({ error: fallback })
}

app.post('/files', async (request, reply) => {
  // Auth before multipart parse so anonymous callers cannot force buffer allocation.
  let me
  try {
    me = await requireAuthenticatedUser(authContextFromFastify(request))
  } catch (error) {
    return sendSafeHttpError(reply, request, error, 'Upload failed')
  }

  const file = await request.file()
  if (!file) {
    return reply.status(400).send({ error: 'file is required' })
  }

  try {
    const buffer = await file.toBuffer()
    const parentCollection = readMultipartString(
      file.fields as unknown as Record<string, unknown> | undefined,
      'parent_collection',
    )
    const parentRecordId = readMultipartString(
      file.fields as unknown as Record<string, unknown> | undefined,
      'parent_record_id',
    )
    await assertFileParentWritable(me, parentCollection, parentRecordId)
    const uploaded = await uploadFileBuffer({
      filename: file.filename,
      mimeType: file.mimetype,
      buffer,
      uploadedBy: me.id,
      parentCollection,
      parentRecordId,
    })
    return reply.send(uploaded)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed'
    return sendSafeHttpError(reply, request, error, message)
  }
})

app.patch<{
  Params: { id: string }
  Body: Record<string, unknown>
}>('/files/:id', async (request, reply) => {
  try {
    const me = await requireAuthenticatedUser(authContextFromFastify(request))
    await assertFileWritable(me, request.params.id)
    const data = await updateFileRecord(request.params.id, request.body ?? {})
    return reply.send(data)
  } catch (error) {
    return sendSafeHttpError(reply, request, error, 'File update failed')
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
    const me = await requireAuthenticatedUser(authContextFromFastify(request))
    const parentCollection = String(request.body?.parent_collection || '').trim()
    const parentRecordId = String(request.body?.parent_record_id || '').trim()
    if (!parentCollection || !parentRecordId) {
      return reply.status(400).send({
        error: 'parent_collection and parent_record_id are required',
      })
    }
    // Linking exposes the file to the target record's readers — caller must be able to read it.
    await assertFileReadable(me, request.params.id)
    await assertFileParentWritable(me, parentCollection, parentRecordId)
    const data = await linkFileToRecord({
      fileId: request.params.id,
      parentCollection,
      parentRecordId,
      createdBy: me.id,
    })
    return reply.send(data)
  } catch (error) {
    return sendSafeHttpError(reply, request, error, 'File link failed')
  }
})

app.delete<{
  Params: { id: string }
  Querystring: { parent_collection?: string; parent_record_id?: string }
}>('/files/:id', async (request, reply) => {
  try {
    const me = await requireAuthenticatedUser(authContextFromFastify(request))
    const parentCollection = String(request.query.parent_collection || '').trim()
    const parentRecordId = String(request.query.parent_record_id || '').trim()
    if (parentCollection && parentRecordId) {
      // Parent context must be one the file is actually attached to; otherwise
      // update on any collection would allow deleting arbitrary files.
      const attached = await postgresFileHasParentLink({
        fileId: request.params.id,
        parentCollection,
        parentRecordId,
      })
      if (!attached) {
        return reply.status(404).send({ error: 'File not found' })
      }
      await assertFileParentWritable(me, parentCollection, parentRecordId)
    } else {
      await assertFileWritable(me, request.params.id)
    }
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
    return sendSafeHttpError(reply, request, error, 'File delete failed')
  }
})

app.get<{
  Params: { id: string }
  Querystring: Record<string, string>
}>('/assets/:id', async (request, reply) => {
  const queryForAsset = { ...request.query }
  delete queryForAsset.access_token
  const search = new URLSearchParams(queryForAsset).toString()
  try {
    const me = await requireAuthenticatedUser(authContextForAssetRequest(request))
    await assertFileReadable(me, request.params.id)
    const asset = await loadAsset(request.params.id, search)
    if (!asset) {
      return reply.status(404).send({ error: 'File not found' })
    }
    if (asset.contentType) {
      reply.type(asset.contentType)
    }
    if (asset.filename) {
      const asciiName = asset.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
      reply.header(
        'content-disposition',
        `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      )
    }
    reply.header('x-content-type-options', 'nosniff')
    const frameAncestors = [
      "'self'",
      ...corsOriginAllowlist.filter((origin) => origin !== '*'),
    ].join(' ')
    // User-uploaded content (HTML / SVG / XML can carry script): opaque-origin
    // sandbox, no script. PDFs are exempt — browsers refuse to render them sandboxed.
    const isPdf = /^application\/pdf\b/i.test(asset.contentType ?? '')
    reply.header(
      'content-security-policy',
      isPdf
        ? `frame-ancestors ${frameAncestors}`
        : `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src blob:; frame-ancestors ${frameAncestors}`,
    )
    reply.header('cross-origin-resource-policy', 'cross-origin')
    reply.header('cache-control', 'private, max-age=3600')
    return reply.send(asset.buffer)
  } catch (error) {
    return sendSafeHttpError(reply, request, error, 'Asset fetch failed')
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
    assertCorsConfigSafe()
    assertProductionFlowAuthConfig()
    // Production: refuse known example bootstrap passwords (admin12345 / ChangeMeNow!, …).
    await assertProductionBootstrapPasswordsSafe()
    // Production: field-level security columns must exist (no silent FLS-off).
    await assertFieldSensitivitySchemaReady()
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
