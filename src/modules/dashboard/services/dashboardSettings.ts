import {
  readAggregateRecordsBridge,
  readDashboardsBridge,
  readPanelsBridge,
} from '@/core/graphql/dashboardsApi'
import type {
  DashboardPanelRecord,
  DashboardRecord,
} from '@/interfaces'
import {
  loadReportPanelSeries,
  type ReportPanelSeries,
} from './panelReportSource'

type AggregateFunction =
  | 'count'
  | 'countDistinct'
  | 'sum'
  | 'sumDistinct'
  | 'avg'
  | 'avgDistinct'
  | 'min'
  | 'max'
type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'polarArea'

export type { DashboardPanelRecord, DashboardRecord }

export interface DashboardWithPanels extends DashboardRecord {
  panels: DashboardPanel[]
}

export interface DashboardPanel extends DashboardPanelRecord {
  render: PanelRenderModel
}

export type PanelRenderModel =
  | {
      kind: 'metric'
      label: string
      value: string
      detail?: string
    }
  | {
      kind: 'chart'
      chartType: ChartType
      data: Record<string, unknown>
      options: Record<string, unknown>
    }
  | {
      kind: 'note'
      text: string
    }
  | {
      kind: 'unsupported'
      reason: string
      options: Record<string, unknown> | null
    }

interface PanelQueryConfig {
  collection: string
  aggregateFunction: AggregateFunction
  aggregateField: string
  groupBy?: string
  filter?: Record<string, unknown>
  limit?: number
  showLegend?: boolean
}

const CHART_COLORS = [
  '#42A5F5',
  '#66BB6A',
  '#FFA726',
  '#AB47BC',
  '#26C6DA',
  '#EF5350',
  '#EC407A',
  '#7E57C2',
]

export async function loadDashboardsWithPanels(): Promise<DashboardWithPanels[]> {
  const [dashboardsRaw, panelsRaw] = await Promise.all([
    loadDashboardRecords(),
    loadPanelRecords(),
  ])

  const dashboards = dashboardsRaw as unknown as DashboardRecord[]
  const panels = panelsRaw as unknown as DashboardPanelRecord[]

  return Promise.all(
    dashboards.map(async (dashboard) => {
      const dashboardPanels = panels
        .filter((panel) => dashboardId(panel.dashboard) === dashboard.id)
        .sort(comparePanelPosition)

      return {
        ...dashboard,
        panels: await Promise.all(
          dashboardPanels.map(async (panel) => ({
            ...panel,
            render: await buildPanelRenderModel(panel),
          })),
        ),
      }
    }),
  )
}

async function loadDashboardRecords(): Promise<Record<string, unknown>[]> {
  return readDashboardsBridge({
    fields: ['id', 'name', 'icon', 'note', 'color'],
    sort: ['name'],
    limit: -1,
  })
}

async function loadPanelRecords(): Promise<Record<string, unknown>[]> {
  return readPanelsBridge({
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
    sort: ['dashboard', 'position_y', 'position_x'],
    limit: -1,
  })
}

/** Build live render model for a panel (runtime + designer preview). */
export async function buildPanelRenderModel(
  panel: DashboardPanelRecord,
): Promise<PanelRenderModel> {
  const options = asRecord(panel.options)
  const type = panel.type.toLowerCase()

  if (isNotePanel(type)) {
    return {
      kind: 'note',
      text: stringOption(options, ['text', 'content', 'body', 'note']) ?? panel.note ?? '',
    }
  }

  if (panelSourceType(options) === 'report') {
    return buildReportPanelRender(panel, options)
  }

  const query = panelQueryConfig(panel, options)
  if (!query) {
    return {
      kind: 'unsupported',
      reason: 'Panel options do not include enough query information.',
      options,
    }
  }

  try {
    const rows = await loadPanelAggregateRows(query)

    if (isMetricPanel(type, query)) {
      return buildMetricRender(panel, query, rows)
    }

    return buildChartRender(panel, query, rows, options)
  } catch (err) {
    return {
      kind: 'unsupported',
      reason: err instanceof Error ? err.message : 'Failed to load panel data.',
      options,
    }
  }
}

