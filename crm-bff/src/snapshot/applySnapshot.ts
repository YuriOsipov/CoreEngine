import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import {
  createRegistryEntity,
  deleteRegistryEntity,
  ensureUserEditableNameField,
} from '../schema/entityRegistry.js'
import { updateEntityMeta, type EntityMetaInput } from '../schema/entityMeta.js'
import {
  createRegistryField,
  deleteRegistryField,
  updateRegistryField,
} from '../schema/fieldRegistry.js'
import { saveEntityAutomations, type EntityRecordAutomation } from '../schema/recordAutomations.js'
import { replaceRolePermissions } from '../services/rolePermissions.js'
import { upsertLayoutSettingRow } from '../schema/layoutSettings.js'
import {
  deleteScheduledTask,
  listScheduledTasks,
  upsertScheduledTask,
  isMissingTasksTable,
} from '../tasks/taskService.js'
import {
  postgresDeleteDashboard,
  postgresUpsertDashboard,
  postgresUpsertPanel,
} from '../adapters/postgresDashboards.js'
import { assertConfigOnly, REPORT_GROUP, UI_LAYOUT_GROUPS, type ConfigSnapshot } from './config.js'
import { assertKernelMatch } from './kernel.js'
import { readKernelMigrations } from './readKernel.js'
import type { PermissionMatrixRow } from './permissions.js'
import type { TaskDefinition } from './tasks.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function str(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

async function entityExists(apiName: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
    [apiName],
  )
  return Boolean(rows[0]?.id)
}

