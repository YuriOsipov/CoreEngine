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
  deleteRegistryField,
  updateRegistryField,
} from '../crm-bff/src/schema/fieldRegistry.ts'
import {
  seedFullPermissionsForRole,
  setRoleOwnerBypassOnEntities,
} from '../crm-bff/src/services/rolePermissions.ts'
import {
  postgresUpsertDashboard,
  postgresUpsertPanel,
} from '../crm-bff/src/adapters/postgresDashboards.ts'
import { upsertLayoutSettingRow } from '../crm-bff/src/schema/layoutSettings.ts'
import {
  loadEntityAutomations,
  saveEntityAutomations,
  type EntityRecordAutomation,
} from '../crm-bff/src/schema/recordAutomations.ts'

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
  /** Merged into entities.backend_config (e.g. rowLevelSecurity: "owner"). */
  backendConfig?: {
    rowLevelSecurity?: 'owner' | null
    defaultFieldSensitivity?: number
    /** M2O field for parent-owner inheritance on create. */
    inheritOwnerFrom?: string | null
    /** Extra fields that grant read when equal to me (OR owner), e.g. ["to_user"]. */
    rowLevelReadAlsoIf?: string[]
    /** Peers with the same app role as the owner may read (MVP; Teams later). */
    rowLevelReadAlsoIfSameRole?: boolean
    /** Upserted by id into entities.backend_config.automations (does not wipe other rules). */
    automations?: EntityRecordAutomation[]
  }
  fields?: PackField[]
  /** Drop these registry fields if still present (does not DROP physical columns). */
  retireFields?: string[]
}

async function mergePackAutomations(
  apiName: string,
  packRules: EntityRecordAutomation[],
): Promise<void> {
  if (!packRules.length) return
  const existing = await loadEntityAutomations(apiName)
  const byId = new Map(existing.map((rule) => [rule.id, rule]))
  for (const rule of packRules) {
    const id = String(rule.id || '').trim()
    if (!id) continue
    byId.set(id, rule)
  }
  const merged = [...byId.values()]
  await saveEntityAutomations(apiName, merged)
  console.log(
    `    automations: upserted ${packRules.length} pack rule(s) → ${merged.length} total`,
  )
}

interface PackRole {
  name: string
  isAdmin?: boolean
  /** Non-admin roles may author reports scoped to their own role. */
  canAuthorReports?: boolean
  permissions?: 'full_pack' | 'none'
  /** After full_pack seed, set can_view_all on these entity api_names. */
  canViewAllOn?: string[]
  /** After full_pack seed, set can_modify_all (implies view all) on these api_names. */
  canModifyAllOn?: string[]
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

async function ensureRole(
  name: string,
  isAdmin: boolean,
  canAuthorReports = false,
): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.app_roles WHERE lower(name) = lower($1) LIMIT 1`,
    [name],
  )
  if (existing[0]?.id) {
    await query(
      `UPDATE public.app_roles
       SET is_admin = $2,
           can_author_reports = $3,
           updated_at = now()
       WHERE id = $1::uuid`,
      [existing[0].id, isAdmin, isAdmin ? false : canAuthorReports],
    )
    return existing[0].id
  }

  const id = randomUUID()
  await query(
    `INSERT INTO public.app_roles (id, name, is_admin, can_author_reports, backend_role_id)
     VALUES ($1::uuid, $2, $3, $4, $5)`,
    [id, name, isAdmin, isAdmin ? false : canAuthorReports, id],
  )
  return id
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Accept a role UUID or role name (e.g. "Reception", "Sales Rep") from pack JSON. */
async function resolvePackRoleId(raw: string | null | undefined): Promise<string | null> {
  const value = raw != null ? String(raw).trim() : ''
  if (!value) return null
  if (UUID_RE.test(value)) return value
  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.app_roles WHERE lower(name) = lower($1) LIMIT 1`,
    [value],
  )
  if (existing[0]?.id) return existing[0].id
  console.warn(`  skip role binding (unknown role name): ${value}`)
  return null
}

