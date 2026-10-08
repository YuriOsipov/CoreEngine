<script lang="ts">
export default {
  name: 'RecordPageRenderer',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import RecordPageComponentView from '@/modules/entities/components/RecordPageComponentView.vue'
import type {
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
  RecordPageRegion,
} from '@/interfaces'
import { loadEntityLayoutById } from '@/modules/config/services/layoutSettings'
import { clampRecordPageMainSize } from '@/modules/config/services/recordPageSettings'
import { listBlockLayoutRelatedListFields } from '@/modules/config/utils/recordPageRelatedList'
import {
  fetchCompactRecordDetails,
  type CompactRecordDetailsRuntime,
} from '@/modules/entities/services/recordDetails'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  pageLayout: RecordPageLayoutSchema
  /** Fallback Block Layout when a detail component has no pageLayoutId. */
  defaultBlockLayout: EntityLayoutSchema | null
  modelValue: Record<string, unknown>
  collection: string
  recordId: string
  m2aEditable?: boolean
  actions?: EntityAction[]
  actionRunning?: Record<string, boolean>
  actionsDisabled?: boolean
  deleting?: boolean
  recordArchived?: boolean
}>()

const emit = defineEmits<{
  'blocks-saved': [payload: { field: string; value: unknown }]
  'run-action': [action: EntityAction]
  'edit-record': []
  'delete-record': []
  'related-changed': []
}>()

const { t } = useTranslation()
const blockLayoutCache = ref<Record<string, EntityLayoutSchema | null>>({})
const highlightsByKey = ref<Record<string, CompactRecordDetailsRuntime | null>>({})
const highlightsLoading = ref(false)
const highlightsError = ref<string | null>(null)
const detailLayouts = ref<Record<string, EntityLayoutSchema | null>>({})
const relatedListFields = ref<Record<string, LayoutFieldMetadata[]>>({})

const headerRegion = computed(() =>
  props.pageLayout.regions.find((region) => region.key === 'header') ?? null,
)
const mainRegion = computed(() =>
  props.pageLayout.regions.find((region) => region.key === 'main') ?? null,
)
const sidebarRegion = computed(() =>
  props.pageLayout.regions.find((region) => region.key === 'sidebar') ?? null,
)
const sidebarEnabled = computed(() => props.pageLayout.sidebarEnabled !== false)
const showSidebar = computed(() => sidebarEnabled.value && Boolean(sidebarRegion.value))
const mainSize = computed(() => clampRecordPageMainSize(props.pageLayout.mainSize))
const bodyStyle = computed(() => {
  if (!showSidebar.value) return undefined
  const main = mainSize.value
  return {
    '--record-page-main-fr': String(main),
    '--record-page-sidebar-fr': String(100 - main),
  } as Record<string, string>
})

function walkComponents(
  components: RecordPageComponent[],
  visit: (component: RecordPageComponent) => void,
): void {
  for (const component of components) {
    visit(component)
    if (component.type === 'fieldGroup' && component.components) {
      walkComponents(component.components, visit)
    }
    if (component.tabs) {
      for (const tab of component.tabs) {
        walkComponents(tab.components, visit)
      }
    }
  }
}

function allComponents(): RecordPageComponent[] {
  const list: RecordPageComponent[] = []
  for (const region of props.pageLayout.regions) {
    walkComponents(region.components, (component) => list.push(component))
  }
  return list
}

function filterBlockLayout(
  schema: EntityLayoutSchema,
  sectionIds?: string[],
): EntityLayoutSchema {
  if (!sectionIds?.length) return schema
  const allowed = new Set(sectionIds)
  return {
    ...schema,
    sections: schema.sections.filter((section) => allowed.has(section.id)),
  }
}

async function resolveBlockLayout(
  component: RecordPageComponent,
): Promise<EntityLayoutSchema | null> {
  const layoutId = component.pageLayoutId || props.pageLayout.pageLayoutId || null
  if (!layoutId) {
    return props.defaultBlockLayout
      ? filterBlockLayout(props.defaultBlockLayout, component.sectionIds)
      : null
  }

  if (!(layoutId in blockLayoutCache.value)) {
    blockLayoutCache.value[layoutId] = await loadEntityLayoutById(props.collection, layoutId)
  }
  const loaded = blockLayoutCache.value[layoutId]
  return loaded ? filterBlockLayout(loaded, component.sectionIds) : null
}

