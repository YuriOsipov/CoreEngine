/**
 * Apply a CoreEngine domain pack (sales | clinic | …) onto an already-provisioned kernel DB.
 *
 * Usage (repo root):
 *   npm run platform:apply-pack -- sales
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import {
  createRegistryEntity,
  ensureUserEditableNameField,
} from '../crm-bff/src/schema/entityRegistry.ts'
import {
  createRegistryField,
  updateRegistryField,
} from '../crm-bff/src/schema/fieldRegistry.ts'
import { seedFullPermissionsForRole } from '../crm-bff/src/services/rolePermissions.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

interface PackManifest {
  id: string
  label: string
  entitiesFile: string
  rolesFile: string
  layoutsFile: string
  recordsFile?: string
}

interface PackField {
  apiName: string
  label: string
  type: string
  interface: string
  required?: boolean
  readonly?: boolean
  hidden?: boolean
  options?: Record<string, unknown>
  displayOptions?: Record<string, unknown>
  isUnique?: boolean
  isIndexed?: boolean
  relationKind?: string
  relatedEntity?: string
  junctionEntity?: string
  relationMeta?: Record<string, unknown>
}

interface PackEntity {
  apiName: string
  label: string
  icon?: string
  group?: string
  displayTemplate?: string
  hidden?: boolean
  singleton?: boolean
  fields?: PackField[]
}

interface PackRole {
  name: string
  isAdmin?: boolean
  permissions?: 'full_pack' | 'none'
}

interface PackLayout {
  entityApiName: string
  groupKey: string
  subGroup?: string | null
  roleId?: string | null
  payload: Record<string, unknown>
}

interface PackRecord {
  recordId: string
  status?: string
  data?: Record<string, unknown>
  columns?: Record<string, unknown>
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function assertSafeIdent(ident: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(ident)) {
    throw new Error(`Unsafe identifier: ${ident}`)
  }
  return ident
}

async function entityExists(apiName: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
    [apiName],
  )
  return Boolean(rows[0])
}

async function findFieldId(
  entityApiName: string,
  fieldApiName: string,
): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT f.id::text AS id
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1 AND e.deleted_at IS NULL AND f.api_name = $2
     LIMIT 1`,
    [entityApiName, fieldApiName],
  )
  return rows[0]?.id ?? null
}

async function ensureRole(name: string, isAdmin: boolean): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.app_roles WHERE lower(name) = lower($1) LIMIT 1`,
    [name],
  )
  if (existing[0]?.id) return existing[0].id

  const id = randomUUID()
  await query(
    `INSERT INTO public.app_roles (id, name, is_admin, backend_role_id)
     VALUES ($1::uuid, $2, $3, $4)`,
    [id, name, isAdmin, id],
  )
  return id
}

async function ensureLayout(layout: PackLayout): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.layout_settings
     WHERE entity_api_name = $1
       AND group_key = $2
       AND COALESCE(sub_group, '') = COALESCE($3, '')
       AND COALESCE(role_id, '') = COALESCE($4, '')
     LIMIT 1`,
    [
      layout.entityApiName,
      layout.groupKey,
      layout.subGroup ?? null,
      layout.roleId ?? null,
    ],
  )
  if (existing[0]) {
    await query(
      `UPDATE public.layout_settings
       SET payload = $2::jsonb, updated_at = now()
       WHERE id = $1::uuid`,
      [existing[0].id, JSON.stringify(layout.payload ?? {})],
    )
    return
  }
  await query(
    `INSERT INTO public.layout_settings (
       id, entity_api_name, group_key, sub_group, role_id, payload
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)`,
    [
      randomUUID(),
      layout.entityApiName,
      layout.groupKey,
      layout.subGroup ?? null,
      layout.roleId ?? null,
      JSON.stringify(layout.payload ?? {}),
    ],
  )
}

async function upsertPackRecord(entityApiName: string, record: PackRecord): Promise<void> {
  const table = assertSafeIdent(entityApiName)
  const exists = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`crm_schema.${table}`],
  )
  if (!exists[0]?.exists) {
    console.log(`    skip records for ${table}: table missing (run DDL/sync first)`)
    return
  }

  const recordId = String(record.recordId || '').trim()
  if (!recordId) return
  const status = record.status?.trim() || 'published'
  const data = record.data && typeof record.data === 'object' ? record.data : {}
  const columns =
    record.columns && typeof record.columns === 'object' ? record.columns : {}

  const colNames = Object.keys(columns).filter((k) => /^[a-z][a-z0-9_]*$/.test(k))
  const insertCols = ['record_id', 'status', 'data', ...colNames]
  const insertVals = [
    recordId,
    status,
    JSON.stringify(data),
    ...colNames.map((k) => columns[k]),
  ]
  const placeholders = insertVals.map((_, i) => {
    if (i === 2) return `$${i + 1}::jsonb`
    return `$${i + 1}`
  })
  const updates = [
    'status = EXCLUDED.status',
    'data = EXCLUDED.data',
    'updated_at = now()',
    ...colNames.map((k) => `"${k}" = EXCLUDED."${k}"`),
  ]

  await query(
    `INSERT INTO crm_schema."${table}" (${insertCols.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (record_id) DO UPDATE SET ${updates.join(', ')}`,
    insertVals,
  )
}

const packId = process.argv[2]?.trim().toLowerCase()
if (!packId || packId.startsWith('-')) {
  console.error('Usage: apply-domain-pack.mts <sales|clinic|…>')
  process.exit(1)
}

const packDir = resolve(repoRoot, 'supabase', 'domains', packId)
const manifest = readJson<PackManifest>(resolve(packDir, 'pack.json'))
const entitiesDoc = readJson<{ entities: PackEntity[] }>(
  resolve(packDir, manifest.entitiesFile),
)
const rolesDoc = readJson<{ roles: PackRole[] }>(resolve(packDir, manifest.rolesFile))
const layoutsDoc = readJson<{ layouts: PackLayout[] }>(
  resolve(packDir, manifest.layoutsFile),
)
const recordsPath = resolve(packDir, manifest.recordsFile || 'records.json')
const recordsDoc = existsSync(recordsPath)
  ? readJson<{ recordsByEntity?: Record<string, PackRecord[]> }>(recordsPath)
  : { recordsByEntity: {} }

console.log(`Applying domain pack: ${manifest.label} (${manifest.id})`)

const packEntityNames: string[] = []

for (const entity of entitiesDoc.entities ?? []) {
  const apiName = entity.apiName.trim().toLowerCase()
  packEntityNames.push(apiName)

  if (await entityExists(apiName)) {
    console.log(`  entity exists: ${apiName}`)
  } else {
    console.log(`  create entity: ${apiName}`)
    await createRegistryEntity(
      {
        apiName,
        label: entity.label,
        icon: entity.icon ?? null,
        group: entity.group ?? null,
        displayTemplate: entity.displayTemplate ?? null,
        hidden: Boolean(entity.hidden),
        singleton: Boolean(entity.singleton),
      },
      { applyDdl: true },
    )
  }

  for (const field of entity.fields ?? []) {
    const fieldApi = field.apiName.trim().toLowerCase()
    const existingId = await findFieldId(apiName, fieldApi)
    const input = {
      apiName: fieldApi,
      label: field.label,
      type: field.type,
      interface: field.interface,
      required: field.required,
      readonly: field.readonly,
      hidden: field.hidden,
      options: field.options ?? null,
      displayOptions: field.displayOptions ?? null,
      isUnique: field.isUnique,
      isIndexed: field.isIndexed,
      relationKind: field.relationKind ?? null,
      relatedEntity: field.relatedEntity ?? null,
      junctionEntity: field.junctionEntity ?? null,
      relationMeta: field.relationMeta ?? null,
    }
    if (existingId) {
      console.log(`    update field: ${apiName}.${fieldApi}`)
      await updateRegistryField(existingId, input, {
        applyDdl: true,
        entityApiName: apiName,
      })
    } else {
      console.log(`    create field: ${apiName}.${fieldApi}`)
      await createRegistryField(apiName, input, { applyDdl: true })
    }
  }

  await ensureUserEditableNameField(apiName)
}

for (const role of rolesDoc.roles ?? []) {
  const roleId = await ensureRole(role.name, Boolean(role.isAdmin))
  console.log(`  role: ${role.name} (${roleId})`)
  if (role.permissions === 'full_pack' || role.permissions == null) {
    await seedFullPermissionsForRole(roleId)
  }
}

for (const layout of layoutsDoc.layouts ?? []) {
  await ensureLayout(layout)
  console.log(`  layout: ${layout.entityApiName}/${layout.groupKey}`)
}

for (const [entityApiName, records] of Object.entries(
  recordsDoc.recordsByEntity ?? {},
)) {
  console.log(`  records: ${entityApiName} (${records.length})`)
  for (const record of records) {
    await upsertPackRecord(entityApiName, record)
  }
}

console.log(`Done. Pack entities: ${packEntityNames.join(', ') || '(none)'}`)
await pool.end()
