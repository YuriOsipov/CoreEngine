/**
 * Build a domain-pack shaped snapshot from the live registry.
 * Shared by MCP `export_domain_pack` and `scripts/export-domain-pack.mts`.
 */
import { query } from '../db/pool.js'

export interface PackManifest {
  id: string
  label: string
  description?: string
  entitiesFile: string
  rolesFile: string
  layoutsFile: string
  recordsFile?: string
  dashboardsFile?: string
  navigationFile?: string
  platformFile?: string
}

export type DomainPackExport = {
  pack: PackManifest
  entities: Array<Record<string, unknown>>
  platformEntities: Array<Record<string, unknown>>
  layouts: Array<Record<string, unknown>>
  roles: Array<Record<string, unknown>>
  recordsByEntity: Record<string, Array<Record<string, unknown>>>
  dashboards: Array<Record<string, unknown>>
  panels: Array<Record<string, unknown>>
  navigationApps: Array<Record<string, unknown>>
  meta: {
    entityNames: string[]
    platformEntityNames: string[]
  }
}

const SYSTEM_FIELD_NAMES = new Set([
  'id',
  'name',
  'status',
  'sort',
  'user_created',
  'owner_id',
  'date_created',
  'user_updated',
  'date_updated',
  'created_at',
])

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function quoteIdentUnsafe(ident: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(ident)) {
    throw new Error(`Refusing to query unsafe table name: ${ident}`)
  }
  return `"${ident}"`
}

