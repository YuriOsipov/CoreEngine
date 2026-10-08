<script lang="ts">
export default {
  name: 'RecordPageCanvasComponent',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import FormRendererLight from '@/modules/entities/components/FormRendererLight.vue'
import type {
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageComponentType,
} from '@/interfaces'
import { DEFAULT_VISIBLE_ACTION_BUTTONS } from '@/interfaces'
import { loadEntityLayoutById } from '../../services/layoutSettings'
import { buildFormStateFromSchema } from '@/modules/entities/utils/fieldDefaults'
import { useTranslation } from '@/core/translation'
import { DIALOG_SORTABLE_ATTRS } from '../../utils/dialogSortable'

function fieldsFromSchema(schema: EntityLayoutSchema): LayoutFieldMetadata[] {
  return schema.sections.flatMap((section) =>
    section.groups.flatMap((group) => group.fields),
  )
}

const props = defineProps<{
  component: RecordPageComponent
  collection: string
  selectedComponentId?: string | null
  /** Default Block Layout id when component.pageLayoutId is empty. */
  defaultBlockLayoutId?: string | null
  blockLayoutName?: (pageLayoutId: string | null | undefined) => string
  compactLayoutName?: (compactLayoutId: string | null | undefined) => string
  activeTabId?: string | null
  /** For nested `field` cards — label beside control (Block Layout style). */
  inlineLabels?: boolean
  /** Override field grid span (e.g. Field group 1/2 columns). */
  forceSpan?: number | null
}>()

const emit = defineEmits<{
  select: [componentId: string]
  setActiveTab: [componentId: string, tabId: string]
  tabChange: [event: { added?: { element: RecordPageComponent } }]
  fieldGroupChange: [
    event: { added?: { newIndex: number; element: RecordPageComponent } },
    fieldGroup: RecordPageComponent,
  ]
}>()

const { t } = useTranslation()
const blockSchema = ref<EntityLayoutSchema | null>(null)
const blockLoading = ref(false)
const blockError = ref<string | null>(null)
const previewModel = ref<Record<string, unknown>>({})
const actionLabels = ref<string[]>([])

const selected = computed(() => props.selectedComponentId === props.component.id)
const typeLabel = computed(() => componentTypeLabel(props.component.type))

function componentTypeLabel(type: RecordPageComponentType): string {
  switch (type) {
    case 'highlights':
      return t('recordPage.component.highlights', 'Highlights')
    case 'detail':
      return t('recordPage.component.detail', 'Record Detail')
    case 'relatedList':
      return t('recordPage.component.relatedList', 'Related List')
    case 'files':
      return t('recordPage.component.files', 'Files')
    case 'activityLog':
      return t('recordPage.component.activityLog', 'Activity log')
    case 'tabs':
      return t('recordPage.component.tabs', 'Tabs')
    case 'actions':
      return t('recordPage.component.actions', 'Actions')
    case 'field':
      return t('recordPage.component.field', 'Field')
    case 'fieldGroup':
      return t('recordPage.component.fieldGroup', 'Field group')
    default:
      return type
  }
}

const resolvedBlockLayoutId = computed(
  () => props.component.pageLayoutId || props.defaultBlockLayoutId || null,
)

const resolvedActionLayoutId = computed(
  () => props.component.actionLayoutId || props.defaultBlockLayoutId || null,
)

const tabs = computed(() => props.component.tabs ?? [])

const fieldGroupCollapsed = ref(false)

watch(
  () => props.component.id,
  () => {
    fieldGroupCollapsed.value = props.component.collapsed === true
  },
  { immediate: true },
)

function ensureLocalFieldGroupChildren(): RecordPageComponent[] {
  if (props.component.type !== 'fieldGroup') return []
  if (!props.component.components) props.component.components = []
  return props.component.components
}

const fieldGroupTitle = computed(
  () => props.component.label?.trim()
    || t('recordPage.fieldGroupDefaultLabel', 'Section'),
)

const activeTab = computed(() => {
  const list = tabs.value
  if (!list.length) return null
  if (props.activeTabId && list.some((tab) => tab.id === props.activeTabId)) {
    return list.find((tab) => tab.id === props.activeTabId) ?? list[0]
  }
  return list[0]
})

const detailPreviewSchema = computed((): EntityLayoutSchema | null => {
  if (props.component.type !== 'detail' || !blockSchema.value) return null
  const sectionIds = props.component.sectionIds
  if (!sectionIds?.length) return blockSchema.value
  const allowed = new Set(sectionIds)
  return {
    ...blockSchema.value,
    sections: blockSchema.value.sections.filter((section) => allowed.has(section.id)),
  }
})

async function loadDetailSchema(): Promise<void> {
  if (props.component.type !== 'detail') {
    if (props.component.type !== 'actions') {
      blockSchema.value = null
    }
    return
  }

  const layoutId = resolvedBlockLayoutId.value
  if (!layoutId) {
    blockSchema.value = null
    blockError.value = t(
      'recordPage.canvasSelectBlockLayout',
      'Select a Block Layout for this component.',
    )
    return
  }

  blockLoading.value = true
  blockError.value = null
  try {
    const schema = await loadEntityLayoutById(props.collection, layoutId)
    blockSchema.value = schema
    previewModel.value = schema ? buildFormStateFromSchema(fieldsFromSchema(schema)) : {}
    if (!schema) {
      blockError.value = t('recordPage.canvasBlockLayoutMissing', 'Block Layout could not be loaded.')
    }
  } catch (err) {
    blockSchema.value = null
    previewModel.value = {}
    blockError.value =
      err instanceof Error
        ? err.message
        : t('recordPage.canvasBlockLayoutMissing', 'Block Layout could not be loaded.')
  } finally {
    blockLoading.value = false
  }
}

async function loadActionPreview(): Promise<void> {
  if (props.component.type !== 'actions' && props.component.type !== 'highlights') {
    actionLabels.value = []
    return
  }

  const layoutId = resolvedActionLayoutId.value
  if (!layoutId) {
    actionLabels.value = []
    return
  }

  try {
    const schema = await loadEntityLayoutById(props.collection, layoutId)
    actionLabels.value = (schema?.actions ?? []).map((action: EntityAction) => action.label)
  } catch {
    actionLabels.value = []
  }
}

watch(
  () => [
    props.component.type,
    props.component.pageLayoutId,
    props.component.sectionIds,
    props.defaultBlockLayoutId,
    props.collection,
  ] as const,
  () => {
    void loadDetailSchema()
  },
  { immediate: true, deep: true },
)

watch(
  () => [
    props.component.type,
    props.component.actionLayoutId,
    props.defaultBlockLayoutId,
    props.collection,
  ] as const,
  () => {
    void loadActionPreview()
  },
  { immediate: true },
)

const previewActionLabels = computed(() => {
  const standard = [
    t('common.edit', 'Edit'),
    t('common.delete', 'Delete'),
  ]
  return [...standard, ...actionLabels.value]
})

const visiblePreviewActions = computed(() => {
  const limit = props.component.visibleActionButtons ?? DEFAULT_VISIBLE_ACTION_BUTTONS
  return previewActionLabels.value.slice(0, Math.max(1, limit))
})

const overflowPreviewCount = computed(() => {
  const limit = props.component.visibleActionButtons ?? DEFAULT_VISIBLE_ACTION_BUTTONS
  return Math.max(0, previewActionLabels.value.length - Math.max(1, limit))
})

const subtitle = computed(() => {
  if (props.component.type === 'detail') {
    return props.blockLayoutName?.(resolvedBlockLayoutId.value)
      ?? t('recordPage.useDefaultPageLayout', 'Use default')
  }
  if (props.component.type === 'highlights') {
    return props.compactLayoutName?.(props.component.compactLayoutId)
      ?? t('recordPage.useRoleCompactLayout', 'Use role default')
  }
  if (props.component.type === 'actions') {
    return props.blockLayoutName?.(resolvedActionLayoutId.value)
      ?? t('recordPage.useDefaultPageLayout', 'Use default')
  }
  if (props.component.type === 'field') {
    return props.component.field ?? ''
  }
  if (props.component.type === 'fieldGroup') {
    const cols = props.component.columns === 1 ? 1 : 2
    return t('recordPage.fieldGroupSubtitle', '{columns} columns', { columns: cols })
  }
  if (props.component.type === 'relatedList') {
    return props.blockLayoutName?.(props.component.pageLayoutId)
      ?? t('recordPage.useDefaultPageLayout', 'Use default')
  }
  if (props.component.type === 'files') {
    return t('recordPage.component.files', 'Files')
  }
  if (props.component.type === 'activityLog') {
    return t('recordPage.component.activityLog', 'Activity log')
  }
  if (props.component.type === 'tabs') {
    return t('recordPage.tabsCount', '{count} tabs', { count: tabs.value.length })
  }
  return typeLabel.value
})

function onSelectSelf(): void {
  emit('select', props.component.id)
}

function onSelectTab(tabId: string): void {
  emit('setActiveTab', props.component.id, tabId)
  emit('select', props.component.id)
}

const gridItemStyle = computed((): Record<string, string> => {
  if (props.component.type === 'field') {
    const span = Math.min(
      12,
      Math.max(1, props.forceSpan ?? props.component.span ?? 6),
    )
    return { gridColumn: `span ${span}` }
  }
  return { gridColumn: 'span 12' }
})
</script>

<template>
  <div
    v-if="component.type === 'field'"
    class="record-page-canvas-field"
    :class="{
      'record-page-canvas-field--selected': selected,
      'record-page-canvas-field--inline': inlineLabels !== false,
    }"
    :style="gridItemStyle"
    @click.stop="onSelectSelf"
  >
    <div class="record-page-canvas-field__label-row">
      <span class="truncate font-semibold text-[0.9rem]">
        {{ component.label || component.field || typeLabel }}
      </span>
      <span
        class="record-page-component__drag shrink-0 cursor-grab text-surface-300 tracking-[-0.15em] active:cursor-grabbing"
        aria-hidden="true"
      >⠿</span>
    </div>
    <div class="record-page-canvas-field__control">
      <div class="record-page-canvas-field__placeholder">
        —
      </div>
    </div>
  </div>

  <div
    v-else
    class="record-page-canvas-component"
    :class="{ 'record-page-canvas-component--selected': selected }"
    :style="gridItemStyle"
    @click.stop="onSelectSelf"
  >
    <div
      class="record-page-canvas-component__chrome"
      :class="{ 'record-page-canvas-component__chrome--compact': component.type === 'highlights' }"
    >
      <div class="min-w-0 flex-1">
        <div class="truncate text-[0.85rem] font-semibold">
          {{ component.label || typeLabel }}
        </div>
        <div
          v-if="component.type !== 'highlights'"
          class="truncate text-[0.75rem] text-muted-color"
        >
          {{ typeLabel }}
          <template v-if="subtitle">
            · {{ subtitle }}
          </template>
        </div>
      </div>
      <span
        class="record-page-component__drag shrink-0 cursor-grab text-surface-300 active:cursor-grabbing"
        aria-hidden="true"
      >⠿</span>
    </div>

    <div
      v-if="component.type === 'detail'"
      class="record-page-canvas-component__preview"
      @wheel.stop
    >
      <div
        v-if="blockLoading"
        class="px-3 py-4 text-center text-sm text-muted-color"
      >
        {{ t('recordPage.canvasLoadingBlock', 'Loading Block Layout…') }}
      </div>
      <Message
        v-else-if="blockError"
        severity="warn"
        :closable="false"
        class="m-0"
      >
        {{ blockError }}
      </Message>
      <FormRendererLight
        v-else-if="detailPreviewSchema"
        :schema="detailPreviewSchema"
        :model-value="previewModel"
        :parent-name="collection"
        :m2a-editable="false"
      />
    </div>

    <div
      v-else-if="component.type === 'highlights'"
      class="record-page-canvas-component__highlights"
    >
      <div class="record-page-canvas-component__actions record-page-canvas-component__actions--compact">
        <span
          v-for="label in visiblePreviewActions"
          :key="label"
          class="record-page-canvas-component__action-chip"
        >
          {{ label }}
        </span>
        <span
          v-if="overflowPreviewCount > 0"
          class="record-page-canvas-component__action-chip record-page-canvas-component__action-chip--overflow"
          :title="t('recordPage.actionsOverflowPreview', '{count} more in overflow', { count: overflowPreviewCount })"
        >
          ▾
        </span>
      </div>
    </div>

    <div
      v-else-if="component.type === 'actions'"
      class="record-page-canvas-component__actions"
    >
      <span class="text-[0.8rem] text-muted-color">
        {{ t('recordPage.actionsDeprecated', 'Actions moved to Highlights. Remove this component.') }}
      </span>
    </div>

    <div
      v-else-if="component.type === 'fieldGroup'"
      class="record-page-canvas-component__field-group"
      @click.stop="emit('select', component.id)"
    >
      <div class="record-page-canvas-component__field-group-card">
        <button
          type="button"
          class="record-page-canvas-component__field-group-header"
          @click.stop="fieldGroupCollapsed = !fieldGroupCollapsed; emit('select', component.id)"
        >
          <span class="truncate">{{ fieldGroupTitle }}</span>
          <i
            :class="fieldGroupCollapsed ? 'pi pi-chevron-down' : 'pi pi-chevron-up'"
            class="text-xs text-muted-color"
          />
        </button>
        <div
          v-show="!fieldGroupCollapsed"
          class="record-page-canvas-component__field-group-body"
        >
          <VueDraggableNext
            :list="ensureLocalFieldGroupChildren()"
            :group="{ name: 'record-page' }"
            item-key="id"
            tag="div"
            class="record-page-canvas-grid record-page-canvas-grid--group"
            handle=".record-page-component__drag"
            ghost-class="record-page-component--ghost"
            chosen-class="record-page-component--chosen"
            v-bind="DIALOG_SORTABLE_ATTRS"
            @change="emit('fieldGroupChange', $event, component)"
          >
            <RecordPageCanvasComponent
              v-for="child in ensureLocalFieldGroupChildren()"
              :key="child.id"
              :component="child"
              :collection="collection"
              :selected-component-id="selectedComponentId"
              :default-block-layout-id="defaultBlockLayoutId"
              :block-layout-name="blockLayoutName"
              :compact-layout-name="compactLayoutName"
              :active-tab-id="null"
              :inline-labels="component.inlineLabels !== false"
              :force-span="(component.columns ?? 2) === 1 ? 12 : 6"
              @select="emit('select', $event)"
              @set-active-tab="(id, tabId) => emit('setActiveTab', id, tabId)"
              @tab-change="emit('tabChange', $event)"
              @field-group-change="(event, group) => emit('fieldGroupChange', event, group)"
            />
          </VueDraggableNext>
          <p
            v-if="ensureLocalFieldGroupChildren().length === 0"
            class="m-0 px-1 py-3 text-center text-[0.75rem] text-muted-color"
          >
            {{ t('recordPage.dragFieldsIntoGroup', 'Add Field(s) Here') }}
          </p>
        </div>
      </div>
    </div>

    <div
      v-else-if="component.type === 'tabs'"
      class="record-page-canvas-component__tabs"
      @click.stop
    >
      <div class="record-page-canvas-component__tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="record-page-canvas-component__tab"
          :class="{ 'record-page-canvas-component__tab--active': activeTab?.id === tab.id }"
          @click="onSelectTab(tab.id)"
        >
          {{ tab.title }}
        </button>
      </div>
      <div
        v-if="activeTab"
        class="record-page-canvas-component__tab-body"
      >
        <VueDraggableNext
          :list="activeTab.components"
          :group="{ name: 'record-page' }"
          item-key="id"
          tag="div"
          class="record-page-canvas-grid min-h-[5rem]"
          handle=".record-page-component__drag"
          ghost-class="record-page-component--ghost"
          chosen-class="record-page-component--chosen"
          v-bind="DIALOG_SORTABLE_ATTRS"
          @change="emit('tabChange', $event)"
        >
          <RecordPageCanvasComponent
            v-for="child in activeTab.components"
            :key="child.id"
            :component="child"
            :collection="collection"
            :selected-component-id="selectedComponentId"
            :default-block-layout-id="defaultBlockLayoutId"
            :block-layout-name="blockLayoutName"
            :compact-layout-name="compactLayoutName"
            :active-tab-id="null"
            :inline-labels="child.inlineLabels !== false"
            @select="emit('select', $event)"
            @set-active-tab="(id, tabId) => emit('setActiveTab', id, tabId)"
            @tab-change="emit('tabChange', $event)"
            @field-group-change="(event, group) => emit('fieldGroupChange', event, group)"
          />
        </VueDraggableNext>
        <p
          v-if="activeTab.components.length === 0"
          class="m-0 px-1 py-2 text-[0.75rem] text-muted-color"
        >
          {{ t('recordPage.dragIntoTab', 'Drag components into this tab.') }}
        </p>
      </div>
    </div>

    <div
      v-else
      class="record-page-canvas-component__placeholder"
    >
      {{ typeLabel }}
    </div>
  </div>
