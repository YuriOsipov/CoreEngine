<script lang="ts">
export default {
  name: 'CrmVTablePivot',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PivotTable } from '@visactor/vue-vtable'
import CrmPivotTable from './CrmPivotTable.vue'
import type {
  ReportPivotDrillDown,
  ReportPivotSettings,
} from '@/modules/reports/services/reportSettings'
import { buildDrillDownFromPaths } from '@/modules/reports/services/reportDrillDown'
import { resolveReportValueDisplayOptions } from '@/modules/reports/services/reportCellDisplay'
import {
  buildReportVTableOptions,
  buildVTableWidthKeyMap,
  extractHeaderPathValues,
  extractRecordIdsFromCellRecords,
} from '@/modules/reports/services/reportVTableAdapter'
import type { NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    rows: Record<string, unknown>[]
    pivot: ReportPivotSettings
    collection?: string
    emptyMessage?: string
    columnWidths?: Record<string, number>
  }>(),
  {
    columnWidths: () => ({}),
  },
)

const emit = defineEmits<{
  drillDown: [payload: ReportPivotDrillDown]
  'update:columnWidths': [widths: Record<string, number>]
}>()

const { t } = useTranslation()
const useFallback = ref(false)
const renderError = ref<string | null>(null)
const tableInstance = ref<PivotTableApi | null>(null)
const hostRef = ref<HTMLElement | null>(null)
const hostHeight = ref(520)
const valueDisplayByField = ref<Record<string, NumberDisplayOptions>>({})
let clickListenerId: number | string | null = null
let resizeListenerId: number | string | null = null
let hostResizeObserver: ResizeObserver | null = null

interface PivotTableApi {
  isHeader: (col: number, row: number) => boolean
  getCellHeaderPaths: (col: number, row: number) => {
    rowHeaderPaths?: Array<{ value?: unknown; indicatorKey?: unknown; dimensionKey?: unknown }>
    colHeaderPaths?: Array<{ value?: unknown; indicatorKey?: unknown; dimensionKey?: unknown }>
  }
  getCellRawRecord: (col: number, row: number) => unknown
  getHeaderField?: (col: number, row: number) => unknown
  getColWidth?: (col: number) => number
  on: (
    type: string,
    listener: (event: {
      col?: number
      row?: number
      colWidth?: number
      colWidths?: number[]
    }) => void,
  ) => number | string
  off: (id: number | string) => void
}

const totalLabel = computed(() => t('reports.total', 'Total'))
const widthKeyByVTableField = computed(() => buildVTableWidthKeyMap(props.pivot))
/** Widths baked into VTable options — only refresh when the pivot structure changes. */
const widthsForOptions = ref<Record<string, number>>({ ...(props.columnWidths ?? {}) })

watch(
  () =>
    JSON.stringify({
      rows: props.pivot.rows,
      columns: props.pivot.columns,
      values: props.pivot.values,
      sortRowsByTotal: props.pivot.sortRowsByTotal ?? null,
    }),
  () => {
    widthsForOptions.value = { ...(props.columnWidths ?? {}) }
  },
)

const vtableOptions = computed(() =>
  buildReportVTableOptions(
    props.rows,
    props.pivot,
    {
      allRecords: t('reports.allRecords', 'All records'),
      average: t('reports.average', 'Average'),
      count: t('reports.count', 'Count'),
      emptyValue: t('reports.emptyValue', '(empty)'),
      max: t('reports.max', 'Max'),
      min: t('reports.min', 'Min'),
      records: t('reports.records', 'Records'),
      sum: t('reports.sum', 'Sum'),
      total: totalLabel.value,
    },
    valueDisplayByField.value,
    widthsForOptions.value,
  ),
)

const pivotRenderKey = computed(() =>
  JSON.stringify({
    rows: props.pivot.rows,
    columns: props.pivot.columns,
    values: props.pivot.values,
    sortRowsByTotal: props.pivot.sortRowsByTotal ?? null,
    valueDisplayByField: valueDisplayByField.value,
    // Intentionally omit columnWidths — resizing must not remount / reflow neighbors.
  }),
)

watch(
  () => [props.collection, props.pivot.values] as const,
  async ([collection, values]) => {
    if (!collection) {
      valueDisplayByField.value = {}
      return
    }
    const fields = (values ?? [])
      .map((value) => value.field)
      .filter((field) => Boolean(field && field !== '*'))
    valueDisplayByField.value = await resolveReportValueDisplayOptions(collection, fields).catch(
      () => ({}),
    )
  },
  { immediate: true, deep: true },
)

watch(
  () => [props.rows, props.pivot],
  () => {
    useFallback.value = false
    renderError.value = null
    detachListeners()
    tableInstance.value = null
  },
)

onMounted(() => {
  syncHostHeight()
  if (typeof ResizeObserver === 'undefined') return
  hostResizeObserver = new ResizeObserver(() => {
    syncHostHeight()
  })
  if (hostRef.value) hostResizeObserver.observe(hostRef.value)
})

onBeforeUnmount(() => {
  detachListeners()
  hostResizeObserver?.disconnect()
  hostResizeObserver = null
})

