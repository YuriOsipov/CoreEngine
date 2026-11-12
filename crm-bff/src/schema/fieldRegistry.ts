/**
 * Registry field + relation CRUD (Salesforce-style Fields & Relationships).
 * Physical crm_schema columns are applied via ddlSync when applyDdl is true.
 */
import { query } from '../db/pool.js'
import {
  loadStoredSensitivityByEntity,
  requiredComputedSensitivity,
} from '../computed/computedSensitivity.js'
import { clearComputedFieldMetaCache } from '../computed/fieldMeta.js'
import { clampSensitivity, clearFieldSecurityCache } from '../services/fieldSecurity.js'
import { syncAutoNumberCounterFromOptions } from '../computed/applyAutoNumber.js'
import {
  clearCrmStorageCache,
  normalizeFloatFieldOptions,
  normalizeOnDelete,
  resolveCrmStorageConfig,
  shouldPromoteField,
} from './crmStorage.js'
import { applyDdlActions, planEntityDdlSync, type DdlAction } from './ddlSync.js'
import {
  applyUniqueIndexActions,
  planUniqueIndexActions,
} from './uniqueGroups.js'
import { createRegistryEntity, ensureLeanJunctionEntity } from './entityRegistry.js'
import {
  resolveEntityDefaultFieldSensitivity,
  updateEntityMeta,
} from './entityMeta.js'
import { clearRecordRelationsCache } from '../adapters/records/relations.js'
import { clearUsersProfileColumnCache } from '../adapters/postgresUsers.js'
import {
  isUsersAssetCollection,
  USERS_RESERVED_COLUMNS,
} from '../users/userNames.js'

const FIELD_TYPES = new Set([
  'STRING',
  'INTEGER',
  'FLOAT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'UUID',
  'JSON',
  'ALIAS',
])

/** UI aliases accepted then stored as STRING / JSON / UUID. */
const FIELD_TYPE_ALIASES: Record<string, string> = {
  TEXT: 'STRING',
  ADDRESS: 'JSON',
  IMAGE: 'UUID',
}

const RELATION_KINDS = new Set(['M2O', 'O2M', 'M2M', 'M2A'])

export interface RegistryFieldInput {
  apiName: string
  label: string
  type: string
  interface: string
  required?: boolean
  readonly?: boolean
  hidden?: boolean
  sort?: number
  options?: Record<string, unknown> | null
  displayOptions?: Record<string, unknown> | null
  isUnique?: boolean
  /** Optional btree index on crm_schema column (scalars). Lookups always indexed. */
  isIndexed?: boolean
  /** Field-level security tier: 0 none, 1 restricted, 2 confidential. */
  sensitivity?: number | null
  /** When set, upsert a relation on this field (M2O / M2M supported from Setup). */
  relationKind?: string | null
  relatedEntity?: string | null
  junctionEntity?: string | null
  relationMeta?: Record<string, unknown> | null
}