</template>

<style scoped>
.record-page-canvas-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.4rem 0.6rem;
  background: #fff;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}

.record-page-canvas-field--inline {
  flex-direction: row;
  align-items: center;
  gap: 0.65rem;
}

.record-page-canvas-field:hover {
  border-color: transparent;
  box-shadow: none;
}

.record-page-canvas-field--selected {
  border-color: #6f868c;
  box-shadow: 0 0 0 1px #6f868c;
}

.record-page-canvas-field__label-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: #111;
}

.record-page-canvas-field--inline .record-page-canvas-field__label-row {
  flex: 0 0 7.1rem;
}

.record-page-canvas-field__control {
  min-width: 0;
  pointer-events: none;
}

.record-page-canvas-field--inline .record-page-canvas-field__control {
  flex: 1 1 auto;
}

.record-page-canvas-field__placeholder {
  min-height: 2rem;
  padding: 0.35rem 0.75rem;
  border: 0;
  border-radius: 6px;
  background: #edf3f4;
  color: #9ca3af;
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.35;
}

.record-page-canvas-field--selected .record-page-canvas-field__placeholder {
  color: #374151;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px #8fa3a8;
}

.record-page-canvas-component {
  border: 1px solid #8fa3a8;
  border-radius: 8px;
  background: #edf3f4;
  overflow: hidden;
}

