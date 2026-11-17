<script lang="ts">
export default {
  name: 'ReportTabularTable',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { useTranslation } from '@/core/translation'
import { recordDetailRoute } from '@/core/compactRecordRoutes'
import type { FieldDefinition } from '@/interfaces'
import type { NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import {
  listReportFields,
  reportColumnWidthKey,
  reportFieldDisplayLabel,
  tabularAsPivotSettings,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportPivotDrillDown,
  type ReportPivotSettings,
} from '../services/reportSettings'
import {
  resolveReportFieldDefinitions,
  resolveReportValueDisplayOptions,
} from '../services/reportCellDisplay'
import {
  buildTabularDisplayColumns,
  buildTabularDisplayRows,
  type TabularCellLink,
  type TabularDisplayRow,
} from '../services/reportTabularRuntime'
import CrmVTablePivot from '@/core/ui-kit/CrmVTablePivot.vue'
import {
  REPORT_DEFAULT_COL_WIDTH,
  REPORT_MIN_COL_WIDTH,
} from '../services/reportVTableAdapter'

const props = withDefaults(
  defineProps<{
    report: ReportDefinition
    rows: Record<string, unknown>[]
    emptyMessage?: string
  }>(),
  {
    emptyMessage: 'Run the report to show data.',
  },
)

const emit = defineEmits<{
  'update:columnWidths': [widths: Record<string, number>]
  drillDown: [payload: ReportPivotDrillDown]
}>()

const { t } = useTranslation()
const fieldOptions = ref<ReportFieldOption[]>([])
const fieldDefinitions = ref<Map<string, FieldDefinition>>(new Map())
const numberDisplayByField = ref<Record<string, NumberDisplayOptions>>({})

watch(
  () => [props.report.collection, props.report.tabular.columns] as const,
  ([collection, columns]) => {
    void loadFieldMeta(collection, columns.map((column) => column.field))
  },
  { immediate: true, deep: true },
)

async function loadFieldMeta(
  collection: string,
  columnFields: string[],
): Promise<void> {
  if (!collection) {
    fieldOptions.value = []
    fieldDefinitions.value = new Map()
    numberDisplayByField.value = {}
    return
  }
  try {
    const [options, definitions, numberDisplay] = await Promise.all([
      listReportFields(collection),
      resolveReportFieldDefinitions(collection, columnFields),
      resolveReportValueDisplayOptions(collection, columnFields),
    ])
    fieldOptions.value = options
    fieldDefinitions.value = definitions
    numberDisplayByField.value = numberDisplay
  } catch {
    fieldOptions.value = []
    fieldDefinitions.value = new Map()
    numberDisplayByField.value = {}
  }
}

const fieldLabels = computed(() => {
  const labels: Record<string, string> = {}
  for (const field of fieldOptions.value) {
    // Prefer leaf name in the rendered table (full path stays in the field picker).
    labels[field.field] = reportFieldDisplayLabel(field.field)
  }
  for (const column of props.report.tabular.columns) {
    if (!labels[column.field]) labels[column.field] = reportFieldDisplayLabel(column.field)
  }
  for (const group of props.report.tabular.groupRows) {
    if (!labels[group.field]) labels[group.field] = reportFieldDisplayLabel(group.field)
  }
  return labels
})

const columnWidths = computed(() => props.report.columnWidths ?? {})

function onColumnWidths(widths: Record<string, number>): void {
  emit('update:columnWidths', widths)
}

function resolvedColumnWidthPx(field: string): number {
  const key = reportColumnWidthKey('field', field)
  const width = columnWidths.value[key]
  if (typeof width === 'number' && Number.isFinite(width) && width >= REPORT_MIN_COL_WIDTH) {
    return Math.round(width)
  }
  return REPORT_DEFAULT_COL_WIDTH
}

function dataTableColumnStyle(field: string): Record<string, string> {
  const px = resolvedColumnWidthPx(field)
  return {
    width: `${px}px`,
    minWidth: `${REPORT_MIN_COL_WIDTH}px`,
  }
}

/** Table is only as wide as its columns — never stretched to the page. */
const tableWidthPx = computed(() =>
  displayColumns.value.reduce((sum, column) => sum + resolvedColumnWidthPx(column.field), 0),
)

const tableStyle = computed(() => ({
  tableLayout: 'fixed',
  width: `${tableWidthPx.value}px`,
  minWidth: `${tableWidthPx.value}px`,
  maxWidth: `${tableWidthPx.value}px`,
}))

function onDataTableColumnResize(event: {
  element?: HTMLElement
  delta?: number
}): void {
  const th = event.element
  if (!th) return

  // Identify the resized column only — do not rewrite siblings (full-page stretch
  // otherwise pollutes the first column's measured width).
  const headerRow = th.closest('tr')
  const headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th')) : []
  const colIndex = headerCells.indexOf(th as HTMLTableCellElement)
  let columnField = ''
  if (colIndex >= 0 && colIndex < displayColumns.value.length) {
    columnField = displayColumns.value[colIndex]!.field
  } else {
    const headerText = th.textContent?.trim() || ''
    columnField =
      displayColumns.value.find((column) => column.header === headerText)?.field || ''
  }
  if (!columnField) return

  const delta = typeof event.delta === 'number' ? event.delta : 0
  const previous = resolvedColumnWidthPx(columnField)
  const nextWidth = Math.max(REPORT_MIN_COL_WIDTH, Math.round(previous + delta))

  onColumnWidths({
    ...columnWidths.value,
    [reportColumnWidthKey('field', columnField)]: nextWidth,
  })
}

const matrixPivot = computed<ReportPivotSettings | null>(() =>
  tabularAsPivotSettings(props.report.tabular),
)

const displayColumns = computed(() =>
  buildTabularDisplayColumns(
    props.report,
    fieldLabels.value,
    fieldDefinitions.value,
  ),
)

const displayRows = computed(() =>
  buildTabularDisplayRows(
    props.report,
    props.rows,
    fieldLabels.value,
    fieldDefinitions.value,
    numberDisplayByField.value,
  ),
)

function rowClass(data: { kind?: string }): string | undefined {
  if (data.kind === 'group') return 'font-semibold bg-surface-50'
  if (data.kind === 'subtotal') return 'font-medium bg-surface-50'
  if (data.kind === 'grandtotal') return 'font-semibold bg-surface-100'
  return undefined
}

function isNumericColumn(column: { numeric?: boolean; hasSummary?: boolean }): boolean {
  return Boolean(column.numeric || column.hasSummary)
}

function cellLink(
  data: TabularDisplayRow,
  field: string,
): TabularCellLink | null {
  const link = data.cellLinks?.[field]
  if (!link) return null
  const text = data.cells[field]
  if (!text) return null
  return link
}

function cellRoute(link: TabularCellLink): RouteLocationRaw {
  return recordDetailRoute(link.collection, link.id)
}
</script>

<template>
  <div class="report-tabular-root min-h-0 min-w-0 flex flex-1 flex-col">
    <CrmVTablePivot
      v-if="matrixPivot"
      class="report-tabular-root__pivot min-h-0 flex-1"
      :rows="rows"
      :pivot="matrixPivot"
      :collection="report.collection"
      :empty-message="emptyMessage"
      :column-widths="columnWidths"
      @update:column-widths="onColumnWidths"
      @drill-down="emit('drillDown', $event)"
    />

    <DataTable
      v-else-if="displayColumns.length > 0"
      :value="displayRows"
      size="small"
      striped-rows
      scrollable
      scroll-height="flex"
      resizable-columns
      column-resize-mode="expand"
      :table-style="tableStyle"
      :paginator="false"
      :row-class="rowClass"
      :empty-message="emptyMessage"
      class="report-tabular-table min-h-0 flex-1"
      @column-resize-end="onDataTableColumnResize"
    >
      <Column
        v-for="column in displayColumns"
        :key="column.field"
        :field="column.field"
        :header="column.header"
        :style="dataTableColumnStyle(column.field)"
        :pt="{
          headerCell: { style: dataTableColumnStyle(column.field) },
          bodyCell: { style: dataTableColumnStyle(column.field) },
        }"
        :align="isNumericColumn(column) ? 'right' : undefined"
        :header-class="isNumericColumn(column) ? 'text-right!' : undefined"
        :body-class="isNumericColumn(column) ? 'text-right! tabular-nums' : undefined"
      >
        <template #body="{ data }">
          <span
            :class="isNumericColumn(column) ? 'block w-full text-right tabular-nums' : undefined"
            :style="
              column.isGroup && data.level
                ? { paddingLeft: `${data.level * 0.85}rem` }
                : undefined
            "
          >
            <RouterLink
              v-if="cellLink(data, column.field)"
              :to="cellRoute(cellLink(data, column.field)!)"
              class="report-tabular-table__m2o"
              @click.stop
            >
              {{ data.cells[column.field] }}
            </RouterLink>
            <template v-else>
              {{ data.cells[column.field] }}
            </template>
          </span>
        </template>
      </Column>
      <template #empty>
        <p class="text-muted-color m-0 py-4 text-center">
          {{ emptyMessage }}
        </p>
      </template>
    </DataTable>

    <p v-else class="text-muted-color m-0 py-4 text-center">
      {{ t('reports.noColumnsSelected', 'No columns selected. Add fields from the list above.') }}
    </p>
  </div>
</template>

<style scoped>
.report-tabular-root {
  width: 100%;
}

.report-tabular-table {
  width: fit-content;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.report-tabular-table :deep(.p-datatable-table-container),
.report-tabular-table :deep(.p-datatable-wrapper) {
  width: fit-content !important;
  max-width: 100%;
  flex: 1 1 auto;
  min-height: 0;
}

.report-tabular-table :deep(table) {
  table-layout: fixed !important;
  width: v-bind('`${tableWidthPx}px`') !important;
  min-width: v-bind('`${tableWidthPx}px`') !important;
  max-width: v-bind('`${tableWidthPx}px`') !important;
}

.report-tabular-table :deep(th),
.report-tabular-table :deep(td) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box;
}

.report-tabular-table__m2o {
  color: #2563eb;
  font-weight: 600;
  text-decoration: none;
}

.report-tabular-table__m2o:hover {
  text-decoration: underline;
}
</style>
