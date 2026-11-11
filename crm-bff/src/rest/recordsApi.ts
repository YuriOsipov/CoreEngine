/**
 * Thin REST CRUD for n8n / integrations.
 *
 * GET|POST /api/v1/query                 SOQL subset (q=SELECT … FROM …)
 * GET    /api/v1/:collection
 * GET    /api/v1/:collection/:id         ?expand=children → reverse-M2O + files
 * POST   /api/v1/:collection              create (body = fields)
 * POST   /api/v1/:collection?upsert=true  upsert (body must include id, or by=<uniqueField>)
 * PUT|PATCH /api/v1/:collection/:id       update
 * DELETE /api/v1/:collection/:id          soft-delete (?hard=true → hard delete)
 *
 * :id may be the primary key, or a unique-index lookup: fieldName:value
 *   e.g. PATCH /api/v1/account/external_id:EXT-123
 *
 * Auth: Authorization Bearer JWT (same as GraphQL).
 * Optional: X-CRM-Automation: n8n
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  createRecord,
  expandRecordWithChildren,
  findManyRecords,
  findOneRecord,
  hardDeleteRecord,
  softDeleteRecord,
  updateRecord,
} from '../adapters/records/facade.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import { writeAuditEntry } from '../audit/auditService.js'
import { requireAuthenticatedUser } from '../auth/accessGuards.js'
import { loadEntityUniqueGroups } from '../schema/uniqueGroups.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'
import {
  assertIncludeDeletedAllowed,
  DEFAULT_LIST_LIMIT,
  resolveAuthorizedListLimit,
} from './listQueryPolicy.js'
import { assertUpsertPermissions } from './upsertPermissions.js'
import { parseSoql, SoqlParseError } from './soql.js'

type AuthHeader = string | null

function authHeaderFromRequest(request: FastifyRequest): AuthHeader {
  return typeof request.headers.authorization === 'string'
    ? request.headers.authorization
    : null
}

/** Validate Bearer JWT resolves to a real user (not merely that a token string is present). */
async function requireAuth(
  reply: FastifyReply,
  authHeader: AuthHeader,
): Promise<MeUser | null> {
  try {
    return await requireAuthenticatedUser({ authorization: authHeader })
  } catch {
    void reply.status(401).send({ error: 'Authorization Bearer token required' })
    return null
  }
}

function parseCsvFields(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const fields = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return fields.length ? fields : null
}

