<script lang="ts">
export default {
  name: 'NavigationSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { loadAppRoles } from '@/core/settingRoleUtils'
import type { AppRoleOption, SavedNavigationApp } from '@/interfaces'
import {
  deleteNavigationApp,
  loadNavigationApps,
} from '@/core/navigation/navigationService'
import { useNavigationMenu } from '@/core/navigation/useNavigationMenu'
import SetupPageHeader from '../components/setup/SetupPageHeader.vue'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()
const { reload: reloadLiveMenu } = useNavigationMenu()

const rows = ref<SavedNavigationApp[]>([])
const roleOptions = ref<AppRoleOption[]>([])
const loading = ref(false)
const deletingId = ref<string | null>(null)
const searchQuery = ref('')

const defaultRoleLabel = computed(() => t('layoutRole.defaultRole', 'Default (all roles)'))

const filteredRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((row) => {
    const roleLabel = roleLabelFor(row).toLowerCase()
    return (
      row.name.toLowerCase().includes(q) ||
      row.label.toLowerCase().includes(q) ||
      roleLabel.includes(q)
    )
  })
})

const itemSummary = computed(() =>
  t('setup.itemCountSortedByName', '{count} Items, Sorted by Name', {
    count: filteredRows.value.length,
  }),
)

onMounted(() => {
  void loadAll()
})

watch(
  () => route.fullPath,
  () => {
    if (route.name === 'setup-navigation') void loadAll()
  },
)

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    const [appList, roles] = await Promise.all([loadNavigationApps(), loadAppRoles()])
    rows.value = appList
    roleOptions.value = roles
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('navigation.loadError', 'Failed to load navigation apps.'),
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

function roleLabelFor(row: SavedNavigationApp): string {
  if (row.roleId == null || row.roleId === '') {
    return defaultRoleLabel.value
  }
  return (
    row.roleName ??
    roleOptions.value.find((role) => role.id === row.roleId)?.name ??
    row.roleId
  )
}

function displayName(row: SavedNavigationApp): string {
  return row.label || row.name || t('navigation.untitledItem', 'Untitled')
}

function openNewApp(): void {
  void router.push({ name: 'setup-navigation-new' })
}

function openApp(row: SavedNavigationApp): void {
  void router.push({ name: 'setup-navigation-edit', params: { appId: row.id } })
}

function confirmDelete(row: SavedNavigationApp): void {
  confirm.require({
    message: t('navigation.deleteConfirm', 'Delete this navigation app?'),
    header: t('navigation.deleteApp', 'Delete navigation app'),
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: t('common.cancel', 'Cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('common.delete', 'Delete'), severity: 'danger' },
    accept: () => void deleteRow(row),
  })
}

async function deleteRow(row: SavedNavigationApp): Promise<void> {
  deletingId.value = row.id
  try {
    await deleteNavigationApp(row.id)
    rows.value = rows.value.filter((item) => item.id !== row.id)
    await reloadLiveMenu()
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('navigation.deleted', 'Navigation app deleted.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('navigation.deleteError', 'Failed to delete navigation app.'),
      life: 4000,
    })
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <section class="setup-tab-content">
    <SetupPageHeader
      :title="t('navigation.listTitle', 'Navigation')"
      :meta="itemSummary"
      icon-class="pi pi-sitemap"
    >
      <template #actions>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
            :disabled="loading"
          />
        </IconField>
        <Button
          :label="t('navigation.newApp', 'New app')"
          icon="pi pi-plus"
          :disabled="loading"
          @click="openNewApp"
        />
      </template>
    </SetupPageHeader>

    <p class="text-muted-color mt-0 mb-4">
      {{
        t(
          'navigation.listSubtitle',
          'Build role-scoped navigation apps with folders, links, dashboards, and reports.',
        )
      }}
    </p>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('navigation.loading', 'Loading navigation apps...') }}</span>
    </div>

    <DataTable
      v-else
      :value="filteredRows"
      striped-rows
      table-style="table-layout: fixed; width: 100%"
      :empty-message="t('navigation.emptyList', 'No navigation apps yet. Create one to get started.')"
    >
      <Column
        field="name"
        :header="t('navigation.columnName', 'Name')"
        sortable
      >
        <template #body="{ data }">
          <RouterLink
            :to="{ name: 'setup-navigation-edit', params: { appId: data.id } }"
            class="setup-link"
          >
            {{ displayName(data) }}
          </RouterLink>
        </template>
      </Column>
      <Column
        :header="t('layoutRole.role', 'Role')"
        sortable
      >
        <template #body="{ data }">
          {{ roleLabelFor(data) }}
        </template>
      </Column>
      <Column
        field="isDefault"
        :header="t('navigation.columnDefault', 'Default')"
        style="width: 8rem"
        header-style="width: 8rem"
      >
        <template #body="{ data }">
          <i
            v-if="data.isDefault"
            class="pi pi-check text-primary"
            :aria-label="t('navigation.defaultForRole', 'Default for role')"
          />
          <span
            v-else
            class="text-muted-color"
          >—</span>
        </template>
      </Column>
      <Column
        :header="t('navigation.columnActions', 'Actions')"
        style="width: 7rem"
        header-style="width: 7rem"
      >
        <template #body="{ data }">
          <div class="flex items-center gap-1">
            <Button
              icon="pi pi-pencil"
              text
              rounded
              size="small"
              :aria-label="t('common.edit', 'Edit')"
              @click="openApp(data)"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              size="small"
              :loading="deletingId === data.id"
              :aria-label="t('common.delete', 'Delete')"
              @click="confirmDelete(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </section>
</template>
