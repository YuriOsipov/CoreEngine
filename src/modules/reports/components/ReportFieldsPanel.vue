<script lang="ts">
export default {
  name: 'ReportFieldsPanel',
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import { isNumericFieldDefinition } from '@/core/fieldHelpers'
import { useTranslation } from '@/core/translation'
import { REPORT_FIELD_DND_GROUP } from '../services/reportFieldDnD'
import {
  listReportFieldTreeNodes,
  type ReportFieldOption,
  type ReportFieldTreeNode,
} from '../services/reportSettings'

const props = defineProps<{
  collection: string
  collapsed?: boolean
}>()

const emit = defineEmits<{
  'update:collapsed': [value: boolean]
  'fields-loaded': [fields: ReportFieldOption[]]
}>()

const { t } = useTranslation()
const fields = ref<ReportFieldOption[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')

const paletteList = ref<ReportFieldOption[]>([])

const paletteGroup = {
  name: REPORT_FIELD_DND_GROUP,
  pull: 'clone' as const,
  put: false,
}

watch(
  [fields, search],
  () => {
    const q = search.value.trim().toLowerCase()
    paletteList.value = !q
      ? [...fields.value]
      : fields.value.filter(
          (field) =>
            field.label.toLowerCase().includes(q) ||
            field.field.toLowerCase().includes(q),
        )
  },
  { immediate: true, deep: true },
)

watch(
  () => props.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
)

async function loadFields(collection: string): Promise<void> {
  if (!collection) {
    fields.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const nodes = await listReportFieldTreeNodes(collection)
    fields.value = []
    registerTreeFields(nodes)
    emit('fields-loaded', fields.value)
  } catch (err) {
    fields.value = []
    error.value = err instanceof Error
      ? err.message
      : t('reports.failedLoadFields', 'Failed to load report fields.')
  } finally {
    loading.value = false
  }
}

function registerTreeFields(nodes: ReportFieldTreeNode[]): void {
  const byField = new Map(fields.value.map((field) => [field.field, field]))
  for (const node of nodes) {
    byField.set(node.data.field, node.data)
  }
  fields.value = Array.from(byField.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

function isNumeric(field: ReportFieldOption): boolean {
  return isNumericFieldDefinition({
    type: field.type,
    component: field.component,
  })
}

function cloneField(field: ReportFieldOption): ReportFieldOption {
  return { ...field }
}

function toggleCollapsed(): void {
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <aside
    class="bg-surface-0 border border-surface-200 rounded-lg min-h-[24rem] overflow-hidden"
    :class="collapsed ? 'w-10' : 'w-[min(260px,100%)]'"
  >
    <div
      v-if="collapsed"
      class="h-full grid grid-rows-[auto_1fr] justify-items-center py-2 gap-2"
    >
      <Button
        icon="pi pi-angle-double-right"
        text
        rounded
        size="small"
        :aria-label="t('reports.expandFields', 'Expand fields')"
        :title="t('reports.expandFields', 'Expand fields')"
        @click="toggleCollapsed"
      />
      <button
        type="button"
        class="writing-mode-vertical border-0 bg-transparent text-surface-700 cursor-pointer text-[0.8rem] font-semibold tracking-wide px-1 py-2"
        style="writing-mode: vertical-rl; text-orientation: mixed;"
        @click="toggleCollapsed"
      >
        {{ t('reports.fields', 'Fields') }}
      </button>
    </div>

    <div v-else class="grid gap-3 p-3 content-start h-full">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[0.95rem]">{{ t('reports.fields', 'Fields') }}</h3>
        <Button
          icon="pi pi-angle-double-left"
          text
          rounded
          size="small"
          :aria-label="t('reports.collapseFields', 'Collapse fields')"
          :title="t('reports.collapseFields', 'Collapse fields')"
          @click="toggleCollapsed"
        />
      </div>

      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="search"
          :placeholder="t('reports.searchAllFields', 'Search all fields')"
          fluid
        />
      </IconField>

      <p class="text-muted-color text-[0.75rem] m-0">
        {{ t('reports.dragFieldsHint', 'Drag fields into Groups or Columns.') }}
      </p>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <div v-if="loading" class="page-loading min-h-[80px]">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('reports.loadingFields', 'Loading report fields...') }}</span>
      </div>

      <template v-else>
        <p
          v-if="paletteList.length === 0"
          class="text-muted-color text-[0.85rem] m-0 px-1"
        >
          {{ t('reports.noAvailableFields', 'No available fields.') }}
        </p>
        <VueDraggableNext
          v-else
          :list="paletteList"
          :group="paletteGroup"
          :clone="cloneField"
          :sort="false"
          tag="div"
          class="grid gap-0.5 max-h-[calc(100vh-16rem)] overflow-auto content-start"
          ghost-class="opacity-[0.45]"
          chosen-class="bg-primary-50"
        >
          <div
            v-for="field in paletteList"
            :key="field.field"
            class="text-left border-0 rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing bg-transparent text-surface-700 hover:bg-surface-50 text-[0.85rem] flex items-center gap-2 select-none"
            :title="t('reports.dragField', 'Drag to Outline')"
          >
            <i
              v-if="isNumeric(field)"
              class="pi pi-hashtag text-[0.7rem] text-muted-color"
              :title="t('reports.numericField', 'Numeric field')"
            />
            <span class="truncate">{{ field.label }}</span>
          </div>
        </VueDraggableNext>
      </template>
    </div>
  </aside>
</template>
