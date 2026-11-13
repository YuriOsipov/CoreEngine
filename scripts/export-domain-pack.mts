/**
 * Export the current DB registry into a domain pack under supabase/domains/<id>/.
 *
 * Captures entities/fields/relations, layouts, non-admin roles, dashboards/panels,
 * navigation apps (`crm_navigation` settings), and optional crm_schema record snapshots.
 *
 * Usage (repo root):
 *   npm run platform:export-pack -- sales
 *   npm run platform:export-pack -- clinic
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from '../crm-bff/src/db/pool.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

interface PackManifest {
  id: string
  label: string
  description?: string
  entitiesFile: string
  rolesFile: string
  layoutsFile: string
  recordsFile?: string
  dashboardsFile?: string
  navigationFile?: string
  /** PLATFORM entity overlays (e.g. users custom fields + display template). */
  platformFile?: string
}

const SYSTEM_FIELD_NAMES = new Set([
  'id',
  'name',
  'status',
  'sort',
  'user_created',
  'date_created',
  'user_updated',
  'date_updated',
  'created_at',
])

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const packId = process.argv[2]?.trim().toLowerCase()
if (!packId || packId.startsWith('-')) {
  console.error('Usage: export-domain-pack.mts <sales|clinic|…>')
  process.exit(1)
}

const packDir = resolve(repoRoot, 'supabase', 'domains', packId)
mkdirSync(packDir, { recursive: true })

const manifestPath = resolve(packDir, 'pack.json')
const manifest: PackManifest = existsSync(manifestPath)
  ? readJson<PackManifest>(manifestPath)
  : {
      id: packId,
      label: `${packId} pack`,
      description: `Exported domain pack: ${packId}`,
      entitiesFile: 'entities.json',
      rolesFile: 'roles.json',
      layoutsFile: 'layouts.json',
      recordsFile: 'records.json',
      dashboardsFile: 'dashboards.json',
      navigationFile: 'navigation.json',
      platformFile: 'platform.json',
    }

if (!manifest.recordsFile) manifest.recordsFile = 'records.json'
if (!manifest.dashboardsFile) manifest.dashboardsFile = 'dashboards.json'
if (!manifest.navigationFile) manifest.navigationFile = 'navigation.json'
if (!manifest.platformFile) manifest.platformFile = 'platform.json'
manifest.id = packId

const entityRows = await query<{
  id: string
  api_name: string
  label: string
  icon: string | null
  singleton: boolean
  entity_group: string | null
  display_template: string | null
  backend_target: string
  backend_config: unknown
  hidden: boolean
}>(
  `SELECT id::text AS id, api_name, label, icon, singleton, entity_group,
          display_template, backend_target, backend_config, hidden
   FROM public.entities
   WHERE deleted_at IS NULL
     AND upper(COALESCE(backend_target, '')) <> 'PLATFORM'
     AND COALESCE((backend_config->>'internal')::boolean, false) = false
   ORDER BY api_name`,
)

const packEntities: Array<Record<string, unknown>> = []
const packEntityNames: string[] = []

