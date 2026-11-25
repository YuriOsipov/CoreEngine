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
import { getEffectiveSetupAccess } from '@/core/setupAccess'
import { buildHierarchyTreeNodes, type HierarchyTreeNode } from '@/core/hierarchyTree'
import { loadAppRoles } from '@/core/settingRoleUtils'
import { useTranslation } from '@/core/translation'
import type { AppRoleOption } from '@/interfaces'
import {
  collectReportFolderDescendantIds,
  deleteReport,
  deleteReportFolder,
  listReportFolders,
  listReportsForAuthoring,
  reportFolderDepth,
  reportFolderPathLabel,
  REPORT_FOLDER_MAX_DEPTH,
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
const roles = ref<AppRoleOption[]>([])
const loading = ref(false)
const isAdmin = ref(false)
const canAuthor = ref(false)
const searchQuery = ref('')
const selectedFolderId = ref<string | 'all' | 'unfiled'>('all')
const folderDialogVisible = ref(false)
const folderName = ref('')
const folderParentId = ref<string | null>(null)
const folderSaving = ref(false)
const expandedFolderIds = ref<Set<string>>(new Set())

interface FolderTreeRow {
  folder: ReportFolder
  depth: number
  hasChildren: boolean
}

const folderTree = computed(() =>
  buildHierarchyTreeNodes(
    folders.value.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      settingId: folder.settingId,
    })),
    {
      primaryKey: 'id',
      labelField: 'name',
      parentField: 'parentId',
    },
  ),
)

const folderTreeRows = computed(() => {
  const rows: FolderTreeRow[] = []
  const walk = (nodes: HierarchyTreeNode[], depth: number) => {
    for (const node of nodes) {
      const folder = folders.value.find((item) => item.id === node.key)
      if (!folder) continue
      const children = node.children ?? []
      rows.push({
        folder,
        depth,
        hasChildren: children.length > 0,
      })
      if (children.length > 0 && expandedFolderIds.value.has(folder.id)) {
        walk(children, depth + 1)
      }
    }
  }
  walk(folderTree.value, 0)
  return rows
})

const folderParentOptions = computed(() => {
  const options: Array<{ label: string; value: string | null }> = [
    { label: t('reports.rootFolder', 'Root (no parent)'), value: null },
  ]
  for (const folder of folders.value) {
    if (reportFolderDepth(folders.value, folder.id) >= REPORT_FOLDER_MAX_DEPTH) continue
    options.push({
      label: reportFolderPathLabel(folders.value, folder.id, folder.name),
      value: folder.id,
    })
  }
  return options
})

const folderCounts = computed(() => {
  const direct = new Map<string, number>()
  let unfiled = 0
  for (const report of reports.value) {
    const folderId = report.config.folderId
    if (!folderId) {
      unfiled += 1
      continue
    }
    direct.set(folderId, (direct.get(folderId) ?? 0) + 1)
  }

  const withDescendants = new Map<string, number>()
  for (const folder of folders.value) {
    const ids = collectReportFolderDescendantIds(folders.value, folder.id)
    let total = 0
    for (const id of ids) total += direct.get(id) ?? 0
    withDescendants.set(folder.id, total)
  }

  return { direct, withDescendants, unfiled, all: reports.value.length }
})

const filteredReports = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const selected = selectedFolderId.value
  const selectedDescendants =
    selected !== 'all' && selected !== 'unfiled'
      ? collectReportFolderDescendantIds(folders.value, selected)
      : null

  return reports.value.filter((report) => {
    if (selected === 'unfiled' && report.config.folderId) return false
    if (selectedDescendants) {
      const folderId = report.config.folderId
      if (!folderId || !selectedDescendants.has(folderId)) return false
    }
    if (!q) return true
    const folderName = folderLabel(report.config.folderId)
    const roleName = roleLabelFor(report.roleId)
    return (
      report.title.toLowerCase().includes(q) ||
      report.name.toLowerCase().includes(q) ||
      report.collection.toLowerCase().includes(q) ||
      folderName.toLowerCase().includes(q) ||
      roleName.toLowerCase().includes(q)
    )
  })
})

onMounted(() => {
  void loadAll()
})

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    const access = await getEffectiveSetupAccess()
    isAdmin.value = access.isFullSetupAdmin
    canAuthor.value = access.canAuthorReports
    if (!access.canOpenSetup) {
      reports.value = []
      folders.value = []
      roles.value = []
      toast.add({
        severity: 'warn',
        summary: t('common.error', 'Error'),
        detail: t(
          'setup.reports.authorAccessRequired',
          'You do not have permission to manage reports.',
        ),
        life: 4000,
      })
      return
    }
    const [reportRows, folderRows, roleRows] = await Promise.all([
      listReportsForAuthoring(),
      listReportFolders(),
      loadAppRoles(),
    ])
    reports.value = reportRows
    folders.value = folderRows
    roles.value = roleRows
    // Keep only expansions for folders that still exist (folders stay collapsed by default).
    const validIds = new Set(folderRows.map((folder) => folder.id))
    expandedFolderIds.value = new Set(
      [...expandedFolderIds.value].filter((id) => validIds.has(id)),
    )
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
  return reportFolderPathLabel(folders.value, folderId) || folderId
}

