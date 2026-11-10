import type {
  EntityRecordAutomationCondition,
  RecordPageComponent,
  RecordPageLayoutSchema,
  RecordPageListDetailPanel,
  RecordPageRegion,
  RoleLayoutSaveOptions,
  SavedRoleScopedLayout,
} from '@/interfaces'
import { DEFAULT_VISIBLE_ACTION_BUTTONS, normalizeActivityLogSettings } from '@/interfaces'
import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { currentUserRole } from '@/core/currentUser'
import {
  DuplicateRoleScopedLayoutError,
  canDeleteRoleScopedLayout,
  normalizeSavedRoleScopedLayout,
  parseSettingRoleId,
  sortRoleScopedLayouts,
} from '@/core/settingRoleUtils'

const SETTINGS_GROUP = 'RecordPage'
const SETTINGS_SUB_GROUP = 'full'

interface RecordPageSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: RecordPageLayoutSchema | string | null
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

const DEFAULT_MAIN_SIZE = 50
const MIN_MAIN_SIZE = 20
const MAX_MAIN_SIZE = 80

export function clampRecordPageMainSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAIN_SIZE
  return Math.min(MAX_MAIN_SIZE, Math.max(MIN_MAIN_SIZE, Math.round(value)))
}

export function createDefaultRecordPageLayout(collection: string): RecordPageLayoutSchema {
  return {
    entity: collection,
    version: 1,
    pageLayoutId: null,
    sidebarEnabled: true,
    mainSize: DEFAULT_MAIN_SIZE,
    listDetailPanel: null,
    regions: [
      {
        id: newId('region'),
        key: 'header',
        title: 'Header',
        components: [
          {
            id: newId('cmp'),
            type: 'highlights',
            label: 'Highlights',
            visibleActionButtons: DEFAULT_VISIBLE_ACTION_BUTTONS,
            actionLayoutId: null,
          },
        ],
      },
      {
        id: newId('region'),
        key: 'main',
        title: 'Main',
        components: [
          {
            id: newId('cmp'),
            type: 'detail',
            label: 'Record Detail',
            pageLayoutId: null,
          },
        ],
      },
      {
        id: newId('region'),
        key: 'sidebar',
        title: 'Sidebar',
        components: [],
      },
    ],
  }
}

export function normalizeRecordPageLayout(
  schema: Partial<RecordPageLayoutSchema> | null | undefined,
  collection: string,
): RecordPageLayoutSchema {
  const fallback = createDefaultRecordPageLayout(collection)
  if (!schema || typeof schema !== 'object') return fallback

  const regions = Array.isArray(schema.regions)
    ? schema.regions.map((region) => normalizeRegion(region)).filter(Boolean) as RecordPageRegion[]
    : fallback.regions

  return {
    entity: typeof schema.entity === 'string' && schema.entity ? schema.entity : collection,
    version: typeof schema.version === 'number' ? schema.version : 1,
    pageLayoutId: schema.pageLayoutId ?? null,
    sidebarEnabled: schema.sidebarEnabled !== false,
    mainSize: clampRecordPageMainSize(schema.mainSize ?? DEFAULT_MAIN_SIZE),
    listDetailPanel: normalizeListDetailPanel(schema.listDetailPanel),
    regions: regions.length > 0 ? regions : fallback.regions,
  }
}

function normalizeListDetailPanel(
  panel: Partial<RecordPageListDetailPanel> | null | undefined,
): RecordPageListDetailPanel | null {
  if (!panel || typeof panel !== 'object' || panel.enabled !== true) return null

  const masterSize =
    typeof panel.masterSize === 'number' && panel.masterSize > 0 && panel.masterSize < 100
      ? Math.min(95, Math.max(20, Math.round(panel.masterSize)))
      : undefined
  const detailMinSize =
    typeof panel.detailMinSize === 'number' && panel.detailMinSize >= 0 && panel.detailMinSize < 100
      ? Math.min(50, Math.max(5, Math.round(panel.detailMinSize)))
      : undefined

  const orientation = panel.orientation === 'sideBySide' ? 'sideBySide' : undefined
  // Side-by-side always uses the full Page Layout on the detail pane.
  const contentMode =
    orientation === 'sideBySide' || panel.contentMode === 'fullPageLayout'
      ? 'fullPageLayout'
      : undefined

  const relatedListsSource =
    contentMode === 'fullPageLayout'
      ? undefined
      : panel.relatedListsSource === 'block'
        ? 'block'
        : undefined
  const relatedListsBlockId =
    relatedListsSource === 'block' && typeof panel.relatedListsBlockId === 'string'
      ? panel.relatedListsBlockId.trim() || null
      : undefined

  return {
    enabled: true,
    ...(contentMode ? { contentMode } : {}),
    ...(orientation ? { orientation } : {}),
    ...(masterSize !== undefined ? { masterSize } : {}),
    ...(detailMinSize !== undefined ? { detailMinSize } : {}),
    ...(panel.defaultCollapsed === true ? { defaultCollapsed: true } : {}),
    ...(relatedListsSource ? { relatedListsSource } : {}),
    ...(relatedListsSource === 'block' ? { relatedListsBlockId: relatedListsBlockId ?? null } : {}),
  }
}

