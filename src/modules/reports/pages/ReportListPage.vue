<script lang="ts">
export default {
  name: 'ReportListPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  deleteReport,
  deleteReportFolder,
  listReportFolders,
  listReports,
  saveReportFolder,
  type ReportFolder,
  type ReportWithSetting,
} from '../services/reportSettings'

const { t } = useTranslation()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()

const reports = ref<ReportWithSetting[]>([])
const folders = ref<ReportFolder[]>([])
const loading = ref(false)
const searchQuery = ref('')
const selectedFolderId = ref<string | 'all' | 'unfiled'>('all')
const folderDialogVisible = ref(false)
const folderName = ref('')
const folderSaving = ref(false)

const folderCounts = computed(() => {
  const counts = new Map<string, number>()
  let unfiled = 0
  for (const report of reports.value) {
    const folderId = report.config.folderId
    if (!folderId) {
      unfiled += 1
      continue
    }
    counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
  }
  return { counts, unfiled, all: reports.value.length }
})

const filteredReports = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return reports.value.filter((report) => {
    if (selectedFolderId.value === 'unfiled' && report.config.folderId) return false
    if (
      selectedFolderId.value !== 'all' &&
      selectedFolderId.value !== 'unfiled' &&
      report.config.folderId !== selectedFolderId.value
    ) {
      return false
    }
    if (!q) return true
    const folderName = folderLabel(report.config.folderId)
    return (
      report.title.toLowerCase().includes(q) ||
      report.name.toLowerCase().includes(q) ||
      report.collection.toLowerCase().includes(q) ||
      folderName.toLowerCase().includes(q)
    )
  })
})

onMounted(() => {
  void loadAll()
})

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    const [reportRows, folderRows] = await Promise.all([
      listReports(),
      listReportFolders(),
    ])
    reports.value = reportRows
    folders.value = folderRows
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

function folderLabel(folderId: string | null | undefined): string {
  if (!folderId) return t('reports.unfiled', 'Unfiled')
  return folders.value.find((folder) => folder.id === folderId)?.name ?? folderId
}

function openNewReport(): void {
  void router.push({ name: 'setup-report-new' })
}

function openReport(report: ReportWithSetting): void {
  void router.push({
    name: 'setup-report-edit',
    params: { settingId: String(report.settingId) },
  })
}

function openNewFolderDialog(): void {
  folderName.value = ''
  folderDialogVisible.value = true
}

async function saveFolder(): Promise<void> {
  const name = folderName.value.trim()
  if (!name) return
  folderSaving.value = true
  try {
    await saveReportFolder({ name })
    folderDialogVisible.value = false
    await loadAll()
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('reports.folderCreated', 'Folder created.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('reports.failedSaveFolder', 'Failed to save folder.'),
      life: 4000,
    })
  } finally {
    folderSaving.value = false
  }
}

function confirmDeleteFolder(folder: ReportFolder): void {
  confirm.require({
    message: t(
      'reports.deleteFolderConfirm',
      'Delete folder "{name}"? Reports in it will become unfiled.',
      { name: folder.name },
    ),
    header: t('reports.deleteFolder', 'Delete folder'),
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => {
      void removeFolder(folder)
    },
  })
}

async function removeFolder(folder: ReportFolder): Promise<void> {
  try {
    await deleteReportFolder(folder.settingId)
    if (selectedFolderId.value === folder.id) selectedFolderId.value = 'all'
    await loadAll()
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('reports.folderDeleted', 'Folder deleted.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('reports.failedDeleteFolder', 'Failed to delete folder.'),
      life: 4000,
    })
  }
}

function confirmDeleteReport(report: ReportWithSetting): void {
  confirm.require({
    message: t('reports.deleteReportConfirm', 'Delete report "{name}"?', {
      name: report.title,
    }),
    header: t('reports.deleteReport', 'Delete report'),
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => {
      void removeReport(report)
    },
  })
}

async function removeReport(report: ReportWithSetting): Promise<void> {
  try {
    await deleteReport(report.settingId)
    await loadAll()
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('reports.reportDeleted', 'Report deleted.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('reports.failedDeleteReport', 'Failed to delete report.'),
      life: 4000,
    })
  }
}
</script>