for (const entity of entityRows) {
  packEntityNames.push(entity.api_name)

  const fieldRows = await query<{
    api_name: string
    label: string
    field_type: string
    interface: string | null
    options: unknown
    display_options: unknown
    required: boolean
    readonly: boolean
    hidden: boolean
    sort: number
    is_system: boolean
    is_unique: boolean
    is_indexed: boolean
    relation_kind: string | null
    related_api_name: string | null
    junction_api_name: string | null
    relation_meta: unknown
  }>(
    `SELECT f.api_name, f.label, f.field_type, f.interface, f.options, f.display_options,
            f.required, f.readonly, f.hidden, f.sort, f.is_system, f.is_unique, f.is_indexed,
            r.kind AS relation_kind,
            related.api_name AS related_api_name,
            junction.api_name AS junction_api_name,
            r.meta AS relation_meta
     FROM public.fields f
     LEFT JOIN public.relations r ON r.field_id = f.id
     LEFT JOIN public.entities related ON related.id = r.related_entity_id
     LEFT JOIN public.entities junction ON junction.id = r.junction_entity_id
     WHERE f.entity_id = $1::uuid
     ORDER BY f.sort ASC, f.api_name ASC`,
    [entity.id],
  )

  const fields = fieldRows
    .filter((f) => !f.is_system && !SYSTEM_FIELD_NAMES.has(f.api_name))
    .map((f) => {
      const out: Record<string, unknown> = {
        apiName: f.api_name,
        label: f.label,
        type: f.field_type,
        interface: f.interface || 'input',
      }
      if (f.required) out.required = true
      if (f.readonly) out.readonly = true
      if (f.hidden) out.hidden = true
      if (f.isUnique) out.isUnique = true
      if (f.isIndexed) out.isIndexed = true
      const options = asObject(f.options)
      if (Object.keys(options).length) out.options = options
      const displayOptions = asObject(f.display_options)
      if (Object.keys(displayOptions).length) out.displayOptions = displayOptions
      if (f.relation_kind) {
        out.relationKind = f.relation_kind
        if (f.related_api_name) out.relatedEntity = f.related_api_name
        if (f.junction_api_name) out.junctionEntity = f.junction_api_name
        const meta = asObject(f.relation_meta)
        if (Object.keys(meta).length) out.relationMeta = meta
      }
      return out
    })

  const entityOut: Record<string, unknown> = {
    apiName: entity.api_name,
    label: entity.label,
  }
  if (entity.icon) entityOut.icon = entity.icon
  if (entity.entity_group) entityOut.group = entity.entity_group
  if (entity.display_template) entityOut.displayTemplate = entity.display_template
  if (entity.hidden) entityOut.hidden = true
  if (entity.singleton) entityOut.singleton = true
  entityOut.fields = fields
  packEntities.push(entityOut)
}

async function exportEntityFields(entityId: string): Promise<Record<string, unknown>[]> {
  const fieldRows = await query<{
    api_name: string
    label: string
    field_type: string
    interface: string | null
    options: unknown
    display_options: unknown
    required: boolean
    readonly: boolean
    hidden: boolean
    sort: number
    is_system: boolean
    is_unique: boolean
    is_indexed: boolean
    relation_kind: string | null
    related_api_name: string | null
    junction_api_name: string | null
    relation_meta: unknown
  }>(
    `SELECT f.api_name, f.label, f.field_type, f.interface, f.options, f.display_options,
            f.required, f.readonly, f.hidden, f.sort, f.is_system, f.is_unique, f.is_indexed,
            r.kind AS relation_kind,
            related.api_name AS related_api_name,
            junction.api_name AS junction_api_name,
            r.meta AS relation_meta
     FROM public.fields f
     LEFT JOIN public.relations r ON r.field_id = f.id
     LEFT JOIN public.entities related ON related.id = r.related_entity_id
     LEFT JOIN public.entities junction ON junction.id = r.junction_entity_id
     WHERE f.entity_id = $1::uuid
     ORDER BY f.sort ASC, f.api_name ASC`,
    [entityId],
  )

  return fieldRows
    .filter((f) => !f.is_system && !SYSTEM_FIELD_NAMES.has(f.api_name))
    .map((f) => {
      const out: Record<string, unknown> = {
        apiName: f.api_name,
        label: f.label,
        type: f.field_type,
        interface: f.interface || 'input',
      }
      if (f.required) out.required = true
      if (f.readonly) out.readonly = true
      if (f.hidden) out.hidden = true
      if (f.isUnique) out.isUnique = true
      if (f.isIndexed) out.isIndexed = true
      const options = asObject(f.options)
      if (Object.keys(options).length) out.options = options
      const displayOptions = asObject(f.display_options)
      if (Object.keys(displayOptions).length) out.displayOptions = displayOptions
      if (f.relation_kind) {
        out.relationKind = f.relation_kind
        if (f.related_api_name) out.relatedEntity = f.related_api_name
        if (f.junction_api_name) out.junctionEntity = f.junction_api_name
        const meta = asObject(f.relation_meta)
        if (Object.keys(meta).length) out.relationMeta = meta
      }
      return out
    })
}