function normalizeRegion(region: Partial<RecordPageRegion> | null | undefined): RecordPageRegion | null {
  if (!region || typeof region !== 'object') return null
  const key = region.key === 'header' || region.key === 'sidebar' || region.key === 'main'
    ? region.key
    : 'main'
  const components = Array.isArray(region.components)
    ? region.components.map((component) => normalizeComponent(component)).filter(Boolean) as RecordPageComponent[]
    : []

  return {
    id: typeof region.id === 'string' && region.id ? region.id : newId('region'),
    key,
    title: typeof region.title === 'string' ? region.title : undefined,
    components,
  }
}

function normalizeVisibleActionButtons(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VISIBLE_ACTION_BUTTONS
  }
  return Math.min(20, Math.max(1, Math.floor(value)))
}

function normalizeReadonlyIfConditions(
  value: unknown,
): EntityRecordAutomationCondition[] | undefined {
  if (!Array.isArray(value)) return undefined
  const conditions = value
    .map((item): EntityRecordAutomationCondition | null => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const field = typeof row.field === 'string' ? row.field.trim() : ''
      const operator = typeof row.operator === 'string' ? row.operator.trim() : ''
      if (!field || !operator) return null
      const valueSource =
        row.valueSource === 'field' || row.valueSource === 'literal'
          ? row.valueSource
          : undefined
      const compareField =
        typeof row.compareField === 'string' && row.compareField.trim()
          ? row.compareField.trim()
          : row.compareField === null
            ? null
            : undefined
      return {
        field,
        operator,
        ...(row.value !== undefined ? { value: row.value } : {}),
        ...(valueSource ? { valueSource } : {}),
        ...(compareField !== undefined ? { compareField } : {}),
      }
    })
    .filter((item): item is EntityRecordAutomationCondition => item !== null)
  return conditions.length > 0 ? conditions : undefined
}

function normalizeComponent(
  component: Partial<RecordPageComponent> | null | undefined,
): RecordPageComponent | null {
  if (!component || typeof component !== 'object') return null
  const type = component.type
  if (
    type !== 'highlights'
    && type !== 'detail'
    && type !== 'relatedList'
    && type !== 'files'
    && type !== 'activityLog'
    && type !== 'tabs'
    && type !== 'actions'
    && type !== 'field'
    && type !== 'fieldGroup'
    && type !== 'path'
  ) {
    return null
  }

  const columns: 1 | 2 | undefined =
    type === 'fieldGroup'
      ? (component.columns === 1 ? 1 : 2)
      : undefined

  const visibleActionButtons =
    type === 'highlights'
      ? normalizeVisibleActionButtons(component.visibleActionButtons)
      : undefined

  return {
    id: typeof component.id === 'string' && component.id ? component.id : newId('cmp'),
    type,
    label: typeof component.label === 'string' ? component.label : undefined,
    pageLayoutId: component.pageLayoutId ?? null,
    compactLayoutId: component.compactLayoutId ?? null,
    actionLayoutId: component.actionLayoutId ?? null,
    visibleActionButtons,
    sectionIds: Array.isArray(component.sectionIds)
      ? component.sectionIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    relatedCollection:
      typeof component.relatedCollection === 'string' ? component.relatedCollection : undefined,
    relatedFieldId:
      typeof component.relatedFieldId === 'string' && component.relatedFieldId
        ? component.relatedFieldId
        : null,
    field: typeof component.field === 'string' ? component.field : undefined,
    terminalField:
      type === 'path' && typeof component.terminalField === 'string' && component.terminalField.trim()
        ? component.terminalField.trim()
        : undefined,
    successTerminalValues:
      type === 'path' && Array.isArray(component.successTerminalValues)
        ? component.successTerminalValues
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim())
        : undefined,
    readonly: type === 'path' ? component.readonly === true : undefined,
    readonlyIf:
      type === 'path' ? normalizeReadonlyIfConditions(component.readonlyIf) : undefined,
    readonlyIfLogic:
      type === 'path' && component.readonlyIfLogic === 'or' ? 'or' : undefined,
    fieldComponent: component.fieldComponent,
    span: typeof component.span === 'number' ? component.span : undefined,
    format: typeof component.format === 'string' ? component.format : undefined,
    columns,
    inlineLabels:
      type === 'fieldGroup' || type === 'field'
        ? component.inlineLabels !== false
        : undefined,
    collapsed: type === 'fieldGroup' ? component.collapsed === true : undefined,
    activityLog:
      type === 'activityLog'
        ? normalizeActivityLogSettings(component.activityLog)
        : undefined,
    components:
      type === 'fieldGroup' && Array.isArray(component.components)
        ? component.components
            .map((child) => normalizeComponent(child))
            .filter(Boolean) as RecordPageComponent[]
        : type === 'fieldGroup'
          ? []
          : undefined,
    defaultTabId: (() => {
      const tabs = Array.isArray(component.tabs) ? component.tabs : []
      const requested =
        typeof component.defaultTabId === 'string' && component.defaultTabId
          ? component.defaultTabId
          : null
      if (requested && tabs.some((tab) => tab?.id === requested)) return requested
      const firstId = tabs.find((tab) => typeof tab?.id === 'string' && tab.id)?.id
      return typeof firstId === 'string' ? firstId : null
    })(),
    tabs: Array.isArray(component.tabs)
      ? component.tabs.map((tab) => ({
          id: typeof tab?.id === 'string' && tab.id ? tab.id : newId('tab'),
          title: typeof tab?.title === 'string' ? tab.title : 'Tab',
          components: Array.isArray(tab?.components)
            ? tab.components
                .map((child) => normalizeComponent(child))
                .filter(Boolean) as RecordPageComponent[]
            : [],
        }))
      : undefined,
  }
}

