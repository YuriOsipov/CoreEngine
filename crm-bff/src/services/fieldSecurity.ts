import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import {
  loadM2ORelations,
  loadO2MRelations,
} from '../adapters/records/relations.js'

/**
 * Field-level security by sensitivity tier.
 *
 * fields.sensitivity (0 none, 1 restricted, 2 confidential) is compared with
 * role_permissions.max_read_sensitivity / max_edit_sensitivity for the entity.
 * Admins and system callers (no `me`) bypass. Both lookups are cached in memory
 * and cleared when Setup changes a field or a role matrix; the TTL bounds
 * staleness when several BFF instances run.
 */

export const MAX_SENSITIVITY = 2

const CACHE_TTL_MS = 30_000
const MAX_FILTER_DEPTH = 6

export function clampSensitivity(value: unknown): number {
  const num = Math.trunc(Number(value))
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.min(num, MAX_SENSITIVITY)
}

type RoleTiers = { read: number; edit: number }

let sensitiveFields: {
  byEntity: Map<string, Map<string, number>>
  expiresAt: number
} | null = null
let sensitiveFieldsLoad: Promise<Map<string, Map<string, number>>> | null = null
const roleTierCache = new Map<
  string,
  { byEntity: Map<string, RoleTiers>; expiresAt: number }
>()
let missingColumnWarned = false

export function clearFieldSecurityCache(): void {
  sensitiveFields = null
  sensitiveFieldsLoad = null
  roleTierCache.clear()
}

function entityKey(entity: string): string {
  return String(entity || '').trim().toLowerCase()
}

/** Pre-migration databases lack the columns; treat as "nothing sensitive". */
function isMissingColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703'
}

function warnMissingColumns(): void {
  if (missingColumnWarned) return
  missingColumnWarned = true
  console.warn(
    '[fieldSecurity] sensitivity columns missing — run registry migrations; field-level security is inactive',
  )
}

async function loadSensitiveFields(): Promise<Map<string, Map<string, number>>> {
  if (sensitiveFields && sensitiveFields.expiresAt > Date.now()) {
    return sensitiveFields.byEntity
  }
  if (sensitiveFieldsLoad) return sensitiveFieldsLoad

  sensitiveFieldsLoad = (async () => {
    const byEntity = new Map<string, Map<string, number>>()
    try {
      const rows = await query<{
        entity_api_name: string
        field_api_name: string
        sensitivity: number
      }>(
        `SELECT e.api_name AS entity_api_name,
                f.api_name AS field_api_name,
                f.sensitivity
         FROM public.fields f
         JOIN public.entities e ON e.id = f.entity_id
         WHERE f.sensitivity > 0
           AND e.deleted_at IS NULL`,
      )
      for (const row of rows) {
        const key = entityKey(row.entity_api_name)
        const fields = byEntity.get(key) ?? new Map<string, number>()
        fields.set(row.field_api_name, clampSensitivity(row.sensitivity))
        byEntity.set(key, fields)
      }
    } catch (error) {
      if (!isMissingColumnError(error)) throw error
      warnMissingColumns()
    }
    sensitiveFields = { byEntity, expiresAt: Date.now() + CACHE_TTL_MS }
    return byEntity
  })()

  try {
    return await sensitiveFieldsLoad
  } finally {
    sensitiveFieldsLoad = null
  }
}

async function loadRoleTiers(roleRef: string): Promise<Map<string, RoleTiers>> {
  const cached = roleTierCache.get(roleRef)
  if (cached && cached.expiresAt > Date.now()) return cached.byEntity

  const byEntity = new Map<string, RoleTiers>()
  try {
    const rows = await query<{
      entity_api_name: string
      max_read_sensitivity: number
      max_edit_sensitivity: number
    }>(
      `SELECT p.entity_api_name, p.max_read_sensitivity, p.max_edit_sensitivity
       FROM public.app_roles r
       JOIN public.role_permissions p ON p.role_id = r.id
       WHERE (r.backend_role_id = $1 OR r.id::text = $1)
         AND (p.max_read_sensitivity > 0 OR p.max_edit_sensitivity > 0)`,
      [roleRef],
    )
    for (const row of rows) {
      const read = clampSensitivity(row.max_read_sensitivity)
      byEntity.set(entityKey(row.entity_api_name), {
        read,
        edit: Math.min(clampSensitivity(row.max_edit_sensitivity), read),
      })
    }
  } catch (error) {
    if (!isMissingColumnError(error)) throw error
    warnMissingColumns()
  }
  roleTierCache.set(roleRef, { byEntity, expiresAt: Date.now() + CACHE_TTL_MS })
  return byEntity
}

