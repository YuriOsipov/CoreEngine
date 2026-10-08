import type {
  RoleLayoutSaveOptions,
  SavedRoleScopedLayout,
  SchedulerFilterLevel,
  SchedulerEventClickAction,
  SchedulerResourceFilterSettings,
  SchedulerResourceSettings,
  SchedulerResourceTreeSettings,
  SchedulerSettings,
} from '@/interfaces'
import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { currentUserRole } from '@/core/currentUser'
import {
  DuplicateRoleScopedLayoutError,
  normalizeSavedRoleScopedLayout,
  parseSettingRoleId,
  sortRoleScopedLayouts,
} from '@/core/settingRoleUtils'

const SETTINGS_GROUP = 'Scheduler'
const SETTINGS_SUB_GROUP = 'full'

interface SchedulerSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: SchedulerSettings | string | null
}

export async function loadSchedulerLayouts(
  eventCollection: string,
): Promise<SavedRoleScopedLayout[]> {
  const records = await readSchedulerSettingRecords(eventCollection)
  return sortRoleScopedLayouts(records.map((record) => normalizeSavedRoleScopedLayout(record)))
}

/** Builder/setup only — loads a scheduler layout by record ID without role scoping. */
export async function loadSchedulerSettingsById(
  eventCollection: string,
  layoutId: string,
): Promise<SchedulerSettings | null> {
  const record = await readSchedulerSettingRecordById(eventCollection, layoutId)
  return parseSchedulerBody(record)
}

export async function resolveSchedulerSettingsForRole(
  eventCollection: string,
  roleId: string | null,
): Promise<SchedulerSettings | null> {
  const record = await resolveSchedulerSettingRecord(eventCollection, roleId)
  return parseSchedulerBody(record)
}

export async function resolveSchedulerSettingsForCurrentUser(
  eventCollection: string,
): Promise<SchedulerSettings | null> {
  return resolveSchedulerSettingsForRole(eventCollection, await currentUserRole())
}

export async function loadSchedulerSettings(
  eventCollection: string,
): Promise<SchedulerSettings | null> {
  return resolveSchedulerSettingsForCurrentUser(eventCollection)
}

export async function saveSchedulerSettings(
  settings: SchedulerSettings,
  options?: RoleLayoutSaveOptions,
): Promise<SavedRoleScopedLayout> {
  const body = stripBlankFilterLevels(normalizeSchedulerSettings(settings))
  if (!body.event.collection) {
    throw new Error('Scheduler event collection is required.')
  }

  const collection = body.event.collection
  const resolvedOptions: RoleLayoutSaveOptions = options ?? {
    layoutId: null,
    name: collection,
    roleId: null,
  }
  const name = resolvedOptions.name.trim()
  if (!name) {
    throw new Error('Scheduler layout name is required.')
  }

  const roleId = resolvedOptions.roleId ?? null
  const layouts = await loadSchedulerLayouts(collection)
  const layoutId = resolvedOptions.layoutId ?? null
  const duplicate = layouts.find(
    (layout) => layout.roleId === roleId && layout.id !== String(layoutId ?? ''),
  )
  if (duplicate) {
    throw new DuplicateRoleScopedLayoutError()
  }

  const existing = layoutId
    ? await readSchedulerSettingRecordById(collection, String(layoutId))
    : null

  const savedId = await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    name,
    body: body as unknown as Record<string, unknown>,
  })

  return {
    id: savedId,
    name,
    roleId,
    roleName: layouts.find((layout) => layout.roleId === roleId)?.roleName ?? null,
  }
}

export async function deleteSchedulerLayout(
  eventCollection: string,
  layoutId: string,
): Promise<void> {
  const existing = await readSchedulerSettingRecordById(eventCollection, layoutId)
  if (!existing) return

  if (parseSettingRoleId(existing.role) === null) {
    throw new Error('Cannot delete the default scheduler layout')
  }

  await writeSettingDelete(String(existing.id))
}

