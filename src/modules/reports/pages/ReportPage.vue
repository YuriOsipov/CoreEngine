<script lang="ts">
export default {
  name: 'ReportPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import CrmVTablePivot from '@/core/ui-kit/CrmVTablePivot.vue'
import { useTranslation } from '@/core/translation'
import ReportDrillDownDialog from '../components/ReportDrillDownDialog.vue'
import {
  executeReport,
  listReports,
  normalizeReportDefinition,
  pivotDimensionFields,
  resolveReportDateGrains,
  type ReportDefinition,
  type ReportPivotDrillDown,
  type ReportWithSetting,
} from '../services/reportSettings'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const reports = ref<ReportWithSetting[]>([])
const selectedSettingId = ref<string | null>(null)
const draft = ref<ReportDefinition | null>(null)
const draftSettingId = ref<string | number | null>(null)
const rows = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const status = ref<string | null>(null)
const drillDownVisible = ref(false)
const drillDown = ref<ReportPivotDrillDown | null>(null)

const reportOptions = computed(() =>
  reports.value.map((report) => ({
    label: `${report.title} (${report.name})`,
    value: String(report.settingId),
  })),
)
const drillDownTitle = computed(() => {
  const reportTitle = draft.value?.title || t('reports.pivotTable', 'Pivot table')
  return t('reports.drillDownTitle', 'Drill down · {title}', { title: reportTitle })
})
const drillDownFieldLabels = computed<Record<string, string>>(() => {
  if (!draft.value) return {}
  const labels: Record<string, string> = {}
  for (const field of [
    ...pivotDimensionFields(draft.value.pivot.rows),
    ...pivotDimensionFields(draft.value.pivot.columns),
    ...draft.value.pivot.values.map((value) => value.field),
  ]) {
    labels[field] = field
  }
  return labels
})
const canRun = computed(() => Boolean(draft.value?.collection && draft.value.pivot.values.length > 0))
const editInSetupRoute = computed(() => {
  if (!draftSettingId.value) return null
  return {
    name: 'setup-report-edit' as const,
    params: { settingId: String(draftSettingId.value) },
  }
})

onMounted(() => {
  void loadReportList()
})

async function loadReportList(): Promise<void> {
  loading.value = true
  error.value = null
  status.value = null
  try {
    const all = await listReports()
    const curatedIds =
      typeof route.query.ids === 'string'
        ? route.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
        : []
    reports.value = curatedIds.length
      ? all.filter((report) => curatedIds.includes(String(report.settingId)))
      : all
    if (!draft.value && reports.value.length > 0) {
      await selectReport(String(reports.value[0].settingId))
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('reports.failedLoadReports', 'Failed to load reports.')
  } finally {
    loading.value = false
  }
}

async function selectReport(settingId: string): Promise<void> {
  selectedSettingId.value = settingId
  const report = reports.value.find((item) => String(item.settingId) === settingId)
  if (!report) return

  draftSettingId.value = report.settingId
  draft.value = await resolveReportDateGrains(normalizeReportDefinition(report.config))
  rows.value = []
  status.value = null
  error.value = null
  if (canRun.value) {
    await runCurrentReport()
  }
}

async function runCurrentReport(): Promise<void> {
  if (!draft.value || !canRun.value) return

  running.value = true
  error.value = null
  status.value = null
  try {
    rows.value = await executeReport(draft.value)
    status.value = t('reports.loadedRows', 'Loaded {count} report rows.', {
      count: rows.value.length,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('reports.failedRun', 'Failed to run report.')
  } finally {
    running.value = false
  }
}

function openDrillDown(payload: ReportPivotDrillDown): void {
  drillDown.value = payload
  drillDownVisible.value = true
}

function openInSetup(): void {
  if (!editInSetupRoute.value) return
  void router.push(editInSetupRoute.value)
}
</script>

<template>
  <main class="app-shell report-page">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <RouterLink to="/" class="nav-link">{{ t('common.allCollections', 'All collections') }}</RouterLink>
          <h1>{{ t('reports.title', 'Reports') }}</h1>
          <p>{{ t('reports.runSubtitle', 'Run pivot reports and drill into source records.') }}</p>
        </div>
      </div>

      <div
        class="bg-surface-0 border border-surface-200 rounded-lg grid gap-4 grid-cols-[minmax(240px,420px)_minmax(0,1fr)] items-end px-4 py-[0.85rem] mt-4 max-[1100px]:grid-cols-1"
      >
        <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
          {{ t('reports.chooseReport', 'Choose report') }}
          <Select
            :model-value="selectedSettingId"
            :options="reportOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('reports.chooseReport', 'Choose report')"
            fluid
            @update:model-value="selectReport(String($event))"
          />
        </label>
        <div class="flex items-center gap-3 flex-wrap justify-end max-[1100px]:justify-start">
          <Button
            :label="t('reports.refresh', 'Refresh')"
            size="small"
            text
            :loading="loading || running"
            @click="runCurrentReport"
          />
          <Button
            v-if="editInSetupRoute"
            :label="t('reports.editInSetup', 'Edit in Setup')"
            size="small"
            severity="secondary"
            outlined
            @click="openInSetup"
          />
        </div>
      </div>

      <Message
        v-if="error"
        severity="error"
        :closable="false"
        class="collections-message"
      >
        {{ error }}
      </Message>
      <Message
        v-else-if="status"
        severity="info"
        :closable="false"
        class="collections-message"
      >
        {{ status }}
      </Message>
    </header>

    <section v-if="loading && reports.length === 0" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('reports.loadingReports', 'Loading reports...') }}</span>
    </section>

    <section
      v-else
      class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-4 grid gap-4 mt-6 max-h-[calc(100vh-9rem)] overflow-auto"
    >
      <div class="flex items-center gap-3 justify-between">
        <h2 class="m-0">{{ draft?.title || t('reports.pivotTable', 'Pivot table') }}</h2>
        <small v-if="draft?.name" class="text-muted-color">{{ draft.name }}</small>
      </div>

      <div v-if="running" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('reports.runningReport', 'Running report...') }}</span>
      </div>
      <CrmVTablePivot
        v-else-if="draft"
        :rows="rows"
        :pivot="draft.pivot"
        :collection="draft.collection"
        :empty-message="t('reports.runEmptyMessage', 'Run the report to show pivot data.')"
        @drill-down="openDrillDown"
      />
      <Message v-else severity="info" :closable="false">
        {{ t('reports.chooseExistingOrCreate', 'Choose an existing report or create a new one.') }}
      </Message>
    </section>

    <ReportDrillDownDialog
      v-if="draft"
      v-model:visible="drillDownVisible"
      :title="drillDownTitle"
      :collection="draft.collection"
      :pivot="draft.pivot"
      :rows="rows"
      :drill-down="drillDown"
      :field-labels="drillDownFieldLabels"
    />
  </main>
</template>
