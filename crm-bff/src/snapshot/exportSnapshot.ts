import { query } from '../db/pool.js'
import { exportDomainPack } from '../packs/exportDomainPack.js'
import { listScheduledTasks, isMissingTasksTable } from '../tasks/taskService.js'
import { assertConfigOnly, REPORT_GROUP, UI_LAYOUT_GROUPS, type ConfigSnapshot } from './config.js'
import { readKernelMigrations } from './readKernel.js'
import { toRoleSnapshot, type PermissionMatrixRow } from './permissions.js'
import { toTaskDefinition } from './tasks.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const UI_GROUPS = new Set<string>(UI_LAYOUT_GROUPS)

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function roleNameById(): Promise<Map<string, string>> {
  const rows = await query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM public.app_roles`,
  )
  return new Map(rows.map((row) => [row.id, row.name]))
}

function roleName(raw: unknown, names: Map<string, string>): string | null {
  const value = raw == null ? '' : String(raw).trim()
  if (!value) return null
  if (UUID_RE.test(value)) return names.get(value) ?? null
  return value
}

function withRoleName(
  row: Record<string, unknown>,
  names: Map<string, string>,
): Record<string, unknown> {
  const payload = asObject(row.payload)
  const meta = asObject(payload.__meta)
  const role = roleName(row.roleId ?? meta.role, names)
  const nextPayload = { ...payload }
  if (meta && Object.keys(meta).length) {
    nextPayload.__meta = { ...meta, role }
  }
  return { ...row, roleId: role, payload: nextPayload }
}

async function exportRoles(): Promise<ConfigSnapshot['roles']> {
  const roles = await query<{
    id: string
    name: string
    is_admin: boolean
    can_author_reports: boolean
  }>(
    `SELECT id::text AS id, name,
            COALESCE(is_admin, false) AS is_admin,
            COALESCE(can_author_reports, false) AS can_author_reports
     FROM public.app_roles
     ORDER BY name`,
  )
  const perms = await query<{
    role_id: string
    entity_api_name: string
    can_create: boolean
    can_read: boolean
    can_update: boolean
    can_delete: boolean
    can_import: boolean
    can_export: boolean
    can_view_all: boolean
    can_modify_all: boolean
    max_read_sensitivity: number | null
    max_edit_sensitivity: number | null
  }>(
    `SELECT role_id::text AS role_id, entity_api_name,
            can_create, can_read, can_update, can_delete,
            can_import, can_export, can_view_all, can_modify_all,
            max_read_sensitivity, max_edit_sensitivity
     FROM public.role_permissions
     ORDER BY entity_api_name`,
  )
  const byRole = new Map<string, PermissionMatrixRow[]>()
  for (const row of perms) {
    const list = byRole.get(row.role_id) ?? []
    const canModifyAll = Boolean(row.can_modify_all)
    list.push({
      entityApiName: row.entity_api_name,
      canCreate: Boolean(row.can_create),
      canRead: Boolean(row.can_read),
      canUpdate: Boolean(row.can_update),
      canDelete: Boolean(row.can_delete),
      canImport: Boolean(row.can_import),
      canExport: Boolean(row.can_export),
      canViewAll: canModifyAll || Boolean(row.can_view_all),
      canModifyAll,
      maxReadSensitivity: Number(row.max_read_sensitivity ?? 0),
      maxEditSensitivity: Number(row.max_edit_sensitivity ?? 0),
    })
    byRole.set(row.role_id, list)
  }
  return roles.map((role) =>
    toRoleSnapshot(
      role.name,
      role.is_admin,
      role.can_author_reports,
      byRole.get(role.id) ?? [],
    ),
  )
}

async function exportTasks(): Promise<ConfigSnapshot['tasks']> {
  try {
    const tasks = await listScheduledTasks()
    return tasks.map(toTaskDefinition)
  } catch (error) {
    if (isMissingTasksTable(error)) return []
    throw error
  }
}

async function exportDocTemplates(
  names: Map<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const exists = await query<{ exists: boolean }>(
    `SELECT to_regclass('crm_schema.doc_template') IS NOT NULL AS exists`,
  )
  if (!exists[0]?.exists) return []
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM crm_schema.doc_template ORDER BY record_id`,
  )
  return rows.map((row) => {
    const data = asObject(row.data)
    const pick = (key: string) => (row[key] !== undefined ? row[key] : data[key])
    const role = roleName(pick('role'), names)
    return {
      name: pick('name') == null ? '' : String(pick('name')),
      collection: pick('collection') == null ? '' : String(pick('collection')),
      description: pick('description') ?? null,
      body: pick('body') ?? null,
      fieldMapping: pick('field_mapping') ?? null,
      roleName: role,
      outputFormat: pick('output_format') ?? 'pdf',
      hideEmpty: Boolean(pick('hide_empty')),
      attachFile: pick('attach_file') == null ? true : Boolean(pick('attach_file')),
      archived: Boolean(pick('archived')),
    }
  })
}

export async function exportConfigSnapshot(): Promise<ConfigSnapshot> {
  const kernelMigrations = await readKernelMigrations()
  const pack = await exportDomainPack({
    packId: 'snapshot',
    includeRecords: false,
    includeDashboards: true,
  })
  const names = await roleNameById()
  const entities = pack.entities.map((entity) => {
    const backend = asObject(entity.backendConfig)
    return {
      ...entity,
      backendConfig: {
        ...backend,
        rowLevelSecurity: backend.rowLevelSecurity === 'owner' ? 'owner' : null,
      },
    }
  })
  const layouts = pack.layouts
    .filter((row) => String(row.groupKey) !== REPORT_GROUP)
    .filter((row) => UI_GROUPS.has(String(row.groupKey)) || String(row.groupKey) === 'entity')
    .map((row) => withRoleName(row, names))
  const reports = pack.layouts
    .filter((row) => String(row.groupKey) === REPORT_GROUP)
    .map((row) => withRoleName(row, names))
  const navigation = pack.navigationApps.map((row) => withRoleName(row, names))
  return {
    kind: 'coreengine-config-snapshot',
    kernelMigrations,
    kernelMigrationId: kernelMigrations.at(-1) ?? null,
    entities,
    platformEntities: pack.platformEntities,
    roles: await exportRoles(),
    tasks: await exportTasks(),
    layouts,
    navigation,
    dashboards: pack.dashboards,
    panels: pack.panels,
    reports,
    docTemplates: await exportDocTemplates(names),
  }
}

export function assertApplyBody(body: unknown): void {
  assertConfigOnly(body)
}
