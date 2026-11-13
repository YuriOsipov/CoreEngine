<script lang="ts">
export default {
  name: 'DashboardDesignerPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { formatDateValue } from '@/core/dateFormatting'
import { getOrgDateTimeFormat } from '@/core/orgLocale'
import {
  buildRoleSelectOptions,
  loadAppRoles,
  roleIdToSelectValue,
  selectValueToRoleId,
} from '@/core/settingRoleUtils'
import type { AppRoleOption, DashboardPanelType, DashboardRecord } from '@/interfaces'
import DashboardCanvas from '../components/DashboardCanvas.vue'
import PanelOptionsForm from '../components/PanelOptionsForm.vue'
import PanelPalette from '../components/PanelPalette.vue'
import {
  createEmptyDraft,
  createPanelDraft,
  deleteDesignerDashboard,
  listDashboardSummaries,
  loadDesignerDraft,
  saveDesignerDraft,
  type DesignerDashboardDraft,
  type DesignerPanelDraft,
} from '../services/dashboardDesigner'
import { refreshDashboardSnapshot } from '../services/dashboardSnapshot'

const props = withDefaults(
  defineProps<{
    /** When true, omit page chrome for embedding under Setup. */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const isSetupRoute = computed(
  () =>
    route.name === 'setup-dashboard-new' ||
    route.name === 'setup-dashboard-edit' ||
    props.embedded,
)
const isNewSetup = computed(() => route.name === 'setup-dashboard-new')

const summaries = ref<DashboardRecord[]>([])
const draft = ref<DesignerDashboardDraft>(createEmptyDraft())
const selectedPanelId = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const refreshing = ref(false)
const roleOptions = ref<AppRoleOption[]>([])

const dashboardOptions = computed(() =>
  summaries.value.map((d) => ({ label: d.name, value: d.id })),
)

const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(
    roleOptions.value,
    t('layoutRole.defaultRole', 'Default (all roles)'),
  ),
)

const selectedPanel = computed(
  () => draft.value.panels.find((p) => p.id === selectedPanelId.value) ?? null,
)

const canSave = computed(
  () => Boolean(draft.value.name.trim()) && !saving.value && !loading.value,
)

const lastRefreshedLabel = computed(() => {
  const value = draft.value.lastRefreshedAt
  if (!value) return t('dashboard.neverRefreshed', 'Never')
  return formatDateValue(value, getOrgDateTimeFormat() || 'yyyy-MM-dd HH:mm') || value
})

onMounted(async () => {
  roleOptions.value = await loadAppRoles()
  if (!isSetupRoute.value) {
    await reloadSummaries()
  }
  await bootstrapFromRoute()
})

watch(
  () => [route.name, route.params.dashboardId, route.query.id] as const,
  async () => {
    await bootstrapFromRoute()
  },
)

async function bootstrapFromRoute(): Promise<void> {
  if (route.name === 'setup-dashboard-new') {
    startNew(false)
    return
  }
  const paramId =
    typeof route.params.dashboardId === 'string' ? route.params.dashboardId : null
  const queryId = typeof route.query.id === 'string' ? route.query.id : null
  const id = paramId || queryId
  if (id) {
    if (id !== draft.value.id) await selectDashboard(id, false)
    return
  }
  if (!isSetupRoute.value && summaries.value[0]) {
    await selectDashboard(summaries.value[0].id, true)
  } else if (!isSetupRoute.value) {
    startNew(false)
  }
}

async function reloadSummaries(): Promise<void> {
  summaries.value = await listDashboardSummaries()
}

function startNew(syncRoute: boolean): void {
  draft.value = createEmptyDraft()
  draft.value.name = t('dashboard.newDashboardName', 'New dashboard')
  draft.value.dirty = true
  selectedPanelId.value = null
  if (syncRoute && !isSetupRoute.value) {
    void router.replace({ name: 'dashboard-design', query: {} })
  }
}

async function selectDashboard(id: string, syncQuery: boolean): Promise<void> {
  loading.value = true
  try {
    draft.value = await loadDesignerDraft(id)
    selectedPanelId.value = draft.value.panels[0]?.id ?? null
    if (syncQuery && !isSetupRoute.value && route.query.id !== id) {
      await router.replace({ name: 'dashboard-design', query: { id } })
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('dashboard.loadDesignerError', 'Failed to load dashboard.'),
      life: 4000,
    })
    if (isSetupRoute.value) {
      void router.replace({ name: 'setup-dashboards' })
    }
  } finally {
    loading.value = false
  }
}

function markDirty(): void {
  draft.value.dirty = true
}

function onMetaName(value: string | undefined): void {
  draft.value.name = String(value ?? '')
  markDirty()
}

function onMetaNote(value: string | undefined): void {
  draft.value.note = String(value ?? '') || null
  markDirty()
}

function onMetaColor(value: string | undefined): void {
  draft.value.color = String(value ?? '') || null
  markDirty()
}

function onMetaIcon(value: string | undefined): void {
  draft.value.icon = String(value ?? '') || null
  markDirty()
}

function onMetaRole(value: unknown): void {
  draft.value.roleId = selectValueToRoleId(value)
  markDirty()
}

function addPanel(type: DashboardPanelType): void {
  const panel = createPanelDraft(type, draft.value.id, draft.value.panels)
  draft.value.panels = [...draft.value.panels, panel]
  selectedPanelId.value = panel.id
  markDirty()
}

function updatePanel(panel: DesignerPanelDraft): void {
  draft.value.panels = draft.value.panels.map((p) =>
    p.id === panel.id ? panel : p,
  )
  markDirty()
}

function removePanel(id: string): void {
  const panel = draft.value.panels.find((p) => p.id === id)
  draft.value.panels = draft.value.panels.filter((p) => p.id !== id)
  if (panel && !panel._isNew) {
    draft.value.deletedPanelIds = [...draft.value.deletedPanelIds, id]
  }
  if (selectedPanelId.value === id) selectedPanelId.value = null
  markDirty()
}

async function save(): Promise<void> {
  saving.value = true
  try {
    draft.value = await saveDesignerDraft(draft.value)
    selectedPanelId.value =
      draft.value.panels.find((p) => p.id === selectedPanelId.value)?.id ??
      draft.value.panels[0]?.id ??
      null
    if (!isSetupRoute.value) {
      await reloadSummaries()
      await router.replace({
        name: 'dashboard-design',
        query: { id: draft.value.id ?? undefined },
      })
    } else if (draft.value.id) {
      await router.replace({
        name: 'setup-dashboard-edit',
        params: { dashboardId: draft.value.id },
      })
    }
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('dashboard.saved', 'Dashboard saved.'),
      life: 2500,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('dashboard.saveError', 'Failed to save dashboard.'),
      life: 4000,
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(): void {
  if (!draft.value.id) {
    if (isSetupRoute.value) {
      void router.push({ name: 'setup-dashboards' })
    } else {
      startNew(true)
    }
    return
  }
  confirm.require({
    message: t('dashboard.deleteConfirm', 'Delete this dashboard and all its panels?'),
    header: t('dashboard.deleteHeader', 'Delete dashboard'),
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => {
      void deleteCurrent()
    },
  })
}

async function deleteCurrent(): Promise<void> {
  if (!draft.value.id) return
  deleting.value = true
  try {
    await deleteDesignerDashboard(draft.value.id)
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('dashboard.deleted', 'Dashboard deleted.'),
      life: 2500,
    })
    if (isSetupRoute.value) {
      await router.push({ name: 'setup-dashboards' })
      return
    }
    await reloadSummaries()
    if (summaries.value[0]) {
      await selectDashboard(summaries.value[0].id, true)
    } else {
      startNew(true)
    }
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
  } finally {
    deleting.value = false
  }
}

async function refreshData(): Promise<void> {
  if (!draft.value.id) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('dashboard.refreshSaveFirst', 'Save the dashboard before updating data.'),
      life: 3000,
    })
    return
  }
  refreshing.value = true
  try {
    const result = await refreshDashboardSnapshot(draft.value.id)
    draft.value.lastRefreshedAt = result.lastRefreshedAt
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
    refreshing.value = false
  }
}

