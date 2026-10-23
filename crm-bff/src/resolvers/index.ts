import {
  aggregateRecords,
  createRecord,
  findManyRecords,
  findOneRecord,
  hardDeleteRecord,
  restoreRecord,
  softDeleteRecord,
  updateRecord,
} from '../adapters/recordsAdapter.js'
import { findFile, findFiles, listRecordFiles } from '../adapters/filesAdapter.js'
import { writeAuditEntry, listRecordActivities, listRecordRevisions } from '../audit/auditService.js'
import {
  detectSchemaDrift,
  listEntitySyncStates,
  listSyncJobs,
  runSchemaDriftCheck,
  runSchemaSync,
} from '../sync/schemaSyncService.js'
import { getUserSetting, upsertUserSetting } from '../services/userSettingsService.js'
import {
  listRecentRecordViews,
  upsertRecentRecordView,
} from '../services/recentRecordsService.js'
import { loadItemGroupPriceTree } from '../services/itemGroupPriceTree.js'
import { listRoles } from '../services/rolesService.js'
import { fetchMe, listUsers } from '../adapters/usersAdapter.js'
import { listPresets } from '../adapters/presetsAdapter.js'
import {
  deleteDashboard,
  deletePanel,
  listDashboards,
  listPanels,
  upsertDashboard,
  upsertPanel,
} from '../adapters/dashboardsAdapter.js'
import { query } from '../db/pool.js'
import { upsertLayoutSettingRow } from '../schema/layoutSettings.js'
import {
  applyUniqueIndexActions,
  loadEntityUniqueGroups,
  planUniqueIndexActions,
  saveEntityUniqueGroups,
  setFieldIsUnique as writeFieldIsUnique,
  type EntityUniqueGroup,
} from '../schema/uniqueGroups.js'
import {
  loadEntityAutomations,
  saveEntityAutomations,
  type EntityRecordAutomation,
} from '../schema/recordAutomations.js'
import {
  createRegistryField,
  deleteRegistryField,
  toGraphQlField,
  updateRegistryField,
  type RegistryFieldInput,
} from '../schema/fieldRegistry.js'
import {
  createAppRole,
  createAppUser,
  deleteAppRole,
  listAppRolesAdmin,
  listAppUsersAdmin,
  setAppUserPassword,
  updateAppRole,
  updateAppUser,
} from '../services/userAdminService.js'
import {
  assertEntityPermission,
  isRoleAdmin,
  listPermissionEntities,
  listRolePermissions,
  replaceRolePermissions,
} from '../services/rolePermissions.js'
import { clearCrmStorageCache } from '../schema/crmStorage.js'
import {
  parseAccountability,
  readInternal,
  readNote,
  resolveEntityAccountability,
  updateEntityMeta,
  type EntityAccountability,
} from '../schema/entityMeta.js'
import { createRegistryEntity, deleteRegistryEntity } from '../schema/entityRegistry.js'
import { generateScheduleSlots as generateScheduleSlotsService } from '../schedule/generateSlots.js'
import { SCHEDULE_SLOT_COLLECTION } from '../schedule/constants.js'
import {
  bulkUpdateRelatedFromAction,
  BulkUpdateRelatedError,
} from '../actions/bulkUpdateRelated.js'
import { bulkUpdateFilteredFromAction } from '../actions/bulkUpdateFiltered.js'
import {
  deleteScheduledTask,
  listScheduledTaskRuns,
  listScheduledTasks,
  runScheduledTask,
  upsertScheduledTask,
} from '../tasks/taskService.js'

type GraphQlAuthContext = { authorization: string | null }

/** Resolve the authenticated actor for audit stamps; never throw into mutations. */
async function resolveActorUserId(
  ctx: GraphQlAuthContext | undefined,
): Promise<string | null> {
  if (!ctx?.authorization) return null
  try {
    const me = await fetchMe({ authorization: ctx.authorization })
    return me.id ? String(me.id) : null
  } catch {
    return null
  }
}

async function requireAdminAccess(ctx: GraphQlAuthContext | undefined): Promise<void> {
  if (!ctx?.authorization) {
    throw new Error('Admin access required')
  }
  const me = await fetchMe({ authorization: ctx.authorization })
  if (!(me.adminAccess || me.roleAdminAccess)) {
    throw new Error('Admin access required')
  }
}

type LabelTranslation = { language?: string; label?: string }

function toIsoTimestamp(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const text = String(value).trim()
  return text || null
}

function parseLabelTranslations(raw: unknown): LabelTranslation[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (row): row is LabelTranslation =>
      !!row && typeof row === 'object' && typeof (row as LabelTranslation).language === 'string',
  )
}

function pickLocalizedLabel(
  translations: LabelTranslation[],
  language: string | null | undefined,
  fallback: string,
): string {
  if (!language) return fallback
  const match = translations.find((row) => row.language === language && row.label?.trim())
  return match?.label?.trim() || fallback
}

function mapField(row: Record<string, unknown>, language?: string | null) {
  const labelTranslations = parseLabelTranslations(row.label_translations)
  const baseLabel = String(row.label ?? row.api_name)
  return {
    id: String(row.id),
    apiName: String(row.api_name),
    label: pickLocalizedLabel(labelTranslations, language, baseLabel),
    type: String(row.field_type),
    interface: String(row.interface),
    options: row.options ?? {},
    displayOptions: row.display_options ?? {},
    labelTranslations: labelTranslations.map((t) => ({
      language: String(t.language),
      label: String(t.label ?? ''),
    })),
    required: Boolean(row.required),
    readonly: Boolean(row.readonly),
    hidden: Boolean(row.hidden),
    sort: Number(row.sort ?? 0),
    isSystem: Boolean(row.is_system),
    isUnique: Boolean(row.is_unique),
    isIndexed: Boolean(row.is_indexed),
  }
}

