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
import { updateEntityMeta } from '../crm-bff/src/schema/entityMeta.ts'
import {
  createRegistryField,
  updateRegistryField,
} from '../crm-bff/src/schema/fieldRegistry.ts'
import { seedFullPermissionsForRole } from '../crm-bff/src/services/rolePermissions.ts'
import {
  postgresUpsertDashboard,
  postgresUpsertPanel,
} from '../crm-bff/src/adapters/postgresDashboards.ts'
import { upsertLayoutSettingRow } from '../crm-bff/src/schema/layoutSettings.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

interface PackManifest {
  id: string
  label: string
  entitiesFile: string
  rolesFile: string
  layoutsFile: string
  recordsFile?: string
  dashboardsFile?: string
  navigationFile?: string
  platformFile?: string
}

interface PackDashboard {
  id: string
  name: string
  icon?: string | null
  note?: string | null
  color?: string | null
}

interface PackPanel {
  id: string
  dashboard: string
  name?: string | null
  icon?: string | null
  color?: string | null
  showHeader?: boolean | null
  note?: string | null
  type: string
  positionX?: number | null
  positionY?: number | null
  width?: number | null
  height?: number | null
  options?: Record<string, unknown> | null
}

interface PackNavigationApp {
  settingId: string
  name: string
  roleId?: string | null
  groupKey?: string
  subGroup?: string | null
  body: Record<string, unknown>
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
  /** Stable public id (payload.__meta.settingId). Required for Record Page → Block Layout refs. */
  settingId?: string | null
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function ensureLayout(layout: PackLayout): Promise<void> {
  const payload = asRecord(layout.payload)
  const meta = asRecord(payload.__meta)
  const settingId = String(
    layout.settingId || meta.settingId || '',
  ).trim() || null
  const roleId =
    (layout.roleId != null && String(layout.roleId).trim()) ||
    (meta.role != null && String(meta.role).trim()) ||
    null
  const name =
    (typeof payload.name === 'string' && payload.name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    null

  // Preserve settingId so Record Page pageLayoutId / blockLayoutId refs keep working.
  const { __meta: _drop, ...body } = payload
  await upsertLayoutSettingRow({
    settingId,
    entityApiName: layout.entityApiName,
    groupKey: layout.groupKey,
    subGroup: layout.subGroup ?? null,
    roleId,
    name,
    body,
  })
}

const tableColumnCache = new Map<string, Set<string>>()

async function tableColumns(entityApiName: string): Promise<Set<string>> {
  const table = assertSafeIdent(entityApiName)
  const cached = tableColumnCache.get(table)
  if (cached) return cached
  const rows = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'crm_schema' AND table_name = $1`,
    [table],
  )
  const cols = new Set(rows.map((r) => r.column_name))
  tableColumnCache.set(table, cols)
  return cols
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
  const cols = await tableColumns(table)
  if (!cols.has('record_id')) {
    throw new Error(`crm_schema.${table} has no record_id column`)
  }

  const status = record.status?.trim() || 'published'
  const data = record.data && typeof record.data === 'object' ? record.data : {}
  const columns =
    record.columns && typeof record.columns === 'object' ? record.columns : {}

  // Only write physical columns that exist (status/data are optional by DDL envelope).
  const colNames = Object.keys(columns).filter(
    (k) => /^[a-z][a-z0-9_]*$/.test(k) && cols.has(k) && k !== 'record_id',
  )
  const insertCols = ['record_id']
  const insertVals: unknown[] = [recordId]
  const updates: string[] = []

  if (cols.has('status')) {
    insertCols.push('status')
    insertVals.push(status)
    updates.push('status = EXCLUDED.status')
  }
  if (cols.has('data')) {
    insertCols.push('data')
    insertVals.push(JSON.stringify(data))
    updates.push('data = EXCLUDED.data')
  }
  for (const k of colNames) {
    insertCols.push(k)
    insertVals.push(columns[k])
    updates.push(`"${k}" = EXCLUDED."${k}"`)
  }
  if (cols.has('updated_at')) {
    updates.push('updated_at = now()')
  }

  const placeholders = insertVals.map((_, i) => {
    const col = insertCols[i]
    if (col === 'data') return `$${i + 1}::jsonb`
    return `$${i + 1}`
  })

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
const dashboardsPath = resolve(
  packDir,
  manifest.dashboardsFile || 'dashboards.json',
)
const dashboardsDoc = existsSync(dashboardsPath)
  ? readJson<{ dashboards?: PackDashboard[]; panels?: PackPanel[] }>(
      dashboardsPath,
    )
  : { dashboards: [], panels: [] }
const navigationPath = resolve(
  packDir,
  manifest.navigationFile || 'navigation.json',
)
const navigationDoc = existsSync(navigationPath)
  ? readJson<{ apps?: PackNavigationApp[] }>(navigationPath)
  : { apps: [] }
const platformPath = resolve(
  packDir,
  manifest.platformFile || 'platform.json',
)
const platformDoc = existsSync(platformPath)
  ? readJson<{ entities?: PackEntity[] }>(platformPath)
  : { entities: [] }

console.log(`Applying domain pack: ${manifest.label} (${manifest.id})`)

const packEntityNames: string[] = []

for (const entity of entitiesDoc.entities ?? []) {
  const apiName = entity.apiName.trim().toLowerCase()
  packEntityNames.push(apiName)

  if (await entityExists(apiName)) {
    console.log(`  entity exists: ${apiName} (sync meta)`)
    await updateEntityMeta(apiName, {
      label: entity.label,
      icon: entity.icon ?? null,
      displayTemplate: entity.displayTemplate ?? null,
      hidden: Boolean(entity.hidden),
      singleton: Boolean(entity.singleton),
    })
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

// PLATFORM overlays: do not create entities — update meta + custom fields on kernel seeds.
for (const entity of platformDoc.entities ?? []) {
  const apiName = entity.apiName.trim().toLowerCase()
  if (!(await entityExists(apiName))) {
    console.warn(`  skip platform overlay (missing entity): ${apiName}`)
    continue
  }
  console.log(`  platform overlay: ${apiName}`)
  if (entity.displayTemplate != null || entity.label) {
    await updateEntityMeta(apiName, {
      label: entity.label,
      displayTemplate: entity.displayTemplate ?? undefined,
    })
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

// Prefer pack entity order (parents first), then any leftover record buckets.
const recordBuckets = recordsDoc.recordsByEntity ?? {}
const recordEntityOrder = [
  ...packEntityNames.filter((name) => recordBuckets[name]?.length),
  ...Object.keys(recordBuckets).filter(
    (name) => !packEntityNames.includes(name) && recordBuckets[name]?.length,
  ),
]

type PendingRecord = { entityApiName: string; record: PackRecord }
const pending: PendingRecord[] = []
for (const entityApiName of recordEntityOrder) {
  for (const record of recordBuckets[entityApiName] ?? []) {
    pending.push({ entityApiName, record })
  }
}

const maxPasses = 5
let remaining = pending
for (let pass = 1; pass <= maxPasses && remaining.length; pass += 1) {
  console.log(`  records pass ${pass}: ${remaining.length} pending`)
  const next: PendingRecord[] = []
  let applied = 0
  for (const item of remaining) {
    try {
      await upsertPackRecord(item.entityApiName, item.record)
      applied += 1
    } catch (err) {
      next.push(item)
      if (pass === maxPasses) {
        console.warn(
          `    skip record ${item.entityApiName}/${item.record.recordId}: ${
            err instanceof Error ? err.message : err
          }`,
        )
      }
    }
  }
  console.log(`    applied ${applied}, still pending ${next.length}`)
  if (next.length === remaining.length) break
  remaining = next
}

for (const dashboard of dashboardsDoc.dashboards ?? []) {
  const id = String(dashboard.id || '').trim()
  const name = String(dashboard.name || '').trim()
  if (!id || !name) continue
  await postgresUpsertDashboard({
    id,
    name,
    icon: dashboard.icon ?? null,
    note: dashboard.note ?? null,
    color: dashboard.color ?? null,
  })
  console.log(`  dashboard: ${name} (${id})`)
}

for (const panel of dashboardsDoc.panels ?? []) {
  const id = String(panel.id || '').trim()
  const dashboard = String(panel.dashboard || '').trim()
  const type = String(panel.type || '').trim()
  if (!id || !dashboard || !type) continue
  await postgresUpsertPanel({
    id,
    dashboard,
    name: panel.name ?? null,
    icon: panel.icon ?? null,
    color: panel.color ?? null,
    show_header: panel.showHeader ?? true,
    note: panel.note ?? null,
    type,
    position_x: panel.positionX ?? 0,
    position_y: panel.positionY ?? 0,
    width: panel.width ?? 1,
    height: panel.height ?? 1,
    options: panel.options ?? {},
  })
  console.log(`  panel: ${panel.name || type} (${id}) → ${dashboard}`)
}

for (const app of navigationDoc.apps ?? []) {
  const settingId = String(app.settingId || '').trim()
  const name = String(app.name || '').trim()
  if (!settingId || !name) continue
  const body = { ...(app.body ?? {}), name, label: (app.body?.label as string) || name }
  await upsertLayoutSettingRow({
    settingId,
    entityApiName: 'crm_navigation',
    groupKey: app.groupKey || 'app',
    subGroup: app.subGroup || 'full',
    roleId: app.roleId ?? null,
    name,
    body,
  })
  console.log(`  navigation: ${name} (${settingId})`)
}

console.log(`Done. Pack entities: ${packEntityNames.join(', ') || '(none)'}`)
await pool.end()
