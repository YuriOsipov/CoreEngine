<script lang="ts">
export default {
  name: 'NavigationDesigner',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  buildRoleSelectOptions,
  loadAppRoles,
  roleIdToSelectValue,
  selectValueToRoleId,
} from '@/core/settingRoleUtils'
import type { AppRoleOption, NavItem, NavLink, NavigationApp } from '@/interfaces'
import {
  createDefaultNavigationApp,
  deleteNavigationApp,
  loadNavigationAppById,
  loadNavigationApps,
  saveNavigationApp,
} from '@/core/navigation/navigationService'
import { useNavigationMenu } from '@/core/navigation/useNavigationMenu'
import NavTreeNode from './NavTreeNode.vue'
import NavItemEditor from './NavItemEditor.vue'
import { createNavFolder, createNavLink } from './navigationItemFactory'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()
const { reload: reloadLiveMenu } = useNavigationMenu()

const app = ref<NavigationApp>(createDefaultNavigationApp())
const roleOptions = ref<AppRoleOption[]>([])
const selectedRecordId = ref<string | null>(null)
const appName = ref('')
const roleId = ref<string | null>(null)
const isDefault = ref(false)

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)

const editorVisible = ref(false)
const editingItem = ref<NavItem | null>(null)
const editingHome = ref(false)
const homeProxy = ref<NavLink | null>(null)

const defaultRoleLabel = computed(() => t('layoutRole.defaultRole', 'Default (all roles)'))
const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(roleOptions.value, defaultRoleLabel.value),
)
const canSave = computed(() => Boolean(appName.value.trim()) && !saving.value && !loading.value)
const canDelete = computed(() => Boolean(selectedRecordId.value) && !deleting.value)
const isNewRoute = computed(() => route.name === 'setup-navigation-new')

onMounted(async () => {
  roleOptions.value = await loadAppRoles()
  await bootstrapFromRoute()
})

watch(
  () => [route.name, route.params.appId] as const,
  async () => {
    await bootstrapFromRoute()
  },
)

async function bootstrapFromRoute(): Promise<void> {
  if (isNewRoute.value) {
    startNewApp()
    return
  }
  const appId = typeof route.params.appId === 'string' ? route.params.appId : null
  if (appId) {
    await selectApp(appId)
    return
  }
  startNewApp()
}

async function selectApp(recordId: string): Promise<void> {
  loading.value = true
  try {
    const [loaded, apps] = await Promise.all([
      loadNavigationAppById(recordId),
      loadNavigationApps(),
    ])
    if (!loaded) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: t('navigation.loadError', 'Failed to load navigation apps.'),
        life: 4000,
      })
      void router.replace({ name: 'setup-navigation' })
      return
    }
    const meta = apps.find((entry) => entry.id === recordId)
    app.value = loaded
    selectedRecordId.value = recordId
    appName.value = meta?.name || loaded.label || loaded.name
    roleId.value = meta?.roleId ?? null
    isDefault.value = meta?.isDefault ?? loaded.isDefault === true
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
    void router.replace({ name: 'setup-navigation' })
  } finally {
    loading.value = false
  }
}

function startNewApp(): void {
  loading.value = false
  app.value = createDefaultNavigationApp('')
  selectedRecordId.value = null
  appName.value = ''
  roleId.value = null
  isDefault.value = false
}

async function openEditor(item: NavItem): Promise<void> {
  editingHome.value = false
  editingItem.value = item
  await nextTick()
  editorVisible.value = true
}

function addTopLink(): void {
  const link = createNavLink()
  app.value.items.push(link)
  void openEditor(link)
}

function addTopFolder(): void {
  const folder = createNavFolder()
  app.value.items.push(folder)
  void openEditor(folder)
}

async function openHomeEditor(): Promise<void> {
  homeProxy.value = {
    id: '__home__',
    type: 'link',
    label: t('navigation.home', 'Home'),
    // app.home is a Vue proxy; structuredClone needs a plain object
    target: structuredClone(toRaw(app.value.home)),
  }
  editingHome.value = true
  editingItem.value = homeProxy.value
  await nextTick()
  editorVisible.value = true
}

function handleEditorVisibility(visible: boolean): void {
  editorVisible.value = visible
  if (!visible) {
    editingHome.value = false
    homeProxy.value = null
    editingItem.value = null
  }
}

