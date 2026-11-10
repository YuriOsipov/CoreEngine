<script lang="ts">
export default {
  name: 'PanelOptionsForm',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import { fetchRegistrySnapshotFromGraphQL } from '@/core/graphql/registryApi'
import type { DashboardPanelSourceType, DashboardPanelType } from '@/interfaces'
import { listReports } from '@/modules/reports/services/reportSettings'
import type { DesignerPanelDraft } from '../services/dashboardDesigner'
import { isDesignerPanelType } from '../services/dashboardDesigner'
import PanelFilterEditor from './PanelFilterEditor.vue'

const props = defineProps<{
  panel: DesignerPanelDraft | null
}>()

const emit = defineEmits<{
  update: [panel: DesignerPanelDraft]
}>()

const { t } = useTranslation()

const collectionOptions = ref<{ label: string; value: string }[]>([])
const reportOptions = ref<{ label: string; value: string }[]>([])
const fieldOptions = ref<{ label: string; value: string }[]>([])
const loadingReports = ref(false)

const aggregateOptions = [
  { label: 'count', value: 'count' },
  { label: 'countDistinct', value: 'countDistinct' },
  { label: 'sum', value: 'sum' },
  { label: 'sumDistinct', value: 'sumDistinct' },
  { label: 'avg', value: 'avg' },
  { label: 'avgDistinct', value: 'avgDistinct' },
  { label: 'min', value: 'min' },
  { label: 'max', value: 'max' },
]

const sourceTypeOptions = computed(() => [
  { label: t('dashboard.sourceCollection', 'Collection'), value: 'collection' },
  { label: t('dashboard.sourceReport', 'Report'), value: 'report' },
])

const fieldsByCollection = ref<Map<string, { label: string; value: string }[]>>(
  new Map(),
)

const panelType = computed(() =>
  props.panel && isDesignerPanelType(props.panel.type)
    ? (props.panel.type as DashboardPanelType)
    : null,
)

const isChart = computed(() =>
  panelType.value === 'bar-chart' ||
  panelType.value === 'line-chart' ||
  panelType.value === 'pie-chart',
)

const isMetric = computed(() => panelType.value === 'metric')
const isLabel = computed(() => panelType.value === 'label')

const sourceType = computed<DashboardPanelSourceType>(() => {
  const explicit = stringOpt('sourceType')
  if (explicit === 'report' || explicit === 'collection') return explicit
  return stringOpt('reportId') ? 'report' : 'collection'
})

const isReportSource = computed(() => sourceType.value === 'report')

const currentFilter = computed((): Record<string, unknown> => {
  const filter = props.panel?.options?.filter
  if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
    return filter as Record<string, unknown>
  }
  return {}
})

onMounted(() => {
  void loadCollections()
  void loadReports()
})

watch(
  () => props.panel?.id,
  () => {
    refreshFieldOptions()
  },
)

watch(
  () => props.panel?.options,
  () => {
    refreshFieldOptions()
  },
  { deep: true },
)

async function loadCollections(): Promise<void> {
  const snapshot = await fetchRegistrySnapshotFromGraphQL(false)
  const map = new Map<string, { label: string; value: string }[]>()
  for (const collection of snapshot.collections) {
    if (collection.meta?.hidden || collection.meta?.singleton || collection.meta?.internal) {
      continue
    }
    const fields = snapshot.fields
      .filter((f) => f.collection === collection.collection && !f.meta?.hidden)
      .map((f) => ({
        label: f.meta?.translations?.[0]?.translation || f.field,
        value: f.field,
      }))
    map.set(collection.collection, [
      { label: '*', value: '*' },
      ...fields,
    ])
  }
  fieldsByCollection.value = map
  collectionOptions.value = [...map.keys()]
    .sort()
    .map((value) => ({ label: value, value }))
  refreshFieldOptions()
}

async function loadReports(): Promise<void> {
  loadingReports.value = true
  try {
    const reports = await listReports()
    reportOptions.value = reports.map((report) => ({
      label: report.title || report.name,
      value: String(report.settingId),
    }))
  } catch {
    reportOptions.value = []
  } finally {
    loadingReports.value = false
  }
}

function refreshFieldOptions(): void {
  const collection = stringOpt('collection')
  fieldOptions.value = collection
    ? (fieldsByCollection.value.get(collection) ?? [{ label: '*', value: '*' }])
    : [{ label: '*', value: '*' }]
}

function stringOpt(key: string): string {
  const value = props.panel?.options?.[key]
  return typeof value === 'string' ? value : ''
}

function boolOpt(key: string): boolean {
  return Boolean(props.panel?.options?.[key])
}

function patchPanel(partial: Partial<DesignerPanelDraft>): void {
  if (!props.panel) return
  emit('update', { ...props.panel, ...partial })
}

function patchOptions(partial: Record<string, unknown>): void {
  if (!props.panel) return
  const options = { ...(props.panel.options ?? {}), ...partial }
  emit('update', { ...props.panel, options })
  if ('collection' in partial) {
    refreshFieldOptions()
  }
}

function onSourceTypeChange(value: unknown): void {
  const next = value === 'report' ? 'report' : 'collection'
  patchOptions({ sourceType: next })
}

function onFilterUpdate(filter: Record<string, unknown>): void {
  patchOptions({ filter })
}
</script>