export interface FieldAccess {
  entity: string
  /** Fields whose values must not leave the BFF (projection, filter, sort, search). */
  unreadable: ReadonlySet<string>
  /** Fields the caller may not write (superset of unreadable). */
  uneditable: ReadonlySet<string>
}

function bypassesFieldSecurity(me: MeUser | null | undefined): boolean {
  if (!me) return true
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

/**
 * Restricted fields for `me` on `entity`, or null when nothing is restricted
 * (admin, system caller, entity without sensitive fields, or role covers all tiers).
 */
export async function resolveFieldAccess(
  me: MeUser | null | undefined,
  entity: string,
): Promise<FieldAccess | null> {
  if (bypassesFieldSecurity(me)) return null
  const fields = (await loadSensitiveFields()).get(entityKey(entity))
  if (!fields?.size) return null

  const roleRef = String(me?.roleId || '').trim()
  const tiers = roleRef
    ? (await loadRoleTiers(roleRef)).get(entityKey(entity))
    : undefined
  const maxRead = tiers?.read ?? 0
  const maxEdit = tiers?.edit ?? 0

  const unreadable = new Set<string>()
  const uneditable = new Set<string>()
  for (const [field, tier] of fields) {
    if (tier > maxRead) unreadable.add(field)
    if (tier > maxEdit) uneditable.add(field)
  }
  if (!unreadable.size && !uneditable.size) return null
  return { entity, unreadable, uneditable }
}

function fieldPathRoot(path: string): string {
  return String(path || '').split(/[.:(]/)[0]?.trim() ?? ''
}

function deniedError(entity: string, field: string, action: 'read' | 'update'): Error {
  return new Error(`Permission denied: ${action} on ${entity}.${field}`)
}

/** Drop unreadable keys from a record (shallow; nested relations are redacted by their own reads). */
export function redactRecord(
  record: Record<string, unknown>,
  access: FieldAccess | null,
): Record<string, unknown> {
  if (!access?.unreadable.size || !record || typeof record !== 'object') return record
  let out: Record<string, unknown> | null = null
  for (const field of access.unreadable) {
    if (!(field in record)) continue
    out ??= { ...record }
    delete out[field]
  }
  return out ?? record
}

export function redactRecords(
  records: Record<string, unknown>[],
  access: FieldAccess | null,
): Record<string, unknown>[] {
  if (!access?.unreadable.size) return records
  return records.map((record) => redactRecord(record, access))
}

export async function redactRecordForMe(
  me: MeUser | null | undefined,
  entity: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return redactRecord(record, await resolveFieldAccess(me, entity))
}

/**
 * Remove unreadable roots from a requested projection. Returns ['id'] when every
 * requested path was restricted so stores never fall back to "all columns".
 */
export function filterReadableFieldPaths(
  fields: string[] | null | undefined,
  access: FieldAccess | null,
): string[] | null | undefined {
  if (!fields?.length || !access?.unreadable.size) return fields
  const kept = fields.filter((path) => !access.unreadable.has(fieldPathRoot(path)))
  return kept.length ? kept : ['id']
}

/**
 * Reject a write payload that touches fields the caller may not edit. Never
 * compare against the stored value: for unreadable fields that would turn the
 * error into an equality oracle.
 */
export function assertPayloadWritable(
  data: Record<string, unknown>,
  access: FieldAccess | null,
): void {
  if (!access?.uneditable.size || !data || typeof data !== 'object') return
  const denied = Object.keys(data).filter((field) => access.uneditable.has(field))
  if (denied.length) throw deniedError(access.entity, denied.join(', '), 'update')
}

/** Reject writes to explicit target fields (bulk actions, junction links). */
export async function assertFieldsEditable(
  me: MeUser | null | undefined,
  entity: string,
  fields: Array<string | null | undefined>,
): Promise<void> {
  const access = await resolveFieldAccess(me, entity)
  if (!access) return
  const denied = fields.filter(
    (field): field is string => Boolean(field) && access.uneditable.has(field!),
  )
  if (denied.length) throw deniedError(entity, denied.join(', '), 'update')
}

async function relatedEntityFor(entity: string, field: string): Promise<string | null> {
  const m2o = (await loadM2ORelations(entity)).find((rel) => rel.fieldApiName === field)
  if (m2o?.relatedEntityApiName) return m2o.relatedEntityApiName
  const o2m = (await loadO2MRelations(entity)).find((rel) => rel.fieldApiName === field)
  return o2m?.junctionEntityApiName ?? null
}

/** Each dotted segment must be readable on the entity it belongs to (M2O / O2M hops). */
export async function assertFieldPathReadable(
  me: MeUser | null | undefined,
  entity: string,
  path: string,
): Promise<void> {
  if (bypassesFieldSecurity(me)) return
  const segments = String(path || '')
    .replace(/^-/, '')
    .split('.')
    .map((part) => fieldPathRoot(part))
    .filter(Boolean)
  let current = entity
  for (let index = 0; index < segments.length; index += 1) {
    const field = segments[index]!
    if (field === '*') return
    const access = await resolveFieldAccess(me, current)
    if (access?.unreadable.has(field)) throw deniedError(current, field, 'read')
    if (index === segments.length - 1) return
    const next = await relatedEntityFor(current, field)
    if (!next) return
    current = next
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function assertFilterReadable(
  me: MeUser | null | undefined,
  entity: string,
  filter: unknown,
  depth: number,
): Promise<void> {
  if (depth > MAX_FILTER_DEPTH) return
  if (Array.isArray(filter)) {
    for (const item of filter) await assertFilterReadable(me, entity, item, depth + 1)
    return
  }
  if (!isPlainObject(filter)) return

  const access = await resolveFieldAccess(me, entity)
  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and' || key === '_or' || key === '_not') {
      await assertFilterReadable(me, entity, value, depth + 1)
      continue
    }
    if (key.startsWith('_')) continue
    if (access?.unreadable.has(key)) throw deniedError(entity, key, 'read')
    if (!isPlainObject(value)) continue

    const nested: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === '_some' || childKey === '_none') {
        if (isPlainObject(childValue)) Object.assign(nested, childValue)
      } else if (!childKey.startsWith('_')) {
        nested[childKey] = childValue
      }
    }
    if (!Object.keys(nested).length) continue
    const related = await relatedEntityFor(entity, key)
    if (related) await assertFilterReadable(me, related, nested, depth + 1)
  }
}