function roleLabelFor(roleId: string | null | undefined): string {
  if (roleId == null || roleId === '') {
    return t('layoutRole.defaultRole', 'Default (all roles)')
  }
  return roles.value.find((role) => role.id === roleId)?.name ?? roleId
}

function toggleFolderExpanded(folderId: string): void {
  const next = new Set(expandedFolderIds.value)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  expandedFolderIds.value = next
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
  const selected = selectedFolderId.value
  if (
    typeof selected === 'string' &&
    selected !== 'all' &&
    selected !== 'unfiled' &&
    reportFolderDepth(folders.value, selected) < REPORT_FOLDER_MAX_DEPTH
  ) {
    folderParentId.value = selected
  } else {
    folderParentId.value = null
  }
  folderDialogVisible.value = true
}

async function saveFolder(): Promise<void> {
  const name = folderName.value.trim()
  if (!name) return
  folderSaving.value = true
  try {
    const saved = await saveReportFolder({
      name,
      parentId: folderParentId.value,
    })
    folderDialogVisible.value = false
    if (saved.parentId) {
      const next = new Set(expandedFolderIds.value)
      next.add(saved.parentId)
      expandedFolderIds.value = next
    }
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
      'reports.deleteFolderConfirmNested',
      'Delete folder "{name}"? Reports in it will become unfiled. Subfolders move up one level.',
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
              'Configure pivot and tabular reports from registry collections. Link them to roles and Navigation when ready.',
            )
          }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <Button
          v-if="isAdmin"
          :label="t('reports.newFolder', 'New folder')"
          icon="pi pi-folder-plus"
          size="small"
          severity="secondary"
          outlined
          @click="openNewFolderDialog"
        />
        <Button
          v-if="canAuthor"
          :label="t('reports.newReport', 'New report')"
          icon="pi pi-plus"
          size="small"
          @click="openNewReport"
        />
      </div>
    </div>

    <div class="grid gap-4 grid-cols-[minmax(200px,260px)_minmax(0,1fr)] max-[900px]:grid-cols-1">
      <aside class="bg-panel border border-line rounded-lg p-3 grid gap-2 content-start">
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
        <div class="border-t border-line my-1" />
        <p class="text-muted-color text-[0.75rem] uppercase m-0 px-3">
          {{ t('reports.folders', 'Folders') }}
        </p>
        <p v-if="folders.length === 0" class="text-muted-color text-[0.85rem] m-0 px-3">
          {{ t('reports.noFolders', 'No folders yet.') }}
        </p>
        <div
          v-for="row in folderTreeRows"
          :key="row.folder.settingId"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1"
          :style="{ paddingLeft: `${row.depth * 0.75}rem` }"
        >
          <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-0.5 min-w-0">
            <Button
              v-if="row.hasChildren"
              :icon="expandedFolderIds.has(row.folder.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
              text
              rounded
              size="small"
              class="w-7 h-7"
              :aria-label="t('reports.toggleFolder', 'Expand or collapse folder')"
              @click="toggleFolderExpanded(row.folder.id)"
            />
            <span v-else class="w-7" />
            <button
              type="button"
              class="text-left border-0 rounded-md px-2 py-2 cursor-pointer truncate"
              :class="selectedFolderId === row.folder.id ? 'bg-primary-50 text-primary font-semibold' : 'bg-transparent text-surface-700'"
              @click="selectedFolderId = row.folder.id"
            >
              {{ row.folder.name }}
              <span class="text-muted-color ml-1">
                ({{ folderCounts.withDescendants.get(row.folder.id) ?? 0 }})
              </span>
            </button>
          </div>
          <Button
            v-if="isAdmin"
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            size="small"
            :aria-label="t('reports.deleteFolder', 'Delete folder')"
            @click="confirmDeleteFolder(row.folder)"
          />
        </div>
      </aside>

      <section class="bg-panel border border-line rounded-lg p-4 grid gap-3 min-w-0">
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
          <Column :header="t('layoutRole.role', 'Role')">
            <template #body="{ data }">
              {{ roleLabelFor(data.roleId) }}
            </template>
          </Column>
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
      <div class="grid gap-3">
        <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
          {{ t('reports.folderName', 'Folder name') }}
          <InputText
            v-model="folderName"
            fluid
            :placeholder="t('reports.folderNamePlaceholder', 'Sales')"
            @keyup.enter="saveFolder"
          />
        </label>
        <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
          {{ t('reports.parentFolder', 'Parent folder') }}
          <Select
            v-model="folderParentId"
            :options="folderParentOptions"
            option-label="label"
            option-value="value"
            fluid
            show-clear
            :placeholder="t('reports.rootFolder', 'Root (no parent)')"
          />
        </label>
      </div>
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