function parseSchedulerBody(record: SchedulerSettingRecord | null): SchedulerSettings | null {
  if (!record?.body) return null

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as SchedulerSettings)
      : record.body

  return normalizeSchedulerSettings(body)
}

async function resolveSchedulerSettingRecord(
  eventCollection: string,
  roleId: string | null,
): Promise<SchedulerSettingRecord | null> {
  if (roleId) {
    const roleMatch = await readSchedulerSettingRecordByRole(eventCollection, roleId)
    if (roleMatch) return roleMatch
  }

  return readSchedulerSettingRecordByRole(eventCollection, null)
}

async function readSchedulerSettingRecords(
  eventCollection: string,
): Promise<SchedulerSettingRecord[]> {
  return readSettingRecords<SchedulerSettingRecord>({
    collection: eventCollection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
  })
}

async function readSchedulerSettingRecordById(
  eventCollection: string,
  layoutId: string,
): Promise<SchedulerSettingRecord | null> {
  return readSettingRecord<SchedulerSettingRecord>({
    collection: eventCollection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    id: layoutId,
    limit: 1,
  })
}

async function readSchedulerSettingRecordByRole(
  eventCollection: string,
  roleId: string | null,
): Promise<SchedulerSettingRecord | null> {
  return readSettingRecord<SchedulerSettingRecord>({
    collection: eventCollection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    limit: 1,
  })
}

export function normalizeSchedulerSettings(
  settings: Partial<SchedulerSettings> & Record<string, any> | null | undefined,
): SchedulerSettings {
  const resource = (settings?.resource ?? {}) as Partial<SchedulerSettings['resource']> & {
    collections?: unknown[]
    location?: unknown
  }
  const event = (settings?.event ?? {}) as Partial<SchedulerSettings['event']>
  const legacyResourceCollections = normalizeLegacyResourceCollections(resource, settings)
  const primaryResource = legacyResourceCollections[0]
  const tree = normalizeResourceTree(resource.tree ?? settings?.resourceTree)
  const resourceFields = normalizeStringList(
    event.resourceFields ??
      legacyResourceCollections.map((item) => item.eventField).filter(Boolean) ??
      event.resourceField ??
      settings?.eventResourceField,
    primaryResource.eventField ?? '',
  )
  const eventResourceField =
    event.resourceField ??
    settings?.eventResourceField ??
    resourceFields[0] ??
    ''
  const fixedResource =
    legacyResourceCollections.find((item) => item.eventField === eventResourceField) ??
    primaryResource
  const resourceTitle = normalizeResourceTitle(
    resource.title ?? settings?.resourceTitle ?? fixedResource.title,
  )
  const titledResource: SchedulerResourceSettings = {
    ...fixedResource,
    title: resourceTitle,
  }
  const resourceMigrationFallbacks = titledResource.collection ? [titledResource] : []
  const titleField = event.titleField ?? settings?.eventTitleField ?? 'name'
  const titleFields = normalizeStringList(
    event.titleFields ?? settings?.eventTitleFields,
    titleField,
  )
  const statusColors = normalizeStatusColors(
    event.statusColors ?? settings?.eventStatusColors,
  )
  const viewMode =
    settings?.viewMode === 'timelineScheduler'
      ? 'timelineScheduler'
      : 'resourceCalendar'

  return {
    viewMode,
    resource: {
      title: resourceTitle,
      collection: titledResource.collection,
      primaryKey: titledResource.primaryKey,
      labelField: titledResource.labelField,
      eventField: eventResourceField,
      tree,
      filter: normalizeResourceFilterSettings(
        resource.filter ?? resource.location ?? settings?.resourceFilter ?? settings?.resourceLocation,
        tree,
        resourceMigrationFallbacks,
      ),
    },
    event: {
      collection: event.collection ?? settings?.eventCollection ?? '',
      primaryKey: event.primaryKey ?? settings?.eventPrimaryKey ?? 'id',
      titleField,
      titleFields,
      startField: event.startField ?? settings?.eventStartField ?? 'start',
      endField: event.endField ?? settings?.eventEndField ?? 'end',
      resourceField: eventResourceField,
      resourceFields: eventResourceField ? [eventResourceField] : [],
      statusField: event.statusField ?? settings?.eventStatusField ?? null,
      statusColors,
      colorField: event.colorField ?? settings?.eventColorField ?? null,
      defaultTitle: event.defaultTitle ?? settings?.defaultTitle ?? 'New visit',
      clickAction: normalizeEventClickAction(event.clickAction ?? settings?.eventClickAction),
      allowDelete: Boolean(event.allowDelete ?? settings?.allowEventDelete),
      availability: normalizeAvailabilitySettings(
        event.availability ?? settings?.availability,
      ),
      sourceMode: event.sourceMode === 'templateExpansion' ? 'templateExpansion' : 'direct',
      ruleField: typeof event.ruleField === 'string' ? event.ruleField.trim() : '',
    },
  }
}

