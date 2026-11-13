<script lang="ts">
export default {
  name: 'DashboardListPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { formatDateValue } from '@/core/dateFormatting'
import { getOrgDateTimeFormat } from '@/core/orgLocale'
import { loadAppRoles } from '@/core/settingRoleUtils'
import type { AppRoleOption } from '@/interfaces'
import {
  deleteDesignerDashboard,
  listDashboardRows,
  type DashboardListRow,
} from '../services/dashboardDesigner'
import { refreshDashboardSnapshot } from '../services/dashboardSnapshot'

const { t } = useTranslation()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()

const rows = ref<DashboardListRow[]>([])
const roles = ref<AppRoleOption[]>([])
const loading = ref(false)
const refreshingId = ref<string | null>(null)
const searchQuery = ref('')

const filteredRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((row) => {
    const roleLabel = roleLabelFor(row.roleId).toLowerCase()
    return (
      row.name.toLowerCase().includes(q) ||
      roleLabel.includes(q) ||
      (row.note ?? '').toLowerCase().includes(q)
    )
  })
})

onMounted(() => {
  void loadAll()
})

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    const [dashboardRows, roleRows] = await Promise.all([
      listDashboardRows(),
      loadAppRoles(),
    ])
    rows.value = dashboardRows
    roles.value = roleRows
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('dashboard.failedLoad', 'Failed to load dashboards.'),
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

function roleLabelFor(roleId: string | null | undefined): string {
  if (roleId == null || roleId === '') {
    return t('layoutRole.defaultRole', 'Default (all roles)')
  }
  return roles.value.find((role) => role.id === roleId)?.name ?? roleId
}

function formatLastRefreshed(value: string | null | undefined): string {
  if (!value) return t('dashboard.neverRefreshed', 'Never')
  return formatDateValue(value, getOrgDateTimeFormat() || 'yyyy-MM-dd HH:mm') || value
}

function openNewDashboard(): void {
  void router.push({ name: 'setup-dashboard-new' })
}

function openDashboard(row: DashboardListRow): void {
  void router.push({
    name: 'setup-dashboard-edit',
    params: { dashboardId: row.id },
  })
}

function confirmDelete(row: DashboardListRow): void {
  confirm.require({
    message: t('dashboard.deleteConfirm', 'Delete this dashboard and all its panels?'),
    header: t('dashboard.deleteHeader', 'Delete dashboard'),
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => {
      void deleteRow(row)
    },
  })
}

async function deleteRow(row: DashboardListRow): Promise<void> {
  try {
    await deleteDesignerDashboard(row.id)
    rows.value = rows.value.filter((item) => item.id !== row.id)
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('dashboard.deleted', 'Dashboard deleted.'),
      life: 2500,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('dashboard.deleteError', 'Failed to delete dashboard.'),
      life: 4000,
    })
  }
}

async function refreshRow(row: DashboardListRow): Promise<void> {
  refreshingId.value = row.id
  try {
    const result = await refreshDashboardSnapshot(row.id)
    rows.value = rows.value.map((item) =>
      item.id === row.id
        ? {
            ...item,
            sourceSnapshot: result.dashboard.sourceSnapshot,
            lastRefreshedAt: result.lastRefreshedAt,
            panelCount: result.dashboard.panels.length,
          }
        : item,
    )
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('dashboard.refreshSuccess', 'Dashboard data updated.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('dashboard.refreshError', 'Failed to update dashboard data.'),
      life: 4000,
    })
  } finally {
    refreshingId.value = null
  }
}
</script>

<template>
  <section class="setup-dashboards-tab mt-6">
    <div class="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div>
        <h2 class="m-0">{{ t('setup.dashboards.title', 'Dashboards') }}</h2>
        <p class="text-muted-color mt-1 mb-0">
          {{
            t(
              'setup.dashboards.subtitle',
              'Configure dashboards and panels. Link them from Navigation when ready.',
            )
          }}
        </p>
      </div>
      <Button
        :label="t('dashboard.newDashboardButton', 'New dashboard')"
        icon="pi pi-plus"
        size="small"
        @click="openNewDashboard"
      />
    </div>

    <section class="bg-surface-0 border border-surface-200 rounded-lg p-4 grid gap-3 min-w-0">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('dashboard.searchDashboards', 'Search dashboards…')"
          />
        </IconField>
        <small class="text-muted-color">
          {{
            t('setup.itemCountSortedByName', '{count} Items, Sorted by Name', {
              count: filteredRows.length,
            })
          }}
        </small>
      </div>

      <div v-if="loading" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('dashboard.loading', 'Loading dashboards...') }}</span>
      </div>

      <DataTable
        v-else
        :value="filteredRows"
        size="small"
        striped-rows
        :paginator="filteredRows.length > 10"
        :rows="10"
      >
        <Column :header="t('dashboard.name', 'Name')">
          <template #body="{ data }">
            <button
              type="button"
              class="text-primary bg-transparent border-0 p-0 cursor-pointer hover:underline font-medium"
              @click="openDashboard(data)"
            >
              {{ data.name }}
            </button>
          </template>
        </Column>
        <Column :header="t('layoutRole.role', 'Role')">
          <template #body="{ data }">
            {{ roleLabelFor(data.roleId) }}
          </template>
        </Column>
        <Column :header="t('dashboard.lastRefreshed', 'Last refreshed')">
          <template #body="{ data }">
            {{ formatLastRefreshed(data.lastRefreshedAt) }}
          </template>
        </Column>
        <Column :header="t('dashboard.panelsColumn', 'Panels')">
          <template #body="{ data }">
            {{ data.panelCount }}
          </template>
        </Column>
        <Column :header="t('common.edit', 'Edit')" style="width: 9rem">
          <template #body="{ data }">
            <div class="flex items-center gap-1">
              <Button
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                :aria-label="t('common.edit', 'Edit')"
                @click="openDashboard(data)"
              />
              <Button
                icon="pi pi-refresh"
                text
                rounded
                size="small"
                :loading="refreshingId === data.id"
                :aria-label="t('dashboard.updateData', 'Update data')"
                @click="refreshRow(data)"
              />
              <Button
                icon="pi pi-trash"
                text
                rounded
                severity="danger"
                size="small"
                :aria-label="t('common.delete', 'Delete')"
                @click="confirmDelete(data)"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <p class="text-muted-color m-0 py-4 text-center">
            {{
              t(
                'dashboard.noDashboardsConfigured',
                'No dashboards configured yet. Create a new dashboard to get started.',
              )
            }}
          </p>
        </template>
      </DataTable>
    </section>
  </section>
</template>