// PLATFORM overlays: custom fields + display template (kernel seeds defaults only).
const platformRows = await query<{
  id: string
  api_name: string
  label: string
  display_template: string | null
}>(
  `SELECT id::text AS id, api_name, label, display_template
   FROM public.entities
   WHERE deleted_at IS NULL
     AND upper(COALESCE(backend_target, '')) = 'PLATFORM'
   ORDER BY api_name`,
)
const platformEntities: Array<Record<string, unknown>> = []
const platformEntityNames: string[] = []
for (const entity of platformRows) {
  const fields = await exportEntityFields(entity.id)
  const hasCustomFields = fields.length > 0
  // users is PLATFORM+internal; still overlay custom fields + display template.
  const isUsers = entity.api_name === 'users'
  if (!hasCustomFields && !isUsers) continue
  platformEntityNames.push(entity.api_name)
  const out: Record<string, unknown> = {
    apiName: entity.api_name,
    label: entity.label,
    fields,
  }
  if (entity.display_template) out.displayTemplate = entity.display_template
  platformEntities.push(out)
}

const layoutEntityNames = [...packEntityNames, ...platformEntityNames]

const layoutRows = await query<{
  id: string
  entity_api_name: string
  group_key: string
  sub_group: string | null
  role_id: string | null
  payload: unknown
}>(
  layoutEntityNames.length
    ? `SELECT id::text AS id, entity_api_name, group_key, sub_group, role_id, payload
       FROM public.layout_settings
       WHERE entity_api_name = ANY($1::text[])
       ORDER BY entity_api_name, group_key, COALESCE(sub_group, ''), COALESCE(role_id, ''), id`
    : `SELECT id::text AS id, entity_api_name, group_key, sub_group, role_id, payload
       FROM public.layout_settings
       WHERE false`,
  layoutEntityNames.length ? [layoutEntityNames] : [],
)

const layouts = layoutRows.map((row) => {
  const payload = asObject(row.payload)
  const meta = asObject(payload.__meta)
  const settingId = String(meta.settingId ?? row.id)
  const roleFromMeta =
    meta.role != null && String(meta.role).trim()
      ? String(meta.role).trim()
      : null
  const out: Record<string, unknown> = {
    entityApiName: row.entity_api_name,
    groupKey: row.group_key,
    settingId,
    payload,
  }
  if (row.sub_group) out.subGroup = row.sub_group
  const roleId = row.role_id || roleFromMeta
  if (roleId) out.roleId = roleId
  return out
})

const roleRows = await query<{ name: string; is_admin: boolean }>(
  `SELECT name, COALESCE(is_admin, false) AS is_admin
   FROM public.app_roles
   WHERE COALESCE(is_admin, false) = false
   ORDER BY name`,
)
const roles = roleRows.map((row) => ({
  name: row.name,
  isAdmin: false,
  permissions: 'full_pack' as const,
}))

