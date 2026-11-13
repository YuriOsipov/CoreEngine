import {
  deleteDashboardBridge,
  deletePanelBridge,
  readPanelsBridge,
  upsertDashboardBridge,
  upsertPanelBridge,
} from '@/core/graphql/dashboardsApi'
import type {
  DashboardPanelRecord,
  DashboardPanelType,
  DashboardRecord,
  UpsertDashboardInput,
  UpsertPanelInput,
} from '@/interfaces'
import {
  loadDashboardRecords,
  type DashboardWithPanels,
} from './dashboardSettings'

export const GRID_COLUMNS = 60
export const DEFAULT_PANEL_WIDTH = 20
export const DEFAULT_PANEL_HEIGHT = 12

export const DESIGNER_PANEL_TYPES: DashboardPanelType[] = [
  'metric',
  'bar-chart',
  'line-chart',
  'pie-chart',
  'label',
]

export interface DesignerPanelDraft extends DashboardPanelRecord {
  /** Client-side marker: panel exists only in draft until first save. */
  _isNew?: boolean
}

export interface DesignerDashboardDraft {
  id: string | null
  name: string
  icon: string | null
  note: string | null
  color: string | null
  roleId: string | null
  lastRefreshedAt: string | null
  panels: DesignerPanelDraft[]
  /** Panel ids removed from an existing dashboard; deleted on save. */
  deletedPanelIds: string[]
  dirty: boolean
}

export function createEmptyDraft(): DesignerDashboardDraft {
  return {
    id: null,
    name: '',
    icon: null,
    note: null,
    color: null,
    roleId: null,
    lastRefreshedAt: null,
    panels: [],
    deletedPanelIds: [],
    dirty: false,
  }
}

export function draftFromDashboard(
  dashboard: DashboardWithPanels,
): DesignerDashboardDraft {
  return {
    id: dashboard.id,
    name: dashboard.name,
    icon: dashboard.icon ?? null,
    note: dashboard.note ?? null,
    color: dashboard.color ?? null,
    roleId: dashboard.roleId ?? null,
    lastRefreshedAt: dashboard.lastRefreshedAt ?? null,
    panels: dashboard.panels.map((panel) => ({
      id: panel.id,
      dashboard: dashboard.id,
      name: panel.name ?? null,
      icon: panel.icon ?? null,
      color: panel.color ?? null,
      show_header: panel.show_header !== false,
      note: panel.note ?? null,
      type: panel.type,
      position_x: panel.position_x ?? 1,
      position_y: panel.position_y ?? 1,
      width: panel.width ?? DEFAULT_PANEL_WIDTH,
      height: panel.height ?? DEFAULT_PANEL_HEIGHT,
      options: panel.options ? { ...panel.options } : {},
      _isNew: false,
    })),
    deletedPanelIds: [],
    dirty: false,
  }
}

export function defaultOptionsForType(
  type: DashboardPanelType,
): Record<string, unknown> {
  switch (type) {
    case 'metric':
      return {
        sourceType: 'collection',
        collection: '',
        reportId: '',
        field: '*',
        function: 'count',
        filter: {},
      }
    case 'bar-chart':
    case 'line-chart':
    case 'pie-chart':
      return {
        sourceType: 'collection',
        collection: '',
        reportId: '',
        xAxis: '',
        yAxis: '',
        aggregation: 'count',
        showLegend: type === 'pie-chart',
        filter: {},
      }
    case 'label':
      return { text: '' }
    default:
      return {}
  }
}

export function defaultSizeForType(type: DashboardPanelType): {
  width: number
  height: number
} {
  if (type === 'metric') return { width: 12, height: 8 }
  if (type === 'label') return { width: 16, height: 6 }
  return { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT }
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  )
}

export function findFreePosition(
  panels: DesignerPanelDraft[],
  width: number,
  height: number,
  excludeId?: string,
): { position_x: number; position_y: number } {
  const others = panels.filter((p) => p.id !== excludeId)
  let y = 1
  while (y < 500) {
    for (let x = 1; x <= GRID_COLUMNS - width + 1; x += 1) {
      const candidate = { x, y, w: width, h: height }
      const collision = others.some((p) =>
        rectsOverlap(candidate, {
          x: p.position_x ?? 1,
          y: p.position_y ?? 1,
          w: p.width ?? DEFAULT_PANEL_WIDTH,
          h: p.height ?? DEFAULT_PANEL_HEIGHT,
        }),
      )
      if (!collision) return { position_x: x, position_y: y }
    }
    y += 1
  }
  return { position_x: 1, position_y: 1 }
}

export function clampPanelGeometry(panel: DesignerPanelDraft): DesignerPanelDraft {
  const width = Math.min(
    GRID_COLUMNS,
    Math.max(2, panel.width ?? DEFAULT_PANEL_WIDTH),
  )
  const height = Math.max(2, panel.height ?? DEFAULT_PANEL_HEIGHT)
  const position_x = Math.min(
    GRID_COLUMNS - width + 1,
    Math.max(1, panel.position_x ?? 1),
  )
  const position_y = Math.max(1, panel.position_y ?? 1)
  return { ...panel, width, height, position_x, position_y }
}