/** Full Block Layout (no section filter) for Related List field lookup. */
async function resolveRelatedListBlockLayout(
  component: RecordPageComponent,
): Promise<EntityLayoutSchema | null> {
  const layoutId = component.pageLayoutId || props.pageLayout.pageLayoutId || null
  if (!layoutId) {
    return props.defaultBlockLayout
  }

  if (!(layoutId in blockLayoutCache.value)) {
    blockLayoutCache.value[layoutId] = await loadEntityLayoutById(props.collection, layoutId)
  }
  return blockLayoutCache.value[layoutId] ?? null
}

async function hydrateDetailLayouts(): Promise<void> {
  const detailComponents = allComponents().filter((component) => component.type === 'detail')
  const next: Record<string, EntityLayoutSchema | null> = {}
  await Promise.all(
    detailComponents.map(async (component) => {
      next[component.id] = await resolveBlockLayout(component)
    }),
  )
  detailLayouts.value = next
}

async function hydrateRelatedListFields(): Promise<void> {
  const relatedComponents = allComponents().filter(
    (component) => component.type === 'relatedList',
  )
  const next: Record<string, LayoutFieldMetadata[]> = {}
  await Promise.all(
    relatedComponents.map(async (component) => {
      const schema = await resolveRelatedListBlockLayout(component)
      next[component.id] = listBlockLayoutRelatedListFields(schema)
    }),
  )
  relatedListFields.value = next
}

async function loadHighlights(): Promise<void> {
  const highlightComponents = allComponents().filter((component) => component.type === 'highlights')
  if (!highlightComponents.length) {
    highlightsByKey.value = {}
    return
  }

  const keys = Array.from(
    new Set(highlightComponents.map((component) => component.compactLayoutId || '__role__')),
  )

  highlightsLoading.value = true
  highlightsError.value = null
  try {
    const next: Record<string, CompactRecordDetailsRuntime | null> = {}
    await Promise.all(
      keys.map(async (key) => {
        next[key] = await fetchCompactRecordDetails(props.collection, props.recordId, {
          compactLayoutId: key === '__role__' ? null : key,
          includeRelatedCounts: false,
        })
      }),
    )
    highlightsByKey.value = next
  } catch (err) {
    highlightsError.value =
      err instanceof Error
        ? err.message
        : t('recordPage.highlightsLoadError', 'Failed to load highlights.')
    highlightsByKey.value = {}
  } finally {
    highlightsLoading.value = false
  }
}

watch(
  () => [props.pageLayout, props.defaultBlockLayout, props.collection, props.recordId] as const,
  () => {
    void hydrateDetailLayouts()
    void hydrateRelatedListFields()
    void loadHighlights()
  },
  { immediate: true, deep: true },
)

onMounted(() => {
  void hydrateDetailLayouts()
  void hydrateRelatedListFields()
  void loadHighlights()
})

function regionTitle(region: RecordPageRegion): string {
  if (region.title) return region.title
  if (region.key === 'header') return t('recordPage.region.header', 'Header')
  if (region.key === 'sidebar') return t('recordPage.region.sidebar', 'Sidebar')
  return t('recordPage.region.main', 'Main')
}

function componentGridStyle(component: RecordPageComponent): Record<string, string> {
  if (component.type === 'field') {
    const span = Math.min(12, Math.max(1, component.span ?? 6))
    return { gridColumn: `span ${span}` }
  }
  return { gridColumn: 'span 12' }
}
</script>

