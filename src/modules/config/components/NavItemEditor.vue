<script lang="ts">
export default {
  name: 'NavItemEditor',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import type { NavItem, NavTarget, NavTargetKind } from '@/interfaces'
import {
  listNavCollections,
  listNavListViews,
  listNavDashboards,
  listNavReports,
  type NavPickerOption,
} from '@/core/navigation/navigationPickers'
import CrmIconPicker from '@/core/ui-kit/CrmIconPicker.vue'

const props = defineProps<{
  visible: boolean
  item: NavItem | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [item: NavItem]
}>()

const { t } = useTranslation()

const collections = ref<NavPickerOption[]>([])
const dashboards = ref<NavPickerOption[]>([])
const reports = ref<NavPickerOption[]>([])
const views = ref<NavPickerOption[]>([])
const viewsLoading = ref(false)
const optionsLoaded = ref(false)
const draft = ref<NavItem | null>(null)

const isLink = computed(() => draft.value?.type === 'link')

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const targetKindOptions = computed<Array<{ label: string; value: NavTargetKind }>>(() => [
  { label: t('navigation.targetHome', 'Home'), value: 'home' },
  { label: t('navigation.targetObject', 'Object list'), value: 'object' },
  { label: t('navigation.targetDashboard', 'Dashboard'), value: 'dashboard' },
  { label: t('navigation.targetReports', 'Reports'), value: 'reports' },
  { label: t('navigation.targetProjects', 'Projects'), value: 'projects' },
  { label: t('navigation.targetUrl', 'URL'), value: 'url' },
])

function cloneItem(item: NavItem): NavItem {
  return JSON.parse(JSON.stringify(item)) as NavItem
}

function defaultTargetForKind(kind: NavTargetKind): NavTarget {
  switch (kind) {
    case 'object':
      return { kind: 'object', collection: '' }
    case 'dashboard':
      return { kind: 'dashboard', dashboardId: '' }
    case 'reports':
      return { kind: 'reports', reportIds: [] }
    case 'projects':
      return { kind: 'projects' }
    case 'url':
      return { kind: 'url', href: '', external: false }
    case 'home':
    default:
      return { kind: 'home' }
  }
}

const targetKind = computed<NavTargetKind>({
  get: () => (draft.value?.type === 'link' ? draft.value.target.kind : 'home'),
  set: (kind) => {
    if (draft.value?.type !== 'link') return
    draft.value.target = defaultTargetForKind(kind)
  },
})

const objectCollection = computed<string>({
  get: () =>
    draft.value?.type === 'link' && draft.value.target.kind === 'object'
      ? draft.value.target.collection
      : '',
  set: (value) => {
    if (draft.value?.type === 'link' && draft.value.target.kind === 'object') {
      draft.value.target.collection = value
    }
  },
})

const objectViewId = computed<string>({
  get: () =>
    draft.value?.type === 'link' && draft.value.target.kind === 'object'
      ? draft.value.target.viewId ?? ''
      : '',
  set: (value) => {
    if (draft.value?.type === 'link' && draft.value.target.kind === 'object') {
      draft.value.target.viewId = value || undefined
    }
  },
})

const dashboardId = computed<string>({
  get: () =>
    draft.value?.type === 'link' && draft.value.target.kind === 'dashboard'
      ? draft.value.target.dashboardId
      : '',
  set: (value) => {
    if (draft.value?.type === 'link' && draft.value.target.kind === 'dashboard') {
      draft.value.target.dashboardId = value
    }
  },
})

const reportIds = computed<string[]>({
  get: () =>
    draft.value?.type === 'link' && draft.value.target.kind === 'reports'
      ? [...draft.value.target.reportIds]
      : [],
  set: (value) => {
    if (draft.value?.type === 'link' && draft.value.target.kind === 'reports') {
      draft.value.target.reportIds = value
    }
  },
})

const urlHref = computed<string>({
  get: () =>
    draft.value?.type === 'link' && draft.value.target.kind === 'url'
      ? draft.value.target.href
      : '',
  set: (value) => {
    if (draft.value?.type === 'link' && draft.value.target.kind === 'url') {
      draft.value.target.href = value
    }
  },
})

const urlExternal = computed<boolean>({
  get: () =>
    draft.value?.type === 'link' && draft.value.target.kind === 'url'
      ? draft.value.target.external === true
      : false,
  set: (value) => {
    if (draft.value?.type === 'link' && draft.value.target.kind === 'url') {
      draft.value.target.external = value
    }
  },
})

const draftLabel = computed({
  get: () => draft.value?.label ?? '',
  set: (value: string) => {
    if (draft.value) draft.value.label = value
  },
})

const draftIcon = computed({
  get: () => draft.value?.icon ?? '',
  set: (value: string) => {
    if (draft.value) draft.value.icon = value || undefined
  },
})

async function ensureOptions(): Promise<void> {
  if (optionsLoaded.value) return
  optionsLoaded.value = true
  const [collectionResult, dashboardResult, reportResult] = await Promise.all([
    listNavCollections().catch(() => []),
    listNavDashboards().catch(() => []),
    listNavReports().catch(() => []),
  ])
  collections.value = collectionResult
  dashboards.value = dashboardResult
  reports.value = reportResult
}

async function loadViews(collection: string): Promise<void> {
  views.value = []
  if (!collection) return
  viewsLoading.value = true
  try {
    views.value = await listNavListViews(collection)
  } finally {
    viewsLoading.value = false
  }
}

watch(
  () => [props.visible, props.item] as const,
  ([visible, item]) => {
    if (!visible || !item) {
      if (!visible) draft.value = null
      return
    }
    draft.value = cloneItem(item)
    void ensureOptions()
    if (item.type === 'link' && item.target.kind === 'object') {
      void loadViews(item.target.collection)
    } else {
      views.value = []
    }
  },
)

watch(objectCollection, (collection, previous) => {
  if (previous === undefined || collection === previous) return
  if (draft.value?.type === 'link' && draft.value.target.kind === 'object') {
    draft.value.target.viewId = undefined
  }
  void loadViews(collection)
})

function close(): void {
  emit('update:visible', false)
}

function save(): void {
  if (!draft.value) {
    close()
    return
  }
  emit('save', cloneItem(draft.value))
  close()
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    append-to="body"
    :header="isLink
      ? t('navigation.editLink', 'Edit link')
      : t('navigation.editFolder', 'Edit folder')"
    :style="{ width: '32rem' }"
  >
    <div v-if="draft" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.itemLabel', 'Label') }}
        </label>
        <InputText v-model="draftLabel" fluid />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.itemIcon', 'Icon') }}
        </label>
        <CrmIconPicker v-model="draftIcon" />
      </div>

      <template v-if="isLink">
        <div class="flex flex-col gap-1">
          <label class="text-surface-700 text-[0.8rem] font-semibold">
            {{ t('navigation.targetType', 'Target type') }}
          </label>
          <Select
            v-model="targetKind"
            :options="targetKindOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>

        <div v-if="targetKind === 'object'" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-surface-700 text-[0.8rem] font-semibold">
              {{ t('common.collection', 'Collection') }}
            </label>
            <Select
              v-model="objectCollection"
              :options="collections"
              option-label="label"
              option-value="value"
              filter
              :placeholder="t('common.selectCollection', 'Select collection')"
              fluid
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-surface-700 text-[0.8rem] font-semibold">
              {{ t('navigation.viewId', 'View (optional)') }}
            </label>
            <Select
              v-model="objectViewId"
              :options="views"
              option-label="label"
              option-value="value"
              :loading="viewsLoading"
              :disabled="!objectCollection"
              :placeholder="t('navigation.selectView', 'Select view…')"
              show-clear
              fluid
            />
          </div>
        </div>

        <div v-else-if="targetKind === 'dashboard'" class="flex flex-col gap-1">
          <label class="text-surface-700 text-[0.8rem] font-semibold">
            {{ t('navigation.dashboard', 'Dashboard') }}
          </label>
          <Select
            v-model="dashboardId"
            :options="dashboards"
            option-label="label"
            option-value="value"
            filter
            :placeholder="t('navigation.selectDashboard', 'Select dashboard')"
            fluid
          />
        </div>

        <div v-else-if="targetKind === 'reports'" class="flex flex-col gap-1">
          <label class="text-surface-700 text-[0.8rem] font-semibold">
            {{ t('navigation.reports', 'Reports') }}
          </label>
          <MultiSelect
            v-model="reportIds"
            :options="reports"
            option-label="label"
            option-value="value"
            filter
            :placeholder="t('navigation.selectReports', 'Select reports')"
            fluid
          />
        </div>

        <div v-else-if="targetKind === 'projects'" class="flex flex-col gap-1">
          <p class="text-surface-600 text-[0.85rem] m-0">
            {{ t('navigation.projectsHint', 'Opens the Project Management workspace.') }}
          </p>
        </div>

        <div v-else-if="targetKind === 'url'" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-surface-700 text-[0.8rem] font-semibold">
              {{ t('navigation.url', 'URL') }}
            </label>
            <InputText
              v-model="urlHref"
              placeholder="/object/leads"
              fluid
            />
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="urlExternal" binary input-id="nav-url-external" />
            <label for="nav-url-external" class="text-[0.85rem]">
              {{ t('navigation.openExternal', 'Open in new tab') }}
            </label>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="close"
      />
      <Button
        :label="t('common.ok', 'OK')"
        @click="save"
      />
    </template>
  </Dialog>
</template>
