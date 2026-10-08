<script lang="ts">
export default {
  name: 'CrmPivotTable',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { ReportPivotSettings, ReportPivotValue } from '@/modules/reports/services/reportSettings'
import { getPathValue } from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'

interface PivotColumn {
  key: string
  label: string
}

interface PivotRow {
  key: string
  labels: string[]
  cells: Record<string, string>
  total: string
}

const props = defineProps<{
  rows: Record<string, unknown>[]
  pivot: ReportPivotSettings
  emptyMessage?: string
}>()

const { t } = useTranslation()
const rowFields = computed(() => props.pivot.rows ?? [])
const columnFields = computed(() => props.pivot.columns ?? [])
const value = computed<ReportPivotValue>(() =>
  props.pivot.values?.[0] ?? { field: 'id', aggregate: 'count' },
)
const pivotColumns = computed<PivotColumn[]>(() => {
  if (columnFields.value.length === 0) {
    return [{ key: '__total__', label: t('reports.total', 'Total') }]
  }

  const columns = new Map<string, string>()
  for (const row of props.rows) {
    const key = groupKey(row, columnFields.value)
    columns.set(key, groupLabel(row, columnFields.value))
  }

  return Array.from(columns.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
const pivotRows = computed<PivotRow[]>(() => {
  const groups = new Map<string, Record<string, unknown>[]>()
  const fields = rowFields.value

  for (const row of props.rows) {
    const key = fields.length ? groupKey(row, fields) : '__all__'
    const rows = groups.get(key) ?? []
    rows.push(row)
    groups.set(key, rows)
  }

  return Array.from(groups.entries())
    .map(([key, groupRows]) => {
      const first = groupRows[0] ?? {}
      const cells: Record<string, string> = {}
      for (const column of pivotColumns.value) {
        const cellRows = column.key === '__total__'
          ? groupRows
          : groupRows.filter((row) => groupKey(row, columnFields.value) === column.key)
        cells[column.key] = formatAggregate(cellRows, value.value)
      }

      return {
        key,
        labels: fields.length ? groupLabels(first, fields) : [t('reports.allRecords', 'All records')],
        cells,
        total: formatAggregate(groupRows, value.value),
      }
    })
    .sort((a, b) => a.labels.join(' / ').localeCompare(b.labels.join(' / ')))
})
const grandTotal = computed(() => formatAggregate(props.rows, value.value))

function groupKey(row: Record<string, unknown>, fields: string[]): string {
  return fields.map((field) => valueKey(getPathValue(row, field))).join('::')
}

function groupLabel(row: Record<string, unknown>, fields: string[]): string {
  return fields.map((field) => valueLabel(getPathValue(row, field))).join(' / ')
}

function groupLabels(row: Record<string, unknown>, fields: string[]): string[] {
  return fields.map((field) => valueLabel(getPathValue(row, field)))
}

function formatAggregate(rows: Record<string, unknown>[], pivotValue: ReportPivotValue): string {
  const values = rows
    .map((row) => numericValue(getPathValue(row, pivotValue.field)))
    .filter((item): item is number => item !== null)

  if (pivotValue.aggregate === 'count') return String(rows.length)
  if (values.length === 0) return ''

  if (pivotValue.aggregate === 'sum') return formatNumber(values.reduce((sum, item) => sum + item, 0))
  if (pivotValue.aggregate === 'avg') {
    return formatNumber(values.reduce((sum, item) => sum + item, 0) / values.length)
  }
  if (pivotValue.aggregate === 'min') return formatNumber(Math.min(...values))
  if (pivotValue.aggregate === 'max') return formatNumber(Math.max(...values))
  return ''
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function valueKey(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('reports.emptyValue', '(empty)')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.id ?? record.name ?? record.title ?? JSON.stringify(record))
  }
  return String(value)
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('reports.emptyValue', '(empty)')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.__crmValueType === 'm2o' && record.label !== undefined && record.label !== null) {
      return String(record.label)
    }
    return String(record.name ?? record.title ?? record.label ?? record.id ?? JSON.stringify(record))
  }
  return String(value)
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
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
            <th v-if="pivotColumns.length > 1">{{ t('reports.total', 'Total') }}</th>
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
            <td v-for="column in pivotColumns" :key="column.key">
              {{ row.cells[column.key] }}
            </td>
            <td v-if="pivotColumns.length > 1">{{ row.total }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th :colspan="Math.max(1, rowFields.length)">{{ t('reports.total', 'Total') }}</th>
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
