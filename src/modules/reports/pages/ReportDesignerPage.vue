<script lang="ts">
export default {
  name: 'ReportDesignerPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'openvue/usetoast'
import CrmVTablePivot from '@/core/ui-kit/CrmVTablePivot.vue'
import {
  buildRoleSelectOptions,
  loadAppRoles,
  roleIdToSelectValue,
  selectValueToRoleId,
} from '@/core/settingRoleUtils'
import { useTranslation } from '@/core/translation'
import type { AppRoleOption } from '@/interfaces'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
import ReportDrillDownDialog from '../components/ReportDrillDownDialog.vue'
import ReportFieldsPanel from '../components/ReportFieldsPanel.vue'
import ReportFiltersPanel from '../components/ReportFiltersPanel.vue'
import ReportOutlinePanel from '../components/ReportOutlinePanel.vue'
import ReportTabularOutlinePanel from '../components/ReportTabularOutlinePanel.vue'
import ReportTabularTable from '../components/ReportTabularTable.vue'
import type { ReportFieldOption } from '../services/reportSettings'
import {
  defaultReportDefinition,
  executeReport,
  getReportBySettingId,
  isPivotReport,
  isTabularReport,
  listReportFolders,
  listReports,
  normalizeReportDefinition,
  normalizeReportName,
  normalizeReportType,
  pivotDimensionFields,
  reportCanRun,
  resolveReportDateGrains,
  saveReport,
  type ReportDefinition,
  type ReportFolder,
  type ReportPivotDrillDown,
  type ReportType,
} from '../services/reportSettings'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const draft = ref<ReportDefinition | null>(null)
const draftSettingId = ref<string | number | null>(null)
const draftRoleId = ref<string | null>(null)
const folders = ref<ReportFolder[]>([])
const collections = ref<Array<{ label: string; value: string }>>([])
const roleOptions = ref<AppRoleOption[]>([])
const loadingCollections = ref(false)
const rows = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const saving = ref(false)
const running = ref(false)
const activeTab = ref<'outline' | 'filters'>('outline')
const fieldsCollapsed = ref(false)
const tabularOutlineRef = ref<{
  mergeLoadedFields: (fields: ReportFieldOption[]) => void
} | null>(null)
const drillDownVisible = ref(false)
const drillDown = ref<ReportPivotDrillDown | null>(null)

const isNew = computed(() => route.name === 'setup-report-new')
const canSave = computed(() =>
  Boolean(draft.value?.name && draft.value.collection && reportCanRun(draft.value)),
)
const canRun = computed(() => reportCanRun(draft.value))
const pageTitle = computed(() =>
  draft.value?.title ||
  (isNew.value
    ? t('reports.newReport', 'New report')
    : t('reports.untitledReport', 'Untitled report')),
)
const drillDownTitle = computed(() =>
  t('reports.drillDownTitle', 'Drill down · {title}', { title: pageTitle.value }),
)
const drillDownFieldLabels = computed<Record<string, string>>(() => {
  if (!draft.value || !isPivotReport(draft.value)) return {}
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
const tabOptions = computed(() => [
  { label: t('reports.outline', 'Outline'), value: 'outline' },
  { label: t('reports.filters', 'Filters'), value: 'filters' },
])
const folderOptions = computed(() => [
  { label: t('reports.unfiled', 'Unfiled'), value: null as string | null },
  ...folders.value.map((folder) => ({
    label: folder.name,
    value: folder.id as string | null,
  })),
])
const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(
    roleOptions.value,
    t('layoutRole.defaultRole', 'Default (all roles)'),
  ),
)
const reportTypeOptions = computed(() => [
  {
    label: t('reports.typePivot', 'Pivot'),
    value: 'pivot' as ReportType,
  },
  {
    label: t('reports.typeTabular', 'Tabular'),
    value: 'tabular' as ReportType,
  },
])
const previewTitle = computed(() => {
  if (!draft.value) return t('reports.preview', 'Preview')
  if (isTabularReport(draft.value)) {
    return draft.value.title || t('reports.tabularReport', 'Tabular report')
  }
  return draft.value.title || t('reports.pivotTable', 'Pivot table')
})

watch(
  () => route.params.settingId,
  () => {
    void loadDesigner()
  },
)

onMounted(() => {
  void loadCollections()
  void loadRoles()
  void loadDesigner()
})

async function loadRoles(): Promise<void> {
  roleOptions.value = await loadAppRoles()
}

async function loadCollections(): Promise<void> {
  loadingCollections.value = true
  try {
    collections.value = await listUserCollections()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('builder.loadCollectionsError', 'Failed to load collections.'),
      life: 4000,
    })
  } finally {
    loadingCollections.value = false
  }
}