.record-page-canvas-component--selected {
  background: #e4eef0;
  border-color: #6f868c;
  box-shadow: 0 0 0 1px #6f868c;
}

.record-page-canvas-component__chrome {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.7rem 0.85rem 0.35rem;
  border-bottom: 0;
  background: transparent;
  cursor: pointer;
  font-weight: 700;
  color: #111;
}

.record-page-canvas-component__chrome--compact {
  padding: 0.4rem 0.65rem 0.15rem;
}

.record-page-canvas-component__preview {
  pointer-events: auto;
  max-height: 28rem;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.55rem 0.75rem 0.75rem;
  background: transparent;
}

.record-page-canvas-component__preview :deep(*) {
  pointer-events: none;
}

.record-page-canvas-component__placeholder {
  padding: 0.85rem 0.75rem;
  font-size: 0.8rem;
  color: rgba(55, 53, 47, 0.45);
}

.record-page-canvas-component__highlights {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.record-page-canvas-component__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.55rem 0.65rem;
}

.record-page-canvas-component__actions--compact {
  gap: 0.25rem;
  padding: 0.2rem 0.65rem 0.45rem;
}

.record-page-canvas-component__actions--compact .record-page-canvas-component__action-chip {
  padding: 0.22rem 0.55rem;
  font-size: 0.75rem;
  border-radius: 6px;
}