export function createPanelDraft(
  type: DashboardPanelType,
  dashboardId: string | null,
  existing: DesignerPanelDraft[],
): DesignerPanelDraft {
  const size = defaultSizeForType(type)
  const pos = findFreePosition(existing, size.width, size.height)
  return clampPanelGeometry({
    id: crypto.randomUUID(),
    dashboard: dashboardId ?? '',
    name: type,
    icon: null,
    color: null,
    show_header: true,
    note: null,
    type,
    position_x: pos.position_x,
    position_y: pos.position_y,
    width: size.width,
    height: size.height,
    options: defaultOptionsForType(type),
    _isNew: true,
  })
}

export async function listDashboardSummaries(): Promise<DashboardRecord[]> {
  return loadDashboardRecords()
}

export interface DashboardListRow extends DashboardRecord {
  panelCount: number
}

export async function listDashboardRows(): Promise<DashboardListRow[]> {
  const [dashboards, panels] = await Promise.all([
    loadDashboardRecords(),
    readPanelsBridge({
      fields: ['id', 'dashboard'],
      sort: ['dashboard'],
      limit: -1,
    }),
  ])
  const counts = new Map<string, number>()
  for (const panel of panels) {
    const dashboard =
      typeof panel.dashboard === 'string'
        ? panel.dashboard
        : panel.dashboard && typeof panel.dashboard === 'object'
          ? String((panel.dashboard as { id?: unknown }).id ?? '')
          : ''
    if (!dashboard) continue
    counts.set(dashboard, (counts.get(dashboard) ?? 0) + 1)
  }
  return dashboards.map((dashboard) => ({
    ...dashboard,
    panelCount: counts.get(dashboard.id) ?? 0,
  }))
}

export async function loadDesignerDraft(
  dashboardId: string,
): Promise<DesignerDashboardDraft> {
  const id = String(dashboardId)
  const [dashboards, panels] = await Promise.all([
    loadDashboardRecords(),
    readPanelsBridge({
      fields: [
        'id',
        'dashboard',
        'name',
        'icon',
        'color',
        'show_header',
        'note',
        'type',
        'position_x',
        'position_y',
        'width',
        'height',
        'options',
      ],
      filter: { dashboard: { _eq: id } },
      sort: ['position_y', 'position_x'],
      limit: -1,
    }),
  ])
  const found = dashboards.find((d) => d.id === id)
  if (!found) throw new Error(`Dashboard not found: ${dashboardId}`)
  const withPanels: DashboardWithPanels = {
    ...found,
    panels: (panels as unknown as DashboardPanelRecord[]).map((panel) => ({
      ...panel,
      render: {
        kind: 'unsupported' as const,
        reason: '',
        options: null,
      },
    })),
  }
  return draftFromDashboard(withPanels)
}

function toUpsertPanelInput(
  panel: DesignerPanelDraft,
  dashboardId: string,
): UpsertPanelInput {
  return {
    id: panel.id,
    dashboard: dashboardId,
    name: panel.name ?? null,
    icon: panel.icon ?? null,
    color: panel.color ?? null,
    show_header: panel.show_header !== false,
    note: panel.note ?? null,
    type: panel.type,
    position_x: panel.position_x ?? 1,
    position_y: panel.position_y ?? 1,
    width: panel.width ?? DEFAULT_PANEL_WIDTH,
    height: panel.height ?? DEFAULT_PANEL_HEIGHT,
    options: (panel.options as Record<string, unknown>) ?? {},
  }
}

/**
 * Persist draft dashboard + panels. Creates dashboard first when `id` is null.
 * Returns refreshed draft from server.
 */
export async function saveDesignerDraft(
  draft: DesignerDashboardDraft,
): Promise<DesignerDashboardDraft> {
  const name = draft.name.trim()
  if (!name) throw new Error('Dashboard name is required.')

  const dashboardInput: UpsertDashboardInput = {
    id: draft.id,
    name,
    icon: draft.icon,
    note: draft.note,
    color: draft.color,
    roleId: draft.roleId,
  }
  const savedDashboard = await upsertDashboardBridge(dashboardInput)
  const dashboardId = String(savedDashboard.id)

  for (const panelId of draft.deletedPanelIds) {
    await deletePanelBridge(panelId)
  }

  for (const panel of draft.panels) {
    await upsertPanelBridge(toUpsertPanelInput(panel, dashboardId))
  }

  return loadDesignerDraft(dashboardId)
}

export async function deleteDesignerDashboard(id: string): Promise<void> {
  await deleteDashboardBridge(id)
}

export function panelGridStyle(
  panel: Pick<
    DesignerPanelDraft,
    'position_x' | 'position_y' | 'width' | 'height'
  >,
): Record<string, string> {
  const column = Math.max(1, panel.position_x ?? 1)
  const row = Math.max(1, panel.position_y ?? 1)
  const width = Math.max(1, panel.width ?? DEFAULT_PANEL_WIDTH)
  const height = Math.max(1, panel.height ?? DEFAULT_PANEL_HEIGHT)
  return {
    gridColumn: `${column} / span ${width}`,
    gridRow: `${row} / span ${height}`,
  }
}

export function isDesignerPanelType(type: string): type is DashboardPanelType {
  return (DESIGNER_PANEL_TYPES as string[]).includes(type)
}