function updateTitle(value: string): void {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    title: value,
    name: normalizeReportName(value),
  }
}

function updateCollection(collection: string): void {
  if (!draft.value) return
  const type = draft.value.type
  void (async () => {
    const next = await defaultReportDefinition(collection, type)
    draft.value = {
      ...next,
      id: draft.value?.id ?? next.id,
      title: draft.value?.title ?? '',
      name: draft.value?.name ?? '',
      folderId: draft.value?.folderId ?? null,
      limit: draft.value?.limit ?? -1,
      collection,
      type,
    }
    rows.value = []
  })()
}

function updateFolderId(folderId: unknown): void {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    folderId: folderId ? String(folderId) : null,
  }
}

function updateLimit(limit: unknown): void {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    limit: Number(limit ?? -1),
  }
}

function updateRoleId(value: unknown): void {
  draftRoleId.value = selectValueToRoleId(value)
}

async function updateReportType(value: unknown): Promise<void> {
  if (!draft.value) return
  const type = normalizeReportType(value)
  if (type === draft.value.type) return
  const collection = draft.value.collection
  const next = await defaultReportDefinition(collection, type)
  draft.value = {
    ...next,
    id: draft.value.id,
    title: draft.value.title,
    name: draft.value.name,
    folderId: draft.value.folderId ?? null,
    limit: draft.value.limit ?? -1,
    collection,
    type,
    conditions: [],
  }
  rows.value = []
}

function initialTypeFromRoute(): ReportType {
  const queryType = typeof route.query.type === 'string' ? route.query.type : ''
  return normalizeReportType(queryType)
}

async function loadDesigner(): Promise<void> {
  loading.value = true
  rows.value = []
  try {
    folders.value = await listReportFolders()
    if (isNew.value) {
      draftSettingId.value = null
      draftRoleId.value = null
      draft.value = await defaultReportDefinition('', initialTypeFromRoute())
      return
    }
    const settingId = String(route.params.settingId ?? '')
    const report = await getReportBySettingId(settingId)
    if (!report) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: t('reports.reportNotFound', 'Report not found.'),
        life: 4000,
      })
      await router.replace({ name: 'setup-reports' })
      return
    }
    draftSettingId.value = report.settingId
    draftRoleId.value = report.roleId
    draft.value = await resolveReportDateGrains(normalizeReportDefinition(report.config))
    if (canRun.value) await runPreview()
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