.record-page-canvas-component__action-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.38rem 0.7rem;
  border: 1px solid rgba(55, 53, 47, 0.14);
  border-radius: 8px;
  background: #fff;
  font-size: 0.8rem;
  font-weight: 500;
  color: #37352f;
}

.record-page-canvas-component__action-chip--overflow {
  min-width: 1.75rem;
  justify-content: center;
  font-weight: 600;
}

.record-page-canvas-component__tabs {
  padding: 0.55rem 0.65rem;
}

.record-page-canvas-component__tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  border-bottom: 0;
  padding: 0.4rem 0.55rem;
  border: 1px solid #8fa3a8;
  border-radius: 8px;
  background: #edf3f4;
}

.record-page-canvas-component__tab {
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #37352f;
  padding: 0.28rem 0.5rem;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.record-page-canvas-component__tab--active {
  border-color: #6f868c;
  background: #fff;
  color: #191918;
  font-weight: 600;
  box-shadow: 0 0 0 1px #6f868c;
}

.record-page-canvas-component__tab-body {
  min-height: 5rem;
  padding: 0.55rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
}

.record-page-canvas-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.25rem 0.4rem;
  align-content: start;
}

.record-page-canvas-grid--group {
  min-height: 3.25rem;
  padding: 0.55rem 0.75rem 0.7rem;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.record-page-canvas-component__field-group {
  padding: 0.35rem 0;
}

.record-page-canvas-component__field-group-card {
  overflow: hidden;
  border: 1px solid #8fa3a8;
  border-radius: 8px;
  background: #edf3f4;
}

.record-page-canvas-component__field-group-header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 0.9rem 0.35rem;
  border: 0;
  background: transparent;
  color: #111;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.record-page-canvas-component__field-group-body {
  padding: 0.15rem 0.55rem 0.7rem;
}
</style>
