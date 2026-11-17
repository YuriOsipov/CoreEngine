<script lang="ts">
export default {
  name: 'ReportPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MenuItem } from 'openvue/menuitem'
import type Menu from 'openvue/menu'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import ReportDrillDownDialog from '../components/ReportDrillDownDialog.vue'
import ReportRuntimeFiltersBar from '../components/ReportRuntimeFiltersBar.vue'
import ReportTabularTable from '../components/ReportTabularTable.vue'
import {
  applyRuntimeFilterValues,
  executeReport,
  getReportBySettingId,
  listReportFields,
  listReportsForCurrentRole,
  listRuntimeVisibleFilters,
  normalizeReportDefinition,
  reportAsPivotSettings,
  reportCanRun,
  reportFieldDisplayLabel,
  resolveReportDateGrains,
  saveReport,
  tabularAsPivotSettings,
  type ReportDefinition,
  type ReportPivotDrillDown,
  type ReportWithSetting,
} from '../services/reportSettings'
import {
  resolveReportFieldDefinitions,
  resolveReportValueDisplayOptions,
} from '../services/reportCellDisplay'
import {
  buildReportExportFilterLines,
  exportReportDetailsOnly,
  type ReportExportFormat,
} from '../services/reportExcelExport'
import { canReadEntity, ensureEntityPermissions } from '@/core/entityPermissions'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const reports = ref<ReportWithSetting[]>([])
const selectedSettingId = ref<string | null>(null)
const draft = ref<ReportDefinition | null>(null)
const draftSettingId = ref<string | number | null>(null)
const draftRoleId = ref<string | null>(null)
const runtimeFilterValues = ref<Record<string, unknown>>({})
const rows = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const running = ref(false)
const exporting = ref(false)
const drillDownVisible = ref(false)
const drillDown = ref<ReportPivotDrillDown | null>(null)

const reportOptions = computed(() =>
  reports.value.map((report) => ({
    label: `${report.title} (${report.name})`,
    value: String(report.settingId),
  })),
)
const drillDownTitle = computed(() => {
  const reportTitle = draft.value?.title || t('reports.tabularReport', 'Tabular report')
  return t('reports.drillDownTitle', 'Drill down · {title}', { title: reportTitle })
})
const drillDownPivot = computed(
  () =>
    (draft.value &&
      (tabularAsPivotSettings(draft.value.tabular) ??
        reportAsPivotSettings(draft.value.tabular))) ||
    null,
)
const drillDownFieldLabels = computed<Record<string, string>>(() => {
  if (!draft.value) return {}
  const labels: Record<string, string> = {}
  const pivot = drillDownPivot.value
  const fields = pivot
    ? [
        ...pivot.rows.map((dimension) => dimension.field),
        ...pivot.columns.map((dimension) => dimension.field),
        ...pivot.values.map((value) => value.field),
      ]
    : [
        ...draft.value.tabular.groupRows.map((group) => group.field),
        ...draft.value.tabular.groupColumns.map((group) => group.field),
        ...draft.value.tabular.columns.map((column) => column.field),
      ]
  for (const field of fields) {
    if (field) labels[field] = reportFieldDisplayLabel(field)
  }
  return labels
})

let columnWidthSaveTimer: ReturnType<typeof setTimeout> | null = null
const canRun = computed(() => reportCanRun(draft.value))
const hasRuntimeFilters = computed(
  () => listRuntimeVisibleFilters(draft.value).length > 0,
)
const editInSetupRoute = computed(() => {
  if (!draftSettingId.value) return null
  return {
    name: 'setup-report-edit' as const,
    params: { settingId: String(draftSettingId.value) },
  }
})
const previewTitle = computed(() => {
  if (!draft.value) return t('reports.title', 'Reports')
  return draft.value.title || t('reports.tabularReport', 'Tabular report')
})

onMounted(() => {
  void loadReportList()
})

function curatedIdsFromRoute(): string[] {
  const raw = route.query.ids
  const value = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : ''
  return value.split(',').map((id) => id.trim()).filter(Boolean)
}

async function resolveCuratedReports(ids: string[]): Promise<ReportWithSetting[]> {
  await ensureEntityPermissions()
  const resolved = await Promise.all(ids.map((id) => getReportBySettingId(id)))
  const found: ReportWithSetting[] = []
  for (const report of resolved) {
    if (!report) continue
    if (report.collection && !canReadEntity(report.collection)) continue
    found.push(report)
  }
  return found
}

async function loadReportList(): Promise<void> {
  loading.value = true
  try {
    const curatedIds = curatedIdsFromRoute()
    const roleReports = await listReportsForCurrentRole()

    if (curatedIds.length > 0) {
      const curated = await resolveCuratedReports(curatedIds)
      if (curated.length > 0) {
        reports.value = curated
      } else {
        // Stale nav ids must not blank the picker — fall back to role-visible reports.
        reports.value = roleReports
        toast.add({
          severity: 'warn',
          summary: t('reports.title', 'Reports'),
          detail: t(
            'reports.linkedReportsMissing',
            'Linked report(s) were not found. Showing reports available for your role.',
          ),
          life: 5000,
        })
      }
    } else {
      reports.value = roleReports
    }

    if (!draft.value && reports.value.length > 0) {
      await selectReport(String(reports.value[0].settingId))
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('reports.failedLoadReports', 'Failed to load reports.'),
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

async function selectReport(settingId: string): Promise<void> {
  selectedSettingId.value = settingId
  let report = reports.value.find((item) => String(item.settingId) === settingId)
  if (!report) {
    const loaded = await getReportBySettingId(settingId)
    if (!loaded) return
    report = loaded
  }

  draftSettingId.value = report.settingId
  draftRoleId.value = report.roleId ?? null
  draft.value = await resolveReportDateGrains(normalizeReportDefinition(report.config))
  runtimeFilterValues.value = Object.fromEntries(
    listRuntimeVisibleFilters(draft.value).map((condition) => [
      condition.id,
      condition.value,
    ]),
  )
  rows.value = []
  if (canRun.value) {
    await runCurrentReport()
  }
}

async function runCurrentReport(): Promise<void> {
  if (!draft.value || !canRun.value) return

  running.value = true
  try {
    const reportToRun = applyRuntimeFilterValues(draft.value, runtimeFilterValues.value)
    rows.value = await executeReport(reportToRun)
    toast.add({
      severity: 'info',
      summary: t('reports.title', 'Reports'),
      detail: t('reports.loadedRows', 'Loaded {count} report rows.', {
        count: rows.value.length,
      }),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('reports.failedRun', 'Failed to run report.'),
      life: 4000,
    })
  } finally {
    running.value = false
  }
}

function openDrillDown(payload: ReportPivotDrillDown): void {
  drillDown.value = payload
  drillDownVisible.value = true
}

function onColumnWidths(widths: Record<string, number>): void {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    columnWidths: widths,
  }
  if (!draftSettingId.value) return
  if (columnWidthSaveTimer) clearTimeout(columnWidthSaveTimer)
  columnWidthSaveTimer = setTimeout(() => {
    void persistColumnWidths()
  }, 600)
}

async function persistColumnWidths(): Promise<void> {
  if (!draft.value || !draftSettingId.value) return
  try {
    await saveReport(draft.value, draftSettingId.value, draftRoleId.value)
  } catch {
    // Width persistence is best-effort; keep the in-memory layout.
  }
}

onBeforeUnmount(() => {
  if (columnWidthSaveTimer) clearTimeout(columnWidthSaveTimer)
})

function openInSetup(): void {
  if (!editInSetupRoute.value) return
  void router.push(editInSetupRoute.value)
}

const exportMenu = ref<InstanceType<typeof Menu> | null>(null)

const exportDisabled = computed(() => {
  if (!draft.value || loading.value || running.value || exporting.value) return true
  if (rows.value.length === 0) return true
  return false
})

const exportMenuItems = computed<MenuItem[]>(() => [
  {
    label: t('reports.exportXlsx', 'Excel (.xlsx)'),
    icon: 'pi pi-file-excel',
    disabled: exportDisabled.value,
    command: () => {
      void exportCurrentReport('xlsx')
    },
  },
  {
    label: t('reports.exportXls', 'Excel (.xls)'),
    icon: 'pi pi-file-excel',
    disabled: exportDisabled.value,
    command: () => {
      void exportCurrentReport('xls')
    },
  },
  {
    label: t('reports.exportCsv', 'CSV (.csv)'),
    icon: 'pi pi-file',
    disabled: exportDisabled.value,
    command: () => {
      void exportCurrentReport('csv')
    },
  },
])

function toggleExportMenu(event: Event): void {
  exportMenu.value?.toggle(event)
}

async function exportCurrentReport(format: ReportExportFormat): Promise<void> {
  if (!draft.value) return

  if (rows.value.length === 0) {
    toast.add({
      severity: 'warn',
      summary: t('reports.title', 'Reports'),
      detail: t('reports.exportEmpty', 'Run the report before exporting.'),
      life: 3500,
    })
    return
  }

  exporting.value = true
  try {
    const reportForExport = applyRuntimeFilterValues(
      draft.value,
      runtimeFilterValues.value,
    )
    const columnFields = [
      ...reportForExport.tabular.groupRows.map((group) => group.field),
      ...reportForExport.tabular.groupColumns.map((group) => group.field),
      ...reportForExport.tabular.columns.map((column) => column.field),
    ]
    const filterFields = reportForExport.conditions.map((condition) => condition.field)
    const metaFields = [...new Set([...columnFields, ...filterFields])]
    const [fieldOptions, fieldDefinitions, numberDisplayByField] = await Promise.all([
      listReportFields(reportForExport.collection).catch(() => []),
      resolveReportFieldDefinitions(reportForExport.collection, metaFields).catch(
        () => new Map(),
      ),
      resolveReportValueDisplayOptions(reportForExport.collection, metaFields).catch(() => ({})),
    ])

    const fieldLabels: Record<string, string> = {}
    for (const field of fieldOptions) {
      fieldLabels[field.field] = reportFieldDisplayLabel(field.field)
    }
    for (const field of metaFields) {
      if (!fieldLabels[field]) fieldLabels[field] = reportFieldDisplayLabel(field)
    }

    const filterLines = buildReportExportFilterLines(
      reportForExport.conditions,
      fieldLabels,
    )

    const result = exportReportDetailsOnly(
      reportForExport,
      rows.value,
      format,
      fieldLabels,
      fieldDefinitions,
      numberDisplayByField,
      filterLines,
    )
    toast.add({
      severity: 'success',
      summary: t('reports.title', 'Reports'),
      detail:
        result.style === 'pivot'
          ? t('reports.exportPivotSuccess', 'Exported pivot summary ({count} rows).', {
              count: result.rowCount,
            })
          : t('reports.exportSuccess', 'Exported {count} detail rows.', {
              count: result.rowCount,
            }),
      life: 3500,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('reports.exportFailed', 'Failed to export report.'),
      life: 4000,
    })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <main class="app-shell report-page report-page--fill">
    <header class="app-header report-page__header">
      <div class="app-header__row">
        <div>
          <h1>{{ t('reports.title', 'Reports') }}</h1>
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
            :label="t('reports.export', 'Export')"
            size="small"
            severity="secondary"
            outlined
            icon="pi pi-download"
            icon-pos="left"
            :loading="exporting"
            :disabled="exportDisabled"
            aria-haspopup="true"
            @click="toggleExportMenu"
          />
          <Menu ref="exportMenu" :model="exportMenuItems" popup />
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
    </header>

    <section v-if="loading && reports.length === 0" class="page-loading report-page__body">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('reports.loadingReports', 'Loading reports...') }}</span>
    </section>

    <section
      v-else
      class="report-page__panel bg-surface-0 border border-surface-200 rounded-lg min-h-0 min-w-0 flex flex-1 flex-col gap-3 p-4 mt-4 overflow-hidden"
    >
      <div class="report-page__panel-chrome flex flex-none flex-col gap-3">
        <div class="flex items-center gap-3 justify-between">
          <h2 class="m-0">{{ previewTitle }}</h2>
          <small v-if="draft?.name" class="text-muted-color">{{ draft.name }}</small>
        </div>

        <ReportRuntimeFiltersBar
          v-if="draft && hasRuntimeFilters"
          :report="draft"
          v-model:values="runtimeFilterValues"
          @apply="runCurrentReport"
        />
      </div>

      <div v-if="running" class="page-loading report-page__scroll min-h-0 flex-1">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('reports.runningReport', 'Running report...') }}</span>
      </div>
      <div
        v-else-if="draft"
        class="report-page__scroll min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden"
      >
        <ReportTabularTable
          :report="draft"
          :rows="rows"
          :empty-message="t('reports.runEmptyTabularMessage', 'Run the report to show tabular data.')"
          @update:column-widths="onColumnWidths"
          @drill-down="openDrillDown"
        />
      </div>
      <p v-else class="text-muted-color m-0">
        {{ t('reports.chooseExistingOrCreate', 'Choose an existing report or create a new one.') }}
      </p>
    </section>

    <ReportDrillDownDialog
      v-if="draft && drillDownPivot"
      v-model:visible="drillDownVisible"
      :title="drillDownTitle"
      :collection="draft.collection"
      :pivot="drillDownPivot"
      :rows="rows"
      :drill-down="drillDown"
      :field-labels="drillDownFieldLabels"
    />
  </main>
</template>

<style scoped>
.report-page--fill {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

.report-page__header {
  flex: 0 0 auto;
}

.report-page__panel,
.report-page__body {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