async function buildReportPanelRender(
  panel: DashboardPanelRecord,
  options: Record<string, unknown> | null,
): Promise<PanelRenderModel> {
  const reportId = stringOption(options, ['reportId', 'report_id', 'report'])
  if (!reportId) {
    return {
      kind: 'unsupported',
      reason: 'Select a report for this panel.',
      options,
    }
  }

  try {
    const series = await loadReportPanelSeries(reportId)
    if (!series) {
      return {
        kind: 'unsupported',
        reason: 'Report not found or has no pivot values.',
        options,
      }
    }

    const type = panel.type.toLowerCase()
    const forceMetric =
      type.includes('metric') ||
      type.includes('stat') ||
      type.includes('count')

    if (forceMetric) {
      return buildMetricFromReportSeries(panel, series)
    }

    if (series.labels.length === 0) {
      return {
        kind: 'unsupported',
        reason: 'Report returned no data for this chart.',
        options,
      }
    }

    return buildChartFromReportSeries(panel, series, options)
  } catch (err) {
    return {
      kind: 'unsupported',
      reason: err instanceof Error ? err.message : 'Failed to load report panel data.',
      options,
    }
  }
}

function buildMetricFromReportSeries(
  panel: DashboardPanelRecord,
  series: ReportPanelSeries,
): PanelRenderModel {
  const total = series.values.reduce((sum, value) => sum + value, 0)
  return {
    kind: 'metric',
    label: panel.name || panel.note || series.title,
    value: formatPanelValue(total),
    detail: series.valueLabel,
  }
}

function buildChartFromReportSeries(
  panel: DashboardPanelRecord,
  series: ReportPanelSeries,
  options: Record<string, unknown> | null,
): PanelRenderModel {
  const chartType = chartTypeForPanel(panel.type, options)
  const isCircular = ['pie', 'doughnut', 'polarArea'].includes(chartType)
  const primaryColor = panelColor(panel, options)
  const showLegend = booleanOption(options, ['showLegend', 'show_legend'])
  const barColors = series.labels.map((label, index) =>
    conditionalFillColor(options, primaryColor, label, series.values[index]),
  )
  const lineFillColor = transparentColor(primaryColor)

  return {
    kind: 'chart',
    chartType,
    data: {
      labels: series.labels,
      datasets: [
        {
          label: panel.name || series.title,
          data: series.values,
          backgroundColor: isCircular
            ? series.labels.map((_, index) => CHART_COLORS[index % CHART_COLORS.length])
            : chartType === 'line'
              ? lineFillColor
              : barColors,
          borderColor: primaryColor,
          borderRadius: chartType === 'bar' ? 6 : undefined,
          fill: chartType === 'line',
          tension: chartType === 'line' ? 0.35 : undefined,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: showLegend ?? isCircular,
        },
      },
      scales: isCircular
        ? undefined
        : {
            y: {
              beginAtZero: true,
            },
          },
    },
  }
}

function panelSourceType(
  options: Record<string, unknown> | null,
): 'collection' | 'report' {
  const explicit = stringOption(options, ['sourceType', 'source_type'])?.toLowerCase()
  if (explicit === 'report') return 'report'
  if (explicit === 'collection') return 'collection'
  if (stringOption(options, ['reportId', 'report_id', 'report'])) return 'report'
  return 'collection'
}

async function loadPanelAggregateRows(
  query: PanelQueryConfig,
): Promise<Record<string, unknown>[]> {
  const aggregate = {
    [query.aggregateFunction]: query.aggregateField,
  }
  const groupBy = query.groupBy ? [query.groupBy] : undefined

  return readAggregateRecordsBridge({
    entity: query.collection,
    aggregate,
    groupBy,
    filter: query.filter ?? null,
    limit: query.limit ?? -1,
  })
}

function panelQueryConfig(
  panel: DashboardPanelRecord,
  options: Record<string, unknown> | null,
): PanelQueryConfig | null {
  if (!options) return null

  const collection = stringOption(options, [
    'collection',
    'collectionName',
    'source',
    'table',
  ])
  if (!collection) return null

  const panelType = panel.type.toLowerCase()
  const xAxis = stringOption(options, [
    'groupBy',
    'group_by',
    'group',
    'groupField',
    'xAxis',
    'x_axis',
    'category',
    'dateField',
    'date_field',
  ])
  const yAxis = stringOption(options, [
    'field',
    'valueField',
    'value_field',
    'measure',
    'yAxis',
    'y_axis',
  ])
  const configuredAggregateFunction = aggregateFunctionOption(options, [
    'function',
    'aggregate',
    'aggregation',
  ])
  const filter = recordOption(options, ['filter', 'filters'])
  const limit = numberOption(options, ['limit'])
  const showLegend = booleanOption(options, ['showLegend', 'show_legend'])
  const metricPanel =
    panelType.includes('metric') ||
    panelType.includes('stat') ||
    panelType.includes('count')
  const aggregateFunction =
    configuredAggregateFunction ??
    (panelType.includes('bar-chart') ? 'max' : 'count')

  const aggregateField =
    aggregateFunction === 'count' && !yAxis ? '*' : yAxis ?? '*'

  return {
    collection,
    aggregateFunction,
    aggregateField,
    groupBy: metricPanel ? undefined : xAxis ?? undefined,
    filter: filter ?? undefined,
    limit: limit ?? undefined,
    showLegend: showLegend ?? undefined,
  }
}