async function ensureLayout(layout: PackLayout): Promise<void> {
  const payload = asRecord(layout.payload)
  const meta = asRecord(payload.__meta)
  const settingId = String(
    layout.settingId || meta.settingId || '',
  ).trim() || null
  const roleId = await resolvePackRoleId(
    (layout.roleId != null && String(layout.roleId).trim()) ||
      (meta.role != null && String(meta.role).trim()) ||
      null,
  )
  const name =
    (typeof payload.name === 'string' && payload.name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    null

  // If this pack settingId is new but a same-named layout already exists
  // (customer-edited), do not insert a duplicate — leave theirs alone.
  // Users is a platform entity: never overwrite existing page/block layouts
  // (Setup edits must survive re-apply). Seed only on first insert.
  if (settingId && name) {
    const mapped = await query<{ id: string }>(
      `SELECT layout_setting_id::text AS id
       FROM public.layout_settings_id_map
       WHERE setting_id = $1
       LIMIT 1`,
      [settingId],
    )
    const byId = mapped[0]?.id
      ? mapped
      : await query<{ id: string }>(
          `SELECT id::text AS id FROM public.layout_settings WHERE id = $1::uuid LIMIT 1`,
          [settingId],
        )
    if (byId[0]?.id && layout.entityApiName === 'users') {
      console.log(
        `  skip layout (keep existing users): ${layout.entityApiName}/${layout.groupKey}`,
      )
      return
    }
    if (!byId[0]?.id) {
      const existingByName = await query<{ id: string }>(
        `SELECT id::text AS id
         FROM public.layout_settings
         WHERE entity_api_name = $1
           AND group_key = $2
           AND coalesce(sub_group, '') = coalesce($3, '')
           AND coalesce(payload->>'name', payload->'__meta'->>'name') = $4
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [
          layout.entityApiName,
          layout.groupKey,
          layout.subGroup ?? null,
          name,
        ],
      )
      if (existingByName[0]?.id) {
        console.log(
          `  skip layout (keep existing "${name}"): ${layout.entityApiName}/${layout.groupKey}`,
        )
        return
      }
    }
  }

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

  const rowLevelSecurity =
    entity.backendConfig && 'rowLevelSecurity' in entity.backendConfig
      ? entity.backendConfig.rowLevelSecurity
      : undefined
  const defaultFieldSensitivity =
    entity.backendConfig && 'defaultFieldSensitivity' in entity.backendConfig
      ? entity.backendConfig.defaultFieldSensitivity
      : undefined
  const inheritOwnerFrom =
    entity.backendConfig && 'inheritOwnerFrom' in entity.backendConfig
      ? entity.backendConfig.inheritOwnerFrom
      : undefined
  const rowLevelReadAlsoIf =
    entity.backendConfig && 'rowLevelReadAlsoIf' in entity.backendConfig
      ? entity.backendConfig.rowLevelReadAlsoIf
      : undefined
  const rowLevelReadAlsoIfSameRole =
    entity.backendConfig && 'rowLevelReadAlsoIfSameRole' in entity.backendConfig
      ? entity.backendConfig.rowLevelReadAlsoIfSameRole
      : undefined

  if (await entityExists(apiName)) {
    console.log(`  entity exists: ${apiName} (sync meta)`)
    await updateEntityMeta(apiName, {
      label: entity.label,
      icon: entity.icon ?? null,
      displayTemplate: entity.displayTemplate ?? null,
      hidden: Boolean(entity.hidden),
      singleton: Boolean(entity.singleton),
      ...(rowLevelSecurity !== undefined ? { rowLevelSecurity } : {}),
      ...(defaultFieldSensitivity !== undefined
        ? { defaultFieldSensitivity }
        : {}),
      ...(inheritOwnerFrom !== undefined ? { inheritOwnerFrom } : {}),
      ...(rowLevelReadAlsoIf !== undefined ? { rowLevelReadAlsoIf } : {}),
      ...(rowLevelReadAlsoIfSameRole !== undefined
        ? { rowLevelReadAlsoIfSameRole }
        : {}),
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
    if (
      rowLevelSecurity !== undefined ||
      defaultFieldSensitivity !== undefined ||
      inheritOwnerFrom !== undefined ||
      rowLevelReadAlsoIf !== undefined ||
      rowLevelReadAlsoIfSameRole !== undefined
    ) {
      await updateEntityMeta(apiName, {
        ...(rowLevelSecurity !== undefined ? { rowLevelSecurity } : {}),
        ...(defaultFieldSensitivity !== undefined
          ? { defaultFieldSensitivity }
          : {}),
        ...(inheritOwnerFrom !== undefined ? { inheritOwnerFrom } : {}),
        ...(rowLevelReadAlsoIf !== undefined ? { rowLevelReadAlsoIf } : {}),
        ...(rowLevelReadAlsoIfSameRole !== undefined
          ? { rowLevelReadAlsoIfSameRole }
          : {}),
      })
    }
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

  for (const retired of entity.retireFields ?? []) {
    const fieldApi = String(retired || '')
      .trim()
      .toLowerCase()
    if (!fieldApi) continue
    const removed = await deleteRegistryField(apiName, fieldApi, {
      allowSystem: true,
    })
    if (removed) console.log(`    retire field: ${apiName}.${fieldApi}`)
  }

  if (entity.backendConfig?.automations?.length) {
    await mergePackAutomations(apiName, entity.backendConfig.automations)
  }
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
  const roleId = await ensureRole(
    role.name,
    Boolean(role.isAdmin),
    Boolean(role.canAuthorReports),
  )
  console.log(`  role: ${role.name} (${roleId})`)
  if (role.permissions === 'full_pack' || role.permissions == null) {
    await seedFullPermissionsForRole(roleId)
  }
  if (role.canViewAllOn?.length || role.canModifyAllOn?.length) {
    await setRoleOwnerBypassOnEntities(roleId, {
      canViewAllOn: role.canViewAllOn,
      canModifyAllOn: role.canModifyAllOn,
    })
    console.log(
      `    owner bypass: viewAll=${(role.canViewAllOn ?? []).join(',') || '-'} ` +
        `modifyAll=${(role.canModifyAllOn ?? []).join(',') || '-'}`,
    )
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
    roleId: await resolvePackRoleId(app.roleId),
    name,
    body,
  })
  console.log(`  navigation: ${name} (${settingId})`)
}

console.log(`Done. Pack entities: ${packEntityNames.join(', ') || '(none)'}`)
await pool.end()