async function loadFields(entityId: string, language?: string | null) {
  const rows = await query(
    `SELECT *
     FROM public.fields
     WHERE entity_id = $1
     ORDER BY sort ASC, api_name ASC`,
    [entityId],
  )
  return rows.map((row) => mapField(row, language))
}

async function loadRelations(entityId: string) {
  const rows = await query(
    `SELECT
       r.id,
       r.kind,
       r.meta,
       f.api_name AS field_api_name,
       related.api_name AS related_entity_api_name,
       junction.api_name AS junction_entity_api_name,
       COALESCE((
         SELECT array_agg(ae.api_name ORDER BY ae.api_name)
         FROM unnest(r.allowed_entity_ids) AS aid(id)
         JOIN public.entities ae ON ae.id = aid.id
       ), '{}') AS allowed_entity_api_names
     FROM public.relations r
     JOIN public.fields f ON f.id = r.field_id
     LEFT JOIN public.entities related
       ON related.id = r.related_entity_id AND related.deleted_at IS NULL
     LEFT JOIN public.entities junction ON junction.id = r.junction_entity_id
     WHERE r.entity_id = $1
     ORDER BY f.api_name ASC`,
    [entityId],
  )

  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    fieldApiName: String(row.field_api_name),
    relatedEntityApiName: row.related_entity_api_name
      ? String(row.related_entity_api_name)
      : null,
    junctionEntityApiName: row.junction_entity_api_name
      ? String(row.junction_entity_api_name)
      : null,
    allowedEntityApiNames: Array.isArray(row.allowed_entity_api_names)
      ? row.allowed_entity_api_names.map(String)
      : [],
    meta: row.meta ?? {},
  }))
}