<template>
  <aside v-if="panel" class="flex flex-col gap-3">
    <h3 class="m-0 text-sm font-semibold text-gray-700">
      {{ t('dashboard.optionsTitle', 'Panel options') }}
    </h3>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-gray-500">{{ t('dashboard.panelName', 'Name') }}</label>
      <InputText
        :model-value="panel.name ?? ''"
        class="w-full"
        @update:model-value="patchPanel({ name: String($event || '') })"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-gray-500">{{ t('dashboard.panelNote', 'Note') }}</label>
      <InputText
        :model-value="panel.note ?? ''"
        class="w-full"
        @update:model-value="patchPanel({ note: String($event || '') || null })"
      />
    </div>

    <div class="flex items-center justify-between gap-2">
      <label class="text-xs text-gray-500">{{ t('dashboard.showHeader', 'Show header') }}</label>
      <ToggleSwitch
        :model-value="panel.show_header !== false"
        @update:model-value="patchPanel({ show_header: Boolean($event) })"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-gray-500">{{ t('dashboard.panelColor', 'Color') }}</label>
      <InputText
        :model-value="panel.color ?? ''"
        class="w-full"
        placeholder="#6D5DF6"
        @update:model-value="patchPanel({ color: String($event || '') || null })"
      />
    </div>

    <template v-if="isLabel">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-gray-500">{{ t('dashboard.labelText', 'Text') }}</label>
        <Textarea
          :model-value="stringOpt('text')"
          rows="4"
          class="w-full"
          @update:model-value="patchOptions({ text: String($event || '') })"
        />
      </div>
    </template>

    <template v-else-if="isMetric || isChart">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-gray-500">{{ t('dashboard.dataSource', 'Data source') }}</label>
        <Select
          :model-value="sourceType"
          :options="sourceTypeOptions"
          option-label="label"
          option-value="value"
          class="w-full"
          @update:model-value="onSourceTypeChange"
        />
      </div>

      <template v-if="isReportSource">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">{{ t('dashboard.report', 'Report') }}</label>
          <Select
            :model-value="stringOpt('reportId') || null"
            :options="reportOptions"
            option-label="label"
            option-value="value"
            filter
            show-clear
            class="w-full"
            :loading="loadingReports"
            :placeholder="t('dashboard.selectReport', 'Select report')"
            @update:model-value="patchOptions({ reportId: String($event || '') })"
          />
        </div>
        <p class="m-0 text-xs text-gray-500">
          {{
            t(
              'dashboard.reportSourceHint',
              'Uses the report’s filters, row grouping, and first value. Charts plot the first row field; metrics show the grand total.',
            )
          }}
        </p>
        <div v-if="isChart" class="flex items-center justify-between gap-2">
          <label class="text-xs text-gray-500">{{ t('dashboard.showLegend', 'Show legend') }}</label>
          <ToggleSwitch
            :model-value="boolOpt('showLegend')"
            @update:model-value="patchOptions({ showLegend: Boolean($event) })"
          />
        </div>
      </template>

      <template v-else>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">{{ t('dashboard.collection', 'Collection') }}</label>
          <Select
            :model-value="stringOpt('collection') || null"
            :options="collectionOptions"
            option-label="label"
            option-value="value"
            filter
            show-clear
            class="w-full"
            :placeholder="t('dashboard.selectCollection', 'Select collection')"
            @update:model-value="patchOptions({ collection: String($event || '') })"
          />
        </div>

        <div v-if="isMetric" class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">{{ t('dashboard.field', 'Field') }}</label>
          <Select
            :model-value="stringOpt('field') || '*'"
            :options="fieldOptions"
            option-label="label"
            option-value="value"
            filter
            class="w-full"
            @update:model-value="patchOptions({ field: String($event || '*') })"
          />
        </div>

        <div v-if="isMetric" class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">{{ t('dashboard.function', 'Function') }}</label>
          <Select
            :model-value="stringOpt('function') || 'count'"
            :options="aggregateOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            @update:model-value="patchOptions({ function: String($event || 'count') })"
          />
        </div>

        <template v-if="isChart">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-gray-500">{{ t('dashboard.xAxis', 'X-Axis') }}</label>
            <Select
              :model-value="stringOpt('xAxis') || null"
              :options="fieldOptions.filter((f) => f.value !== '*')"
              option-label="label"
              option-value="value"
              filter
              show-clear
              class="w-full"
              @update:model-value="patchOptions({ xAxis: String($event || '') })"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs text-gray-500">{{ t('dashboard.yAxis', 'Y-Axis') }}</label>
            <Select
              :model-value="stringOpt('yAxis') || null"
              :options="fieldOptions"
              option-label="label"
              option-value="value"
              filter
              show-clear
              class="w-full"
              @update:model-value="patchOptions({ yAxis: String($event || '') })"
            />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs text-gray-500">{{ t('dashboard.aggregation', 'Aggregation') }}</label>
            <Select
              :model-value="stringOpt('aggregation') || 'count'"
              :options="aggregateOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="patchOptions({ aggregation: String($event || 'count') })"
            />
          </div>

          <div class="flex items-center justify-between gap-2">
            <label class="text-xs text-gray-500">{{ t('dashboard.showLegend', 'Show legend') }}</label>
            <ToggleSwitch
              :model-value="boolOpt('showLegend')"
              @update:model-value="patchOptions({ showLegend: Boolean($event) })"
            />
          </div>
        </template>

        <PanelFilterEditor
          :key="panel.id"
          :filter="currentFilter"
          :field-options="fieldOptions"
          @update="onFilterUpdate"
        />
      </template>
    </template>

    <Message v-else severity="info" :closable="false">
      {{ t('dashboard.unsupportedTypeEdit', 'This panel type has limited designer support.') }}
    </Message>
  </aside>

  <aside v-else class="text-sm text-gray-500">
    {{ t('dashboard.selectPanelHint', 'Select a panel on the canvas to edit its options.') }}
  </aside>
</template>
