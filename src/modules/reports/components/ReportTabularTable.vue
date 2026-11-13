<script lang="ts">
export default {
  name: 'ReportTabularTable',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import {
  listReportFields,
  tabularAsPivotSettings,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportPivotSettings,
} from '../services/reportSettings'
import {
  buildTabularDisplayColumns,
  buildTabularDisplayRows,
} from '../services/reportTabularRuntime'
import CrmVTablePivot from '@/core/ui-kit/CrmVTablePivot.vue'

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

const { t } = useTranslation()
const fieldOptions = ref<ReportFieldOption[]>([])

watch(
  () => props.report.collection,
  (collection) => {
    void loadFieldLabels(collection)
  },
  { immediate: true },
)

async function loadFieldLabels(collection: string): Promise<void> {
  if (!collection) {
    fieldOptions.value = []
    return
  }
  try {
    fieldOptions.value = await listReportFields(collection)
  } catch {
    fieldOptions.value = []
  }
}

const fieldLabels = computed(() => {
  const labels: Record<string, string> = {}
  for (const field of fieldOptions.value) {
    labels[field.field] = field.label
  }
  return labels
})

const matrixPivot = computed<ReportPivotSettings | null>(() =>
  tabularAsPivotSettings(props.report.tabular),
)

const displayColumns = computed(() =>
  buildTabularDisplayColumns(props.report, fieldLabels.value),
)

const displayRows = computed(() =>
  buildTabularDisplayRows(props.report, props.rows, fieldLabels.value),
)

function rowClass(data: { kind?: string }): string | undefined {
  if (data.kind === 'group') return 'font-semibold bg-surface-50'
  if (data.kind === 'subtotal') return 'font-medium bg-surface-50'
  if (data.kind === 'grandtotal') return 'font-semibold bg-surface-100'
  return undefined
}
</script>

<template>
  <div class="min-w-0 grid gap-3">
    <CrmVTablePivot
      v-if="matrixPivot"
      :rows="rows"
      :pivot="matrixPivot"
      :collection="report.collection"
      :empty-message="emptyMessage"
    />

    <DataTable
      v-else-if="displayColumns.length > 0"
      :value="displayRows"
      size="small"
      striped-rows
      scrollable
      scroll-height="flex"
      :paginator="displayRows.length > 50"
      :rows="50"
      :row-class="rowClass"
      :empty-message="emptyMessage"
    >
      <Column
        v-for="column in displayColumns"
        :key="column.field"
        :field="column.field"
        :header="column.header"
        :align="column.hasSummary ? 'right' : undefined"
      >
        <template #body="{ data }">
          <span
            :class="column.hasSummary ? 'tabular-nums' : undefined"
            :style="
              column.isGroup && data.level
                ? { paddingLeft: `${data.level * 0.85}rem` }
                : undefined
            "
          >
            {{ data.cells[column.field] }}
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
