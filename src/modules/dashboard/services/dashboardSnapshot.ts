import { upsertDashboardBridge } from '@/core/graphql/dashboardsApi'
import type { DashboardSourceSnapshot } from '@/interfaces'
import {
  buildPanelRenderModel,
  loadDashboardRecords,
  loadDashboardsWithPanels,
  panelSourceForSnapshot,
  renderModelToSnapshotEntry,
  type DashboardWithPanels,
} from './dashboardSettings'
import { readPanelsBridge } from '@/core/graphql/dashboardsApi'
import type { DashboardPanelRecord } from '@/interfaces'

export interface RefreshDashboardSnapshotResult {
  dashboard: DashboardWithPanels
  lastRefreshedAt: string
}

/** Recompute aggregate/report panel data and persist on the dashboard row. */
export async function refreshDashboardSnapshot(
  dashboardId: string,
): Promise<RefreshDashboardSnapshotResult> {
  const id = String(dashboardId).trim()
  if (!id) throw new Error('Dashboard id is required.')

  const [dashboards, panelsRaw] = await Promise.all([
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

  const dashboard = dashboards.find((row) => row.id === id)
  if (!dashboard) throw new Error(`Dashboard not found: ${id}`)

  const panels = panelsRaw as unknown as DashboardPanelRecord[]
  const lastRefreshedAt = new Date().toISOString()
  const snapshot: DashboardSourceSnapshot = {
    version: 1,
    panels: {},
  }

  for (const panel of panels) {
    const render = await buildPanelRenderModel(panel)
    snapshot.panels[panel.id] = renderModelToSnapshotEntry(
      render,
      panelSourceForSnapshot(panel),
    )
  }

  await upsertDashboardBridge({
    id: dashboard.id,
    name: dashboard.name,
    icon: dashboard.icon ?? null,
    note: dashboard.note ?? null,
    color: dashboard.color ?? null,
    roleId: dashboard.roleId ?? null,
    sourceSnapshot: snapshot,
    lastRefreshedAt,
  })

  const refreshed = await loadDashboardsWithPanels({
    preferSnapshot: true,
  })
  const withPanels = refreshed.find((row) => row.id === id)
  if (!withPanels) throw new Error(`Dashboard not found after refresh: ${id}`)

  return {
    dashboard: withPanels,
    lastRefreshedAt,
  }
}