function normalizeEventClickAction(value: unknown): SchedulerEventClickAction {
  return value === 'openEditDialog' ? 'openEditDialog' : 'openDetails'
}

function normalizeAvailabilitySettings(
  value: unknown,
): SchedulerSettings['event']['availability'] {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const collection = typeof record.collection === 'string' ? record.collection : ''
  if (!collection) return null

  return {
    enabled: record.enabled !== false,
    collection,
    resourceField:
      typeof record.resourceField === 'string' ? record.resourceField : 'provider',
    startField:
      typeof record.startField === 'string' ? record.startField : 'date_start',
    endField: typeof record.endField === 'string' ? record.endField : 'date_end',
    typeField: typeof record.typeField === 'string' ? record.typeField : 'type',
    intakeValue:
      typeof record.intakeValue === 'string' ? record.intakeValue : 'intake',
    blockValue: typeof record.blockValue === 'string' ? record.blockValue : 'block',
  }
}

function normalizeResourceTree(value: unknown): SchedulerResourceTreeSettings {
  const record = value && typeof value === 'object'
    ? value as Partial<SchedulerResourceTreeSettings>
    : {}

  return {
    enabled: Boolean(record.enabled),
    collection: record.collection ?? '',
    fields: normalizeStringList(record.fields, ''),
  }
}

function normalizeResourceFilterSettings(
  value: unknown,
  tree: SchedulerResourceTreeSettings,
  resources: SchedulerResourceSettings[],
): SchedulerResourceFilterSettings {
  const record = value && typeof value === 'object'
    ? value as Partial<SchedulerResourceFilterSettings>
    : {}
  const resourceFields = new Set(
    resources.map((resource) => resource.eventField).filter(Boolean) as string[],
  )
  const migratedResourceField =
    tree.fields.find((field) => resourceFields.has(field)) ??
    tree.fields[1] ??
    ''
  const migratedGroupField =
    tree.fields.find((field) => field !== migratedResourceField) ??
    tree.fields[0] ??
    ''

  const groupField = record.groupField ?? migratedGroupField
  const levels = normalizeFilterLevels(record.levels, groupField)

  return {
    enabled: Boolean(record.enabled ?? tree.enabled),
    title: typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : 'Filter',
    collection: record.collection ?? tree.collection ?? '',
    groupField: levels[0]?.groupField ?? groupField,
    levels,
    resourceField: record.resourceField ?? migratedResourceField,
    tree: normalizeFilterTreeSettings(record.tree),
  }
}

