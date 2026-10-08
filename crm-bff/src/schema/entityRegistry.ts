/**
 * Registry entity create (Object Manager → New Object).
 * Seeds standard system fields and optionally creates crm_schema table.
 */
import { query } from '../db/pool.js'
import { clearComputedFieldMetaCache } from '../computed/fieldMeta.js'
import { ensureAutoNumberCounter } from '../computed/applyAutoNumber.js'
import { buildAutoNumberFieldOptions } from '../computed/autoNumberFormat.js'
import {
  clearCrmStorageCache,
  quoteIdent,
  resolveCrmStorageConfig,
} from './crmStorage.js'
import { applyDdlActions, planEntityDdlSync } from './ddlSync.js'
import {
  applyUniqueIndexActions,
  planUniqueIndexActions,
} from './uniqueGroups.js'

export interface RegistryEntityCreateInput {
  apiName: string
  label: string
  note?: string | null
  icon?: string | null
  singleton?: boolean
  hidden?: boolean
  displayTemplate?: string | null
  group?: string | null
  /**
   * `junction` seeds only Id + created_at — M2M join rows also get the two FK
   * fields from createM2MRegistryField (e.g. item_id, related_item_id).
   * Default `full` seeds Name (Auto Number) and the rest for business objects.
   */
  systemFieldProfile?: 'full' | 'junction'
}

export interface RegistryEntityRow {
  id: string
  apiName: string
  label: string
  icon: string | null
  singleton: boolean
  group: string | null
  displayTemplate: string | null
  backendTarget: string
  backendConfig: Record<string, unknown>
  hidden: boolean
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
      `Invalid object apiName "${apiName}": use snake_case starting with a letter`,
    )
  }
  if (apiName.length > 63) {
    throw new Error(`Invalid object apiName "${apiName}": max 63 characters`)
  }
}

interface SystemFieldSeed {
  apiName: string
  label: string
  fieldType: string
  interface: string
  readonly: boolean
  hidden: boolean
  sort: number
  isUnique?: boolean
  isIndexed?: boolean
}

const SYSTEM_FIELDS: SystemFieldSeed[] = [
  {
    apiName: 'id',
    label: 'Id',
    fieldType: 'UUID',
    interface: 'input',
    readonly: true,
    hidden: false,
    sort: 0,
  },
  {
    apiName: 'name',
    label: 'Name',
    fieldType: 'STRING',
    interface: 'input',
    readonly: true,
    hidden: false,
    sort: 1,
    isUnique: true,
    isIndexed: true,
  },
  {
    apiName: 'status',
    label: 'Status',
    fieldType: 'STRING',
    interface: 'select-dropdown',
    readonly: false,
    hidden: false,
    sort: 10,
  },
  {
    apiName: 'sort',
    label: 'Sort',
    fieldType: 'INTEGER',
    interface: 'input',
    readonly: false,
    hidden: false,
    sort: 20,
  },
  {
    apiName: 'user_created',
    label: 'User Created',
    fieldType: 'UUID',
    interface: 'select-dropdown-m2o',
    readonly: true,
    hidden: false,
    sort: 30,
  },
  {
    apiName: 'date_created',
    label: 'Date Created',
    fieldType: 'DATETIME',
    interface: 'datetime',
    readonly: true,
    hidden: false,
    sort: 40,
  },
  {
    apiName: 'user_updated',
    label: 'User Updated',
    fieldType: 'UUID',
    interface: 'select-dropdown-m2o',
    readonly: true,
    hidden: false,
    sort: 50,
  },
  {
    apiName: 'date_updated',
    label: 'Date Updated',
    fieldType: 'DATETIME',
    interface: 'datetime',
    readonly: true,
    hidden: false,
    sort: 60,
  },
]

/** Lean M2M junction system fields (FKs are added separately). */
const JUNCTION_SYSTEM_FIELDS: SystemFieldSeed[] = [
  {
    apiName: 'id',
    label: 'Id',
    fieldType: 'UUID',
    interface: 'input',
    readonly: true,
    hidden: true,
    sort: 0,
  },
  {
    apiName: 'created_at',
    label: 'Created At',
    fieldType: 'DATETIME',
    interface: 'datetime',
    readonly: true,
    hidden: true,
    sort: 40,
  },
]