function syncHostHeight(): void {
  const el = hostRef.value
  if (!el) return
  const next = Math.max(240, Math.floor(el.clientHeight))
  if (next !== hostHeight.value) hostHeight.value = next
}

watch(
  () => [props.rows.length, useFallback.value] as const,
  async () => {
    await nextTick()
    syncHostHeight()
  },
)

function detachListeners(): void {
  if (!tableInstance.value) {
    clickListenerId = null
    resizeListenerId = null
    return
  }
  for (const id of [clickListenerId, resizeListenerId]) {
    if (id == null) continue
    try {
      tableInstance.value.off(id)
    } catch {
      // Table may already be released during remount.
    }
  }
  clickListenerId = null
  resizeListenerId = null
}

function handleTableReady(instance: PivotTableApi): void {
  detachListeners()
  tableInstance.value = instance
  clickListenerId = instance.on('click_cell', handleClickCell)
  resizeListenerId = instance.on('resize_column_end', handleResizeColumnEnd)
}

function handleVTableError(error: unknown): void {
  useFallback.value = true
  detachListeners()
  tableInstance.value = null
  renderError.value = error instanceof Error
    ? error.message
    : t('reports.vtableFallback', 'VTable renderer failed. Showing fallback table.')
}

function handleClickCell(event: { col?: number; row?: number }): void {
  const col = event.col
  const row = event.row
  if (typeof col !== 'number' || typeof row !== 'number') return

  const table = tableInstance.value
  if (!table) return
  if (table.isHeader(col, row)) return

  const paths = table.getCellHeaderPaths(col, row)
  const rowValues = extractHeaderPathValues(paths.rowHeaderPaths)
  const columnValues = extractHeaderPathValues(paths.colHeaderPaths)
  const recordIds = extractRecordIdsFromCellRecords(table.getCellRawRecord(col, row))
  const payload = buildDrillDownFromPaths(
    props.pivot,
    rowValues,
    columnValues,
    recordIds,
    totalLabel.value,
  )
  if (!payload) return
  emit('drillDown', payload)
}

function handleResizeColumnEnd(event: {
  col?: number
  colWidth?: number
  colWidths?: number[]
}): void {
  const table = tableInstance.value
  if (!table) return

  // Snapshot every column width so neighbors stay frozen after persist/re-render.
  const next: Record<string, number> = { ...(props.columnWidths ?? {}) }
  const allWidths = Array.isArray(event.colWidths) ? event.colWidths : null

  if (allWidths && allWidths.length > 0) {
    for (let col = 0; col < allWidths.length; col += 1) {
      const width = allWidths[col]
      if (typeof width !== 'number' || !Number.isFinite(width) || width < 40) continue
      const widthKey = resolveWidthKeyForCol(table, col)
      if (!widthKey) continue
      next[widthKey] = Math.round(width)
    }
  } else if (typeof event.col === 'number') {
    const width =
      typeof event.colWidth === 'number'
        ? event.colWidth
        : table.getColWidth?.(event.col)
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 40) return
    const widthKey = resolveWidthKeyForCol(table, event.col)
    if (!widthKey) return
    next[widthKey] = Math.round(width)
  } else {
    return
  }

  emit('update:columnWidths', next)
}

function resolveWidthKeyForCol(table: PivotTableApi, col: number): string | null {
  const headerField = table.getHeaderField?.(col, 0)
  const fromField = widthKeyFromHeaderToken(headerField)
  if (fromField) return fromField

  const paths = table.getCellHeaderPaths(col, 0)
  for (const path of [...(paths.colHeaderPaths ?? []), ...(paths.rowHeaderPaths ?? [])]) {
    const token = path.indicatorKey ?? path.dimensionKey
    const mapped = widthKeyFromHeaderToken(token)
    if (mapped) return mapped
  }
  return null
}

function widthKeyFromHeaderToken(token: unknown): string | null {
  if (token == null) return null
  const key = String(token)
  return widthKeyByVTableField.value.get(key) ?? null
}
</script>

<template>
  <div
    ref="hostRef"
    class="bg-surface-0 rounded-lg h-full min-h-0 min-w-0 flex-1 overflow-hidden"
  >
    <p v-if="rows.length === 0" class="text-muted-color m-0">
      {{ emptyMessage || t('datatable.defaultEmpty', 'No records found.') }}
    </p>
    <template v-else-if="useFallback">
      <p v-if="renderError" class="text-amber-700 text-[0.85rem] m-0 mb-3">
        {{ t('reports.vtableFallback', 'VTable renderer failed. Showing fallback table.') }}
      </p>
      <div class="h-full min-h-0 overflow-auto">
        <CrmPivotTable
          :rows="rows"
          :pivot="pivot"
          :collection="collection"
          :empty-message="emptyMessage"
          @drill-down="emit('drillDown', $event)"
        />
      </div>
    </template>
    <PivotTable
      v-else
      :key="pivotRenderKey"
      :options="vtableOptions"
      :height="hostHeight"
      width="100%"
      :on-ready="handleTableReady"
      :on-error="handleVTableError"
    />
  </div>
</template>
