<script lang="ts">
export default {
  name: 'CrmVTablePivot',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
  extractHeaderPathValues,
  extractRecordIdsFromCellRecords,
} from '@/modules/reports/services/reportVTableAdapter'
import type { NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  rows: Record<string, unknown>[]
  pivot: ReportPivotSettings
  collection?: string
  emptyMessage?: string
}>()

const emit = defineEmits<{
  drillDown: [payload: ReportPivotDrillDown]
}>()

const { t } = useTranslation()
const useFallback = ref(false)
const renderError = ref<string | null>(null)
const tableInstance = ref<PivotTableApi | null>(null)
const valueDisplayByField = ref<Record<string, NumberDisplayOptions>>({})
let clickListenerId: number | string | null = null

interface PivotTableApi {
  isHeader: (col: number, row: number) => boolean
  getCellHeaderPaths: (col: number, row: number) => {
    rowHeaderPaths?: Array<{ value?: unknown; indicatorKey?: unknown }>
    colHeaderPaths?: Array<{ value?: unknown; indicatorKey?: unknown }>
  }
  getCellRawRecord: (col: number, row: number) => unknown
  on: (type: string, listener: (event: { col?: number; row?: number }) => void) => number | string
  off: (id: number | string) => void
}

const totalLabel = computed(() => t('reports.total', 'Total'))

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
  ),
)

const pivotRenderKey = computed(() =>
  JSON.stringify({
    rows: props.pivot.rows,
    columns: props.pivot.columns,
    values: props.pivot.values,
    sortRowsByTotal: props.pivot.sortRowsByTotal ?? null,
    valueDisplayByField: valueDisplayByField.value,
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
    detachClickListener()
    tableInstance.value = null
  },
)

onBeforeUnmount(() => {
  detachClickListener()
})

function detachClickListener(): void {
  if (tableInstance.value && clickListenerId != null) {
    try {
      tableInstance.value.off(clickListenerId)
    } catch {
      // Table may already be released during remount.
    }
  }
  clickListenerId = null
}

function handleTableReady(instance: PivotTableApi): void {
  detachClickListener()
  tableInstance.value = instance
  clickListenerId = instance.on('click_cell', handleClickCell)
}

function handleVTableError(error: unknown): void {
  useFallback.value = true
  detachClickListener()
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
</script>

<template>
  <div class="bg-surface-0 rounded-lg h-[520px] min-h-0 min-w-0 overflow-auto">
    <p v-if="rows.length === 0" class="text-muted-color m-0">
      {{ emptyMessage || t('datatable.defaultEmpty', 'No records found.') }}
    </p>
    <template v-else-if="useFallback">
      <p v-if="renderError" class="text-amber-700 text-[0.85rem] m-0 mb-3">
        {{ t('reports.vtableFallback', 'VTable renderer failed. Showing fallback table.') }}
      </p>
      <CrmPivotTable
        :rows="rows"
        :pivot="pivot"
        :collection="collection"
        :empty-message="emptyMessage"
        @drill-down="emit('drillDown', $event)"
      />
    </template>
    <PivotTable
      v-else
      :key="pivotRenderKey"
      :options="vtableOptions"
      :height="520"
      width="100%"
      :on-ready="handleTableReady"
      :on-error="handleVTableError"
    />
  </div>
</template>