async function loadSyncState(entityId: string) {
  const rows = await query(
    `SELECT last_synced_version, last_synced_at, status, last_error
     FROM public.entity_sync_state
     WHERE entity_id = $1`,
    [entityId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    lastSyncedVersion: row.last_synced_version == null ? null : Number(row.last_synced_version),
    lastSyncedAt: row.last_synced_at ? new Date(String(row.last_synced_at)).toISOString() : null,
    status: String(row.status),
    lastError: row.last_error ? String(row.last_error) : null,
  }
}

function mapEntityBase(row: Record<string, unknown>, language?: string | null) {
  const labelTranslations = parseLabelTranslations(row.label_translations)
  const baseLabel = String(row.label ?? row.api_name)
  const backendConfig =
    row.backend_config && typeof row.backend_config === 'object'
      ? (row.backend_config as Record<string, unknown>)
      : {}
  return {
    id: String(row.id),
    apiName: String(row.api_name),
    label: pickLocalizedLabel(labelTranslations, language, baseLabel),
    note: readNote(backendConfig),
    icon: row.icon ? String(row.icon) : null,
    singleton: Boolean(row.singleton),
    group: row.entity_group ? String(row.entity_group) : null,
    displayTemplate: row.display_template ? String(row.display_template) : null,
    backendTarget: String(row.backend_target),
    backendConfig,
    labelTranslations: labelTranslations.map((t) => ({
      language: String(t.language),
      label: String(t.label ?? ''),
    })),
    hidden: Boolean(row.hidden),
    accountability: parseAccountability(backendConfig.accountability),
    internal: readInternal(backendConfig),
    __language: language ?? null,
    __apiName: String(row.api_name),
  }
}

async function writeEntityAudit(options: {
  entityApiName: string
  recordId: string
  action: Parameters<typeof writeAuditEntry>[0]['action']
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  userId?: string | null
}): Promise<void> {
  const accountability: EntityAccountability = await resolveEntityAccountability(
    options.entityApiName,
  )
  if (accountability === null) return
  await writeAuditEntry({
    ...options,
    skipRevisions: accountability === 'activity',
  })
}

export const resolvers = {
  Query: {
    health: async () => {
      const [entityRow] = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM public.entities',
      )
      const [translationRow] = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM public.translation_entries',
      )
      const [layoutRow] = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM public.layout_settings',
      )
      return {
        ok: true,
        service: 'crm-bff',
        registryEntities: Number(entityRow?.count ?? 0),
        translationEntries: Number(translationRow?.count ?? 0),
        layoutSettings: Number(layoutRow?.count ?? 0),
      }
    },

    languages: async () => {
      const rows = await query(
        `SELECT code, label, is_default, is_active, sort
         FROM public.supported_languages
         WHERE is_active = true
         ORDER BY sort ASC, code ASC`,
      )
      return rows.map((row) => ({
        code: String(row.code),
        label: String(row.label),
        isDefault: Boolean(row.is_default),
        isActive: Boolean(row.is_active),
        sort: Number(row.sort ?? 0),
      }))
    },

    translations: async (
      _: unknown,
      args: { language: string; namespace?: string | null; prefix?: string | null; limit?: number },
    ) => {
      const params: unknown[] = [args.language]
      const filters = ['language = $1']

      if (args.namespace) {
        params.push(args.namespace)
        filters.push(`namespace = $${params.length}`)
      }
      if (args.prefix) {
        params.push(`${args.prefix}%`)
        filters.push(`key LIKE $${params.length}`)
      }

      params.push(Math.min(Math.max(args.limit ?? 5000, 1), 20000))
      const rows = await query(
        `SELECT key, language, value, namespace
         FROM public.translation_entries
         WHERE ${filters.join(' AND ')}
         ORDER BY key ASC
         LIMIT $${params.length}`,
        params,
      )
      return rows.map((row) => ({
        key: String(row.key),
        language: String(row.language),
        value: String(row.value),
        namespace: String(row.namespace),
      }))
    },

    translate: async (
      _: unknown,
      args: { key: string; language: string; fallback?: string | null },
    ) => {
      const rows = await query(
        `SELECT value
         FROM public.translation_entries
         WHERE key = $1 AND language = $2
         ORDER BY CASE namespace WHEN 'crm' THEN 0 ELSE 1 END
         LIMIT 1`,
        [args.key, args.language],
      )
      if (rows[0]?.value) return String(rows[0].value)
      return args.fallback ?? args.key
    },

    entities: async (_: unknown, args: { includeHidden?: boolean }) => {
      const rows = await query(
        `SELECT *
         FROM public.entities
         WHERE deleted_at IS NULL
           AND ($1::boolean OR hidden = false)
         ORDER BY api_name ASC`,
        [Boolean(args.includeHidden)],
      )
      return rows.map((row) => mapEntityBase(row))
    },

    entity: async (_: unknown, args: { apiName: string }) => {
      const rows = await query(
        `SELECT * FROM public.entities WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
        [args.apiName],
      )
      return rows[0] ? mapEntityBase(rows[0]) : null
    },

    entitySchema: async (
      _: unknown,
      args: { apiName: string; language?: string | null },
    ) => {
      const rows = await query(
        `SELECT * FROM public.entities WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
        [args.apiName],
      )
      if (!rows[0]) {
        throw new Error(`Entity not found: ${args.apiName}`)
      }
      return mapEntityBase(rows[0], args.language)
    },

    registrySnapshot: async (_: unknown, args: { includeHidden?: boolean }) => {
      const entities = await query(
        `SELECT *
         FROM public.entities
         WHERE deleted_at IS NULL
           AND ($1::boolean OR hidden = false)
         ORDER BY api_name ASC`,
        [args.includeHidden !== false],
      )
      if (entities.length === 0) return []

      const entityIds = entities.map((row) => String(row.id))
      const [fieldRows, relationRows] = await Promise.all([
        query(
          `SELECT *
           FROM public.fields
           WHERE entity_id = ANY($1::uuid[])
           ORDER BY sort ASC, api_name ASC`,
          [entityIds],
        ),
        query(
          `SELECT
             r.id,
             r.entity_id,
             r.kind,
             r.meta,
             f.api_name AS field_api_name,
             related.api_name AS related_entity_api_name,
             junction.api_name AS junction_entity_api_name,
             COALESCE((
               SELECT array_agg(ae.api_name ORDER BY ae.api_name)
               FROM unnest(r.allowed_entity_ids) AS aid(id)
               JOIN public.entities ae ON ae.id = aid.id
             ), '{}') AS allowed_entity_api_names
           FROM public.relations r
           JOIN public.fields f ON f.id = r.field_id
           LEFT JOIN public.entities related
             ON related.id = r.related_entity_id AND related.deleted_at IS NULL
           LEFT JOIN public.entities junction ON junction.id = r.junction_entity_id
           WHERE r.entity_id = ANY($1::uuid[])
           ORDER BY f.api_name ASC`,
          [entityIds],
        ),
      ])

      const fieldsByEntity = new Map<string, ReturnType<typeof mapField>[]>()
      for (const row of fieldRows) {
        const entityId = String(row.entity_id)
        const list = fieldsByEntity.get(entityId) ?? []
        list.push(mapField(row))
        fieldsByEntity.set(entityId, list)
      }

      const relationsByEntity = new Map<string, Array<Record<string, unknown>>>()
      for (const row of relationRows) {
        const entityId = String(row.entity_id)
        const list = relationsByEntity.get(entityId) ?? []
        list.push({
          id: String(row.id),
          kind: String(row.kind),
          fieldApiName: String(row.field_api_name),
          relatedEntityApiName: row.related_entity_api_name
            ? String(row.related_entity_api_name)
            : null,
          junctionEntityApiName: row.junction_entity_api_name
            ? String(row.junction_entity_api_name)
            : null,
          allowedEntityApiNames: Array.isArray(row.allowed_entity_api_names)
            ? row.allowed_entity_api_names.map(String)
            : [],
          meta: row.meta ?? {},
        })
        relationsByEntity.set(entityId, list)
      }

      return entities.map((row) => {
        const base = mapEntityBase(row)
        return {
          ...base,
          __fields: fieldsByEntity.get(base.id) ?? [],
          __relations: relationsByEntity.get(base.id) ?? [],
        }
      })
    },

    layoutSettings: async (
      _: unknown,
      args: { entity?: string | null; groupKey?: string | null; subGroup?: string | null },
    ) => {
      const params: unknown[] = []
      const filters: string[] = []
      if (args.entity) {
        params.push(args.entity)
        filters.push(`entity_api_name = $${params.length}`)
      }
      if (args.groupKey) {
        params.push(args.groupKey)
        filters.push(`group_key = $${params.length}`)
      }
      if (args.subGroup) {
        params.push(args.subGroup)
        filters.push(`sub_group = $${params.length}`)
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const rows = await query(
        `SELECT id, entity_api_name, group_key, sub_group, role_id, payload,
                created_at, updated_at
         FROM public.layout_settings
         ${where}
         ORDER BY entity_api_name ASC, group_key ASC, sub_group ASC NULLS FIRST`,
        params,
      )
      return rows.map((row) => ({
        id: String(row.id),
        entityApiName: String(row.entity_api_name),
        groupKey: String(row.group_key),
        subGroup: row.sub_group == null ? null : String(row.sub_group),
        roleId: row.role_id == null ? null : String(row.role_id),
        payload: row.payload ?? {},
        createdAt: toIsoTimestamp(row.created_at),
        updatedAt: toIsoTimestamp(row.updated_at),
      }))
    },

    record: async (
      _: unknown,
      args: { entity: string; id: string; fields?: string[] | null },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'read')
      return findOneRecord(args.entity, String(args.id), args.fields)
    },

    records: async (
      _: unknown,
      args: {
        entity: string
        filter?: Record<string, unknown> | null
        fields?: string[] | null
        sort?: string[] | null
        search?: string | null
        limit?: number
        offset?: number
        includeDeleted?: boolean
      },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'read')
      return findManyRecords(args.entity, {
        filter: args.filter,
        fields: args.fields,
        sort: args.sort,
        search: args.search,
        limit: args.limit,
        offset: args.offset,
        includeDeleted: args.includeDeleted,
      })
    },

    recordActivities: async (
      _: unknown,
      args: {
        entity: string
        recordId: string
        actions?: string[] | null
        limit?: number
        offset?: number
      },
    ) => {
      return listRecordActivities({
        entityApiName: args.entity,
        recordId: String(args.recordId),
        actions: args.actions,
        limit: args.limit,
        offset: args.offset,
      })
    },

    recordRevisions: async (
      _: unknown,
      args: {
        entity: string
        recordId: string
        limit?: number
      },
    ) => {
      return listRecordRevisions({
        entityApiName: args.entity,
        recordId: String(args.recordId),
        limit: args.limit,
      })
    },

    file: async (
      _: unknown,
      args: { id: string; fields?: string[] | null },
    ) => {
      return findFile(String(args.id), args.fields)
    },

    files: async (
      _: unknown,
      args: { ids: string[]; fields?: string[] | null },
    ) => {
      return findFiles(args.ids ?? [], args.fields)
    },

    recordFiles: async (
      _: unknown,
      args: { collection: string; recordId: string; fields?: string[] | null },
    ) => {
      return listRecordFiles(String(args.collection), String(args.recordId), args.fields)
    },

    schemaDrift: async (
      _: unknown,
      args: { entity?: string | null },
    ) => {
      return detectSchemaDrift({ entityApiName: args.entity })
    },

    entitySyncStates: async () => listEntitySyncStates(),

    syncJobs: async (_: unknown, args: { limit?: number }) => {
      return listSyncJobs(args.limit)
    },

    userSetting: async (
      _: unknown,
      args: {
        userId: string
        collection: string
        groupKey: string
        key: string
      },
    ) => {
      return getUserSetting({
        userId: String(args.userId),
        collection: args.collection,
        groupKey: args.groupKey,
        key: args.key,
      })
    },

    recentRecordViews: async (
      _: unknown,
      args: {
        userId: string
        collection: string
        limit?: number | null
        offset?: number | null
      },
    ) => {
      const page = await listRecentRecordViews({
        userId: String(args.userId),
        collection: args.collection,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      })
      return {
        ids: page.views.map((row) => row.recordId),
        views: page.views,
        totalCount: page.totalCount,
      }
    },

    roles: async () => listRoles(),

    appRolesAdmin: async (
      _: unknown,
      __: unknown,
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return listAppRolesAdmin()
    },

    appUsersAdmin: async (
      _: unknown,
      args: { search?: string | null; includeInactive?: boolean | null },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return listAppUsersAdmin({
        search: args.search ?? null,
        includeInactive: args.includeInactive,
      })
    },

    rolePermissions: async (
      _: unknown,
      args: { roleId: string },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return listRolePermissions(String(args.roleId))
    },

    permissionEntities: async (
      _: unknown,
      __: unknown,
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return listPermissionEntities()
    },

    myRolePermissions: async (
      _: unknown,
      __: unknown,
      ctx: GraphQlAuthContext,
    ) => {
      const me = await fetchMe({ authorization: ctx.authorization })
      if (me.adminAccess || me.roleAdminAccess) {
        const entities = await listPermissionEntities()
        return entities.map((entity) => ({
          entityApiName: entity.apiName,
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        }))
      }
      if (await isRoleAdmin(me.roleId)) {
        const entities = await listPermissionEntities()
        return entities.map((entity) => ({
          entityApiName: entity.apiName,
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        }))
      }
      if (!me.roleId) return []
      return listRolePermissions(String(me.roleId))
    },

    me: async (
      _: unknown,
      __: unknown,
      ctx: { authorization: string | null },
    ) => fetchMe({ authorization: ctx.authorization }),

    users: async (
      _: unknown,
      args: {
        ids?: string[] | null
        search?: string | null
        fields?: string[] | null
        limit?: number | null
        sort?: string[] | null
      },
    ) => {
      return listUsers({
        ids: args.ids ?? null,
        search: args.search ?? null,
        fields: args.fields ?? null,
        limit: args.limit ?? null,
        sort: args.sort ?? null,
      })
    },

    presets: async (
      _: unknown,
      args: {
        fields?: string[] | null
        filter?: Record<string, unknown> | null
        sort?: string[] | null
        limit?: number | null
      },
    ) => {
      return listPresets({
        fields: args.fields?.length
          ? args.fields
          : ['id', 'collection', 'bookmark', 'filter'],
        filter: args.filter ?? null,
        sort: args.sort ?? null,
        limit: args.limit ?? -1,
      })
    },

    dashboards: async (
      _: unknown,
      args: {
        fields?: string[] | null
        sort?: string[] | null
        limit?: number | null
      },
    ) => {
      return listDashboards({
        fields: args.fields ?? null,
        sort: args.sort ?? null,
        limit: args.limit ?? -1,
      })
    },

    panels: async (
      _: unknown,
      args: {
        fields?: string[] | null
        filter?: Record<string, unknown> | null
        sort?: string[] | null
        limit?: number | null
      },
    ) => {
      return listPanels({
        fields: args.fields ?? null,
        filter: args.filter ?? null,
        sort: args.sort ?? null,
        limit: args.limit ?? -1,
      })
    },

    aggregateRecords: async (
      _: unknown,
      args: {
        entity: string
        aggregate: Record<string, unknown>
        groupBy?: string[] | null
        filter?: Record<string, unknown> | null
        limit?: number | null
      },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'read')
      return aggregateRecords(args.entity, {
        aggregate: args.aggregate ?? {},
        groupBy: args.groupBy ?? null,
        filter: args.filter ?? null,
        limit: args.limit ?? -1,
      })
    },

    scheduledTasks: async (
      _: unknown,
      __: unknown,
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return listScheduledTasks()
    },

    scheduledTaskRuns: async (
      _: unknown,
      args: { taskId: string; limit?: number | null },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return listScheduledTaskRuns(String(args.taskId), args.limit ?? 20)
    },

    itemGroupPriceTree: async (
      _: unknown,
      args: {
        priceGroupId?: string | null
        filter?: Record<string, unknown> | null
        fields?: string[] | null
        flatten?: boolean | null
        config?: Record<string, unknown> | null
      },
    ) => {
      const result = await loadItemGroupPriceTree({
        priceGroupId: args.priceGroupId ?? null,
        filter: args.filter ?? null,
        fields: args.fields ?? null,
        config: args.config ?? null,
      })
      const includeRows = args.flatten !== false
      return {
        tree: result.tree,
        rows: includeRows ? result.rows : [],
        sections: result.sections,
      }
    },
  },

  Mutation: {
    upsertDashboard: async (
      _: unknown,
      args: {
        input: {
          id?: string | null
          name: string
          icon?: string | null
          note?: string | null
          color?: string | null
        }
      },
    ) => {
      return upsertDashboard(args.input)
    },

    deleteDashboard: async (_: unknown, args: { id: string }) => {
      return deleteDashboard(args.id)
    },

    upsertPanel: async (
      _: unknown,
      args: {
        input: {
          id?: string | null
          dashboard: string
          name?: string | null
          icon?: string | null
          color?: string | null
          show_header?: boolean | null
          note?: string | null
          type: string
          position_x?: number | null
          position_y?: number | null
          width?: number | null
          height?: number | null
          options?: Record<string, unknown> | null
        }
      },
    ) => {
      return upsertPanel(args.input)
    },

    deletePanel: async (_: unknown, args: { id: string }) => {
      return deletePanel(args.id)
    },

    upsertLayoutSetting: async (
      _: unknown,
      args: {
        input: {
          settingId?: string | null
          entityApiName: string
          groupKey: string
          subGroup?: string | null
          roleId?: string | null
          name?: string | null
          body: Record<string, unknown>
        }
      },
    ) => {
      return upsertLayoutSettingRow(args.input)
    },

    deleteLayoutSetting: async (
      _: unknown,
      args: { settingId: string },
    ) => {
      const settingKey = String(args.settingId)
      const mapped = await query(
        `SELECT layout_setting_id::text AS layout_setting_id
         FROM public.layout_settings_id_map
         WHERE setting_id = $1`,
        [settingKey],
      )
      const layoutId =
        (mapped[0]?.layout_setting_id as string | undefined) ??
        (
          await query<{ id: string }>(
            `SELECT id::text AS id
             FROM public.layout_settings
             WHERE id::text = $1
             LIMIT 1`,
            [settingKey],
          )
        )[0]?.id

      if (!layoutId) return false
      await query(`DELETE FROM public.layout_settings WHERE id = $1::uuid`, [
        layoutId,
      ])
      return true
    },

    createRecord: async (
      _: unknown,
      args: { entity: string; data: Record<string, unknown>; fields?: string[] | null },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'create')
      const actorUserId = await resolveActorUserId(ctx)
      const created = await createRecord(
        args.entity,
        args.data ?? {},
        args.fields ?? null,
        { actorUserId },
      )
      const recordId = String(created.id ?? '')
      if (recordId) {
        try {
          await writeEntityAudit({
            entityApiName: args.entity,
            recordId,
            action: 'CREATE',
            after: created,
            userId: actorUserId,
          })
        } catch (error) {
          console.warn('[audit] createRecord failed', error)
        }
      }
      return created
    },

    updateRecord: async (
      _: unknown,
      args: {
        entity: string
        id: string
        data: Record<string, unknown>
        fields?: string[] | null
      },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'update')
      const actorUserId = await resolveActorUserId(ctx)
      let before: Record<string, unknown> | null = null
      try {
        before = await findOneRecord(args.entity, String(args.id))
      } catch {
        before = null
      }
      const updated = await updateRecord(
        args.entity,
        String(args.id),
        args.data ?? {},
        args.fields ?? null,
        { actorUserId },
      )
      try {
        await writeEntityAudit({
          entityApiName: args.entity,
          recordId: String(args.id),
          action: 'UPDATE',
          before,
          after: updated,
          userId: actorUserId,
        })
      } catch (error) {
        console.warn('[audit] updateRecord failed', error)
      }
      return updated
    },

    softDeleteRecord: async (
      _: unknown,
      args: { entity: string; id: string },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'delete')
      const actorUserId = await resolveActorUserId(ctx)
      let before: Record<string, unknown> | null = null
      try {
        before = await findOneRecord(args.entity, String(args.id))
      } catch {
        before = null
      }
      const deleted = await softDeleteRecord(args.entity, String(args.id), undefined, {
        actorUserId,
      })
      try {
        await writeEntityAudit({
          entityApiName: args.entity,
          recordId: String(args.id),
          action: 'SOFT_DELETE',
          before,
          after: deleted,
          userId: actorUserId,
        })
      } catch (error) {
        console.warn('[audit] softDeleteRecord failed', error)
      }
      return deleted
    },

    deleteRecord: async (
      _: unknown,
      args: { entity: string; id: string },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'delete')
      let before: Record<string, unknown> | null = null
      try {
        before = await findOneRecord(args.entity, String(args.id))
      } catch {
        before = null
      }
      await hardDeleteRecord(args.entity, String(args.id))
      try {
        await writeEntityAudit({
          entityApiName: args.entity,
          recordId: String(args.id),
          action: 'DELETE',
          before,
          after: null,
          userId: await resolveActorUserId(ctx),
        })
      } catch (error) {
        console.warn('[audit] deleteRecord failed', error)
      }
      return true
    },

    restoreRecord: async (
      _: unknown,
      args: { entity: string; id: string },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.entity, 'update')
      let before: Record<string, unknown> | null = null
      try {
        before = await findOneRecord(args.entity, String(args.id))
      } catch {
        before = null
      }
      const restored = await restoreRecord(args.entity, String(args.id))
      try {
        await writeEntityAudit({
          entityApiName: args.entity,
          recordId: String(args.id),
          action: 'RESTORE',
          before,
          after: restored,
          userId: await resolveActorUserId(ctx),
        })
      } catch (error) {
        console.warn('[audit] restoreRecord failed', error)
      }
      return restored
    },

    runSchemaDriftCheck: async (
      _: unknown,
      args: { entity?: string | null },
    ) => {
      return runSchemaDriftCheck({ entityApiName: args.entity })
    },

    runSchemaSync: async (
      _: unknown,
      args: { entity: string; dryRun?: boolean | null },
    ) => {
      return runSchemaSync({
        entityApiName: args.entity,
        dryRun: args.dryRun !== false,
      })
    },

    upsertEntityUniqueGroups: async (
      _: unknown,
      args: {
        entity: string
        groups: Array<{ name: string; fields: string[] }>
        applyIndexes?: boolean | null
      },
    ) => {
      const entityApiName = String(args.entity || '').trim()
      if (!entityApiName) throw new Error('entity is required')
      const saved = await saveEntityUniqueGroups(
        entityApiName,
        (args.groups ?? []).map((g) => ({
          name: String(g.name || ''),
          fields: (g.fields ?? []).map(String),
        })),
      )
      clearCrmStorageCache()
      if (args.applyIndexes !== false) {
        const actions = await planUniqueIndexActions(entityApiName)
        await applyUniqueIndexActions(actions)
      }
      return saved
    },

    upsertEntityAutomations: async (
      _: unknown,
      args: {
        entity: string
        automations: Array<{
          id?: string | null
          name: string
          enabled?: boolean | null
          sort?: number | null
          triggers?: string[] | null
          logic?: string | null
          conditions?: Array<{
            field: string
            operator: string
            value?: unknown
            valueSource?: string | null
            compareField?: string | null
          }> | null
          requireChanged?: string[] | null
          setFields?: Record<string, unknown> | null
          actions?: Array<{
            type: string
            severity?: string | null
            message?: string | null
          }> | null
        }>
      },
    ): Promise<EntityRecordAutomation[]> => {
      const entityApiName = String(args.entity || '').trim()
      if (!entityApiName) throw new Error('entity is required')
      const saved = await saveEntityAutomations(
        entityApiName,
        (args.automations ?? []).map((rule, index) => ({
          id: String(rule.id || `auto_${index + 1}`),
          name: String(rule.name || `Rule ${index + 1}`),
          enabled: rule.enabled !== false,
          sort:
            typeof rule.sort === 'number' && Number.isFinite(rule.sort)
              ? Math.trunc(rule.sort)
              : (index + 1) * 10,
          triggers: (rule.triggers ?? ['create', 'update']) as EntityRecordAutomation['triggers'],
          logic: (rule.logic === 'or' ? 'or' : 'and') as EntityRecordAutomation['logic'],
          conditions: (rule.conditions ?? []).map((c) => ({
            field: String(c.field || ''),
            operator: String(c.operator || ''),
            value: c.value,
            valueSource:
              String(c.valueSource || '').toLowerCase() === 'field'
                ? 'field'
                : 'literal',
            compareField: c.compareField
              ? String(c.compareField)
              : undefined,
          })),
          requireChanged: (rule.requireChanged ?? []).map(String),
          setFields: (rule.setFields && typeof rule.setFields === 'object'
            ? rule.setFields
            : {}) as Record<string, unknown>,
          actions: (rule.actions ?? []).map((action) => {
            const type = String(action.type || '')
              .trim()
              .toLowerCase()
            if (type === 'break') return { type: 'break' as const }
            const severityRaw = String(action.severity || 'info')
              .trim()
              .toLowerCase()
            return {
              type: 'notify' as const,
              severity:
                severityRaw === 'warn' ||
                severityRaw === 'warning' ||
                severityRaw === 'alarm'
                  ? ('warn' as const)
                  : ('info' as const),
              message: String(action.message || '').trim(),
            }
          }),
        })),
      )
      clearCrmStorageCache()
      return saved
    },

    updateEntityMeta: async (
      _: unknown,
      args: {
        entity: string
        input: {
          label?: string | null
          note?: string | null
          icon?: string | null
          displayTemplate?: string | null
          hidden?: boolean | null
          singleton?: boolean | null
          internal?: boolean | null
          accountability?: string | null
        }
      },
    ) => {
      const entityApiName = String(args.entity || '').trim()
      if (!entityApiName) throw new Error('entity is required')
      const input = args.input ?? {}
      const accountability =
        input.accountability === undefined
          ? undefined
          : input.accountability === null || input.accountability === ''
            ? null
            : parseAccountability(input.accountability)

      await updateEntityMeta(entityApiName, {
        label: input.label,
        note: input.note,
        icon: input.icon,
        displayTemplate: input.displayTemplate,
        hidden: input.hidden,
        singleton: input.singleton,
        internal: input.internal,
        accountability,
      })
      clearCrmStorageCache()

      const rows = await query(
        `SELECT * FROM public.entities WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
        [entityApiName],
      )
      if (!rows[0]) throw new Error(`Entity not found: ${entityApiName}`)
      return mapEntityBase(rows[0])
    },

    createRegistryEntity: async (
      _: unknown,
      args: {
        input: {
          apiName: string
          label: string
          note?: string | null
          icon?: string | null
          singleton?: boolean | null
          hidden?: boolean | null
          displayTemplate?: string | null
          group?: string | null
        }
        applyDdl?: boolean | null
      },
    ) => {
      const input = args.input ?? ({} as { apiName: string; label: string })
      if (!String(input.apiName || '').trim()) {
        throw new Error('input.apiName is required')
      }
      if (!String(input.label || '').trim() && !String(input.apiName || '').trim()) {
        throw new Error('input.label or apiName is required')
      }
      const created = await createRegistryEntity(
        {
          apiName: String(input.apiName),
          label: String(input.label || input.apiName),
          note: input.note,
          icon: input.icon,
          singleton: Boolean(input.singleton),
          hidden: Boolean(input.hidden),
          displayTemplate: input.displayTemplate,
          group: input.group,
        },
        { applyDdl: args.applyDdl !== false },
      )
      const rows = await query(
        `SELECT * FROM public.entities WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
        [created.apiName],
      )
      if (!rows[0]) throw new Error(`Entity not found after create: ${created.apiName}`)
      return mapEntityBase(rows[0])
    },

    deleteRegistryEntity: async (
      _: unknown,
      args: { entity: string },
    ) => {
      const entityApiName = String(args.entity || '').trim()
      if (!entityApiName) throw new Error('entity is required')
      return deleteRegistryEntity(entityApiName)
    },

    createAppRole: async (
      _: unknown,
      args: { input: { name: string; isAdmin?: boolean | null } },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return createAppRole({
        name: args.input.name,
        isAdmin: args.input.isAdmin,
      })
    },

    updateAppRole: async (
      _: unknown,
      args: {
        id: string
        input: { name?: string | null; isAdmin?: boolean | null }
      },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return updateAppRole(String(args.id), args.input ?? {})
    },

    deleteAppRole: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return deleteAppRole(String(args.id))
    },

    createAppUser: async (
      _: unknown,
      args: {
        input: {
          email: string
          firstName?: string | null
          lastName?: string | null
          roleId?: string | null
          password?: string | null
          isActive?: boolean | null
        }
      },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return createAppUser(args.input)
    },

    updateAppUser: async (
      _: unknown,
      args: {
        id: string
        input: {
          email?: string | null
          firstName?: string | null
          lastName?: string | null
          roleId?: string | null
          isActive?: boolean | null
        }
      },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return updateAppUser(String(args.id), args.input ?? {})
    },

    setAppUserPassword: async (
      _: unknown,
      args: { id: string; password: string },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return setAppUserPassword(String(args.id), String(args.password ?? ''))
    },

    replaceRolePermissions: async (
      _: unknown,
      args: {
        roleId: string
        permissions: Array<{
          entityApiName: string
          canCreate: boolean
          canRead: boolean
          canUpdate: boolean
          canDelete: boolean
        }>
      },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return replaceRolePermissions(String(args.roleId), args.permissions ?? [])
    },

    setFieldIsUnique: async (
      _: unknown,
      args: {
        entity: string
        field: string
        isUnique: boolean
        applyIndexes?: boolean | null
      },
    ) => {
      const entityApiName = String(args.entity || '').trim()
      const fieldApiName = String(args.field || '').trim()
      if (!entityApiName || !fieldApiName) {
        throw new Error('entity and field are required')
      }
      const ok = await writeFieldIsUnique(
        entityApiName,
        fieldApiName,
        Boolean(args.isUnique),
      )
      if (!ok) throw new Error(`Field not found: ${entityApiName}.${fieldApiName}`)
      clearCrmStorageCache()
      if (args.applyIndexes !== false) {
        const actions = await planUniqueIndexActions(entityApiName)
        await applyUniqueIndexActions(actions)
      }
      return true
    },

    createRegistryField: async (
      _: unknown,
      args: {
        entity: string
        input: RegistryFieldInput
        applyDdl?: boolean | null
      },
    ) => {
      const entityApiName = String(args.entity || '').trim()
      if (!entityApiName) throw new Error('entity is required')
      if (!args.input?.apiName?.trim()) throw new Error('input.apiName is required')
      if (!args.input?.label?.trim() && !args.input?.apiName?.trim()) {
        throw new Error('input.label or apiName is required')
      }
      const row = await createRegistryField(
        entityApiName,
        {
          apiName: String(args.input.apiName),
          label: String(args.input.label || args.input.apiName),
          type: String(args.input.type || 'STRING'),
          interface: String(args.input.interface || ''),
          required: args.input.required,
          readonly: args.input.readonly,
          hidden: args.input.hidden,
          sort: args.input.sort ?? undefined,
          options: args.input.options as Record<string, unknown> | null,
          displayOptions: args.input.displayOptions as Record<string, unknown> | null,
          isUnique: args.input.isUnique,
          isIndexed: args.input.isIndexed,
          relationKind: args.input.relationKind,
          relatedEntity: args.input.relatedEntity,
          junctionEntity: args.input.junctionEntity,
          relationMeta: args.input.relationMeta as Record<string, unknown> | null,
        },
        { applyDdl: args.applyDdl !== false },
      )
      return toGraphQlField(row)
    },

    updateRegistryField: async (
      _: unknown,
      args: {
        id: string
        input: RegistryFieldInput
        applyDdl?: boolean | null
      },
    ) => {
      const id = String(args.id || '').trim()
      if (!id) throw new Error('id is required')
      const row = await updateRegistryField(
        id,
        {
          apiName: args.input.apiName ?? undefined,
          label: args.input.label ?? undefined,
          type: args.input.type ?? undefined,
          interface: args.input.interface ?? undefined,
          required: args.input.required,
          readonly: args.input.readonly,
          hidden: args.input.hidden,
          sort: args.input.sort ?? undefined,
          options: args.input.options as Record<string, unknown> | null | undefined,
          displayOptions: args.input.displayOptions as
            | Record<string, unknown>
            | null
            | undefined,
          isUnique: args.input.isUnique,
          isIndexed: args.input.isIndexed,
          relationKind: args.input.relationKind,
          relatedEntity: args.input.relatedEntity,
          junctionEntity: args.input.junctionEntity,
          relationMeta: args.input.relationMeta as Record<string, unknown> | null,
        },
        { applyDdl: args.applyDdl !== false },
      )
      return toGraphQlField(row)
    },

    deleteRegistryField: async (
      _: unknown,
      args: {
        entity: string
        field: string
        applyDdl?: boolean | null
      },
    ) => {
      const entityApiName = String(args.entity || '').trim()
      const fieldApiName = String(args.field || '').trim()
      if (!entityApiName || !fieldApiName) {
        throw new Error('entity and field are required')
      }
      return deleteRegistryField(entityApiName, fieldApiName, {
        applyDdl: Boolean(args.applyDdl),
      })
    },

    upsertUserSetting: async (
      _: unknown,
      args: {
        userId: string
        collection: string
        groupKey: string
        key: string
        value?: unknown
      },
    ) => {
      await upsertUserSetting({
        userId: String(args.userId),
        collection: args.collection,
        groupKey: args.groupKey,
        key: args.key,
        value: args.value ?? null,
      })
      return true
    },

    upsertRecentRecordView: async (
      _: unknown,
      args: {
        userId: string
        collection: string
        recordId: string
        viewedAt?: string | null
      },
    ) => {
      return upsertRecentRecordView({
        userId: String(args.userId),
        collection: args.collection,
        recordId: String(args.recordId),
        viewedAt: args.viewedAt ?? null,
      })
    },

    upsertScheduledTask: async (
      _: unknown,
      args: {
        input: {
          id?: string | null
          key?: string | null
          name: string
          jobType: string
          cron?: string | null
          schedule?: unknown
          timezone?: string | null
          enabled?: boolean | null
          params?: Record<string, unknown> | null
          description?: string | null
        }
      },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return upsertScheduledTask(args.input)
    },

    deleteScheduledTask: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return deleteScheduledTask(String(args.id))
    },

    runScheduledTask: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQlAuthContext,
    ) => {
      await requireAdminAccess(ctx)
      return runScheduledTask(String(args.id), 'manual')
    },

    generateScheduleSlots: async (
      _: unknown,
      args: {
        rangeStart: string
        rangeEnd: string
        providerIds?: string[] | null
        facilityIds?: string[] | null
      },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, SCHEDULE_SLOT_COLLECTION, 'create')
      return generateScheduleSlotsService({
        rangeStart: args.rangeStart,
        rangeEnd: args.rangeEnd,
        providerIds: args.providerIds ?? undefined,
        facilityIds: args.facilityIds ?? undefined,
      })
    },

    bulkUpdateRelatedFromAction: async (
      _: unknown,
      args: {
        collection: string
        recordId: string
        relatedCollection: string
        targetField: string
        sourcePath: string
        multiplier: number
        formula?: string | null
        sourceCollection?: string | null
        sourceLinkField?: string | null
        activeSourcesOnly?: boolean | null
      },
      ctx: GraphQlAuthContext,
    ) => {
      const sourceCollection = String(args.sourceCollection ?? '').trim()
      await assertEntityPermission(ctx, args.collection, 'read')
      await assertEntityPermission(ctx, args.relatedCollection, 'read')
      await assertEntityPermission(ctx, args.relatedCollection, 'update')
      if (sourceCollection) {
        await assertEntityPermission(ctx, sourceCollection, 'read')
        await assertEntityPermission(ctx, args.relatedCollection, 'create')
      }
      const actorUserId = await resolveActorUserId(ctx)
      try {
        return await bulkUpdateRelatedFromAction({
          collection: args.collection,
          recordId: String(args.recordId),
          relatedCollection: args.relatedCollection,
          targetField: args.targetField,
          sourcePath: args.sourcePath,
          multiplier: Number(args.multiplier),
          formula: args.formula ?? 'multiply',
          sourceCollection: sourceCollection || null,
          sourceLinkField: args.sourceLinkField ?? null,
          activeSourcesOnly: args.activeSourcesOnly !== false,
          actorUserId,
        })
      } catch (error) {
        if (error instanceof BulkUpdateRelatedError) {
          throw new Error(error.message)
        }
        throw error
      }
    },

    bulkUpdateFilteredFromAction: async (
      _: unknown,
      args: {
        collection: string
        targetField: string
        sourcePath: string
        multiplier: number
        formula?: string | null
        filter?: Record<string, unknown> | null
        recordIds?: string[] | null
      },
      ctx: GraphQlAuthContext,
    ) => {
      await assertEntityPermission(ctx, args.collection, 'read')
      await assertEntityPermission(ctx, args.collection, 'update')
      const actorUserId = await resolveActorUserId(ctx)
      try {
        return await bulkUpdateFilteredFromAction({
          collection: args.collection,
          targetField: args.targetField,
          sourcePath: args.sourcePath,
          multiplier: Number(args.multiplier),
          formula: args.formula ?? '{{source}} * {{prompt}}',
          filter: args.filter ?? null,
          recordIds: args.recordIds ?? null,
          actorUserId,
        })
      } catch (error) {
        if (error instanceof BulkUpdateRelatedError) {
          throw new Error(error.message)
        }
        throw error
      }
    },
  },

  Entity: {
    fields: async (parent: {
      id: string
      __language?: string | null
      __fields?: ReturnType<typeof mapField>[]
    }) => {
      if (parent.__fields) return parent.__fields
      return loadFields(parent.id, parent.__language ?? null)
    },
    relations: async (parent: {
      id: string
      __relations?: Array<Record<string, unknown>>
    }) => {
      if (parent.__relations) return parent.__relations
      return loadRelations(parent.id)
    },
    syncState: async (parent: { id: string }) => loadSyncState(parent.id),
    uniqueGroups: async (parent: {
      apiName?: string
      __apiName?: string
    }): Promise<EntityUniqueGroup[]> => {
      const apiName = parent.__apiName || parent.apiName
      if (!apiName) return []
      return loadEntityUniqueGroups(String(apiName))
    },
    automations: async (parent: {
      apiName?: string
      __apiName?: string
    }): Promise<EntityRecordAutomation[]> => {
      const apiName = parent.__apiName || parent.apiName
      if (!apiName) return []
      return loadEntityAutomations(String(apiName))
    },
  },
}