function aggregateFieldPaths(aggregate: Record<string, unknown> | null | undefined): string[] {
  if (!aggregate) return []
  const out: string[] = []
  for (const value of Object.values(aggregate)) {
    const list = Array.isArray(value) ? value : [value]
    for (const item of list) {
      const path = String(item ?? '').trim()
      if (path && path !== '*') out.push(path)
    }
  }
  return out
}

/**
 * Reject queries that would reveal restricted values indirectly: filtering,
 * sorting, grouping, aggregating, or looking up by a field the caller cannot read.
 */
export async function assertReadableQuery(
  me: MeUser | null | undefined,
  entity: string,
  input: {
    filter?: unknown
    sort?: string[] | null
    groupBy?: string[] | null
    aggregate?: Record<string, unknown> | null
    paths?: Array<string | null | undefined>
  },
): Promise<void> {
  if (bypassesFieldSecurity(me)) return
  if (input.filter) await assertFilterReadable(me, entity, input.filter, 0)
  const paths = [
    ...(input.sort ?? []),
    ...(input.groupBy ?? []),
    ...aggregateFieldPaths(input.aggregate),
    ...(input.paths ?? []),
  ]
  for (const path of paths) {
    if (path) await assertFieldPathReadable(me, entity, path)
  }
}

/** Reject an explicit write target (bulk actions) the caller may not edit. */
export async function assertFieldEditable(
  me: MeUser | null | undefined,
  entity: string,
  field: string,
): Promise<void> {
  await assertFieldsEditable(me, entity, [field])
}

/**
 * Schema metadata for non-admins: unreadable fields render hidden (`restricted`),
 * uneditable ones read-only (`writeRestricted`) so clients never send them.
 */
export function applyFieldAccessToSchemaField<
  T extends { apiName: string; hidden: boolean; readonly: boolean },
>(
  field: T,
  access: FieldAccess | null,
): T & { restricted: boolean; writeRestricted: boolean } {
  const restricted = Boolean(access?.unreadable.has(field.apiName))
  const writeRestricted = Boolean(access?.uneditable.has(field.apiName))
  if (!access) return { ...field, restricted, writeRestricted }
  return {
    ...field,
    hidden: field.hidden || restricted,
    readonly: field.readonly || writeRestricted,
    restricted,
    writeRestricted,
  }
}