/** System api_names stripped from legacy junctions (replaced by lean profile). */
const JUNCTION_STRIP_SYSTEM_FIELDS = [
  'name',
  'status',
  'sort',
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
] as const

function statusFieldOptions(): Record<string, unknown> {
  return {
    choices: [
      { text: 'Published', value: 'published' },
      { text: 'Draft', value: 'draft' },
      { text: 'Archived', value: 'archived' },
    ],
    default: 'published',
  }
}

function nameFieldOptions(): Record<string, unknown> {
  return buildAutoNumberFieldOptions({
    displayFormat: '{0000}',
    startingNumber: 1,
  })
}

function mapEntityRow(row: Record<string, unknown>): RegistryEntityRow {
  return {
    id: String(row.id),
    apiName: String(row.api_name),
    label: String(row.label ?? row.api_name),
    icon: row.icon ? String(row.icon) : null,
    singleton: Boolean(row.singleton),
    group: row.entity_group ? String(row.entity_group) : null,
    displayTemplate: row.display_template ? String(row.display_template) : null,
    backendTarget: String(row.backend_target ?? 'SUPABASE'),
    backendConfig: asObject(row.backend_config),
    hidden: Boolean(row.hidden),
  }
}

async function seedSystemFields(
  entityId: string,
  profile: 'full' | 'junction' = 'full',
): Promise<void> {
  const fields = profile === 'junction' ? JUNCTION_SYSTEM_FIELDS : SYSTEM_FIELDS
  for (const field of fields) {
    const options =
      field.apiName === 'status'
        ? statusFieldOptions()
        : field.apiName === 'name'
          ? nameFieldOptions()
          : {}
    const isName = field.apiName === 'name'
    const inserted = await query<{ id: string }>(
      isName
        ? `INSERT INTO public.fields (
             entity_id, api_name, label, field_type, interface,
             options, display_options, required, readonly, hidden, sort,
             is_system, is_unique, is_indexed
           ) VALUES (
             $1::uuid, $2, $3, $4, $5,
             $6::jsonb, '{}'::jsonb, false, $7, $8, $9,
             true, $10, $11
           )
           ON CONFLICT (entity_id, api_name) DO UPDATE SET
             label = COALESCE(NULLIF(BTRIM(public.fields.label), ''), EXCLUDED.label),
             is_system = true,
             options = CASE
               WHEN public.fields.options IS NOT NULL
                 AND public.fields.options <> '{}'::jsonb
               THEN public.fields.options
               ELSE EXCLUDED.options
             END,
             updated_at = now()
           RETURNING id::text AS id`
        : `INSERT INTO public.fields (
             entity_id, api_name, label, field_type, interface,
             options, display_options, required, readonly, hidden, sort,
             is_system, is_unique, is_indexed
           ) VALUES (
             $1::uuid, $2, $3, $4, $5,
             $6::jsonb, '{}'::jsonb, false, $7, $8, $9,
             true, $10, $11
           )
           ON CONFLICT (entity_id, api_name) DO NOTHING
           RETURNING id::text AS id`,
      [
        entityId,
        field.apiName,
        field.label,
        field.fieldType,
        field.interface,
        JSON.stringify(options),
        field.readonly,
        field.hidden,
        field.sort,
        Boolean(field.isUnique),
        Boolean(field.isIndexed || field.isUnique),
      ],
    )
    if (isName) {
      const fieldId =
        inserted[0]?.id ??
        (
          await query<{ id: string }>(
            `SELECT id::text AS id FROM public.fields
             WHERE entity_id = $1::uuid AND api_name = 'name'
             LIMIT 1`,
            [entityId],
          )
        )[0]?.id
      if (fieldId) {
        await ensureAutoNumberCounter(fieldId, 1)
      }
    }
  }
}