function onSelectDashboard(id: string | null): void {
  if (!id) return
  void selectDashboard(id, true)
}

function backToList(): void {
  void router.push({ name: 'setup-dashboards' })
}
</script>

<template>
  <component
    :is="isSetupRoute ? 'section' : 'main'"
    :class="isSetupRoute ? 'setup-dashboards-tab mt-6' : 'app-shell dashboard-designer'"
  >
    <header :class="isSetupRoute ? 'mb-4' : 'app-header'">
      <div
        class="app-header__row"
        :class="{ 'items-start gap-3': isSetupRoute }"
      >
        <div>
          <Button
            v-if="isSetupRoute"
            :label="t('dashboard.backToList', 'Back to dashboards')"
            icon="pi pi-arrow-left"
            text
            size="small"
            class="mb-2 px-0"
            @click="backToList"
          />
          <component :is="isSetupRoute ? 'h2' : 'h1'" class="m-0">
            {{
              isSetupRoute
                ? isNewSetup
                  ? t('dashboard.newDashboardButton', 'New dashboard')
                  : draft.name || t('setup.dashboards.title', 'Dashboards')
                : t('dashboard.designerTitle', 'Dashboard designer')
            }}
          </component>
          <p :class="isSetupRoute ? 'text-muted-color mt-1 mb-0' : undefined">
            {{
              isSetupRoute
                ? t(
                    'setup.dashboards.subtitle',
                    'Configure dashboards and panels. Link them from Navigation when ready.',
                  )
                : t(
                    'dashboard.designerSubtitle',
                    'Arrange Directus-compatible panels on a 60-column grid.',
                  )
            }}
          </p>
          <p class="text-muted-color text-sm mt-1 mb-0">
            {{
              t('dashboard.lastRefreshedLabel', 'Last refreshed: {value}', {
                value: lastRefreshedLabel,
              })
            }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Select
            v-if="!isSetupRoute"
            :model-value="draft.id"
            :options="dashboardOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('dashboard.selectDashboard', 'Select dashboard')"
            class="min-w-[12rem]"
            :disabled="loading"
            @update:model-value="onSelectDashboard"
          />
          <Button
            v-if="!isSetupRoute"
            :label="t('dashboard.newDashboard', 'New')"
            size="small"
            severity="secondary"
            outlined
            :disabled="loading || saving"
            @click="startNew(true)"
          />
          <Button
            :label="t('dashboard.updateData', 'Update data')"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            outlined
            :loading="refreshing"
            :disabled="loading || saving || !draft.id"
            @click="refreshData"
          />
          <Button
            :label="t('common.save', 'Save')"
            size="small"
            :loading="saving"
            :disabled="!canSave"
            @click="save"
          />
          <Button
            :label="t('common.delete', 'Delete')"
            size="small"
            severity="danger"
            outlined
            :loading="deleting"
            :disabled="loading || saving"
            @click="confirmDelete"
          />
          <RouterLink
            class="nav-link"
            :to="draft.id ? { name: 'dashboards', query: { id: draft.id } } : { name: 'dashboards' }"
          >
            {{ t('dashboard.viewDashboard', 'View dashboard') }}
          </RouterLink>
        </div>
      </div>
    </header>

    <section v-if="loading" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('dashboard.loadingDesigner', 'Loading designer...') }}</span>
    </section>

    <section v-else class="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_16rem]">
      <PanelPalette @add="addPanel" />

      <div class="flex min-w-0 flex-col gap-3">
        <Card>
          <template #content>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="flex flex-col gap-1 sm:col-span-2">
                <label class="text-xs text-gray-500">{{ t('dashboard.name', 'Name') }}</label>
                <InputText
                  :model-value="draft.name"
                  class="w-full"
                  @update:model-value="onMetaName"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-gray-500">{{ t('layoutRole.role', 'Role') }}</label>
                <Select
                  :model-value="roleIdToSelectValue(draft.roleId)"
                  :options="roleSelectOptions"
                  option-label="label"
                  option-value="value"
                  class="w-full"
                  @update:model-value="onMetaRole"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-gray-500">{{ t('dashboard.icon', 'Icon') }}</label>
                <InputText
                  :model-value="draft.icon ?? ''"
                  class="w-full"
                  @update:model-value="onMetaIcon"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-gray-500">{{ t('dashboard.color', 'Color') }}</label>
                <InputText
                  :model-value="draft.color ?? ''"
                  class="w-full"
                  placeholder="#6D5DF6"
                  @update:model-value="onMetaColor"
                />
              </div>
              <div class="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                <label class="text-xs text-gray-500">{{ t('dashboard.note', 'Note') }}</label>
                <InputText
                  :model-value="draft.note ?? ''"
                  class="w-full"
                  @update:model-value="onMetaNote"
                />
              </div>
            </div>
          </template>
        </Card>

        <DashboardCanvas
          :panels="draft.panels"
          :selected-id="selectedPanelId"
          @select="selectedPanelId = $event"
          @update="updatePanel"
          @remove="removePanel"
        />
      </div>

      <PanelOptionsForm :panel="selectedPanel" @update="updatePanel" />
    </section>
  </component>
</template>