async function runPreview(): Promise<void> {
  if (!draft.value || !canRun.value) return
  running.value = true
  try {
    rows.value = await executeReport(draft.value)
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

async function saveCurrent(): Promise<void> {
  if (!draft.value) return
  if (!canSave.value) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'reports.enterRequiredTyped',
        'Enter report title, source collection, and at least one value or column.',
      ),
      life: 4000,
    })
    return
  }

  saving.value = true
  try {
    const existing = await listReports()
    const duplicate = existing.find(
      (report) =>
        report.name === draft.value?.name &&
        String(report.settingId) !== String(draftSettingId.value ?? ''),
    )
    if (duplicate) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: t('reports.duplicateName', 'Report name "{name}" already exists.', {
          name: draft.value.name,
        }),
        life: 4000,
      })
      return
    }

    const saved = await saveReport(draft.value, draftSettingId.value, draftRoleId.value)
    draftSettingId.value = saved.settingId
    draftRoleId.value = saved.roleId
    draft.value = normalizeReportDefinition(saved.config)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('reports.reportSaved', 'Report saved.'),
      life: 3000,
    })
    if (isNew.value) {
      await router.replace({
        name: 'setup-report-edit',
        params: { settingId: String(saved.settingId) },
      })
    }
    await runPreview()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('reports.failedSave', 'Failed to save report.'),
      life: 4000,
    })
  } finally {
    saving.value = false
  }
}

function closeDesigner(): void {
  void router.push({ name: 'setup-reports' })
}

function openDrillDown(payload: ReportPivotDrillDown): void {
  drillDown.value = payload
  drillDownVisible.value = true
}

function onPaletteFieldsLoaded(fields: ReportFieldOption[]): void {
  tabularOutlineRef.value?.mergeLoadedFields(fields)
}
</script>

