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
}>()

const { t } = useTranslation()

const collections = ref<NavPickerOption[]>([])
const dashboards = ref<NavPickerOption[]>([])
const reports = ref<NavPickerOption[]>([])
const views = ref<NavPickerOption[]>([])
const viewsLoading = ref(false)
const optionsLoaded = ref(false)

const isLink = computed(() => props.item?.type === 'link')

const targetKindOptions = computed<Array<{ label: string; value: NavTargetKind }>>(() => [
  { label: t('navigation.targetHome', 'Home'), value: 'home' },
  { label: t('navigation.targetObject', 'Object list'), value: 'object' },
  { label: t('navigation.targetDashboard', 'Dashboard'), value: 'dashboard' },
  { label: t('navigation.targetReports', 'Reports'), value: 'reports' },
  { label: t('navigation.targetProjects', 'Projects'), value: 'projects' },
  { label: t('navigation.targetUrl', 'URL'), value: 'url' },
])

const targetKind = computed<NavTargetKind>({
  get: () => (props.item?.type === 'link' ? props.item.target.kind : 'home'),
  set: (kind) => {
    if (props.item?.type !== 'link') return
    props.item.target = defaultTargetForKind(kind)
  },
})

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

const objectCollection = computed<string>({
  get: () =>
    props.item?.type === 'link' && props.item.target.kind === 'object'
      ? props.item.target.collection
      : '',
  set: (value) => {
    if (props.item?.type === 'link' && props.item.target.kind === 'object') {
      props.item.target.collection = value
    }
  },
})

const objectViewId = computed<string>({
  get: () =>
    props.item?.type === 'link' && props.item.target.kind === 'object'
      ? props.item.target.viewId ?? ''
      : '',
  set: (value) => {
    if (props.item?.type === 'link' && props.item.target.kind === 'object') {
      props.item.target.viewId = value || undefined
    }
  },
})

const dashboardId = computed<string>({
  get: () =>
    props.item?.type === 'link' && props.item.target.kind === 'dashboard'
      ? props.item.target.dashboardId
      : '',
  set: (value) => {
    if (props.item?.type === 'link' && props.item.target.kind === 'dashboard') {
      props.item.target.dashboardId = value
    }
  },
})

const reportIds = computed<string[]>({
  get: () =>
    props.item?.type === 'link' && props.item.target.kind === 'reports'
      ? props.item.target.reportIds
      : [],
  set: (value) => {
    if (props.item?.type === 'link' && props.item.target.kind === 'reports') {
      props.item.target.reportIds = value
    }
  },
})

const urlHref = computed<string>({
  get: () =>
    props.item?.type === 'link' && props.item.target.kind === 'url'
      ? props.item.target.href
      : '',
  set: (value) => {
    if (props.item?.type === 'link' && props.item.target.kind === 'url') {
      props.item.target.href = value
    }
  },
})

const urlExternal = computed<boolean>({
  get: () =>
    props.item?.type === 'link' && props.item.target.kind === 'url'
      ? props.item.target.external === true
      : false,
  set: (value) => {
    if (props.item?.type === 'link' && props.item.target.kind === 'url') {
      props.item.target.external = value
    }
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
  () => props.visible,
  (visible) => {
    if (visible) void ensureOptions()
  },
)

watch(objectCollection, (collection) => {
  if (props.item?.type === 'link' && props.item.target.kind === 'object') {
    props.item.target.viewId = undefined
  }
  void loadViews(collection)
})

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="isLink
      ? t('navigation.editLink', 'Edit link')
      : t('navigation.editFolder', 'Edit folder')"
    :style="{ width: '32rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="item" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.itemLabel', 'Label') }}
        </label>
        <InputText v-model="item.label" fluid />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-surface-700 text-[0.8rem] font-semibold">
          {{ t('navigation.itemIcon', 'Icon') }}
        </label>
        <CrmIconPicker v-model="item.icon" />
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
        :label="t('common.ok', 'OK')"
        @click="close"
      />
    </template>
  </Dialog>
</template>