/**
 * Create a registry object (+ system fields). When applyDdl is true, creates
 * crm_schema.<api_name> typed table.
 */
export async function createRegistryEntity(
  input: RegistryEntityCreateInput,
  options?: { applyDdl?: boolean },
): Promise<RegistryEntityRow> {
  const apiName = normalizeApiName(input.apiName)
  assertApiName(apiName)

  const label = String(input.label || apiName).trim() || apiName
  const profile = input.systemFieldProfile === 'junction' ? 'junction' : 'full'
  const defaultDisplayTemplate = profile === 'junction' ? '' : '{{name}}'
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim()
      : null
  const backendConfig: Record<string, unknown> = {
    storage: 'typed',
    accountability: 'all',
  }
  if (note) backendConfig.note = note
  if (profile === 'junction') backendConfig.internal = true

  const existing = await query<{
    id: string
    deleted_at: string | null
    backend_target: string
  }>(
    `SELECT id::text AS id,
            deleted_at::text AS deleted_at,
            backend_target
     FROM public.entities
     WHERE api_name = $1
     LIMIT 1`,
    [apiName],
  )
  const existingRow = existing[0]
  if (existingRow && !existingRow.deleted_at) {
    throw new Error(
      `Object apiName "${apiName}" already exists. Open it from Object Manager or choose another API name.`,
    )
  }

  if (
    apiName === 'files' ||
    apiName === 'users' ||
    apiName === 'roles' ||
    apiName === 'setting' ||
    apiName.startsWith('_')
  ) {
    throw new Error(`Object apiName "${apiName}" is reserved`)
  }

  // Soft-deleted api_name: restore and refresh metadata so Object Manager
  // can recreate with the same name (UNIQUE(api_name) is global).
  if (existingRow?.deleted_at) {
    if (String(existingRow.backend_target || '').toUpperCase() === 'PLATFORM') {
      throw new Error(`Object apiName "${apiName}" is reserved`)
    }

    const restored = await query(
      `UPDATE public.entities
       SET label = $2,
           icon = $3,
           singleton = $4,
           entity_group = $5,
           display_template = COALESCE(
             NULLIF($6, ''),
             display_template,
             NULLIF($9, '')
           ),
           backend_config = $7::jsonb,
           hidden = $8,
           deleted_at = NULL,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [
        existingRow.id,
        label,
        input.icon?.trim() || null,
        Boolean(input.singleton),
        input.group?.trim() || null,
        input.displayTemplate?.trim() || '',
        JSON.stringify(backendConfig),
        Boolean(input.hidden),
        defaultDisplayTemplate,
      ],
    )
    const row = restored[0]
    if (!row) throw new Error('Failed to restore object')

    await seedSystemFields(String(row.id), profile)
    if (profile === 'junction') {
      await ensureLeanJunctionEntity(apiName, {
        applyDdl: options?.applyDdl !== false,
      })
    }
    clearCrmStorageCache()
    clearComputedFieldMetaCache()

    if (options?.applyDdl !== false) {
      const ddl = await planEntityDdlSync(apiName, {
        includeFk: true,
        includeBackfill: true,
      })
      await applyDdlActions(ddl)
      const unique = await planUniqueIndexActions(apiName)
      if (unique.length) await applyUniqueIndexActions(unique)
      clearCrmStorageCache()
    }

    return mapEntityRow(row)
  }

  const inserted = await query(
    `INSERT INTO public.entities (
       api_name, label, icon, singleton, entity_group, display_template,
       backend_target, backend_config, hidden
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       'SUPABASE', $7::jsonb, $8
     )
     RETURNING *`,
    [
      apiName,
      label,
      input.icon?.trim() || null,
      Boolean(input.singleton),
      input.group?.trim() || null,
      input.displayTemplate?.trim() || defaultDisplayTemplate,
      JSON.stringify(backendConfig),
      Boolean(input.hidden),
    ],
  )
  const row = inserted[0]
  if (!row) throw new Error('Failed to create object')

  await seedSystemFields(String(row.id), profile)

  clearCrmStorageCache()
  clearComputedFieldMetaCache()

  if (options?.applyDdl !== false) {
    const ddl = await planEntityDdlSync(apiName, {
      includeFk: true,
      includeBackfill: true,
    })
    await applyDdlActions(ddl)
    const unique = await planUniqueIndexActions(apiName)
    if (unique.length) await applyUniqueIndexActions(unique)
    clearCrmStorageCache()
  }

  return mapEntityRow(row)
}

/**
 * Soft-delete a registry object (sets deleted_at). Does not DROP crm_schema table.
 */
export async function deleteRegistryEntity(entityApiName: string): Promise<boolean> {
  const apiName = normalizeApiName(entityApiName)
  if (!apiName) throw new Error('entity apiName is required')

  const rows = await query<{
    id: string
    backend_target: string
    deleted_at: string | null
  }>(
    `SELECT id::text AS id, backend_target, deleted_at::text AS deleted_at
     FROM public.entities
     WHERE api_name = $1
     LIMIT 1`,
    [apiName],
  )
  const row = rows[0]
  if (!row) return false
  if (row.deleted_at) return true

  if (String(row.backend_target || '').toUpperCase() === 'PLATFORM') {
    throw new Error(`Refusing to delete PLATFORM object: ${apiName}`)
  }
  if (
    apiName === 'files' ||
    apiName === 'users' ||
    apiName === 'roles' ||
    apiName === 'setting' ||
    apiName.startsWith('_')
  ) {
    throw new Error(`Refusing to delete reserved object: ${apiName}`)
  }

  await query(
    `UPDATE public.entities
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [row.id],
  )

  clearCrmStorageCache()
  clearComputedFieldMetaCache()
  return true
}

/**
 * Lean M2M junction: keep Id + created_at (+ FK fields). Drop legacy system
 * columns like name/status/sort/audit that were seeded for normal objects.
 */
export async function ensureLeanJunctionEntity(
  entityApiName: string,
  options?: { applyDdl?: boolean },
): Promise<void> {
  const apiName = normalizeApiName(entityApiName)
  if (!apiName) return

  const entities = await query<{ id: string; backend_config: unknown }>(
    `SELECT id::text AS id, backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [apiName],
  )
  const entity = entities[0]
  if (!entity) return

  await seedSystemFields(entity.id, 'junction')

  await query(
    `DELETE FROM public.fields
     WHERE entity_id = $1::uuid
       AND api_name = ANY($2::text[])`,
    [entity.id, [...JUNCTION_STRIP_SYSTEM_FIELDS]],
  )
  await query(
    `UPDATE public.entities
     SET display_template = CASE
           WHEN display_template IS NULL
             OR btrim(display_template) = ''
             OR display_template = '{{name}}'
           THEN NULL
           ELSE display_template
         END,
         backend_config = COALESCE(backend_config, '{}'::jsonb) || '{"internal": true}'::jsonb,
         hidden = true,
         updated_at = now()
     WHERE id = $1::uuid`,
    [entity.id],
  )

  clearCrmStorageCache()
  clearComputedFieldMetaCache()

  if (options?.applyDdl === false) return

  const storage = resolveCrmStorageConfig(entity.backend_config, apiName)
  if (storage.storage !== 'typed' || !storage.table) return

  const unique = await planUniqueIndexActions(apiName)
  if (unique.length) await applyUniqueIndexActions(unique)

  for (const column of JUNCTION_STRIP_SYSTEM_FIELDS) {
    await query(
      `ALTER TABLE ${quoteIdent(storage.schema)}.${quoteIdent(storage.table)}
       DROP COLUMN IF EXISTS ${quoteIdent(column)}`,
    )
  }

  await query(
    `ALTER TABLE ${quoteIdent(storage.schema)}.${quoteIdent(storage.table)}
     ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
  )
}

/** @deprecated Use ensureLeanJunctionEntity */
export async function stripSystemNameFromJunctionEntity(
  entityApiName: string,
  options?: { applyDdl?: boolean },
): Promise<void> {
  return ensureLeanJunctionEntity(entityApiName, options)
}