<template>
  <section class="setup-reports-tab mt-4 grid gap-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <Button
          :label="t('reports.backToList', 'Back to reports')"
          icon="pi pi-arrow-left"
          text
          size="small"
          class="mb-1"
          @click="closeDesigner"
        />
        <h2 class="m-0 truncate">{{ pageTitle }}</h2>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <Button
          :label="t('reports.runReport', 'Run')"
          icon="pi pi-play"
          size="small"
          severity="secondary"
          :loading="running"
          :disabled="!canRun"
          @click="runPreview"
        />
        <Button
          :label="t('reports.saveReport', 'Save report')"
          icon="pi pi-save"
          size="small"
          :loading="saving"
          :disabled="!canSave"
          @click="saveCurrent"
        />
        <Button
          :label="t('common.close', 'Close')"
          size="small"
          text
          severity="secondary"
          @click="closeDesigner"
        />
      </div>
    </div>

    <div
      v-if="draft"
      class="bg-surface-0 border border-surface-200 rounded-lg grid gap-3 grid-cols-[repeat(6,minmax(0,1fr))] items-end px-4 py-3 max-[1400px]:grid-cols-3 max-[900px]:grid-cols-2 max-[640px]:grid-cols-1"
    >
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem] min-w-0">
        {{ t('reports.reportTitle', 'Report title') }}
        <InputText
          :model-value="draft.title"
          :placeholder="t('reports.reportTitlePlaceholder', 'Visits by Provider')"
          fluid
          @update:model-value="updateTitle(String($event))"
        />
      </label>
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem] min-w-0">
        {{ t('reports.reportType', 'Report type') }}
        <Select
          :model-value="draft.type"
          :options="reportTypeOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="updateReportType($event)"
        />
      </label>
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem] min-w-0">
        {{ t('reports.sourceCollection', 'Source collection') }}
        <Select
          :model-value="draft.collection"
          :options="collections"
          option-label="label"
          option-value="value"
          :placeholder="t('common.selectCollection', 'Select collection')"
          fluid
          :loading="loadingCollections"
          @update:model-value="updateCollection(String($event))"
        />
      </label>
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem] min-w-0">
        {{ t('layoutRole.role', 'Role') }}
        <Select
          :model-value="roleIdToSelectValue(draftRoleId)"
          :options="roleSelectOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="updateRoleId($event)"
        />
      </label>
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem] min-w-0">
        {{ t('reports.folder', 'Folder') }}
        <Select
          :model-value="draft.folderId ?? null"
          :options="folderOptions"
          option-label="label"
          option-value="value"
          :placeholder="t('reports.unfiled', 'Unfiled')"
          fluid
          show-clear
          @update:model-value="updateFolderId($event)"
        />
      </label>
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem] min-w-0">
        {{ t('reports.limit', 'Limit') }}
        <InputNumber
          :model-value="draft.limit ?? -1"
          fluid
          @update:model-value="updateLimit($event)"
        />
      </label>
    </div>

    <div v-if="loading" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('reports.loadingReports', 'Loading reports...') }}</span>
    </div>

    <div
      v-else-if="draft && isTabularReport(draft)"
      class="flex items-start gap-3 max-[1100px]:flex-col"
    >
      <ReportFieldsPanel
        :collection="draft.collection"
        :collapsed="fieldsCollapsed"
        @update:collapsed="fieldsCollapsed = $event"
        @fields-loaded="onPaletteFieldsLoaded"
      />

      <aside class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-3 grid gap-3 overflow-x-hidden w-[minmax(280px,360px)] max-w-[360px] flex-[0_0_360px] max-[1100px]:flex-none max-[1100px]:max-w-none max-[1100px]:w-full">
        <SelectButton
          v-model="activeTab"
          :options="tabOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="w-full justify-stretch"
        />
        <ReportTabularOutlinePanel
          v-show="activeTab === 'outline'"
          ref="tabularOutlineRef"
          v-model="draft"
        />
        <ReportFiltersPanel
          v-show="activeTab === 'filters'"
          v-model="draft"
        />
      </aside>

      <section class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-4 grid gap-3 flex-1 max-h-[calc(100vh-10rem)] overflow-auto">
        <div class="flex items-center justify-between gap-2">
          <h3 class="m-0">{{ previewTitle }}</h3>
          <small v-if="draft.name" class="text-muted-color">{{ draft.name }}</small>
        </div>
        <div v-if="running" class="page-loading">
          <ProgressSpinner stroke-width="4" />
          <span>{{ t('reports.runningReport', 'Running report...') }}</span>
        </div>
        <ReportTabularTable
          v-else
          :report="draft"
          :rows="rows"
          :empty-message="t('reports.runEmptyTabularMessage', 'Run the report to show tabular data.')"
        />
      </section>
    </div>

    <div
      v-else-if="draft"
      class="grid items-start gap-4 grid-cols-[minmax(320px,400px)_minmax(0,1fr)] max-[1100px]:grid-cols-1"
    >
      <aside class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-3 grid gap-3 overflow-x-hidden">
        <SelectButton
          v-model="activeTab"
          :options="tabOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="w-full justify-stretch"
        />
        <ReportOutlinePanel
          v-show="activeTab === 'outline'"
          v-model="draft"
        />
        <ReportFiltersPanel
          v-show="activeTab === 'filters'"
          v-model="draft"
        />
      </aside>

      <section class="bg-surface-0 border border-surface-200 rounded-lg min-w-0 p-4 grid gap-3 max-h-[calc(100vh-10rem)] overflow-auto">
        <div class="flex items-center justify-between gap-2">
          <h3 class="m-0">{{ previewTitle }}</h3>
          <small v-if="draft.name" class="text-muted-color">{{ draft.name }}</small>
        </div>
        <div v-if="running" class="page-loading">
          <ProgressSpinner stroke-width="4" />
          <span>{{ t('reports.runningReport', 'Running report...') }}</span>
        </div>
        <CrmVTablePivot
          v-else
          :rows="rows"
          :pivot="draft.pivot"
          :collection="draft.collection"
          :empty-message="t('reports.runEmptyMessage', 'Run the report to show pivot data.')"
          @drill-down="openDrillDown"
        />
      </section>
    </div>

    <ReportDrillDownDialog
      v-if="draft && isPivotReport(draft)"
      v-model:visible="drillDownVisible"
      :title="drillDownTitle"
      :collection="draft.collection"
      :pivot="draft.pivot"
      :rows="rows"
      :drill-down="drillDown"
      :field-labels="drillDownFieldLabels"
    />
  </section>
</template>
