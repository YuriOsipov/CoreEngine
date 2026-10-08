/** Directus Insights–compatible dashboard / panel contracts. */

export type DashboardPanelType =
  | 'metric'
  | 'bar-chart'
  | 'line-chart'
  | 'pie-chart'
  | 'label'

export type DashboardAggregateFunction =
  | 'count'
  | 'countDistinct'
  | 'sum'
  | 'sumDistinct'
  | 'avg'
  | 'avgDistinct'
  | 'min'
  | 'max'

export interface DashboardRecord {
  id: string
  name: string
  icon?: string | null
  note?: string | null
  color?: string | null
}

export interface DashboardPanelRecord {
  id: string
  dashboard: string | DashboardRecord
  name?: string | null
  icon?: string | null
  color?: string | null
  show_header?: boolean
  note?: string | null
  type: string
  position_x?: number | null
  position_y?: number | null
  width?: number | null
  height?: number | null
  options?: Record<string, unknown> | null
}

/** Directus metric panel options. */
export interface MetricPanelOptions {
  collection: string
  field?: string
  function?: DashboardAggregateFunction | string
  filter?: Record<string, unknown>
}

/** Directus bar / line / pie chart options. */
export interface ChartPanelOptions {
  collection: string
  xAxis?: string
  yAxis?: string
  aggregation?: DashboardAggregateFunction | string
  function?: DashboardAggregateFunction | string
  filter?: Record<string, unknown>
  showLegend?: boolean
  color?: string
}

/** Directus label / note panel options. */
export interface LabelPanelOptions {
  text?: string
  content?: string
  body?: string
  note?: string
}

export type DashboardPanelOptions =
  | MetricPanelOptions
  | ChartPanelOptions
  | LabelPanelOptions
  | Record<string, unknown>

export interface UpsertDashboardInput {
  id?: string | null
  name: string
  icon?: string | null
  note?: string | null
  color?: string | null
}

export interface UpsertPanelInput {
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