function defaultManifest(packId: string): PackManifest {
  return {
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
}

async function exportEntityFields(
  entityId: string,
): Promise<Record<string, unknown>[]> {
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
    sensitivity: number | null
    relation_kind: string | null
    related_api_name: string | null
    junction_api_name: string | null
    relation_meta: unknown
  }>(
    `SELECT f.api_name, f.label, f.field_type, f.interface, f.options, f.display_options,
            f.required, f.readonly, f.hidden, f.sort, f.is_system, f.is_unique, f.is_indexed,
            COALESCE(f.sensitivity, 0) AS sensitivity,
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
      if (f.is_unique) out.isUnique = true
      if (f.is_indexed) out.isIndexed = true
      const sensitivity = Number(f.sensitivity ?? 0)
      if (sensitivity > 0) out.sensitivity = sensitivity
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

export type ExportDomainPackOptions = {
  packId: string
  /** Seed / override pack.json fields */
  manifest?: Partial<PackManifest>
  /** Include crm_schema record snapshots (can be large). Default false for MCP. */
  includeRecords?: boolean
  includeDashboards?: boolean
}

export async function exportDomainPack(
  options: ExportDomainPackOptions,
): Promise<DomainPackExport> {
  const packId = String(options.packId || '')
    .trim()
    .toLowerCase()
  if (!packId || !/^[a-z][a-z0-9_]*$/.test(packId)) {
    throw new Error(
      'packId must be a lowercase snake_case id (e.g. sales, clinic)',
    )
  }

  const manifest: PackManifest = {
    ...defaultManifest(packId),
    ...options.manifest,
    id: packId,
  }
  if (!manifest.recordsFile) manifest.recordsFile = 'records.json'
  if (!manifest.dashboardsFile) manifest.dashboardsFile = 'dashboards.json'
  if (!manifest.navigationFile) manifest.navigationFile = 'navigation.json'
  if (!manifest.platformFile) manifest.platformFile = 'platform.json'
  manifest.description =
    manifest.description ||
    `Domain pack exported from live DB (${new Date().toISOString().slice(0, 10)})`

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
    const fields = await exportEntityFields(entity.id)
    const entityOut: Record<string, unknown> = {
      apiName: entity.api_name,
      label: entity.label,
      fields,
    }
    if (entity.icon) entityOut.icon = entity.icon
    if (entity.entity_group) entityOut.group = entity.entity_group
    if (entity.display_template) {
      entityOut.displayTemplate = entity.display_template
    }
    if (entity.hidden) entityOut.hidden = true
    if (entity.singleton) entityOut.singleton = true
    const backendConfig = asObject(entity.backend_config)
    const packBackend: Record<string, unknown> = {}
    if (backendConfig.rowLevelSecurity === 'owner') {
      packBackend.rowLevelSecurity = 'owner'
    }
    if (
      typeof backendConfig.defaultFieldSensitivity === 'number' &&
      Number.isFinite(backendConfig.defaultFieldSensitivity)
    ) {
      packBackend.defaultFieldSensitivity =
        backendConfig.defaultFieldSensitivity
    }
    if (
      typeof backendConfig.inheritOwnerFrom === 'string' &&
      /^[a-z][a-z0-9_]*$/.test(backendConfig.inheritOwnerFrom.trim())
    ) {
      packBackend.inheritOwnerFrom = backendConfig.inheritOwnerFrom
        .trim()
        .toLowerCase()
    }
    if (
      Array.isArray(backendConfig.rowLevelReadAlsoIf) &&
      backendConfig.rowLevelReadAlsoIf.length
    ) {
      packBackend.rowLevelReadAlsoIf = backendConfig.rowLevelReadAlsoIf
    }
    if (backendConfig.rowLevelReadAlsoIfSameRole === true) {
      packBackend.rowLevelReadAlsoIfSameRole = true
    }
    if (
      Array.isArray(backendConfig.automations) &&
      backendConfig.automations.length
    ) {
      packBackend.automations = backendConfig.automations
    }
    if (Object.keys(packBackend).length) {
      entityOut.backendConfig = packBackend
    }
    packEntities.push(entityOut)
  }

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

  const roleRows = await query<{ id: string; name: string; is_admin: boolean }>(
    `SELECT id::text AS id, name, COALESCE(is_admin, false) AS is_admin
     FROM public.app_roles
     WHERE COALESCE(is_admin, false) = false
     ORDER BY name`,
  )
  const roles: Array<Record<string, unknown>> = []
  for (const row of roleRows) {
    const bypassRows = await query<{
      entity_api_name: string
      can_view_all: boolean
      can_modify_all: boolean
    }>(
      `SELECT entity_api_name,
              COALESCE(can_view_all, false) AS can_view_all,
              COALESCE(can_modify_all, false) AS can_modify_all
       FROM public.role_permissions
       WHERE role_id = $1::uuid
         AND (COALESCE(can_view_all, false) OR COALESCE(can_modify_all, false))
       ORDER BY entity_api_name`,
      [row.id],
    )
    const canViewAllOn = bypassRows
      .filter((r) => r.can_view_all || r.can_modify_all)
      .map((r) => r.entity_api_name)
    const canModifyAllOn = bypassRows
      .filter((r) => r.can_modify_all)
      .map((r) => r.entity_api_name)
    const out: Record<string, unknown> = {
      name: row.name,
      isAdmin: false,
      permissions: 'full_pack',
    }
    if (canViewAllOn.length) out.canViewAllOn = canViewAllOn
    if (canModifyAllOn.length) out.canModifyAllOn = canModifyAllOn
    roles.push(out)
  }

  const recordsByEntity: Record<string, Array<Record<string, unknown>>> = {}
  if (options.includeRecords) {
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
  }

  let dashboards: Array<Record<string, unknown>> = []
  let panels: Array<Record<string, unknown>> = []
  if (options.includeDashboards !== false) {
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
    dashboards = dashboardRows.map((row) => ({
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
    panels = panelRows.map((row) => ({
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
  }

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

  return {
    pack: manifest,
    entities: packEntities,
    platformEntities,
    layouts,
    roles,
    recordsByEntity,
    dashboards,
    panels,
    navigationApps,
    meta: {
      entityNames: packEntityNames,
      platformEntityNames,
    },
  }
}