<template>
  <div class="record-page-runtime flex flex-col gap-4">
    <section
      v-if="headerRegion && headerRegion.components.length > 0"
      class="record-page-runtime__region record-page-runtime__region--header grid grid-cols-12 content-start gap-3"
    >
      <div
        v-for="component in headerRegion.components"
        :key="component.id"
        class="min-w-0"
        :style="componentGridStyle(component)"
      >
        <RecordPageComponentView
          :component="component"
          :model-value="modelValue"
          :collection="collection"
          :record-id="recordId"
          :m2a-editable="m2aEditable"
          :detail-layouts="detailLayouts"
          :related-list-fields="relatedListFields"
          :highlights-by-key="highlightsByKey"
          :highlights-loading="highlightsLoading"
          :highlights-error="highlightsError"
          :actions="actions"
          :action-running="actionRunning"
          :actions-disabled="actionsDisabled"
          :deleting="deleting"
          :record-archived="recordArchived"
          @blocks-saved="emit('blocks-saved', $event)"
          @related-changed="emit('related-changed')"
          @run-action="emit('run-action', $event)"
          @edit-record="emit('edit-record')"
          @delete-record="emit('delete-record')"
        />
      </div>
    </section>

    <div
      class="record-page-runtime__body grid grid-cols-1 gap-4"
      :class="{ 'record-page-runtime__body--with-sidebar': showSidebar }"
      :style="bodyStyle"
    >
      <section
        v-if="mainRegion"
        class="record-page-runtime__region grid min-w-0 grid-cols-12 content-start gap-3"
      >
        <div
          v-for="component in mainRegion.components"
          :key="component.id"
          class="min-w-0"
          :style="componentGridStyle(component)"
        >
          <RecordPageComponentView
            :component="component"
            :model-value="modelValue"
            :collection="collection"
            :record-id="recordId"
            :m2a-editable="m2aEditable"
            :detail-layouts="detailLayouts"
            :related-list-fields="relatedListFields"
            :highlights-by-key="highlightsByKey"
            :highlights-loading="highlightsLoading"
            :highlights-error="highlightsError"
            :actions="actions"
            :action-running="actionRunning"
            :actions-disabled="actionsDisabled"
            :deleting="deleting"
            :record-archived="recordArchived"
            @blocks-saved="emit('blocks-saved', $event)"
            @related-changed="emit('related-changed')"
            @run-action="emit('run-action', $event)"
            @edit-record="emit('edit-record')"
            @delete-record="emit('delete-record')"
          />
        </div>

        <p
          v-if="mainRegion.components.length === 0"
          class="col-span-12 m-0 text-sm text-muted-color"
        >
          {{ t('recordPage.emptyRegionRuntime', 'No components in {region}.', { region: regionTitle(mainRegion) }) }}
        </p>
      </section>

      <section
        v-if="showSidebar && sidebarRegion"
        class="record-page-runtime__region grid min-w-0 grid-cols-12 content-start gap-3"
      >
        <div
          v-for="component in sidebarRegion.components"
          :key="component.id"
          class="min-w-0"
          :style="componentGridStyle(component)"
        >
          <RecordPageComponentView
            :component="component"
            :model-value="modelValue"
            :collection="collection"
            :record-id="recordId"
            :m2a-editable="m2aEditable"
            :detail-layouts="detailLayouts"
            :related-list-fields="relatedListFields"
            :highlights-by-key="highlightsByKey"
            :highlights-loading="highlightsLoading"
            :highlights-error="highlightsError"
            :actions="actions"
            :action-running="actionRunning"
            :actions-disabled="actionsDisabled"
            :deleting="deleting"
            :record-archived="recordArchived"
            @blocks-saved="emit('blocks-saved', $event)"
            @related-changed="emit('related-changed')"
            @run-action="emit('run-action', $event)"
            @edit-record="emit('edit-record')"
            @delete-record="emit('delete-record')"
          />
        </div>

        <p
          v-if="sidebarRegion.components.length === 0"
          class="col-span-12 m-0 text-sm text-muted-color"
        >
          {{ t('recordPage.emptyRegionRuntime', 'No components in {region}.', { region: regionTitle(sidebarRegion) }) }}
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.record-page-runtime__body--with-sidebar {
  grid-template-columns:
    minmax(0, calc(var(--record-page-main-fr, 50) * 1fr))
    minmax(0, calc(var(--record-page-sidebar-fr, 50) * 1fr));
}

@media (max-width: 991px) {
  .record-page-runtime__body--with-sidebar {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
