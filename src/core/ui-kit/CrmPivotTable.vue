<script lang="ts">
export default {
  name: 'CrmPivotTable',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  ReportPivotDimension,
  ReportPivotDrillDown,
  ReportPivotSettings,
  ReportPivotValue,
  ReportSortDirection,
} from '@/modules/reports/services/reportSettings'
import {
  normalizePivotSort,
  normalizeSortRowsByTotal,
} from '@/modules/reports/services/reportSettings'
import { buildDrillDownFromPaths } from '@/modules/reports/services/reportDrillDown'
import {
  formatReportAggregateValue,
  resolveReportValueDisplayOptions,
} from '@/modules/reports/services/reportCellDisplay'
import { dimensionDisplayValue } from '@/modules/reports/services/reportVTableAdapter'
import type { NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import { getPathValue } from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'

interface PivotColumn {
  key: string
  label: string
  values: string[]
}

interface PivotRow {
  key: string
  labels: string[]
  pathValues: string[]
  cells: Record<string, string>
  cellRecordIds: Record<string, Array<string | number>>
  total: string
  totalValue: number
}

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
const valueDisplayByField = ref<Record<string, NumberDisplayOptions>>({})
const rowDimensions = computed(() => props.pivot.rows ?? [])
const columnDimensions = computed(() => props.pivot.columns ?? [])
const rowSort = computed<ReportSortDirection>(() =>
  normalizePivotSort(props.pivot.rows?.[0]?.sort),
)
const columnSort = computed<ReportSortDirection>(() =>
  normalizePivotSort(props.pivot.columns?.[0]?.sort),
)
const sortRowsByTotal = computed(() =>
  normalizeSortRowsByTotal(props.pivot.sortRowsByTotal),
)
const value = computed<ReportPivotValue>(() =>
  props.pivot.values?.[0] ?? { field: 'id', aggregate: 'count' },
)
const totalLabel = computed(() => t('reports.total', 'Total'))
const emptyLabel = computed(() => t('reports.emptyValue', '(empty)'))

watch(
  () => [props.collection, props.pivot.values] as const,
  async ([collection, values]) => {
    if (!collection) {
      valueDisplayByField.value = {}
      return
    }
    const fields = (values ?? [])
      .map((item) => item.field)
      .filter((field) => Boolean(field && field !== '*'))
    valueDisplayByField.value = await resolveReportValueDisplayOptions(collection, fields).catch(
      () => ({}),
    )
  },
  { immediate: true, deep: true },
)

const pivotColumns = computed<PivotColumn[]>(() => {
  if (columnDimensions.value.length === 0) {
    return [{ key: '__total__', label: totalLabel.value, values: [] }]
  }

  const columns = new Map<string, PivotColumn>()
  for (const row of props.rows) {
    const values = groupValues(row, columnDimensions.value)
    const key = values.join('::')
    columns.set(key, {
      key,
      label: values.join(' / '),
      values,
    })
  }

  return Array.from(columns.values()).sort((a, b) =>
    compareLabels(a.label, b.label, columnSort.value),
  )
})

const pivotRows = computed<PivotRow[]>(() => {
  const groups = new Map<string, Record<string, unknown>[]>()
  const dimensions = rowDimensions.value

  for (const row of props.rows) {
    const key = dimensions.length ? groupKey(row, dimensions) : '__all__'
    const rows = groups.get(key) ?? []
    rows.push(row)
    groups.set(key, rows)
  }

  return Array.from(groups.entries())
    .map(([key, groupRows]) => {
      const first = groupRows[0] ?? {}
      const pathValues = dimensions.length
        ? groupValues(first, dimensions)
        : [t('reports.allRecords', 'All records')]
      const cells: Record<string, string> = {}
      const cellRecordIds: Record<string, Array<string | number>> = {}
      for (const column of pivotColumns.value) {
        const cellRows = column.key === '__total__'
          ? groupRows
          : groupRows.filter((row) => groupKey(row, columnDimensions.value) === column.key)
        cells[column.key] = formatAggregate(cellRows, value.value)
        cellRecordIds[column.key] = cellRows
          .map((row) => row.id)
          .filter((id): id is string | number => id !== null && id !== undefined && id !== '')
      }

      const totalValue = computeAggregate(groupRows, value.value)
      return {
        key,
        labels: pathValues,
        pathValues,
        cells,
        cellRecordIds,
        total: formatAggregate(groupRows, value.value),
        totalValue,
      }
    })
    .sort((a, b) => {
      const totalSort = sortRowsByTotal.value
      if (totalSort) {
        return compareNumbers(a.totalValue, b.totalValue, totalSort)
      }
      return compareLabels(a.labels.join(' / '), b.labels.join(' / '), rowSort.value)
    })
})

const grandTotal = computed(() => formatAggregate(props.rows, value.value))

function compareLabels(a: string, b: string, sort: ReportSortDirection): number {
  const result = a.localeCompare(b)
  return sort === 'desc' ? -result : result
}

function compareNumbers(a: number, b: number, sort: ReportSortDirection): number {
  const result = a - b
  return sort === 'desc' ? -result : result
}

function groupKey(row: Record<string, unknown>, dimensions: ReportPivotDimension[]): string {
  return groupValues(row, dimensions).join('::')
}

function groupValues(
  row: Record<string, unknown>,
  dimensions: ReportPivotDimension[],
): string[] {
  return dimensions.map((dimension) =>
    dimensionDisplayValue(
      getPathValue(row, dimension.field),
      emptyLabel.value,
      dimension.dateGrain,
    ),
  )
}

function formatAggregate(rows: Record<string, unknown>[], pivotValue: ReportPivotValue): string {
  const aggregateValue = computeAggregate(rows, pivotValue)
  if (pivotValue.aggregate !== 'count' && rows.length === 0) return ''
  if (
    pivotValue.aggregate !== 'count' &&
    rows
      .map((row) => numericValue(getPathValue(row, pivotValue.field)))
      .every((item) => item === null)
  ) {
    return ''
  }
  return formatReportAggregateValue(
    aggregateValue,
    pivotValue.aggregate,
    valueDisplayByField.value[pivotValue.field],
  )
}

function computeAggregate(
  rows: Record<string, unknown>[],
  pivotValue: ReportPivotValue,
): number {
  if (pivotValue.aggregate === 'count') return rows.length

  const values = rows
    .map((row) => numericValue(getPathValue(row, pivotValue.field)))
    .filter((item): item is number => item !== null)

  if (values.length === 0) return 0
  if (pivotValue.aggregate === 'sum') return values.reduce((sum, item) => sum + item, 0)
  if (pivotValue.aggregate === 'avg') {
    return values.reduce((sum, item) => sum + item, 0) / values.length
  }
  if (pivotValue.aggregate === 'min') return Math.min(...values)
  if (pivotValue.aggregate === 'max') return Math.max(...values)
  return 0
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function handleCellClick(row: PivotRow, column: PivotColumn): void {
  const payload = buildDrillDownFromPaths(
    props.pivot,
    rowDimensions.value.length ? row.pathValues : [],
    column.key === '__total__' ? [] : column.values,
    row.cellRecordIds[column.key] ?? [],
    totalLabel.value,
  )
  if (!payload) return
  emit('drillDown', payload)
}
</script>

<template>
  <div class="crm-pivot-table min-w-0">
    <p v-if="rows.length === 0" class="text-muted-color m-0">
      {{ emptyMessage || t('datatable.defaultEmpty', 'No records found.') }}
    </p>
    <div v-else class="crm-pivot-table__scroll border border-surface-200 rounded-lg overflow-auto">
      <table>
        <thead>
          <tr>
            <template v-if="rowFields.length">
              <th v-for="field in rowFields" :key="field">{{ field }}</th>
            </template>
            <th v-else>{{ t('reports.records', 'Records') }}</th>
            <th v-for="column in pivotColumns" :key="column.key">
              {{ column.label }}
            </th>
            <th v-if="pivotColumns.length > 1">{{ totalLabel }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pivotRows" :key="row.key">
            <template v-if="rowFields.length">
              <th>{{ row.labels[0] }}</th>
              <td
                v-for="(label, index) in row.labels.slice(1)"
                :key="`${row.key}_${index}`"
                class="crm-pivot-table__dimension"
              >
                {{ label }}
              </td>
            </template>
            <th v-else>{{ row.labels[0] }}</th>
            <td
              v-for="column in pivotColumns"
              :key="column.key"
              :class="{ 'crm-pivot-table__value': column.key !== '__total__' }"
              @click="handleCellClick(row, column)"
            >
              {{ row.cells[column.key] }}
            </td>
            <td v-if="pivotColumns.length > 1">{{ row.total }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th :colspan="Math.max(1, rowFields.length)">{{ totalLabel }}</th>
            <td
              v-for="column in pivotColumns"
              :key="column.key"
            >
              {{
                formatAggregate(
                  column.key === '__total__'
                    ? rows
                    : rows.filter((row) => groupKey(row, columnFields) === column.key),
                  value,
                )
              }}
            </td>
            <td v-if="pivotColumns.length > 1">{{ grandTotal }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.crm-pivot-table table {
  border-collapse: collapse;
  min-width: 100%;
}

.crm-pivot-table th,
.crm-pivot-table td {
  border-bottom: 1px solid #e2e8f0;
  border-right: 1px solid #e2e8f0;
  padding: 0.55rem 0.7rem;
  text-align: right;
  white-space: nowrap;
}

.crm-pivot-table th:first-child {
  background: #f8fafc;
  color: #334155;
  left: 0;
  position: sticky;
  text-align: left;
  z-index: 1;
}

.crm-pivot-table__dimension {
  background: #fff;
  color: #334155;
  text-align: left;
}

.crm-pivot-table__value {
  color: #1d4ed8;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.crm-pivot-table__value:hover {
  background: #f8fafc;
}

.crm-pivot-table thead th {
  background: #f1f5f9;
  color: #1e293b;
  font-weight: 700;
  position: sticky;
  top: 0;
  z-index: 2;
}

.crm-pivot-table tfoot th,
.crm-pivot-table tfoot td {
  background: #f8fafc;
  border-bottom: 0;
  font-weight: 700;
}
</style>