async function findFieldId(entityApiName: string, fieldApiName: string): Promise<string | null> {
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

async function resolveRoleId(raw: string | null): Promise<string | null> {
  const value = str(raw)
  if (!value) return null
  const rows = await query<{ id: string }>(
    UUID_RE.test(value)
      ? `SELECT id::text AS id FROM public.app_roles WHERE id::text = $1 LIMIT 1`
      : `SELECT id::text AS id FROM public.app_roles WHERE lower(name) = lower($1) LIMIT 1`,
    [value],
  )
  if (!rows[0]?.id) {
    throw new Error(`Role not found: ${value}`)
  }
  return rows[0].id
}

async function ensureRole(
  name: string,
  isAdmin: boolean,
  canAuthorReports: boolean,
): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.app_roles WHERE lower(name) = lower($1) LIMIT 1`,
    [name],
  )
  if (existing[0]?.id) {
    await query(
      `UPDATE public.app_roles
       SET is_admin = $2, can_author_reports = $3, updated_at = now()
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

type FieldShape = {
  apiName?: string
  label?: string
  type?: string
  interface?: string
  required?: boolean
  readonly?: boolean
  hidden?: boolean
  options?: Record<string, unknown> | null
  displayOptions?: Record<string, unknown> | null
  isUnique?: boolean
  isIndexed?: boolean
  sensitivity?: number
  relationKind?: string | null
  relatedEntity?: string | null
  junctionEntity?: string | null
  relationMeta?: Record<string, unknown> | null
}

function fieldInput(field: FieldShape) {
  const fieldApi = str(field.apiName).toLowerCase()
  return {
    apiName: fieldApi,
    label: str(field.label) || fieldApi,
    type: str(field.type) || 'STRING',
    interface: str(field.interface) || 'input',
    required: Boolean(field.required),
    readonly: Boolean(field.readonly),
    hidden: Boolean(field.hidden),
    options: field.options ?? null,
    displayOptions: field.displayOptions ?? null,
    isUnique: Boolean(field.isUnique),
    isIndexed: Boolean(field.isIndexed),
    sensitivity: field.sensitivity,
    relationKind: field.relationKind ?? null,
    relatedEntity: field.relatedEntity ?? null,
    junctionEntity: field.junctionEntity ?? null,
    relationMeta: field.relationMeta ?? null,
  }
}

async function upsertField(entityApiName: string, field: FieldShape): Promise<void> {
  const input = fieldInput(field)
  const existingId = await findFieldId(entityApiName, input.apiName)
  if (existingId) {
    await updateRegistryField(existingId, input, {
      applyDdl: true,
      entityApiName,
    })
    return
  }
  await createRegistryField(entityApiName, input, { applyDdl: true })
}

async function applyEntity(entity: Record<string, unknown>, create: boolean): Promise<void> {
  const apiName = str(entity.apiName).toLowerCase()
  const backend = asObject(entity.backendConfig)
  const meta: EntityMetaInput = {
    label: str(entity.label) || apiName,
    icon: entity.icon == null ? null : String(entity.icon),
    displayTemplate: entity.displayTemplate == null ? null : String(entity.displayTemplate),
    hidden: Boolean(entity.hidden),
    singleton: Boolean(entity.singleton),
    rowLevelSecurity: backend.rowLevelSecurity === 'owner' ? 'owner' : null,
    ...(backend.defaultFieldSensitivity !== undefined
      ? { defaultFieldSensitivity: Number(backend.defaultFieldSensitivity) }
      : {}),
    ...(backend.inheritOwnerFrom !== undefined
      ? { inheritOwnerFrom: backend.inheritOwnerFrom == null ? null : String(backend.inheritOwnerFrom) }
      : {}),
    ...(backend.rowLevelReadAlsoIf !== undefined
      ? { rowLevelReadAlsoIf: backend.rowLevelReadAlsoIf as string[] }
      : {}),
    ...(backend.rowLevelReadAlsoIfSameRole !== undefined
      ? { rowLevelReadAlsoIfSameRole: Boolean(backend.rowLevelReadAlsoIfSameRole) }
      : {}),
  }
  if (create) {
    await createRegistryEntity(
      {
        apiName,
        label: str(entity.label) || apiName,
        icon: entity.icon == null ? null : String(entity.icon),
        group: entity.group == null ? null : String(entity.group),
        displayTemplate:
          entity.displayTemplate == null ? null : String(entity.displayTemplate),
        hidden: Boolean(entity.hidden),
        singleton: Boolean(entity.singleton),
      },
      { applyDdl: true },
    )
  }
  if (!create || backend.rowLevelSecurity !== undefined) {
    await updateEntityMeta(apiName, meta)
  }
  if (entity.group != null) {
    await query(
      `UPDATE public.entities SET entity_group = $2, updated_at = now()
       WHERE api_name = $1 AND deleted_at IS NULL`,
      [apiName, String(entity.group)],
    )
  }
  const fields = Array.isArray(entity.fields) ? (entity.fields as FieldShape[]) : []
  for (const field of fields) {
    if (!str(field.apiName)) continue
    await upsertField(apiName, field)
  }
  await ensureUserEditableNameField(apiName)
  const keep = new Set(fields.map((field) => str(field.apiName).toLowerCase()).filter(Boolean))
  const existing = await query<{ api_name: string; is_system: boolean }>(
    `SELECT f.api_name, f.is_system
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1 AND e.deleted_at IS NULL`,
    [apiName],
  )
  for (const field of existing) {
    if (field.is_system || keep.has(field.api_name)) continue
    await deleteRegistryField(apiName, field.api_name, { applyDdl: true })
  }
}

async function applyDdl(snapshot: ConfigSnapshot): Promise<void> {
  const names = new Set(
    snapshot.entities.map((entity) => str(entity.apiName).toLowerCase()).filter(Boolean),
  )
  for (const entity of snapshot.entities) {
    const apiName = str(entity.apiName).toLowerCase()
    if (!apiName) continue
    await applyEntity(entity, !(await entityExists(apiName)))
  }
  for (const entity of snapshot.platformEntities) {
    const apiName = str(entity.apiName).toLowerCase()
    if (!apiName || !(await entityExists(apiName))) continue
    if (entity.label || entity.displayTemplate != null) {
      await updateEntityMeta(apiName, {
        label: str(entity.label) || undefined,
        displayTemplate:
          entity.displayTemplate == null ? undefined : String(entity.displayTemplate),
      })
    }
    const fields = Array.isArray(entity.fields) ? (entity.fields as FieldShape[]) : []
    for (const field of fields) {
      if (!str(field.apiName)) continue
      await upsertField(apiName, field)
    }
  }
  const live = await query<{ api_name: string }>(
    `SELECT api_name FROM public.entities
     WHERE deleted_at IS NULL
       AND upper(COALESCE(backend_target, '')) <> 'PLATFORM'
       AND COALESCE((backend_config->>'internal')::boolean, false) = false`,
  )
  for (const row of live) {
    if (names.has(row.api_name)) continue
    try {
      await deleteRegistryEntity(row.api_name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/reserved|PLATFORM/i.test(message)) continue
      throw error
    }
  }
}

async function applyAutomations(snapshot: ConfigSnapshot): Promise<void> {
  for (const entity of snapshot.entities) {
    const apiName = str(entity.apiName).toLowerCase()
    if (!apiName) continue
    const automations = asObject(entity.backendConfig).automations
    const rules = Array.isArray(automations) ? (automations as EntityRecordAutomation[]) : []
    await saveEntityAutomations(apiName, rules)
  }
}

async function applyRoles(snapshot: ConfigSnapshot): Promise<void> {
  const names = new Set(snapshot.roles.map((role) => role.name.trim().toLowerCase()))
  for (const role of snapshot.roles) {
    const roleId = await ensureRole(role.name, role.isAdmin, role.canAuthorReports)
    if (!role.isAdmin) {
      await replaceRolePermissions(roleId, role.permissions as PermissionMatrixRow[])
    }
  }
  const existing = await query<{ id: string; name: string; is_admin: boolean }>(
    `SELECT id::text AS id, name, COALESCE(is_admin, false) AS is_admin FROM public.app_roles`,
  )
  for (const role of existing) {
    if (role.is_admin || names.has(role.name.trim().toLowerCase())) continue
    await replaceRolePermissions(role.id, [])
    await query(`DELETE FROM public.app_roles WHERE id = $1::uuid`, [role.id]).catch(() => undefined)
  }
}

async function applyTasks(snapshot: ConfigSnapshot): Promise<void> {
  let existing: Awaited<ReturnType<typeof listScheduledTasks>> = []
  try {
    existing = await listScheduledTasks()
  } catch (error) {
    if (isMissingTasksTable(error)) return
    throw error
  }
  const byKey = new Map(existing.map((task) => [task.key, task]))
  const keep = new Set<string>()
  for (const task of snapshot.tasks as TaskDefinition[]) {
    keep.add(task.key)
    const current = byKey.get(task.key)
    await upsertScheduledTask({
      id: current?.id,
      key: task.key,
      name: task.name,
      jobType: task.jobType,
      cron: task.cron,
      schedule: task.schedule,
      timezone: task.timezone,
      enabled: task.enabled,
      params: task.params,
      description: task.description,
    })
  }
  for (const task of existing) {
    if (!keep.has(task.key)) await deleteScheduledTask(task.id)
  }
}

async function upsertLayout(layout: Record<string, unknown>): Promise<string> {
  const payload = asObject(layout.payload ?? layout.body)
  const meta = asObject(payload.__meta)
  const { __meta: _drop, ...body } = payload
  const roleId = await resolveRoleId(str(layout.roleId) || str(meta.role) || null)
  const saved = await upsertLayoutSettingRow({
    settingId: str(layout.settingId) || str(meta.settingId) || null,
    entityApiName: str(layout.entityApiName),
    groupKey: str(layout.groupKey),
    subGroup: str(layout.subGroup) || null,
    roleId,
    name: str(payload.name) || str(meta.name) || str(layout.name) || null,
    body,
  })
  return saved.id
}

async function applyLayouts(
  rows: Array<Record<string, unknown>>,
  groups: readonly string[],
): Promise<void> {
  const keep = new Set<string>()
  for (const row of rows) {
    keep.add(await upsertLayout(row))
  }
  const live = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.layout_settings WHERE group_key = ANY($1::text[])`,
    [groups],
  )
  for (const row of live) {
    if (keep.has(row.id)) continue
    await query(`DELETE FROM public.layout_settings WHERE id = $1::uuid`, [row.id])
  }
}

async function applyDashboards(snapshot: ConfigSnapshot): Promise<void> {
  const existing = await query<{ id: string; name: string }>(
    `SELECT backend_dashboard_id AS id, name FROM public.app_dashboards`,
  )
  const byName = new Map(existing.map((row) => [row.name, row.id]))
  const idMap = new Map<string, string>()
  const keep = new Set<string>()
  for (const dashboard of snapshot.dashboards) {
    const name = str(dashboard.name)
    const targetId = byName.get(name) || str(dashboard.id) || randomUUID()
    idMap.set(str(dashboard.id), targetId)
    keep.add(targetId)
    await postgresUpsertDashboard({
      id: targetId,
      name,
      icon: dashboard.icon == null ? null : String(dashboard.icon),
      note: dashboard.note == null ? null : String(dashboard.note),
      color: dashboard.color == null ? null : String(dashboard.color),
    })
  }
  for (const row of existing) {
    if (!keep.has(row.id)) await postgresDeleteDashboard(row.id)
  }
  for (const panel of snapshot.panels) {
    const dashboardId = idMap.get(str(panel.dashboard)) || str(panel.dashboard)
    await postgresUpsertPanel({
      id: str(panel.id) || undefined,
      dashboard: dashboardId,
      name: panel.name == null ? null : String(panel.name),
      icon: panel.icon == null ? null : String(panel.icon),
      color: panel.color == null ? null : String(panel.color),
      show_header: panel.showHeader == null ? null : Boolean(panel.showHeader),
      note: panel.note == null ? null : String(panel.note),
      type: str(panel.type) || 'label',
      position_x: panel.positionX == null ? null : Number(panel.positionX),
      position_y: panel.positionY == null ? null : Number(panel.positionY),
      width: panel.width == null ? null : Number(panel.width),
      height: panel.height == null ? null : Number(panel.height),
      options: asObject(panel.options),
    })
  }
}

async function applyDocTemplates(snapshot: ConfigSnapshot): Promise<void> {
  const exists = await query<{ exists: boolean }>(
    `SELECT to_regclass('crm_schema.doc_template') IS NOT NULL AS exists`,
  )
  if (!exists[0]?.exists) return
  const columns = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'crm_schema' AND table_name = 'doc_template'`,
  )
  const cols = new Set(columns.map((row) => row.column_name))
  const keep = new Set<string>()
  for (const template of snapshot.docTemplates) {
    const name = str(template.name)
    const collection = str(template.collection)
    const roleId = await resolveRoleId(str(template.roleName) || null)
    const found = await query<{ record_id: string }>(
      `SELECT record_id::text AS record_id FROM crm_schema.doc_template
       WHERE name = $1 AND collection = $2 LIMIT 1`,
      [name, collection],
    )
    const recordId = found[0]?.record_id || randomUUID()
    keep.add(recordId)
    const values: Record<string, unknown> = {
      name,
      collection,
      description: template.description ?? null,
      body: template.body ?? {},
      field_mapping: template.fieldMapping ?? {},
      role: roleId,
      output_format: str(template.outputFormat) || 'pdf',
      hide_empty: Boolean(template.hideEmpty),
      attach_file: template.attachFile == null ? true : Boolean(template.attachFile),
      archived: Boolean(template.archived),
    }
    const writeCols = Object.keys(values).filter((key) => cols.has(key))
    if (!found[0]) {
      const insertCols = ['record_id', ...writeCols]
      const params: unknown[] = [recordId]
      const placeholders = insertCols.map((col, index) => {
        if (col === 'record_id') return '$1'
        params.push(jsonParam(col, values[col]))
        return jsonCast(col, params.length)
      })
      await query(
        `INSERT INTO crm_schema.doc_template (${insertCols.join(', ')})
         VALUES (${placeholders.join(', ')})`,
        params,
      )
    } else {
      const sets: string[] = []
      const params: unknown[] = [recordId]
      for (const col of writeCols) {
        params.push(jsonParam(col, values[col]))
        sets.push(`${col} = ${jsonCast(col, params.length)}`)
      }
      if (sets.length) {
        await query(
          `UPDATE crm_schema.doc_template SET ${sets.join(', ')} WHERE record_id = $1::uuid`,
          params,
        )
      }
    }
  }
  const live = await query<{ record_id: string }>(
    `SELECT record_id::text AS record_id FROM crm_schema.doc_template`,
  )
  for (const row of live) {
    if (keep.has(row.record_id)) continue
    await query(`DELETE FROM crm_schema.doc_template WHERE record_id = $1::uuid`, [row.record_id])
  }
}