function parseJsonQuery(
  raw: unknown,
  fieldName: string,
): Record<string, unknown> | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string') {
    throw new Error(`${fieldName} must be a JSON object string`)
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON object`)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message.includes(fieldName)) throw error
    throw new Error(`Invalid ${fieldName} JSON`)
  }
}

function parseSort(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const sort = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return sort.length ? sort : null
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.trunc(n)
}

function flagTrue(raw: unknown): boolean {
  if (raw === true) return true
  const token = String(raw ?? '')
    .trim()
    .toLowerCase()
  return token === '1' || token === 'true' || token === 'yes' || token === 'on'
}

function actorIdFromMe(me: { id?: string | null } | null | undefined): string | null {
  return me?.id ? String(me.id) : null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function sendRecordError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
  fallback: string,
): Promise<FastifyReply> {
  const message = error instanceof Error ? error.message : fallback
  if (/not found/i.test(message)) {
    return reply.status(404).send({ error: message })
  }
  if (/permission denied|authentication|unauthorized|invalid token/i.test(message)) {
    return reply.status(403).send({ error: message })
  }
  if (error instanceof SoqlParseError) {
    return reply.status(400).send({ error: message })
  }
  if (
    /required|invalid .*json|must be|not uniquely indexed|ambiguous|multiple records|unsupported soql|unexpected/i.test(
      message,
    )
  ) {
    return reply.status(400).send({ error: message })
  }
  request.log.error({ err: error }, fallback)
  return reply.status(502).send({ error: fallback })
}

function decodeLookupValue(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Single-field unique api_names for an entity (fields.is_unique + 1-field uniqueGroups). */
async function loadSingleUniqueFields(collection: string): Promise<Set<string>> {
  const groups = await loadEntityUniqueGroups(collection)
  const fields = new Set<string>()
  for (const group of groups) {
    if (group.fields.length === 1 && group.fields[0]) {
      fields.add(group.fields[0])
    }
  }
  return fields
}

/**
 * Resolve path `:id` to primary key.
 * - Plain token → primary key id
 * - `field:value` → lookup by a uniquely indexed field (first colon separates)
 */
async function resolveRecordId(
  collection: string,
  key: string,
): Promise<string> {
  const trimmed = String(key || '').trim()
  if (!trimmed) {
    throw new Error('id is required')
  }

  const colon = trimmed.indexOf(':')
  if (colon <= 0) {
    return trimmed
  }

  const field = trimmed.slice(0, colon).trim()
  const value = decodeLookupValue(trimmed.slice(colon + 1))
  if (!field) {
    throw new Error('unique lookup field is required')
  }
  if (value === '') {
    throw new Error(`unique lookup value for "${field}" is required`)
  }
  if (field === 'id') {
    return value
  }

  const uniqueFields = await loadSingleUniqueFields(collection)
  if (!uniqueFields.has(field)) {
    throw new Error(
      `Field "${field}" is not uniquely indexed on ${collection}`,
    )
  }

  const result = await findManyRecords(collection, {
    filter: { [field]: { _eq: value } },
    fields: ['id'],
    limit: 2,
  })
  const nodes = result.nodes ?? []
  if (!nodes.length) {
    throw new Error(`Record not found: ${collection}.${field}=${value}`)
  }
  if (nodes.length > 1) {
    throw new Error(
      `Ambiguous unique lookup: multiple records for ${collection}.${field}=${value}`,
    )
  }
  const id = nodes[0]?.id
  if (id == null || String(id).trim() === '') {
    throw new Error(`Record not found: ${collection}.${field}=${value}`)
  }
  return String(id)
}

/**
 * Upsert key: body.id, or body[by] when ?by=<uniqueField>.
 * Returns primary key when existing row found; null when create path.
 */
async function resolveUpsertRecordId(
  collection: string,
  data: Record<string, unknown>,
  byField: string | null,
): Promise<{ recordId: string; existing: Record<string, unknown> | null }> {
  if (byField && byField !== 'id') {
    const uniqueFields = await loadSingleUniqueFields(collection)
    if (!uniqueFields.has(byField)) {
      throw new Error(
        `Field "${byField}" is not uniquely indexed on ${collection}`,
      )
    }
    if (data[byField] == null || String(data[byField]).trim() === '') {
      throw new Error(`upsert with by=${byField} requires body.${byField}`)
    }
    const value = String(data[byField]).trim()
    const result = await findManyRecords(collection, {
      filter: { [byField]: { _eq: value } },
      fields: ['id'],
      limit: 2,
    })
    const nodes = result.nodes ?? []
    if (nodes.length > 1) {
      throw new Error(
        `Ambiguous unique lookup: multiple records for ${collection}.${byField}=${value}`,
      )
    }
    if (nodes.length === 1) {
      const id = String(nodes[0]!.id)
      // Full row loaded by caller after permission checks (audit before snapshot).
      return { recordId: id, existing: { id } }
    }
    return { recordId: '', existing: null }
  }

  const recordId = data.id != null ? String(data.id).trim() : ''
  if (!recordId) {
    throw new Error(
      byField === 'id'
        ? 'upsert requires body.id'
        : 'upsert requires body.id (or pass ?by=<uniqueField>)',
    )
  }
  let existing: Record<string, unknown> | null = null
  try {
    // Existence probe only — full row loaded after permission checks.
    existing = await findOneRecord(collection, recordId, ['id'])
  } catch {
    existing = null
  }
  return { recordId, existing }
}

export async function registerRecordsRestApi(app: FastifyInstance): Promise<void> {
  async function runSoqlQuery(
    request: FastifyRequest,
    reply: FastifyReply,
    q: string,
  ): Promise<FastifyReply> {
    const authHeader = authHeaderFromRequest(request)
    const me = await requireAuth(reply, authHeader)
    if (!me) return reply
    try {
      const parsed = parseSoql(q)
      await assertMeEntityPermission(me, parsed.collection, 'read')
      const limit = await resolveAuthorizedListLimit(
        me,
        parsed.collection,
        parsed.params.limit,
        DEFAULT_LIST_LIMIT,
      )
      const result = await findManyRecords(parsed.collection, {
        ...parsed.params,
        limit,
        access: { me },
      })
      return reply.send({
        collection: parsed.collection,
        nodes: result.nodes,
        totalCount: result.totalCount,
      })
    } catch (error) {
      return sendRecordError(reply, request, error, 'SOQL query failed')
    }
  }

  /** Salesforce-style SOQL subset (must register before /:collection) */
  app.get<{ Querystring: { q?: string } }>(
    '/api/v1/query',
    async (request, reply) => {
      const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
      if (!q) {
        return reply.status(400).send({ error: 'q (SOQL) is required' })
      }
      return runSoqlQuery(request, reply, q)
    },
  )

  app.post<{ Body: { q?: string; query?: string } }>(
    '/api/v1/query',
    async (request, reply) => {
      const body = asObject(request.body)
      const q = String(body.q ?? body.query ?? '').trim()
      if (!q) {
        return reply.status(400).send({ error: 'q (SOQL) is required' })
      }
      return runSoqlQuery(request, reply, q)
    },
  )

  /** List / select */
  app.get<{
    Params: { collection: string }
    Querystring: {
      fields?: string
      filter?: string
      sort?: string
      search?: string
      limit?: string
      offset?: string
      includeDeleted?: string
    }
  }>('/api/v1/:collection', async (request, reply) => {
    const collection = String(request.params.collection || '').trim()
    if (!collection) {
      return reply.status(400).send({ error: 'collection is required' })
    }
    const authHeader = authHeaderFromRequest(request)
    const me = await requireAuth(reply, authHeader)
    if (!me) return reply

    try {
      await assertMeEntityPermission(me, collection, 'read')
      const includeDeleted = flagTrue(request.query.includeDeleted)
      await assertIncludeDeletedAllowed(me, collection, includeDeleted)
      const filter = parseJsonQuery(request.query.filter, 'filter')
      // Preserve limit < 0 (unlimited) so resolveAuthorizedListLimit can require export.
      const requestedLimit =
        request.query.limit == null || request.query.limit === ''
          ? DEFAULT_LIST_LIMIT
          : Number(request.query.limit)
      const limit = await resolveAuthorizedListLimit(
        me,
        collection,
        requestedLimit,
      )
      const result = await findManyRecords(collection, {
        filter,
        fields: parseCsvFields(request.query.fields),
        sort: parseSort(request.query.sort),
        search:
          typeof request.query.search === 'string' && request.query.search.trim()
            ? request.query.search.trim()
            : null,
        limit,
        offset: parsePositiveInt(request.query.offset, 0),
        includeDeleted,
        access: { me },
      })
      return reply.send({
        nodes: result.nodes,
        totalCount: result.totalCount,
      })
    } catch (error) {
      return sendRecordError(reply, request, error, 'Record list failed')
    }
  })

  /** Read one (primary key or unique field:value) */
  app.get<{
    Params: { collection: string; id: string }
    Querystring: { fields?: string; expand?: string; childLimit?: string }
  }>('/api/v1/:collection/:id', async (request, reply) => {
    const collection = String(request.params.collection || '').trim()
    const key = String(request.params.id || '').trim()
    if (!collection || !key) {
      return reply.status(400).send({ error: 'collection and id are required' })
    }
    const authHeader = authHeaderFromRequest(request)
    const me = await requireAuth(reply, authHeader)
    if (!me) return reply

    try {
      await assertMeEntityPermission(me, collection, 'read')
      const access = { me }
      const id = await resolveRecordId(collection, key)
      const record = await findOneRecord(
        collection,
        id,
        parseCsvFields(request.query.fields),
        access,
      )
      const expandRaw = String(request.query.expand || '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
      const expandChildren =
        expandRaw.includes('children') || expandRaw.includes('*')
      if (!expandChildren) {
        return reply.send(record)
      }
      const withChildren = await expandRecordWithChildren(collection, id, record, {
        limit: parsePositiveInt(request.query.childLimit, 100),
        includeFiles: !expandRaw.includes('nofiles'),
        access,
      })
      return reply.send(withChildren)
    } catch (error) {
      return sendRecordError(reply, request, error, 'Record fetch failed')
    }
  })

  /** Create or upsert */
  app.post<{
    Params: { collection: string }
    Querystring: { upsert?: string; fields?: string; by?: string }
  }>('/api/v1/:collection', async (request, reply) => {
    const collection = String(request.params.collection || '').trim()
    if (!collection) {
      return reply.status(400).send({ error: 'collection is required' })
    }
    const authHeader = authHeaderFromRequest(request)
    const me = await requireAuth(reply, authHeader)
    if (!me) return reply

    const data = asObject(request.body)
    const upsert = flagTrue(request.query.upsert)
    const fields = parseCsvFields(request.query.fields)
    const byField =
      typeof request.query.by === 'string' && request.query.by.trim()
        ? request.query.by.trim()
        : null

    try {
      if (upsert) {
        // Auth already validated. Require BOTH create + update before any
        // existence lookup so callers cannot use create-vs-update 403s as an oracle.
        await assertUpsertPermissions(me, collection)
        const actorUserId = actorIdFromMe(me)
        const { recordId, existing } = await resolveUpsertRecordId(
          collection,
          data,
          byField,
        )
        if (existing && recordId) {
          let before: Record<string, unknown> | null = existing
          try {
            before = await findOneRecord(collection, recordId, null)
          } catch {
            before = existing
          }
          const patch = { ...data }
          delete patch.id
          const updated = await updateRecord(
            collection,
            recordId,
            patch,
            fields,
            { actorUserId },
          )
          try {
            await writeAuditEntry({
              entityApiName: collection,
              recordId,
              action: 'UPDATE',
              before,
              after: updated,
              userId: actorUserId,
            })
          } catch (error) {
            request.log.warn({ err: error }, '[audit] REST upsert update failed')
          }
          return reply.send(updated)
        }
        const created = await createRecord(collection, data, fields, {
          actorUserId,
        })
        const createdId = String(created.id ?? recordId)
        try {
          await writeAuditEntry({
            entityApiName: collection,
            recordId: createdId,
            action: 'CREATE',
            after: created,
            userId: actorUserId,
          })
        } catch (error) {
          request.log.warn({ err: error }, '[audit] REST upsert create failed')
        }
        return reply.status(201).send(created)
      }

      await assertMeEntityPermission(me, collection, 'create')
      const actorUserId = actorIdFromMe(me)
      const created = await createRecord(collection, data, fields, {
        actorUserId,
      })
      const createdId = String(created.id ?? '')
      if (createdId) {
        try {
          await writeAuditEntry({
            entityApiName: collection,
            recordId: createdId,
            action: 'CREATE',
            after: created,
            userId: actorUserId,
          })
        } catch (error) {
          request.log.warn({ err: error }, '[audit] REST create failed')
        }
      }
      return reply.status(201).send(created)
    } catch (error) {
      return sendRecordError(reply, request, error, 'Record create/upsert failed')
    }
  })

  async function updateHandler(
    request: FastifyRequest<{
      Params: { collection: string; id: string }
      Querystring: { fields?: string }
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const collection = String(request.params.collection || '').trim()
    const key = String(request.params.id || '').trim()
    if (!collection || !key) {
      return reply.status(400).send({ error: 'collection and id are required' })
    }
    const authHeader = authHeaderFromRequest(request)
    const me = await requireAuth(reply, authHeader)
    if (!me) return reply

    const data = asObject(request.body)
    delete data.id
    const fields = parseCsvFields(request.query.fields)

    try {
      await assertMeEntityPermission(me, collection, 'update')
      const actorUserId = actorIdFromMe(me)
      const id = await resolveRecordId(collection, key)
      let before: Record<string, unknown> | null = null
      try {
        before = await findOneRecord(collection, id, null)
      } catch {
        before = null
      }
      const updated = await updateRecord(collection, id, data, fields, {
        actorUserId,
      })
      try {
        await writeAuditEntry({
          entityApiName: collection,
          recordId: id,
          action: 'UPDATE',
          before,
          after: updated,
          userId: actorUserId,
        })
      } catch (error) {
        request.log.warn({ err: error }, '[audit] REST update failed')
      }
      return reply.send(updated)
    } catch (error) {
      return sendRecordError(reply, request, error, 'Record update failed')
    }
  }

  app.put('/api/v1/:collection/:id', updateHandler)
  app.patch('/api/v1/:collection/:id', updateHandler)

  /** Soft delete (default) or hard delete (?hard=true) */
  app.delete<{
    Params: { collection: string; id: string }
    Querystring: { hard?: string }
  }>('/api/v1/:collection/:id', async (request, reply) => {
    const collection = String(request.params.collection || '').trim()
    const key = String(request.params.id || '').trim()
    if (!collection || !key) {
      return reply.status(400).send({ error: 'collection and id are required' })
    }
    const authHeader = authHeaderFromRequest(request)
    const me = await requireAuth(reply, authHeader)
    if (!me) return reply

    const hard = flagTrue(request.query.hard)

    try {
      await assertMeEntityPermission(me, collection, 'delete')
      if (hard && !(me.adminAccess || me.roleAdminAccess)) {
        return reply.status(403).send({ error: 'Hard delete requires admin access' })
      }
      const actorUserId = actorIdFromMe(me)
      const id = await resolveRecordId(collection, key)
      let before: Record<string, unknown> | null = null
      try {
        before = await findOneRecord(collection, id, null)
      } catch {
        before = null
      }

      if (hard) {
        await hardDeleteRecord(collection, id)
        try {
          await writeAuditEntry({
            entityApiName: collection,
            recordId: id,
            action: 'DELETE',
            before,
            after: null,
            userId: actorUserId,
          })
        } catch (error) {
          request.log.warn({ err: error }, '[audit] REST hard delete failed')
        }
        return reply.send({ ok: true, hard: true })
      }

      const deleted = await softDeleteRecord(collection, id, undefined, {
        actorUserId,
      })
      try {
        await writeAuditEntry({
          entityApiName: collection,
          recordId: id,
          action: 'SOFT_DELETE',
          before,
          after: deleted,
          userId: actorUserId,
        })
      } catch (error) {
        request.log.warn({ err: error }, '[audit] REST soft delete failed')
      }
      return reply.send(deleted)
    } catch (error) {
      return sendRecordError(reply, request, error, 'Record delete failed')
    }
  })
}
