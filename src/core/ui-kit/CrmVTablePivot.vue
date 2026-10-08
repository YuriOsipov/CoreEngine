<script lang="ts">
export default {
  name: 'CrmVTablePivot',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PivotTable } from '@visactor/vue-vtable'
import CrmPivotTable from './CrmPivotTable.vue'
import type { ReportPivotSettings } from '@/modules/reports/services/reportSettings'
import { buildReportVTableOptions } from '@/modules/reports/services/reportVTableAdapter'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  rows: Record<string, unknown>[]
  pivot: ReportPivotSettings
  emptyMessage?: string
}>()

const { t } = useTranslation()
const useFallback = ref(false)
const renderError = ref<string | null>(null)

const vtableOptions = computed(() =>
  buildReportVTableOptions(props.rows, props.pivot, {
    allRecords: t('reports.allRecords', 'All records'),
    average: t('reports.average', 'Average'),
    count: t('reports.count', 'Count'),
    emptyValue: t('reports.emptyValue', '(empty)'),
    max: t('reports.max', 'Max'),
    min: t('reports.min', 'Min'),
    records: t('reports.records', 'Records'),
    sum: t('reports.sum', 'Sum'),
    total: t('reports.total', 'Total'),
  }),
)

watch(
  () => [props.rows, props.pivot],
  () => {
    useFallback.value = false
    renderError.value = null
  },
)

function handleVTableError(error: unknown): void {
  useFallback.value = true
  renderError.value = error instanceof Error
    ? error.message
    : t('reports.vtableFallback', 'VTable renderer failed. Showing fallback table.')
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
        :empty-message="emptyMessage"
      />
    </template>
    <PivotTable
      v-else
      :key="JSON.stringify(pivot)"
      :options="vtableOptions"
      :height="520"
      width="100%"
      :on-error="handleVTableError"
    />
  </div>
</template>