function jsonParam(column: string, value: unknown): unknown {
  if (column === 'body' || column === 'field_mapping') return JSON.stringify(value ?? {})
  return value
}

function jsonCast(column: string, index: number): string {
  if (column === 'body' || column === 'field_mapping') return `$${index}::jsonb`
  if (column === 'role') return `$${index}::uuid`
  return `$${index}`
}

export async function applyConfigSnapshot(body: unknown): Promise<{ applied: true }> {
  assertConfigOnly(body)
  const snapshot = body as ConfigSnapshot
  assertKernelMatch(snapshot.kernelMigrations ?? [], await readKernelMigrations())
  await applyDdl(snapshot)
  await applyRoles(snapshot)
  await applyAutomations(snapshot)
  await applyTasks(snapshot)
  const navigation = (snapshot.navigation ?? []).map((row) => ({
    ...row,
    entityApiName: 'crm_navigation',
    groupKey: str(row.groupKey) || 'app',
    payload: row.body ?? row.payload ?? {},
  }))
  await applyLayouts([...(snapshot.layouts ?? []), ...navigation], UI_LAYOUT_GROUPS)
  await applyLayouts(snapshot.reports ?? [], [REPORT_GROUP])
  await applyDashboards(snapshot)
  await applyDocTemplates(snapshot)
  return { applied: true }
}