function buildMetricRender(
  panel: DashboardPanelRecord,
  query: PanelQueryConfig,
  rows: Record<string, unknown>[],
): PanelRenderModel {
  const value = aggregateValue(rows[0], query)

  return {
    kind: 'metric',
    label: panel.name || panel.note || query.collection,
    value: formatPanelValue(value),
    detail: `${query.aggregateFunction} ${query.aggregateField}`,
  }
}

function buildChartRender(
  panel: DashboardPanelRecord,
  query: PanelQueryConfig,
  rows: Record<string, unknown>[],
  options: Record<string, unknown> | null,
): PanelRenderModel {
  if (!query.groupBy) {
    return buildMetricRender(panel, query, rows)
  }

  const labels: string[] = []
  const values: number[] = []

  for (const row of rows) {
    labels.push(formatPanelValue(readNestedValue(row, query.groupBy)))
    values.push(Number(aggregateValue(row, query)) || 0)
  }

  const chartType = chartTypeForPanel(panel.type, options)
  const isCircular = ['pie', 'doughnut', 'polarArea'].includes(chartType)
  const primaryColor = panelColor(panel, options)
  const barColors = labels.map((label, index) =>
    conditionalFillColor(options, primaryColor, label, values[index]),
  )
  const lineFillColor = transparentColor(primaryColor)

  return {
    kind: 'chart',
    chartType,
    data: {
      labels,
      datasets: [
        {
          label: panel.name || query.collection,
          data: values,
          backgroundColor: isCircular
            ? labels.map((_, index) => CHART_COLORS[index % CHART_COLORS.length])
            : chartType === 'line'
              ? lineFillColor
              : barColors,
          borderColor: primaryColor,
          borderRadius: chartType === 'bar' ? 6 : undefined,
          fill: chartType === 'line',
          tension: chartType === 'line' ? 0.35 : undefined,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: query.showLegend ?? isCircular,
        },
      },
      scales: isCircular
        ? undefined
        : {
            y: {
              beginAtZero: true,
            },
          },
    },
  }
}

function aggregateValue(
  row: Record<string, unknown> | undefined,
  query: PanelQueryConfig,
): unknown {
  if (!row) return 0
  const aggregate = row[query.aggregateFunction]

  if (aggregate && typeof aggregate === 'object') {
    const aggregateRecord = aggregate as Record<string, unknown>
    return aggregateRecord[query.aggregateField] ?? aggregateRecord['*'] ?? 0
  }

  return aggregate ?? row.value ?? 0
}

function chartTypeForPanel(
  panelType: string,
  options: Record<string, unknown> | null,
): ChartType {
  const requestedType = stringOption(options, [
    'chartType',
    'chart_type',
    'display',
    'visualization',
  ])
  const source = `${panelType} ${requestedType ?? ''}`.toLowerCase()

  if (source.includes('doughnut') || source.includes('donut')) return 'doughnut'
  if (source.includes('polar')) return 'polarArea'
  if (source.includes('pie')) return 'pie'
  if (source.includes('line') || source.includes('time')) return 'line'

  return 'bar'
}

function isMetricPanel(type: string, query: PanelQueryConfig): boolean {
  return (
    type.includes('metric') ||
    type.includes('stat') ||
    type.includes('count') ||
    !query.groupBy
  )
}

function isNotePanel(type: string): boolean {
  return type.includes('label') || type.includes('note') || type.includes('text')
}

function dashboardId(dashboard: string | DashboardRecord): string {
  return typeof dashboard === 'string' ? dashboard : dashboard.id
}

function comparePanelPosition(
  first: DashboardPanelRecord,
  second: DashboardPanelRecord,
): number {
  const firstY = first.position_y ?? 0
  const secondY = second.position_y ?? 0
  if (firstY !== secondY) return firstY - secondY

  return (first.position_x ?? 0) - (second.position_x ?? 0)
}

function aggregateFunctionOption(
  options: Record<string, unknown> | null,
  keys: string[],
): AggregateFunction | null {
  const value = stringOption(options, keys)?.toLowerCase().replace(/[-_\s]/g, '')

  if (!value) return null
  if (value === 'count') return 'count'
  if (value === 'countdistinct') return 'countDistinct'
  if (value === 'sum') return 'sum'
  if (value === 'sumdistinct') return 'sumDistinct'
  if (value === 'average' || value === 'avg') return 'avg'
  if (value === 'averagedistinct' || value === 'avgdistinct') return 'avgDistinct'
  if (value === 'min' || value === 'minimum') return 'min'
  if (value === 'max' || value === 'maximum') return 'max'

  return null
}

