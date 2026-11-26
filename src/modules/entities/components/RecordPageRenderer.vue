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
  refreshCompactRuntimeFromRecord,
  type CompactRecordDetailsRuntime,
} from '@/modules/entities/services/recordDetails'
import {
  canReadEntity,
  ensureEntityPermissions,
} from '@/core/entityPermissions'
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
  pathSaving?: boolean
}>()

const emit = defineEmits<{
  'blocks-saved': [payload: { field: string; value: unknown }]
  'path-change': [payload: { updates: Record<string, unknown> }]
  'run-action': [action: EntityAction]
  'edit-record': []
  'delete-record': []
  'change-owner': []
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
    '--record-page-main-pct': `${main}%`,
    '--record-page-sidebar-pct': `${100 - main}%`,
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
  await ensureEntityPermissions()
  const next: Record<string, LayoutFieldMetadata[]> = {}
  await Promise.all(
    relatedComponents.map(async (component) => {
      const schema = await resolveRelatedListBlockLayout(component)
      next[component.id] = listBlockLayoutRelatedListFields(schema).filter((field) =>
        canReadEntity(field.relatedCollection),
      )
    }),
  )
  relatedListFields.value = next
}

async function loadHighlights(options?: { silent?: boolean }): Promise<void> {
  const highlightComponents = allComponents().filter((component) => component.type === 'highlights')
  if (!highlightComponents.length) {
    highlightsByKey.value = {}
    return
  }

  const keys = Array.from(
    new Set(highlightComponents.map((component) => component.compactLayoutId || '__role__')),
  )

  const hasExisting = keys.some((key) => Boolean(highlightsByKey.value[key]?.schema))
  const silent = Boolean(options?.silent && hasExisting)
  if (!silent) highlightsLoading.value = true
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
    if (!silent) highlightsByKey.value = {}
  } finally {
    if (!silent) highlightsLoading.value = false
  }
}

/**
 * After related-list / path / edit updates, patch Highlights from the already
 * refreshed parent record — no second item fetch and no “Loading details…” blank.
 */
async function syncHighlightsFromModel(): Promise<void> {
  // Skip the transient `{}` clear during loadRecordDetails — that would wipe
  // highlight values before the new record arrives.
  if (!props.recordId || Object.keys(props.modelValue).length === 0) return

  const current = highlightsByKey.value
  const keys = Object.keys(current)
  if (keys.length === 0) {
    await loadHighlights({ silent: true })
    return
  }

  const next: Record<string, CompactRecordDetailsRuntime | null> = { ...current }
  await Promise.all(
    keys.map(async (key) => {
      const runtime = current[key]
      if (!runtime?.schema) return
      next[key] = await refreshCompactRuntimeFromRecord(runtime, props.modelValue)
    }),
  )
  highlightsByKey.value = next
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

/** Keep Highlights in sync when Path / edit / related flows update the record. */
watch(
  () => props.modelValue,
  () => {
    void syncHighlightsFromModel()
  },
  { deep: true },
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
  <div class="record-page-runtime flex min-h-full flex-col gap-4">
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
          :path-saving="pathSaving"
          @blocks-saved="emit('blocks-saved', $event)"
          @path-change="emit('path-change', $event)"
          @related-changed="emit('related-changed')"
          @run-action="emit('run-action', $event)"
          @edit-record="emit('edit-record')"
          @delete-record="emit('delete-record')"
          @change-owner="emit('change-owner')"
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
            :path-saving="pathSaving"
            @blocks-saved="emit('blocks-saved', $event)"
            @path-change="emit('path-change', $event)"
            @related-changed="emit('related-changed')"
            @run-action="emit('run-action', $event)"
            @edit-record="emit('edit-record')"
            @delete-record="emit('delete-record')"
            @change-owner="emit('change-owner')"
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
            :path-saving="pathSaving"
            @blocks-saved="emit('blocks-saved', $event)"
            @path-change="emit('path-change', $event)"
            @related-changed="emit('related-changed')"
            @run-action="emit('run-action', $event)"
            @edit-record="emit('edit-record')"
            @delete-record="emit('delete-record')"
            @change-owner="emit('change-owner')"
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
.record-page-runtime {
  background: var(--app-canvas, var(--p-surface-50, #f8fafc));
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 100%;
  padding: 0.75rem 1rem 1.25rem;
}

.record-page-runtime__region--header {
  background: linear-gradient(
    to bottom,
    var(--app-canvas, var(--p-surface-50)) 70%,
    color-mix(in srgb, var(--app-canvas, var(--p-surface-50)) 0%, transparent)
  );
  gap: 0.75rem;
  margin: -0.15rem -0.25rem 0;
  padding: 0.15rem 0.25rem 0.35rem;
  position: sticky;
  top: 0;
  z-index: 8;
}

.record-page-runtime__body {
  align-items: start;
  flex: 1 1 auto;
  min-height: 0;
}

.record-page-runtime__body--with-sidebar {
  gap: 1rem;
  grid-template-columns:
    minmax(16rem, var(--record-page-main-pct, 42%))
    minmax(0, var(--record-page-sidebar-pct, 58%));
}

.record-page-runtime__body--with-sidebar > .record-page-runtime__region {
  min-height: 0;
}

/* Related / Activity column: use leftover height instead of a short card strip. */
.record-page-runtime__body--with-sidebar > .record-page-runtime__region:last-child {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  min-height: min(70vh, 42rem);
}

.record-page-runtime__body--with-sidebar
  > .record-page-runtime__region:last-child
  > .min-w-0 {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.record-page-runtime__body--with-sidebar
  > .record-page-runtime__region:last-child
  :deep(.record-page-component-view) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.record-page-runtime__body--with-sidebar
  > .record-page-runtime__region:last-child
  :deep(.record-page-component-view > .rounded-lg),
.record-page-runtime__body--with-sidebar
  > .record-page-runtime__region:last-child
  :deep(.record-page-component-view > .flex.flex-col) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

@media (max-width: 1023px) {
  .record-page-runtime__body--with-sidebar {
    grid-template-columns: minmax(0, 1fr);
  }

  .record-page-runtime__body--with-sidebar > .record-page-runtime__region:last-child {
    min-height: 0;
  }
}

@media (max-width: 767px) {
  .record-page-runtime {
    padding: 0.65rem 0.75rem 1rem;
  }

  .record-page-runtime__region--header {
    position: static;
  }
}
</style>
