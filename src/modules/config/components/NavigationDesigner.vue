<script lang="ts">
export default {
  name: 'NavigationDesigner',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  buildRoleSelectOptions,
  layoutLabelForRole,
  loadAppRoles,
  roleIdToSelectValue,
  selectValueToRoleId,
} from '@/core/settingRoleUtils'
import type { AppRoleOption, NavItem, NavLink, NavigationApp, SavedNavigationApp } from '@/interfaces'
import {
  createDefaultNavigationApp,
  deleteNavigationApp,
  loadNavigationAppById,
  loadNavigationApps,
  saveNavigationApp,
} from '@/core/navigation/navigationService'
import NavTreeNode from './NavTreeNode.vue'
import NavItemEditor from './NavItemEditor.vue'
import { createNavFolder, createNavLink } from './navigationItemFactory'

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()

const app = ref<NavigationApp>(createDefaultNavigationApp())
const apps = ref<SavedNavigationApp[]>([])
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
const appOptions = computed(() => {
  const roleNameById = new Map(roleOptions.value.map((role) => [role.id, role.name]))
  return apps.value.map((entry) => ({
    label: layoutLabelForRole(
      {
        id: entry.id,
        name: entry.label || entry.name,
        roleId: entry.roleId,
        roleName: entry.roleName ?? (entry.roleId ? roleNameById.get(entry.roleId) ?? null : null),
      },
      defaultRoleLabel.value,
    ),
    value: entry.id,
  }))
})
const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(roleOptions.value, defaultRoleLabel.value),
)
const canSave = computed(() => Boolean(appName.value.trim()) && !saving.value && !loading.value)
const canDelete = computed(() => Boolean(selectedRecordId.value) && !deleting.value)

onMounted(async () => {
  await reloadList()
})

async function reloadList(): Promise<void> {
  loading.value = true
  try {
    const [appList, roles] = await Promise.all([loadNavigationApps(), loadAppRoles()])
    apps.value = appList
    roleOptions.value = roles
    if (selectedRecordId.value) {
      const stillExists = appList.some((entry) => entry.id === selectedRecordId.value)
      if (!stillExists) startNewApp()
    } else if (appList.length > 0) {
      await selectApp(appList[0].id)
    } else {
      startNewApp()
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: t('navigation.loadError', 'Failed to load navigation apps.'),
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

async function selectApp(recordId: string): Promise<void> {
  loading.value = true
  try {
    const loaded = await loadNavigationAppById(recordId)
    const meta = apps.value.find((entry) => entry.id === recordId)
    app.value = loaded ?? createDefaultNavigationApp()
    selectedRecordId.value = recordId
    appName.value = meta?.name ?? app.value.name
    roleId.value = meta?.roleId ?? null
    isDefault.value = meta?.isDefault ?? app.value.isDefault === true
  } finally {
    loading.value = false
  }
}

function startNewApp(): void {
  app.value = createDefaultNavigationApp('')
  selectedRecordId.value = null
  appName.value = ''
  roleId.value = null
  isDefault.value = false
}

function openEditor(item: NavItem): void {
  editingHome.value = false
  editingItem.value = item
  editorVisible.value = true
}

function addTopLink(): void {
  const link = createNavLink()
  app.value.items.push(link)
  openEditor(link)
}

function addTopFolder(): void {
  const folder = createNavFolder()
  app.value.items.push(folder)
  openEditor(folder)
}

function removeTopItem(item: NavItem): void {
  app.value.items = app.value.items.filter((entry) => entry.id !== item.id)
}

function openHomeEditor(): void {
  homeProxy.value = {
    id: '__home__',
    type: 'link',
    label: t('navigation.home', 'Home'),
    target: app.value.home,
  }
  editingHome.value = true
  editingItem.value = homeProxy.value
  editorVisible.value = true
}

function handleEditorVisibility(visible: boolean): void {
  editorVisible.value = visible
  if (!visible && editingHome.value && homeProxy.value) {
    app.value.home = homeProxy.value.target
    editingHome.value = false
    homeProxy.value = null
  }
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  try {
    app.value.name = appName.value.trim()
    app.value.label = appName.value.trim()
    const saved = await saveNavigationApp(app.value, {
      recordId: selectedRecordId.value,
      name: appName.value.trim(),
      roleId: roleId.value,
      isDefault: isDefault.value,
    })
    selectedRecordId.value = saved.id
    await reloadList()
    await selectApp(saved.id)
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('navigation.saved', 'Navigation app saved.'),
      life: 3000,
    })
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
    await reloadList()
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
    <div class="flex items-end flex-wrap gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.app', 'Navigation app') }}
        </label>
        <Select
          :model-value="selectedRecordId"
          :options="appOptions"
          option-label="label"
          option-value="value"
          class="min-w-[280px]"
          :placeholder="t('navigation.selectApp', 'Select app')"
          :disabled="loading || appOptions.length === 0"
          @update:model-value="selectApp(String($event ?? ''))"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.appName', 'App name') }}
        </label>
        <InputText v-model="appName" class="min-w-[220px]" :disabled="loading" />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('layoutRole.role', 'Role') }}
        </label>
        <Select
          :model-value="roleIdToSelectValue(roleId)"
          :options="roleSelectOptions"
          option-label="label"
          option-value="value"
          class="min-w-[220px]"
          :disabled="loading"
          @update:model-value="roleId = selectValueToRoleId($event)"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.defaultForRole', 'Default for role') }}
        </label>
        <ToggleSwitch v-model="isDefault" :disabled="loading" />
      </div>

      <div class="flex flex-wrap gap-2">
        <Button
          :label="t('navigation.newApp', 'New app')"
          size="small"
          text
          :disabled="loading || saving"
          @click="startNewApp"
        />
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

    <div class="bg-surface-50 border border-surface-200 rounded-lg flex items-center gap-3 p-3">
      <i class="pi pi-home" />
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

      <VueDraggableNext
        v-else
        :list="app.items"
        :group="{ name: 'nav' }"
        handle=".nav-node__handle"
        item-key="id"
        class="flex flex-col gap-2"
      >
        <NavTreeNode
          v-for="item in app.items"
          :key="item.id"
          :item="item"
          :depth="1"
          @edit="openEditor"
          @remove="removeTopItem"
        />
      </VueDraggableNext>
    </div>

    <NavItemEditor
      :visible="editorVisible"
      :item="editingItem"
      @update:visible="handleEditorVisibility"
    />
  </div>
</template>