function stringOption(
  options: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!options) return null

  for (const key of keys) {
    const value = readNestedValue(options, key)
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function numberOption(
  options: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!options) return null

  for (const key of keys) {
    const value = readNestedValue(options, key)
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value)
      if (!Number.isNaN(numeric)) return numeric
    }
  }

  return null
}

function booleanOption(
  options: Record<string, unknown> | null,
  keys: string[],
): boolean | null {
  if (!options) return null

  for (const key of keys) {
    const value = readNestedValue(options, key)
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true
      if (value.toLowerCase() === 'false') return false
    }
  }

  return null
}

function panelColor(
  panel: DashboardPanelRecord,
  options: Record<string, unknown> | null,
): string {
  return normalizeColor(
    stringOption(options, ['color']) || panel.color || '#6D5DF6',
  )
}

function conditionalFillColor(
  options: Record<string, unknown> | null,
  defaultColor: string,
  x: string,
  y: number,
): string {
  const conditionalFill = arrayOption(options, ['conditionalFill', 'conditional_fill'])

  for (const fill of conditionalFill) {
    if (!fill || typeof fill !== 'object') continue
    const rule = fill as Record<string, unknown>
    const ruleColor = typeof rule.color === 'string' ? rule.color.trim() : ''

    if (!ruleColor || !matchesConditionalFill(rule, x, y)) continue

    return normalizeColor(ruleColor)
  }

  return defaultColor
}

function matchesConditionalFill(
  rule: Record<string, unknown>,
  x: string,
  y: number,
): boolean {
  const axis = rule.axis === 'X' ? 'X' : 'Y'
  const operator = typeof rule.operator === 'string' ? rule.operator : '>='
  const value = axis === 'X' ? x : y
  const compareValue = rule.value

  if (axis === 'Y') {
    const numericCompare = Number(compareValue ?? 0)
    if (Number.isNaN(numericCompare)) return false

    return compareNumericCondition(Number(value), numericCompare, operator)
  }

  return compareStringCondition(String(value), String(compareValue ?? ''), operator)
}

function compareNumericCondition(
  value: number,
  compareValue: number,
  operator: string,
): boolean {
  if (Number.isNaN(value)) return false

  switch (operator) {
    case '=':
      return value === compareValue
    case '!=':
      return value !== compareValue
    case '>':
      return value > compareValue
    case '>=':
      return value >= compareValue
    case '<':
      return value < compareValue
    case '<=':
      return value <= compareValue
    default:
      return false
  }
}

function compareStringCondition(
  value: string,
  compareValue: string,
  operator: string,
): boolean {
  switch (operator) {
    case '=':
      return value === compareValue
    case '!=':
      return value !== compareValue
    case 'contains':
      return compareValue.includes(value)
    case 'ncontains':
      return !compareValue.includes(value)
    case 'starts_with':
      return compareValue.startsWith(value)
    case 'nstarts_with':
      return !compareValue.startsWith(value)
    case 'istarts_with':
      return compareValue.toLowerCase().startsWith(value.toLowerCase())
    case 'nistarts_with':
      return !compareValue.toLowerCase().startsWith(value.toLowerCase())
    case 'ends_with':
      return compareValue.endsWith(value)
    case 'nends_with':
      return !compareValue.endsWith(value)
    case 'iends_with':
      return compareValue.toLowerCase().endsWith(value.toLowerCase())
    case 'niends_with':
      return !compareValue.toLowerCase().endsWith(value.toLowerCase())
    case '>':
      return Number(value) > Number(compareValue)
    case '>=':
      return Number(value) >= Number(compareValue)
    case '<':
      return Number(value) < Number(compareValue)
    case '<=':
      return Number(value) <= Number(compareValue)
    default:
      return false
  }
}

function arrayOption(
  options: Record<string, unknown> | null,
  keys: string[],
): unknown[] {
  if (!options) return []

  for (const key of keys) {
    const value = readNestedValue(options, key)
    if (Array.isArray(value)) return value
  }

  return []
}

function transparentColor(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}26`
  }

  return 'rgba(109, 93, 246, 0.16)'
}

function normalizeColor(color: string): string {
  if (color === 'var(--theme--primary)') return '#6D5DF6'

  return color
}

function recordOption(
  options: Record<string, unknown> | null,
  keys: string[],
): Record<string, unknown> | null {
  if (!options) return null

  for (const key of keys) {
    const value = readNestedValue(options, key)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }

  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  return value as Record<string, unknown>
}

function readNestedValue(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') {
      return (value as Record<string, unknown>)[key]
    }
    return undefined
  }, record)
}

function formatPanelValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return new Intl.NumberFormat().format(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  return JSON.stringify(value)
}