export interface RegistryFieldRow {
  id: string
  apiName: string
  label: string
  type: string
  interface: string
  options: Record<string, unknown>
  displayOptions: Record<string, unknown>
  labelTranslations: Array<{ language: string; label: string }>
  required: boolean
  readonly: boolean
  hidden: boolean
  sort: number
  isSystem: boolean
  isUnique: boolean
  isIndexed: boolean
  sensitivity: number
  relationKind: string | null
  relatedEntityApiName: string | null
  junctionEntityApiName: string | null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeApiName(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function assertApiName(apiName: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(apiName)) {
    throw new Error(
      `Invalid field apiName "${apiName}": use snake_case starting with a letter`,
    )
  }
}

function normalizeFieldType(raw: string): string {
  const upper = String(raw || 'STRING').trim().toUpperCase()
  const type = FIELD_TYPE_ALIASES[upper] ?? upper
  if (!FIELD_TYPES.has(type)) {
    throw new Error(
      `Unsupported field type "${raw}". Use: ${[...FIELD_TYPES].join(', ')} (or TEXT→STRING)`,
    )
  }
  return type
}

export function defaultInterfaceForType(type: string, relationKind?: string | null): string {
  if (relationKind === 'M2O') return 'select-dropdown-m2o'
  if (relationKind === 'O2M') return 'list-o2m'
  if (relationKind === 'M2M') return 'list-m2m'
  if (relationKind === 'M2A') return 'list-m2a'
  switch (String(type || '').toUpperCase()) {
    case 'BOOLEAN':
      return 'boolean'
    case 'INTEGER':
    case 'FLOAT':
      return 'input'
    case 'DATE':
    case 'DATETIME':
      return 'datetime'
    case 'JSON':
      return 'input-code'
    case 'ALIAS':
      return 'presentation'
    case 'UUID':
    case 'STRING':
    default:
      return 'input'
  }
}

function mapFieldRow(row: Record<string, unknown>): RegistryFieldRow {
  const labelTranslations = Array.isArray(row.label_translations)
    ? (row.label_translations as Array<{ language?: string; label?: string }>).map(
        (t) => ({
          language: String(t.language ?? ''),
          label: String(t.label ?? ''),
        }),
      )
    : []
  return {
    id: String(row.id),
    apiName: String(row.api_name),
    label: String(row.label ?? row.api_name),
    type: String(row.field_type),
    interface: String(row.interface),
    options: asObject(row.options),
    displayOptions: asObject(row.display_options),
    labelTranslations,
    required: Boolean(row.required),
    readonly: Boolean(row.readonly),
    hidden: Boolean(row.hidden),
    sort: Number(row.sort ?? 0),
    isSystem: Boolean(row.is_system),
    isUnique: Boolean(row.is_unique),
    isIndexed: Boolean(row.is_indexed),
    sensitivity: clampSensitivity(row.sensitivity),
    relationKind: row.relation_kind ? String(row.relation_kind) : null,
    relatedEntityApiName: row.related_entity_api_name
      ? String(row.related_entity_api_name)
      : null,
    junctionEntityApiName: row.junction_entity_api_name
      ? String(row.junction_entity_api_name)
      : null,
  }
}

async function resolveEntityRow(entityApiName: string): Promise<{
  id: string
  backend_target: string
  backend_config: unknown
}> {
  const rows = await query<{
    id: string
    backend_target: string
    backend_config: unknown
  }>(
    `SELECT id::text AS id, backend_target, backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const row = rows[0]
  if (!row) throw new Error(`Entity not found: ${entityApiName}`)
  return row
}

async function resolveEntityId(entityApiName: string): Promise<string> {
  return (await resolveEntityRow(entityApiName)).id
}

function shouldApplyTypedDdl(
  backendTarget: string,
  backendConfig: unknown,
  entityApiName: string,
): boolean {
  // PLATFORM `users` maps to public.app_users — custom fields need DDL there.
  if (isUsersAssetCollection(entityApiName)) return true
  const target = String(backendTarget).toUpperCase()
  if (target === 'HASURA') return true
  if (target !== 'SUPABASE') return false
  return resolveCrmStorageConfig(backendConfig, entityApiName).storage === 'typed'
}

/**
 * Plan ADD COLUMN for custom User profile fields on public.app_users.
 * Never coerce/drop reserved auth columns; skip jsonb backfill / CRM FKs.
 */
async function planUsersAppUsersDdl(entityApiName: string): Promise<DdlAction[]> {
  const planned = await planEntityDdlSync(entityApiName, {
    schema: 'public',
    table: 'app_users',
    includeFk: false,
    includeBackfill: false,
  })
  return planned.filter((action) => {
    if (action.type === 'CREATE_TABLE') return false
    if (action.type === 'BACKFILL_COLUMN') return false
    if (action.type === 'CREATE_FK') return false
    if (action.type === 'COERCE_FK_TEXT' || action.type === 'COERCE_COLUMN_TYPE') {
      return false
    }
    if (action.fieldApiName && USERS_RESERVED_COLUMNS.has(action.fieldApiName)) {
      return false
    }
    return true
  })
}

async function applyDdlAndUniques(entityApiName: string): Promise<void> {
  const entity = await resolveEntityRow(entityApiName)
  if (isUsersAssetCollection(entityApiName)) {
    const ddl = await planUsersAppUsersDdl(entityApiName)
    await applyDdlActions(ddl)
    clearUsersProfileColumnCache()
    return
  }
  if (String(entity.backend_target).toUpperCase() === 'HASURA') {
    const { syncHasuraEntityColumns } = await import(
      '../adapters/records/backends/hasura/ddl.js'
    )
    const result = await syncHasuraEntityColumns(entityApiName, { dryRun: false })
    if (result.errors.length > 0) {
      const detail = result.errors
        .map((e) => (e.field ? `${e.field}: ${e.error}` : e.error))
        .join('; ')
      throw new Error(`Hasura DDL partially failed: ${detail}`)
    }
    return
  }
  const ddl = await planEntityDdlSync(entityApiName, {
    includeFk: true,
    includeBackfill: true,
  })
  await applyDdlActions(ddl)
  const unique = await planUniqueIndexActions(entityApiName)
  if (unique.length) await applyUniqueIndexActions(unique)
}

async function resolveEntityIdOptional(apiName: string | null | undefined): Promise<string | null> {
  if (!apiName?.trim()) return null
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [apiName.trim()],
  )
  if (!rows[0]) throw new Error(`Related entity not found: ${apiName}`)
  return rows[0].id
}

async function bumpEntitySyncVersion(entityId: string): Promise<void> {
  await query(
    `UPDATE public.entities
     SET sync_version = sync_version + 1,
         updated_at = now()
     WHERE id = $1::uuid`,
    [entityId],
  )
}

async function loadFieldById(fieldId: string): Promise<RegistryFieldRow | null> {
  const rows = await query(
    `SELECT f.*,
            r.kind AS relation_kind,
            re.api_name AS related_entity_api_name,
            je.api_name AS junction_entity_api_name
     FROM public.fields f
     LEFT JOIN public.relations r ON r.field_id = f.id
     LEFT JOIN public.entities re ON re.id = r.related_entity_id
     LEFT JOIN public.entities je ON je.id = r.junction_entity_id
     WHERE f.id = $1::uuid
     LIMIT 1`,
    [fieldId],
  )
  return rows[0] ? mapFieldRow(rows[0]) : null
}

export async function listRegistryFields(
  entityApiName: string,
): Promise<RegistryFieldRow[]> {
  const entityId = await resolveEntityId(entityApiName)
  const rows = await query(
    `SELECT f.*,
            r.kind AS relation_kind,
            re.api_name AS related_entity_api_name,
            je.api_name AS junction_entity_api_name
     FROM public.fields f
     LEFT JOIN public.relations r ON r.field_id = f.id
     LEFT JOIN public.entities re ON re.id = r.related_entity_id
     LEFT JOIN public.entities je ON je.id = r.junction_entity_id
     WHERE f.entity_id = $1::uuid
     ORDER BY f.sort ASC, f.api_name ASC`,
    [entityId],
  )
  return rows.map((row) => mapFieldRow(row))
}

async function upsertRelation(options: {
  entityId: string
  fieldId: string
  kind: string
  relatedEntityId: string | null
  junctionEntityId: string | null
  meta: Record<string, unknown>
}): Promise<void> {
  const kind = String(options.kind).toUpperCase()
  if (!RELATION_KINDS.has(kind)) {
    throw new Error(`Unsupported relation kind: ${options.kind}`)
  }
  if (kind === 'M2O' && !options.relatedEntityId) {
    throw new Error('M2O requires relatedEntity')
  }
  if (kind === 'M2M' && !options.relatedEntityId) {
    throw new Error('M2M requires relatedEntity')
  }
  if (kind === 'M2M' && !options.junctionEntityId) {
    throw new Error('M2M requires junctionEntity')
  }

  const existing = await query<{ id: string; meta: unknown }>(
    `SELECT id::text AS id, meta FROM public.relations WHERE field_id = $1::uuid LIMIT 1`,
    [options.fieldId],
  )

  const meta =
    kind === 'M2O'
      ? buildM2ORelationMeta(options.meta, asObject(existing[0]?.meta))
      : options.meta

  if (existing[0]) {
    await query(
      `UPDATE public.relations
       SET kind = $2,
           related_entity_id = $3::uuid,
           junction_entity_id = $4::uuid,
           meta = $5::jsonb,
           updated_at = now()
       WHERE id = $1::uuid`,
      [
        existing[0].id,
        kind,
        options.relatedEntityId,
        options.junctionEntityId,
        JSON.stringify(meta),
      ],
    )
    return
  }

  await query(
    `INSERT INTO public.relations (
       entity_id, field_id, kind, related_entity_id, junction_entity_id, meta
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::jsonb
     )`,
    [
      options.entityId,
      options.fieldId,
      kind,
      options.relatedEntityId,
      options.junctionEntityId,
      JSON.stringify(meta),
    ],
  )
}

/** Merge + normalize `on_delete` for M2O FKs (default RESTRICT). */
function buildM2ORelationMeta(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged = { ...existing, ...incoming }
  const raw =
    incoming.on_delete !== undefined
      ? incoming.on_delete
      : existing.on_delete !== undefined
        ? existing.on_delete
        : undefined
  merged.on_delete = normalizeOnDelete(raw)
  return merged
}

async function entityExists(apiName: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [apiName],
  )
  return Boolean(rows[0]?.id)
}

function humanizeApiName(apiName: string): string {
  return apiName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Setup M2M: auto-create (or reuse) a junction object marked Hidden + Internal,
 * two M2O FKs on the junction, and an ALIAS list-m2m field on the parent.
 */
async function createM2MRegistryField(
  entityApiName: string,
  input: RegistryFieldInput,
  options?: { applyDdl?: boolean },
): Promise<RegistryFieldRow> {
  const parentApiName = normalizeApiName(entityApiName)
  const relatedApiName = normalizeApiName(String(input.relatedEntity || ''))
  if (!relatedApiName) {
    throw new Error('M2M requires relatedEntity')
  }
  await resolveEntityRow(relatedApiName)

  const fieldApiName = normalizeApiName(input.apiName)
  assertApiName(fieldApiName)
  const applyDdl = options?.applyDdl !== false

  const requestedJunction = input.junctionEntity
    ? normalizeApiName(String(input.junctionEntity))
    : ''
  const junctionApiName =
    requestedJunction || `${parentApiName}_${relatedApiName}`

  const selfRelation = parentApiName === relatedApiName
  const parentFkField = `${parentApiName}_id`
  const relatedFkField = selfRelation
    ? `related_${relatedApiName}_id`
    : `${relatedApiName}_id`

  if (!(await entityExists(junctionApiName))) {
    await createRegistryEntity(
      {
        apiName: junctionApiName,
        label: `${humanizeApiName(parentApiName)} ${humanizeApiName(relatedApiName)}`,
        hidden: true,
        note: `Auto-created M2M junction for ${parentApiName}.${fieldApiName}`,
        systemFieldProfile: 'junction',
        displayTemplate: null,
      },
      { applyDdl },
    )
  }
  // Lean junction: id + created_at + FKs only (strip legacy name/status/…).
  await ensureLeanJunctionEntity(junctionApiName, { applyDdl })
  // Hide within the App + Internal (Object Manager / pickers).
  await updateEntityMeta(junctionApiName, {
    hidden: true,
    internal: true,
  })

  const junctionFields = await listRegistryFields(junctionApiName)
  const hasParentFk = junctionFields.some((field) => field.apiName === parentFkField)
  const hasRelatedFk = junctionFields.some((field) => field.apiName === relatedFkField)

  if (!hasParentFk) {
    await createRegistryField(
      junctionApiName,
      {
        apiName: parentFkField,
        label: humanizeApiName(parentApiName),
        type: 'UUID',
        interface: 'select-dropdown-m2o',
        required: true,
        isIndexed: true,
        sensitivity: 0,
        relationKind: 'M2O',
        relatedEntity: parentApiName,
      },
      { applyDdl },
    )
  }

  if (!hasRelatedFk) {
    await createRegistryField(
      junctionApiName,
      {
        apiName: relatedFkField,
        label: humanizeApiName(relatedApiName),
        type: 'UUID',
        interface: 'select-dropdown-m2o',
        required: true,
        isIndexed: true,
        sensitivity: 0,
        relationKind: 'M2O',
        relatedEntity: relatedApiName,
        relationMeta: {
          // Junction "other side" expand shape (one_field null → treated as M2O expand).
        },
      },
      { applyDdl },
    )
  }

  const parentEntity = await resolveEntityRow(parentApiName)
  const relatedEntityId = await resolveEntityId(relatedApiName)
  const junctionEntityId = await resolveEntityId(junctionApiName)

  const sort =
    input.sort ??
    Number(
      (
        await query<{ next: string }>(
          `SELECT COALESCE(MAX(sort), 0) + 10 AS next
           FROM public.fields WHERE entity_id = $1::uuid`,
          [parentEntity.id],
        )
      )[0]?.next ?? 10,
    )

  const inserted = await query<{ id: string }>(
    `INSERT INTO public.fields (
       entity_id, api_name, label, field_type, interface,
       options, display_options, required, readonly, hidden, sort, is_unique, is_indexed
     ) VALUES (
       $1::uuid, $2, $3, 'ALIAS', 'list-m2m',
       $4::jsonb, $5::jsonb, false, $6, $7, $8, false, false
     )
     RETURNING id::text AS id`,
    [
      parentEntity.id,
      fieldApiName,
      String(input.label || fieldApiName).trim() || fieldApiName,
      JSON.stringify(asObject(input.options)),
      JSON.stringify(asObject(input.displayOptions)),
      Boolean(input.readonly),
      Boolean(input.hidden),
      sort,
    ],
  )
  const fieldId = inserted[0]?.id
  if (!fieldId) throw new Error('Failed to create M2M field')

  await upsertRelation({
    entityId: parentEntity.id,
    fieldId,
    kind: 'M2M',
    relatedEntityId,
    junctionEntityId,
    meta: {
      ...asObject(input.relationMeta),
      one_collection: parentApiName,
      one_field: fieldApiName,
      many_collection: junctionApiName,
      many_field: parentFkField,
      junction_field: relatedFkField,
    },
  })

  await bumpEntitySyncVersion(parentEntity.id)
  clearCrmStorageCache()
  clearRecordRelationsCache()
  clearComputedFieldMetaCache()
  clearFieldSecurityCache()

  // Parent+related pair must be unique on the junction (no duplicate M2M links).
  await query(
    `UPDATE public.entities
     SET backend_config = jsonb_set(
           COALESCE(backend_config, '{}'::jsonb),
           '{uniqueGroups}',
           COALESCE(backend_config->'uniqueGroups', '[]'::jsonb) || $2::jsonb,
           true
         ),
         updated_at = now()
     WHERE api_name = $1
       AND deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(backend_config->'uniqueGroups', '[]'::jsonb)) g
         WHERE g->'fields' = $3::jsonb
       )`,
    [
      junctionApiName,
      JSON.stringify([
        {
          name: 'm2m_link',
          fields: [parentFkField, relatedFkField],
        },
      ]),
      JSON.stringify([parentFkField, relatedFkField]),
    ],
  )
  if (applyDdl) {
    const unique = await planUniqueIndexActions(junctionApiName)
    if (unique.length) await applyUniqueIndexActions(unique)
  }

  const row = await loadFieldById(fieldId)
  if (!row) throw new Error('M2M field created but could not be reloaded')
  return row
}

export async function createRegistryField(
  entityApiName: string,
  input: RegistryFieldInput,
  options?: { applyDdl?: boolean },
): Promise<RegistryFieldRow> {
  const relationKind = input.relationKind
    ? String(input.relationKind).toUpperCase()
    : null
  if (relationKind === 'M2M') {
    return createM2MRegistryField(entityApiName, input, options)
  }

  const entity = await resolveEntityRow(entityApiName)
  const entityId = entity.id
  const apiName = normalizeApiName(input.apiName)
  assertApiName(apiName)

  let fieldType = normalizeFieldType(input.type || 'STRING')
  if (relationKind && !RELATION_KINDS.has(relationKind)) {
    throw new Error(`Unsupported relation kind: ${input.relationKind}`)
  }
  if (relationKind && relationKind !== 'M2O') {
    throw new Error(
      `Creating ${relationKind} relations from Setup is not supported yet (use M2O, M2M, or scalar fields).`,
    )
  }

  const iface =
    String(input.interface || '').trim() ||
    defaultInterfaceForType(fieldType, relationKind)

  const relatedEntityId = await resolveEntityIdOptional(input.relatedEntity)
  const junctionEntityId = await resolveEntityIdOptional(input.junctionEntity)

  const sort =
    input.sort ??
    Number(
      (
        await query<{ next: string }>(
          `SELECT COALESCE(MAX(sort), 0) + 10 AS next
           FROM public.fields WHERE entity_id = $1::uuid`,
          [entityId],
        )
      )[0]?.next ?? 10,
    )

  const fieldOptions =
    fieldType === 'FLOAT'
      ? normalizeFloatFieldOptions(input.options)
      : asObject(input.options)

  // Explicit 0/1/2 wins; omitted/null uses entity backend_config.defaultFieldSensitivity.
  // Formula/rollup fields inherit at least the max sensitivity of their sources.
  let sensitivity =
    input.sensitivity === undefined || input.sensitivity === null
      ? await resolveEntityDefaultFieldSensitivity(entityApiName)
      : clampSensitivity(input.sensitivity)
  try {
    const sourceMap = await loadStoredSensitivityByEntity()
    const required = await requiredComputedSensitivity(
      entityApiName,
      fieldOptions,
      iface,
      sourceMap,
    )
    if (required > sensitivity) sensitivity = required
  } catch {
    // Pre-migration / empty registry: keep requested sensitivity.
  }

  const inserted = await query<{ id: string }>(
    `INSERT INTO public.fields (
       entity_id, api_name, label, field_type, interface,
       options, display_options, required, readonly, hidden, sort, is_unique, is_indexed,
       sensitivity
     ) VALUES (
       $1::uuid, $2, $3, $4, $5,
       $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14
     )
     RETURNING id::text AS id`,
    [
      entityId,
      apiName,
      String(input.label || apiName).trim() || apiName,
      fieldType,
      iface,
      JSON.stringify(fieldOptions),
      JSON.stringify(asObject(input.displayOptions)),
      Boolean(input.required),
      Boolean(input.readonly),
      Boolean(input.hidden),
      sort,
      Boolean(input.isUnique),
      Boolean(input.isIndexed) || Boolean(relationKind),
      sensitivity,
    ],
  )
  const fieldId = inserted[0]?.id
  if (!fieldId) throw new Error('Failed to create field')

  if (relationKind) {
    const meta = {
      ...asObject(input.relationMeta),
      ...(input.relatedEntity
        ? { one_collection: input.relatedEntity }
        : {}),
    }
    await upsertRelation({
      entityId,
      fieldId,
      kind: relationKind,
      relatedEntityId,
      junctionEntityId,
      meta,
    })
  }

  await bumpEntitySyncVersion(entityId)
  clearCrmStorageCache()
  clearComputedFieldMetaCache()
  clearFieldSecurityCache()

  const canDdl =
    options?.applyDdl !== false &&
    shouldApplyTypedDdl(entity.backend_target, entity.backend_config, entityApiName)

  if (canDdl && shouldPromoteField(apiName, fieldType)) {
    await applyDdlAndUniques(entityApiName)
  } else if (canDdl && input.isUnique) {
    const unique = await planUniqueIndexActions(entityApiName)
    if (unique.length) await applyUniqueIndexActions(unique)
  }

  const row = await loadFieldById(fieldId)
  if (!row) throw new Error('Field created but could not be reloaded')
  return row
}

export async function updateRegistryField(
  fieldId: string,
  input: Partial<RegistryFieldInput>,
  options?: { applyDdl?: boolean; entityApiName?: string },
): Promise<RegistryFieldRow> {
  const existing = await query<{
    id: string
    entity_id: string
    api_name: string
    field_type: string
    options: Record<string, unknown> | null
    is_system: boolean
    entity_api_name: string
    relation_kind: string | null
  }>(
    `SELECT f.id::text AS id,
            f.entity_id::text AS entity_id,
            f.api_name,
            f.field_type,
            f.options,
            f.is_system,
            e.api_name AS entity_api_name,
            r.kind AS relation_kind
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     LEFT JOIN public.relations r ON r.field_id = f.id
     WHERE f.id = $1::uuid
     LIMIT 1`,
    [fieldId],
  )
  const current = existing[0]
  if (!current) throw new Error(`Field not found: ${fieldId}`)
  if (current.is_system && input.apiName && normalizeApiName(input.apiName) !== current.api_name) {
    throw new Error('Cannot rename a system field')
  }

  const entityApiName = options?.entityApiName || current.entity_api_name
  const nextApiName = input.apiName
    ? normalizeApiName(input.apiName)
    : current.api_name
  if (input.apiName) assertApiName(nextApiName)

  let nextType = input.type
    ? normalizeFieldType(input.type)
    : current.field_type

  // Renaming or changing type of existing physical columns is opt-in via applyDdl;
  // we update registry always. DDL engine adds missing columns; does not rename/drop.
  if (nextApiName !== current.api_name && current.is_system) {
    throw new Error('Cannot rename a system field')
  }

  const currentRelationKind = current.relation_kind
    ? String(current.relation_kind).toUpperCase()
    : null
  const relationKind = input.relationKind
    ? String(input.relationKind).toUpperCase()
    : undefined
  // Label / flags on an existing M2M (O2M, M2A) are allowed. Converting a
  // different field *into* those kinds from Setup is still blocked.
  if (
    relationKind &&
    relationKind !== 'M2O' &&
    relationKind !== currentRelationKind &&
    RELATION_KINDS.has(relationKind)
  ) {
    throw new Error(
      `Updating to ${relationKind} from Setup is not supported yet.`,
    )
  }

  const iface =
    input.interface !== undefined
      ? String(input.interface || '').trim() ||
        defaultInterfaceForType(nextType, relationKind ?? null)
      : undefined

  let nextOptionsJson: string | null = null
  if (input.options !== undefined || String(nextType).toUpperCase() === 'FLOAT') {
    const baseOptions =
      input.options !== undefined
        ? asObject(input.options)
        : asObject(current.options)
    nextOptionsJson =
      String(nextType).toUpperCase() === 'FLOAT'
        ? JSON.stringify(normalizeFloatFieldOptions(baseOptions))
        : input.options !== undefined
          ? JSON.stringify(baseOptions)
          : null
  }

  let nextSensitivity: number | null =
    input.sensitivity != null ? clampSensitivity(input.sensitivity) : null
  // When options/sensitivity change, bump formula/rollup to max(source tiers).
  if (
    nextOptionsJson != null ||
    input.sensitivity !== undefined ||
    iface !== undefined
  ) {
    try {
      const currentFull = await loadFieldById(fieldId)
      const effectiveOptions =
        nextOptionsJson != null
          ? asObject(JSON.parse(nextOptionsJson) as unknown)
          : asObject(current.options)
      const effectiveIface =
        iface ?? String(currentFull?.interface || current.field_type || '')
      const sourceMap = await loadStoredSensitivityByEntity()
      const required = await requiredComputedSensitivity(
        String(current.entity_api_name),
        effectiveOptions,
        effectiveIface,
        sourceMap,
      )
      const baseline =
        nextSensitivity ??
        clampSensitivity(currentFull?.sensitivity ?? 0)
      if (required > baseline) nextSensitivity = required
    } catch {
      // Keep requested sensitivity when registry lookup fails.
    }
  }

  await query(
    `UPDATE public.fields SET
       api_name = COALESCE($2, api_name),
       label = COALESCE($3, label),
       field_type = COALESCE($4, field_type),
       interface = COALESCE($5, interface),
       options = COALESCE($6::jsonb, options),
       display_options = COALESCE($7::jsonb, display_options),
       required = COALESCE($8, required),
       readonly = COALESCE($9, readonly),
       hidden = COALESCE($10, hidden),
       sort = COALESCE($11, sort),
       is_unique = COALESCE($12, is_unique),
       is_indexed = COALESCE($13, is_indexed),
       sensitivity = COALESCE($14, sensitivity),
       updated_at = now()
     WHERE id = $1::uuid`,
    [
      fieldId,
      input.apiName ? nextApiName : null,
      input.label !== undefined ? String(input.label).trim() : null,
      input.type ? nextType : null,
      iface ?? null,
      nextOptionsJson,
      input.displayOptions !== undefined
        ? JSON.stringify(asObject(input.displayOptions))
        : null,
      input.required !== undefined ? Boolean(input.required) : null,
      input.readonly !== undefined ? Boolean(input.readonly) : null,
      input.hidden !== undefined ? Boolean(input.hidden) : null,
      input.sort !== undefined ? Number(input.sort) : null,
      input.isUnique !== undefined ? Boolean(input.isUnique) : null,
      input.isIndexed !== undefined
        ? Boolean(input.isIndexed) ||
          String(input.relationKind || '').toUpperCase() === 'M2O'
        : null,
      nextSensitivity,
    ],
  )

  if (input.relationKind !== undefined) {
    if (!input.relationKind) {
      await query(`DELETE FROM public.relations WHERE field_id = $1::uuid`, [fieldId])
    } else {
      const nextKind = String(input.relationKind).toUpperCase()
      // Keep existing M2M / O2M / M2A topology. Setup does not send junction
      // ids on edit, and upsertRelation would otherwise fail.
      if (!(nextKind === currentRelationKind && nextKind !== 'M2O')) {
        const relatedEntityId = await resolveEntityIdOptional(input.relatedEntity)
        const junctionEntityId = await resolveEntityIdOptional(input.junctionEntity)
        await upsertRelation({
          entityId: current.entity_id,
          fieldId,
          kind: nextKind,
          relatedEntityId,
          junctionEntityId,
          meta: {
            ...asObject(input.relationMeta),
            ...(input.relatedEntity
              ? { one_collection: input.relatedEntity }
              : {}),
          },
        })
      }
    }
  } else if (input.relatedEntity !== undefined) {
    // Update related entity on existing relation
    const rel = await query<{ id: string; kind: string }>(
      `SELECT id::text AS id, kind FROM public.relations WHERE field_id = $1::uuid LIMIT 1`,
      [fieldId],
    )
    if (rel[0]) {
      const relatedEntityId = await resolveEntityIdOptional(input.relatedEntity)
      const junctionEntityId = await resolveEntityIdOptional(input.junctionEntity)
      await upsertRelation({
        entityId: current.entity_id,
        fieldId,
        kind: rel[0].kind,
        relatedEntityId,
        junctionEntityId,
        meta: {
          ...asObject(input.relationMeta),
          ...(input.relatedEntity
            ? { one_collection: input.relatedEntity }
            : {}),
        },
      })
    }
  }

  await bumpEntitySyncVersion(current.entity_id)
  clearCrmStorageCache()
  clearComputedFieldMetaCache()
  clearFieldSecurityCache()

  if (input.options !== undefined) {
    await syncAutoNumberCounterFromOptions(fieldId, asObject(input.options))
  }

  if (options?.applyDdl !== false) {
    const entity = await resolveEntityRow(entityApiName)
    if (
      shouldApplyTypedDdl(
        entity.backend_target,
        entity.backend_config,
        entityApiName,
      )
    ) {
      await applyDdlAndUniques(entityApiName)
    }
  }

  const row = await loadFieldById(fieldId)
  if (!row) throw new Error('Field updated but could not be reloaded')
  return row
}

export async function deleteRegistryField(
  entityApiName: string,
  fieldApiName: string,
  options?: { applyDdl?: boolean },
): Promise<boolean> {
  const entityId = await resolveEntityId(entityApiName)
  const rows = await query<{ id: string; is_system: boolean }>(
    `SELECT id::text AS id, is_system
     FROM public.fields
     WHERE entity_id = $1::uuid AND api_name = $2
     LIMIT 1`,
    [entityId, fieldApiName],
  )
  const field = rows[0]
  if (!field) return false
  if (field.is_system) {
    throw new Error(`Refusing to delete system field: ${fieldApiName}`)
  }

  await query(`DELETE FROM public.fields WHERE id = $1::uuid`, [field.id])
  await bumpEntitySyncVersion(entityId)
  clearCrmStorageCache()
  clearComputedFieldMetaCache()
  clearFieldSecurityCache()
  if (isUsersAssetCollection(entityApiName)) {
    clearUsersProfileColumnCache()
  }

  // Do not DROP physical columns by default (data safety). applyDdl only refreshes indexes.
  if (options?.applyDdl) {
    if (isUsersAssetCollection(entityApiName)) {
      await applyDdlAndUniques(entityApiName)
    } else {
      const unique = await planUniqueIndexActions(entityApiName)
      await applyUniqueIndexActions(unique)
    }
  }

  return true
}

/** Map service row → GraphQL Field shape (+ relation extras ignored by Field type). */
export function toGraphQlField(row: RegistryFieldRow) {
  return {
    id: row.id,
    apiName: row.apiName,
    label: row.label,
    type: row.type,
    interface: row.interface,
    options: row.options,
    displayOptions: row.displayOptions,
    labelTranslations: row.labelTranslations,
    required: row.required,
    readonly: row.readonly,
    hidden: row.hidden,
    sort: row.sort,
    isSystem: row.isSystem,
    isUnique: row.isUnique,
    isIndexed: row.isIndexed,
    sensitivity: row.sensitivity,
    restricted: false,
    writeRestricted: false,
  }
}
