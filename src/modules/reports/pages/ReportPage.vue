<script lang="ts">
export default {
  name: 'ReportPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CrmVTablePivot from '@/core/ui-kit/CrmVTablePivot.vue'
import ReportSettingsDesigner from '../components/ReportSettingsDesigner.vue'
import { useTranslation } from '@/core/translation'
import {
  defaultReportDefinition,
  executeReport,
  saveReport,
  listReports,
  normalizeReportDefinition,
  type ReportDefinition,
  type ReportWithSetting,
} from '../services/reportSettings'

const { t } = useTranslation()
const route = useRoute()
const reports = ref<ReportWithSetting[]>([])
const selectedSettingId = ref<string | null>(null)
const draft = ref<ReportDefinition | null>(null)
const draftSettingId = ref<string | number | null>(null)
const rows = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const saving = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const status = ref<string | null>(null)
const showConfiguration = ref(false)

const reportOptions = computed(() =>
  reports.value.map((report) => ({
    label: `${report.title} (${report.name})`,
    value: String(report.settingId),
  })),
)
const canSave = computed(() =>
  Boolean(
    draft.value?.name &&
      draft.value.collection &&
      draft.value.pivot.values.length > 0,
  ),
)
const canRun = computed(() => Boolean(draft.value?.collection && draft.value.pivot.values.length > 0))

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
  draft.value = normalizeReportDefinition(report.config)
  rows.value = []
  status.value = null
  error.value = null
  if (canRun.value) {
    await runCurrentReport()
  }
}

async function startNewReport(): Promise<void> {
  draft.value = await defaultReportDefinition('')
  draftSettingId.value = null
  selectedSettingId.value = null
  rows.value = []
  showConfiguration.value = true
  status.value = t('reports.newDraftCreated', 'New report draft created.')
  error.value = null
}

async function saveCurrentReport(): Promise<void> {
  if (!draft.value) return
  if (!canSave.value) {
    error.value = t(
      'reports.enterRequired',
      'Enter report title, source collection, and at least one pivot value.',
    )
    return
  }
  const duplicate = reports.value.find(
    (report) =>
      report.name === draft.value?.name &&
      String(report.settingId) !== String(draftSettingId.value ?? ''),
  )
  if (duplicate) {
    error.value = t('reports.duplicateName', 'Report name "{name}" already exists.', {
      name: draft.value.name,
    })
    return
  }

  saving.value = true
  error.value = null
  status.value = null
  try {
    const saved = await saveReport(draft.value, draftSettingId.value)
    draftSettingId.value = saved.settingId
    selectedSettingId.value = String(saved.settingId)
    await loadReportList()
    await selectReport(String(saved.settingId))
    status.value = t('reports.reportSaved', 'Report saved.')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('reports.failedSave', 'Failed to save report.')
  } finally {
    saving.value = false
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
</script>

<template>
  <main class="app-shell report-page">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <RouterLink to="/" class="nav-link">{{ t('common.allCollections', 'All collections') }}</RouterLink>
          <h1>{{ t('reports.title', 'Reports') }}</h1>
          <p>{{ t('reports.subtitle', 'Build reports from registry records and review them as pivot tables.') }}</p>
        </div>
      </div>

      <div class="bg-surface-0 border border-surface-200 rounded-lg grid gap-4 grid-cols-[minmax(240px,420px)_minmax(0,1fr)] items-end mt-4 px-4 py-[0.85rem] max-[1100px]:grid-cols-1">
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
            :loading="loading"
            @click="loadReportList"
          />
          <Button
            :label="t('reports.newReport', 'New report')"
            size="small"
            @click="startNewReport"
          />
          <Button
            v-if="draft"
            :label="showConfiguration
              ? t('reports.hideConfiguration', 'Hide configuration')
              : t('reports.showConfiguration', 'Show configuration')"
            size="small"
            severity="secondary"
            text
            @click="showConfiguration = !showConfiguration"
          />
          <Button
            v-if="draft"
            :label="t('reports.saveReport', 'Save report')"
            size="small"
            :loading="saving"
            :disabled="!canSave"
            @click="saveCurrentReport"
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
      class="grid items-start gap-5 grid-cols-[minmax(340px,460px)_minmax(0,1fr)] mt-6 max-[1100px]:grid-cols-1"
      :class="{ '!grid-cols-1': !showConfiguration }"
    >
      <aside v-if="showConfiguration" class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-4 grid gap-4">
        <Message
          v-if="reports.length === 0 && !draft"
          severity="info"
          :closable="false"
        >
          {{ t('reports.noReportsConfigured', 'No reports configured yet. Create a new report to get started.') }}
        </Message>

        <ReportSettingsDesigner
          v-if="draft"
          v-model="draft"
        />
      </aside>

      <section class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-4 grid gap-4 max-h-[calc(100vh-9rem)] overflow-auto">
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
          :empty-message="t('reports.runEmptyMessage', 'Run the report to show pivot data.')"
        />
        <Message v-else severity="info" :closable="false">
          {{ t('reports.chooseExistingOrCreate', 'Choose an existing report or create a new one.') }}
        </Message>
      </section>
    </section>
  </main>
</template>