<template>
  <section class="setup-reports-tab mt-6 grid gap-4">
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 class="m-0">{{ t('setup.reports.title', 'Reports') }}</h2>
        <p class="text-muted-color mt-1 mb-0">
          {{
            t(
              'setup.reports.subtitle',
              'Configure pivot reports from registry collections. Link them from Navigation when ready.',
            )
          }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <Button
          :label="t('reports.newFolder', 'New folder')"
          icon="pi pi-folder-plus"
          size="small"
          severity="secondary"
          outlined
          @click="openNewFolderDialog"
        />
        <Button
          :label="t('reports.newReport', 'New report')"
          icon="pi pi-plus"
          size="small"
          @click="openNewReport"
        />
      </div>
    </div>

    <div class="grid gap-4 grid-cols-[minmax(200px,240px)_minmax(0,1fr)] max-[900px]:grid-cols-1">
      <aside class="bg-surface-0 border border-surface-200 rounded-lg p-3 grid gap-2 content-start">
        <button
          type="button"
          class="text-left border-0 rounded-md px-3 py-2 cursor-pointer"
          :class="selectedFolderId === 'all' ? 'bg-primary-50 text-primary font-semibold' : 'bg-transparent text-surface-700'"
          @click="selectedFolderId = 'all'"
        >
          {{ t('reports.allReports', 'All reports') }}
          <span class="text-muted-color ml-1">({{ folderCounts.all }})</span>
        </button>
        <button
          type="button"
          class="text-left border-0 rounded-md px-3 py-2 cursor-pointer"
          :class="selectedFolderId === 'unfiled' ? 'bg-primary-50 text-primary font-semibold' : 'bg-transparent text-surface-700'"
          @click="selectedFolderId = 'unfiled'"
        >
          {{ t('reports.unfiled', 'Unfiled') }}
          <span class="text-muted-color ml-1">({{ folderCounts.unfiled }})</span>
        </button>
        <div class="border-t border-surface-200 my-1" />
        <p class="text-muted-color text-[0.75rem] uppercase m-0 px-3">
          {{ t('reports.folders', 'Folders') }}
        </p>
        <p v-if="folders.length === 0" class="text-muted-color text-[0.85rem] m-0 px-3">
          {{ t('reports.noFolders', 'No folders yet.') }}
        </p>
        <div
          v-for="folder in folders"
          :key="folder.settingId"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1"
        >
          <button
            type="button"
            class="text-left border-0 rounded-md px-3 py-2 cursor-pointer truncate"
            :class="selectedFolderId === folder.id ? 'bg-primary-50 text-primary font-semibold' : 'bg-transparent text-surface-700'"
            @click="selectedFolderId = folder.id"
          >
            {{ folder.name }}
            <span class="text-muted-color ml-1">({{ folderCounts.counts.get(folder.id) ?? 0 }})</span>
          </button>
          <Button
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            size="small"
            :aria-label="t('reports.deleteFolder', 'Delete folder')"
            @click="confirmDeleteFolder(folder)"
          />
        </div>
      </aside>

      <section class="bg-surface-0 border border-surface-200 rounded-lg p-4 grid gap-3 min-w-0">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <IconField>
            <InputIcon class="pi pi-search" />
            <InputText
              v-model="searchQuery"
              :placeholder="t('reports.searchReports', 'Search reports…')"
            />
          </IconField>
          <small class="text-muted-color">
            {{
              t('setup.itemCountSortedByName', '{count} Items, Sorted by Name', {
                count: filteredReports.length,
              })
            }}
          </small>
        </div>

        <div v-if="loading" class="page-loading">
          <ProgressSpinner stroke-width="4" />
          <span>{{ t('reports.loadingReports', 'Loading reports...') }}</span>
        </div>

        <DataTable
          v-else
          :value="filteredReports"
          size="small"
          striped-rows
          :paginator="filteredReports.length > 10"
          :rows="10"
        >
          <Column :header="t('reports.reportTitle', 'Report title')">
            <template #body="{ data }">
              <button
                type="button"
                class="text-primary bg-transparent border-0 p-0 cursor-pointer hover:underline font-medium"
                @click="openReport(data)"
              >
                {{ data.title }}
              </button>
            </template>
          </Column>
          <Column field="collection" :header="t('reports.sourceCollection', 'Source collection')" />
          <Column :header="t('reports.folder', 'Folder')">
            <template #body="{ data }">
              {{ folderLabel(data.config.folderId) }}
            </template>
          </Column>
          <Column :header="t('common.edit', 'Edit')" style="width: 7rem">
            <template #body="{ data }">
              <div class="flex items-center gap-1">
                <Button
                  icon="pi pi-pencil"
                  text
                  rounded
                  size="small"
                  :aria-label="t('common.edit', 'Edit')"
                  @click="openReport(data)"
                />
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  severity="danger"
                  size="small"
                  :aria-label="t('common.delete', 'Delete')"
                  @click="confirmDeleteReport(data)"
                />
              </div>
            </template>
          </Column>
          <template #empty>
            <p class="text-muted-color m-0 py-4 text-center">
              {{ t('reports.noReportsConfigured', 'No reports configured yet. Create a new report to get started.') }}
            </p>
          </template>
        </DataTable>
      </section>
    </div>

    <Dialog
      v-model:visible="folderDialogVisible"
      modal
      :header="t('reports.newFolder', 'New folder')"
      :style="{ width: 'min(420px, 94vw)' }"
    >
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
        {{ t('reports.folderName', 'Folder name') }}
        <InputText
          v-model="folderName"
          fluid
          :placeholder="t('reports.folderNamePlaceholder', 'Sales')"
          @keyup.enter="saveFolder"
        />
      </label>
      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          text
          severity="secondary"
          @click="folderDialogVisible = false"
        />
        <Button
          :label="t('common.save', 'Save')"
          :loading="folderSaving"
          :disabled="!folderName.trim()"
          @click="saveFolder"
        />
      </template>
    </Dialog>
  </section>
</template>