const recordsByEntity: Record<string, Array<Record<string, unknown>>> = {}
for (const apiName of packEntityNames) {
  const tableExists = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`crm_schema.${apiName}`],
  )
  if (!tableExists[0]?.exists) continue

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM crm_schema.${quoteIdentUnsafe(apiName)} ORDER BY record_id`,
  )
  if (!rows.length) continue

  recordsByEntity[apiName] = rows.map((row) => {
    const recordId = String(row.record_id ?? '')
    const status = row.status == null ? 'published' : String(row.status)
    const data = asObject(row.data)
    const columns: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (
        key === 'record_id' ||
        key === 'status' ||
        key === 'data' ||
        key === 'created_at' ||
        key === 'updated_at'
      ) {
        continue
      }
      columns[key] = value
    }
    return { recordId, status, data, columns }
  })
}

function quoteIdentUnsafe(ident: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(ident)) {
    throw new Error(`Refusing to query unsafe table name: ${ident}`)
  }
  return `"${ident}"`
}

const dashboardRows = await query<{
  id: string
  name: string
  icon: string | null
  note: string | null
  color: string | null
}>(
  `SELECT backend_dashboard_id AS id, name, icon, note, color
   FROM public.app_dashboards
   ORDER BY name, backend_dashboard_id`,
)
const dashboards = dashboardRows.map((row) => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  note: row.note,
  color: row.color,
}))

const panelRows = await query<{
  id: string
  dashboard: string
  name: string | null
  icon: string | null
  color: string | null
  show_header: boolean
  note: string | null
  type: string | null
  position_x: number
  position_y: number
  width: number
  height: number
  options: unknown
}>(
  `SELECT backend_panel_id AS id, dashboard_id AS dashboard, name, icon, color,
          show_header, note, type, position_x, position_y, width, height, options
   FROM public.app_panels
   ORDER BY dashboard_id, position_y, position_x, backend_panel_id`,
)
const panels = panelRows.map((row) => ({
  id: row.id,
  dashboard: row.dashboard,
  name: row.name,
  icon: row.icon,
  color: row.color,
  showHeader: row.show_header,
  note: row.note,
  type: row.type,
  positionX: row.position_x,
  positionY: row.position_y,
  width: row.width,
  height: row.height,
  options: asObject(row.options),
}))

const navRows = await query<{
  id: string
  group_key: string
  sub_group: string | null
  role_id: string | null
  payload: unknown
}>(
  `SELECT id::text AS id, group_key, sub_group, role_id, payload
   FROM public.layout_settings
   WHERE entity_api_name = 'crm_navigation'
   ORDER BY COALESCE(payload->>'name', ''), id`,
)
const navigationApps = navRows.map((row) => {
  const payload = asObject(row.payload)
  const meta = asObject(payload.__meta)
  const settingId = String(meta.settingId ?? row.id)
  const roleId =
    (meta.role != null && String(meta.role).trim()) ||
    (row.role_id != null && String(row.role_id).trim()) ||
    null
  const name =
    (typeof payload.name === 'string' && payload.name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    settingId
  const { __meta: _meta, ...body } = payload
  return {
    settingId,
    name,
    roleId,
    groupKey: row.group_key || 'app',
    subGroup: row.sub_group || 'full',
    body,
  }
})

writeJson(resolve(packDir, 'pack.json'), {
  ...manifest,
  description:
    manifest.description ||
    `Domain pack exported from live DB (${new Date().toISOString().slice(0, 10)})`,
})
writeJson(resolve(packDir, manifest.entitiesFile), { entities: packEntities })
writeJson(resolve(packDir, manifest.platformFile!), {
  entities: platformEntities,
})
writeJson(resolve(packDir, manifest.layoutsFile), { layouts })
writeJson(resolve(packDir, manifest.rolesFile), { roles })
writeJson(resolve(packDir, manifest.recordsFile!), { recordsByEntity })
writeJson(resolve(packDir, manifest.dashboardsFile!), { dashboards, panels })
writeJson(resolve(packDir, manifest.navigationFile!), { apps: navigationApps })

console.log(`Exported domain pack: ${packId}`)
console.log(`  entities: ${packEntityNames.join(', ') || '(none)'}`)
console.log(
  `  platform overlays: ${platformEntityNames.join(', ') || '(none)'}`,
)
console.log(`  layouts: ${layouts.length}`)
console.log(`  roles: ${roles.map((r) => r.name).join(', ') || '(none)'}`)
console.log(
  `  record entities: ${Object.keys(recordsByEntity).join(', ') || '(none)'}`,
)
console.log(`  dashboards: ${dashboards.length}, panels: ${panels.length}`)
console.log(`  navigation apps: ${navigationApps.length}`)
console.log(`  path: ${packDir}`)

await pool.end()