function applyEditorSave(updated: NavItem): void {
  if (editingHome.value) {
    if (updated.type === 'link') {
      app.value.home = updated.target
    }
    editingHome.value = false
    homeProxy.value = null
    editingItem.value = null
    return
  }

  const current = editingItem.value
  if (!current || current.id !== updated.id) {
    editingItem.value = null
    return
  }

  current.label = updated.label
  current.icon = updated.icon
  if (current.type === 'link' && updated.type === 'link') {
    current.target = updated.target
  } else if (current.type === 'folder' && updated.type === 'folder') {
    current.collapsed = updated.collapsed
  }
  editingItem.value = null
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  try {
    app.value.name = appName.value.trim()
    app.value.label = appName.value.trim()
    const wasNew = !selectedRecordId.value
    const saved = await saveNavigationApp(app.value, {
      recordId: selectedRecordId.value,
      name: appName.value.trim(),
      roleId: roleId.value,
      isDefault: isDefault.value,
    })
    selectedRecordId.value = saved.id
    app.value = {
      ...app.value,
      name: saved.name,
      label: saved.label,
      isDefault: saved.isDefault,
    }
    roleId.value = saved.roleId
    isDefault.value = saved.isDefault
    await reloadLiveMenu()
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('navigation.saved', 'Navigation app saved.'),
      life: 3000,
    })
    if (wasNew || isNewRoute.value) {
      await router.replace({
        name: 'setup-navigation-edit',
        params: { appId: saved.id },
      })
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('navigation.saveError', 'Failed to save navigation app.'),
      life: 4000,
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(): void {
  if (!selectedRecordId.value) return
  confirm.require({
    message: t('navigation.deleteConfirm', 'Delete this navigation app?'),
    header: t('navigation.deleteApp', 'Delete navigation app'),
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: t('common.cancel', 'Cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('common.delete', 'Delete'), severity: 'danger' },
    accept: () => void remove(),
  })
}

async function remove(): Promise<void> {
  if (!selectedRecordId.value) return
  deleting.value = true
  try {
    await deleteNavigationApp(selectedRecordId.value)
    selectedRecordId.value = null
    await reloadLiveMenu()
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('navigation.deleted', 'Navigation app deleted.'),
      life: 3000,
    })
    void router.push({ name: 'setup-navigation' })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('navigation.deleteError', 'Failed to delete navigation app.'),
      life: 4000,
    })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('navigation.loading', 'Loading navigation apps...') }}</span>
    </div>

    <template v-else>
      <div class="flex items-end flex-wrap gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-ink text-[0.8rem] font-semibold">
            {{ t('navigation.appName', 'App name') }}
          </label>
          <InputText v-model="appName" class="min-w-[220px]" />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-ink text-[0.8rem] font-semibold">
            {{ t('layoutRole.role', 'Role') }}
          </label>
          <Select
            :model-value="roleIdToSelectValue(roleId)"
            :options="roleSelectOptions"
            option-label="label"
            option-value="value"
            class="min-w-[220px]"
            @update:model-value="roleId = selectValueToRoleId($event)"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-ink text-[0.8rem] font-semibold">
            {{ t('navigation.defaultForRole', 'Default for role') }}
          </label>
          <ToggleSwitch v-model="isDefault" />
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            :label="t('common.delete', 'Delete')"
            size="small"
            severity="danger"
            text
            :disabled="!canDelete"
            :loading="deleting"
            @click="confirmDelete"
          />
          <Button
            :label="t('common.save', 'Save')"
            size="small"
            :loading="saving"
            :disabled="!canSave"
            @click="save"
          />
        </div>
      </div>

      <div class="bg-canvas border border-line rounded-lg flex items-center gap-3 p-3 text-ink">
        <i class="pi pi-home text-muted-color" />
        <div class="flex-1">
          <div class="font-semibold">{{ t('navigation.home', 'Home') }}</div>
          <div class="text-muted-color text-[0.8rem]">
            {{ t('navigation.homeHint', 'Fixed landing shown after login for this app.') }}
          </div>
        </div>
        <Button
          icon="pi pi-pencil"
          :label="t('navigation.configureHome', 'Configure home')"
          size="small"
          text
          @click="openHomeEditor"
        />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <h3 class="m-0">{{ t('navigation.structure', 'Navigation structure') }}</h3>
          <div class="flex gap-2">
            <Button
              icon="pi pi-plus"
              :label="t('navigation.addLink', 'Add link')"
              size="small"
              text
              @click="addTopLink"
            />
            <Button
              icon="pi pi-folder-plus"
              :label="t('navigation.addFolder', 'Add folder')"
              size="small"
              text
              @click="addTopFolder"
            />
          </div>
        </div>

        <Message
          v-if="app.items.length === 0"
          severity="info"
          :closable="false"
        >
          {{ t('navigation.emptyStructure', 'Add folders and links to build this navigation app.') }}
        </Message>

        <NavTreeNode
          v-else
          :items="app.items"
          :depth="1"
          class="flex flex-col gap-2"
          @edit="openEditor"
        />
      </div>
    </template>

    <NavItemEditor
      :visible="editorVisible"
      :item="editingItem"
      @update:visible="handleEditorVisibility"
      @save="applyEditorSave"
    />
  </div>
</template>