function normalizeFilterTreeSettings(
  value: unknown,
): SchedulerResourceFilterSettings['tree'] {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parentField = typeof record.parentField === 'string'
    ? record.parentField.trim()
    : ''
  const enabled = Boolean(record.enabled)
  // Keep enabled independently of parentField so the designer checkbox persists
  // before a parent field is chosen. Runtime still requires both.
  if (!enabled && !parentField) return null
  const levelIndex = typeof record.levelIndex === 'number' && Number.isFinite(record.levelIndex)
    ? Math.max(0, Math.floor(record.levelIndex))
    : 0
  return {
    enabled,
    levelIndex,
    parentField,
  }
}

function stripBlankFilterLevels(settings: SchedulerSettings): SchedulerSettings {
  const filter = settings.resource.filter
  if (!filter) return settings

  const levels = filter.levels.filter((level) => level.groupField)
  return {
    ...settings,
    resource: {
      ...settings.resource,
      filter: {
        ...filter,
        levels,
        groupField: levels[0]?.groupField ?? '',
      },
    },
  }
}

function normalizeFilterLevels(
  value: unknown,
  fallbackGroupField: string,
): SchedulerFilterLevel[] {
  const list = Array.isArray(value) ? value : []
  // Blank levels are preserved so the designer can render freshly added rows
  // before a group field is chosen. Save validation and `stripBlankFilterLevels`
  // keep incomplete levels out of the persisted body and runtime.
  const levels = list.map((item) => {
    const record = item && typeof item === 'object'
      ? item as Partial<SchedulerFilterLevel>
      : {}
    const groupField = typeof record.groupField === 'string'
      ? record.groupField.trim()
      : ''
    const title = typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : groupField
    return { groupField, title }
  })

  if (levels.length > 0) return levels
  return fallbackGroupField
    ? [{ groupField: fallbackGroupField, title: fallbackGroupField }]
    : []
}

function normalizeLegacyResourceCollections(
  resource: Partial<SchedulerSettings['resource']> & { collections?: unknown[] },
  settings: (Partial<SchedulerSettings> & Record<string, any>) | null | undefined,
): SchedulerResourceSettings[] {
  const event = (settings?.event ?? {}) as Partial<SchedulerSettings['event']>
  const legacyResource: SchedulerResourceSettings = {
    title: normalizeResourceTitle(resource.title ?? settings?.resourceTitle),
    collection: resource.collection ?? settings?.resourceCollection ?? '',
    primaryKey: resource.primaryKey ?? settings?.resourcePrimaryKey ?? 'id',
    labelField: resource.labelField ?? settings?.resourceLabelField ?? 'name',
    eventField: resource.eventField ?? event.resourceField ?? settings?.eventResourceField ?? '',
  }
  const rawCollections = Array.isArray(resource.collections)
    ? resource.collections
    : []
  const collections = rawCollections
    .map((item) => normalizeResourceCollection(item, legacyResource))
    .filter((item) => item.collection)

  if (collections.length === 0) {
    return [legacyResource]
  }

  return collections
}

function normalizeResourceCollection(
  value: unknown,
  fallback: SchedulerResourceSettings,
): SchedulerResourceSettings {
  const record = value && typeof value === 'object'
    ? value as Partial<SchedulerResourceSettings>
    : {}

  return {
    title: normalizeResourceTitle(record.title ?? fallback.title),
    collection: record.collection ?? '',
    primaryKey: record.primaryKey ?? fallback.primaryKey,
    labelField: record.labelField ?? fallback.labelField,
    eventField: record.eventField ?? fallback.eventField,
  }
}

function normalizeResourceTitle(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : 'Resources'
}

function normalizeStringList(value: unknown, fallback: string): string[] {
  const values = Array.isArray(value) ? value : [fallback]
  const normalized = values
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
  if (normalized.length > 0) return Array.from(new Set(normalized))
  return fallback ? [fallback] : []
}

function normalizeStatusColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (colors, [status, color]) => {
      if (typeof color === 'string' && color.trim()) {
        colors[status] = color.trim()
      }
      return colors
    },
    {},
  )
}