export async function loadRecordPageLayouts(
  collection: string,
): Promise<SavedRoleScopedLayout[]> {
  const records = await readRecordPageSettingRecords(collection)
  return sortRoleScopedLayouts(records.map((record) => normalizeSavedRoleScopedLayout(record)))
}

/** Builder/setup only — loads a record page layout by record ID without role scoping. */
export async function loadRecordPageLayoutById(
  collection: string,
  layoutId: string,
): Promise<RecordPageLayoutSchema | null> {
  const record = await readRecordPageSettingRecordById(collection, layoutId)
  return parseRecordPageBody(collection, record)
}

export async function resolveRecordPageLayoutForRole(
  collection: string,
  roleId: string | null,
): Promise<RecordPageLayoutSchema | null> {
  const record = await resolveRecordPageSettingRecord(collection, roleId)
  return parseRecordPageBody(collection, record)
}

export async function resolveRecordPageLayoutForCurrentUser(
  collection: string,
): Promise<RecordPageLayoutSchema | null> {
  return resolveRecordPageLayoutForRole(collection, await currentUserRole())
}

export async function saveRecordPageLayout(
  collection: string,
  schema: RecordPageLayoutSchema,
  options: RoleLayoutSaveOptions,
): Promise<SavedRoleScopedLayout> {
  const name = options.name.trim()
  if (!name) {
    throw new Error('Page layout name is required')
  }

  const roleId = options.roleId ?? null
  const layouts = await loadRecordPageLayouts(collection)
  const layoutId = options.layoutId ?? null
  const duplicate = layouts.find(
    (layout) => layout.roleId === roleId && layout.id !== String(layoutId ?? ''),
  )
  if (duplicate) {
    throw new DuplicateRoleScopedLayoutError()
  }

  const body = normalizeRecordPageLayout(
    {
      ...schema,
      entity: collection,
    },
    collection,
  )

  const existing = layoutId
    ? await readRecordPageSettingRecordById(collection, String(layoutId))
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

export async function deleteRecordPageLayout(
  collection: string,
  layoutId: string,
): Promise<void> {
  const existing = await readRecordPageSettingRecordById(collection, layoutId)
  if (!existing) return

  const layouts = await loadRecordPageLayouts(collection)
  const roleId = parseSettingRoleId(existing.role)
  if (
    !canDeleteRoleScopedLayout(
      { id: String(existing.id), roleId },
      layouts,
    )
  ) {
    throw new Error('Cannot delete the last default page layout')
  }

  await writeSettingDelete(String(existing.id))
}

function parseRecordPageBody(
  collection: string,
  record: RecordPageSettingRecord | null,
): RecordPageLayoutSchema | null {
  if (!record?.body) return null

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as RecordPageLayoutSchema)
      : record.body

  return normalizeRecordPageLayout(body, collection)
}

async function resolveRecordPageSettingRecord(
  collection: string,
  roleId: string | null,
): Promise<RecordPageSettingRecord | null> {
  if (roleId) {
    const roleMatch = await readRecordPageSettingRecordByRole(collection, roleId)
    if (roleMatch) return roleMatch
  }

  return readRecordPageSettingRecordByRole(collection, null)
}

async function readRecordPageSettingRecords(
  collection: string,
): Promise<RecordPageSettingRecord[]> {
  return readSettingRecords<RecordPageSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
  })
}

async function readRecordPageSettingRecordById(
  collection: string,
  layoutId: string,
): Promise<RecordPageSettingRecord | null> {
  return readSettingRecord<RecordPageSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    id: layoutId,
    limit: 1,
  })
}

async function readRecordPageSettingRecordByRole(
  collection: string,
  roleId: string | null,
): Promise<RecordPageSettingRecord | null> {
  return readSettingRecord<RecordPageSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    limit: 1,
  })
}
