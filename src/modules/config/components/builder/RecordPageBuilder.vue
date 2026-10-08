<script lang="ts">
export default {
  name: 'RecordPageBuilder',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import { useTranslation } from '@/core/translation'
import { isDateComponent } from '@/core/dateFormatting'
import type {
  ActivityLogAction,
  PrimeVueComponentType,
  RecordPageComponent,
  RecordPageComponentType,
  RecordPageLayoutSchema,
  RecordPageListDetailPanel,
  RecordPageRegion,
  SavedRoleScopedLayout,
} from '@/interfaces'
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_VISIBLE_ACTION_BUTTONS,
  normalizeActivityLogSettings,
} from '@/interfaces'
import type { PaletteItem } from '@/modules/entities/utils/fieldPalette'
import { buildLivePalette } from '@/modules/entities/services/collectionSchema'
import { FILES_ASSET_COLLECTION } from '@/core/filesField'
import {
  loadCompactLayouts,
  loadEntityForms,
} from '../../services/layoutSettings'
import { clampRecordPageMainSize } from '../../services/recordPageSettings'
import { resolveRecordPageListDetailContent } from '../../utils/recordPageRelatedList'
import PaletteSkeleton from '../PaletteSkeleton.vue'
import RecordPageCanvasComponent from './RecordPageCanvasComponent.vue'
import { DIALOG_SORTABLE_ATTRS } from '../../utils/dialogSortable'

interface RecordPagePaletteItem {
  id: string
  kind: 'pageLayout' | 'field' | 'component'
  label: string
  icon: string
  pageLayoutId?: string
  field?: string
  fieldComponent?: PrimeVueComponentType
  relatedCollection?: string
  componentType?: Exclude<RecordPageComponentType, 'detail' | 'field'>
}

const PALETTE_ICONS: Record<string, string> = {
  InputText: 'T',
  InputNumber: '#',
  Textarea: '¶',
  Editor: 'H',
  Select: '▾',
  AutoComplete: 'AC',
  DatePicker: '▦',
  Checkbox: '☑',
  DataTable: 'DT',
  CrmTreeTable: 'TT',
  CrmScheduler: 'SC',
  CrmActivityLog: 'AL',
  Files: 'FL',
  ChildLookup: 'CL',
  M2ABuilder: 'M2',
  Repeater: 'RP',
  pageLayout: 'PL',
  highlights: '★',
  relatedList: 'RL',
  files: 'FL',
  activityLog: 'AL',
  tabs: '☰',
  actions: '⚡',
  fieldGroup: '§',
}

const props = defineProps<{
  collection: string
}>()

const schema = defineModel<RecordPageLayoutSchema>('modelValue', { required: true })
const { t } = useTranslation()

function clearBuilderTextSelection(): void {
  window.getSelection()?.removeAllRanges()
}

function onBuilderSplitterResizeStart(): void {
  document.body.classList.add('builder-splitter-resizing')
  clearBuilderTextSelection()
}

function onBuilderSplitterResizeEnd(): void {
  document.body.classList.remove('builder-splitter-resizing')
  clearBuilderTextSelection()
}

const paletteTab = ref<'pageLayouts' | 'fields' | 'components'>('pageLayouts')
const selectedComponentId = ref<string | null>(null)
const pageLayouts = ref<SavedRoleScopedLayout[]>([])
const compactLayouts = ref<SavedRoleScopedLayout[]>([])
const fieldPaletteItems = ref<PaletteItem[]>([])
const paletteLoading = ref(false)
const paletteError = ref<string | null>(null)
const canvasZoom = ref<'fit' | '1' | '0.75' | '0.5' | '0.25'>('fit')
const fitScale = ref(1)
const contentSizeVersion = ref(0)
const canvasViewportRef = ref<HTMLElement | null>(null)
const canvasContentRef = ref<HTMLElement | null>(null)
let canvasResizeObserver: ResizeObserver | null = null
/** Active tab id per Tabs component (builder canvas/properties). */
const activeTabByComponentId = ref<Record<string, string>>({})

const canvasZoomOptions = computed(() => [
  {
    label: t('recordPage.zoom.shrinkToView', 'Shrink to view'),
    value: 'fit' as const,
  },
  {
    label: t('recordPage.zoom.percent', '{percent}%', { percent: 100 }),
    value: '1' as const,
  },
  {
    label: t('recordPage.zoom.percent', '{percent}%', { percent: 75 }),
    value: '0.75' as const,
  },
  {
    label: t('recordPage.zoom.percent', '{percent}%', { percent: 50 }),
    value: '0.5' as const,
  },
  {
    label: t('recordPage.zoom.percent', '{percent}%', { percent: 25 }),
    value: '0.25' as const,
  },
])

const listDetailPreviewLabels = ref<string[]>([])
const listDetailPreviewLoading = ref(false)

const listDetailPanelEnabled = computed(() => Boolean(schema.value.listDetailPanel?.enabled))

const sidebarEnabled = computed({
  get: () => schema.value.sidebarEnabled !== false,
  set: (enabled: boolean) => {
    schema.value = { ...schema.value, sidebarEnabled: enabled }
  },
})

const mainSize = computed({
  get: () => clampRecordPageMainSize(schema.value.mainSize),
  set: (value: number | null) => {
    schema.value = {
      ...schema.value,
      mainSize: clampRecordPageMainSize(value ?? 50),
    }
  },
})

const sidebarSize = computed(() => 100 - mainSize.value)

function onBodySplitterResizeEnd(event: { sizes?: number[] }): void {
  onBuilderSplitterResizeEnd()
  const nextMain = event.sizes?.[0]
  if (typeof nextMain === 'number' && Number.isFinite(nextMain)) {
    mainSize.value = nextMain
  }
}

function patchListDetailPanel(patch: Partial<RecordPageListDetailPanel> | null): void {
  if (patch === null || patch.enabled === false) {
    schema.value = { ...schema.value, listDetailPanel: null }
    return
  }
  const current = schema.value.listDetailPanel
  const defaultCollapsed =
    patch.defaultCollapsed !== undefined
      ? patch.defaultCollapsed === true
      : current?.defaultCollapsed === true
  const next: RecordPageListDetailPanel = {
    enabled: true,
    masterSize: patch.masterSize ?? current?.masterSize ?? 60,
    detailMinSize: patch.detailMinSize ?? current?.detailMinSize ?? 15,
    ...(defaultCollapsed ? { defaultCollapsed: true } : {}),
  }
  schema.value = { ...schema.value, listDetailPanel: next }
}

function enableListDetailPanel(): void {
  patchListDetailPanel({
    enabled: true,
    masterSize: schema.value.listDetailPanel?.masterSize ?? 60,
    detailMinSize: schema.value.listDetailPanel?.detailMinSize ?? 15,
  })
}

function disableListDetailPanel(): void {
  patchListDetailPanel(null)
}

const listDetailMasterSize = computed({
  get: () => schema.value.listDetailPanel?.masterSize ?? 60,
  set: (value: number | null) => {
    if (!listDetailPanelEnabled.value) return
    const masterSize =
      value !== null && Number.isFinite(value)
        ? Math.min(95, Math.max(20, Math.round(value)))
        : 60
    patchListDetailPanel({ masterSize })
  },
})

const listDetailMinSize = computed({
  get: () => schema.value.listDetailPanel?.detailMinSize ?? 15,
  set: (value: number | null) => {
    if (!listDetailPanelEnabled.value) return
    const detailMinSize =
      value !== null && Number.isFinite(value)
        ? Math.min(50, Math.max(5, Math.round(value)))
        : 15
    patchListDetailPanel({ detailMinSize })
  },
})

const listDetailDefaultCollapsed = computed({
  get: () => schema.value.listDetailPanel?.defaultCollapsed === true,
  set: (defaultCollapsed: boolean) => {
    if (!listDetailPanelEnabled.value) return
    patchListDetailPanel(
      defaultCollapsed ? { defaultCollapsed: true } : { defaultCollapsed: false },
    )
  },
})

async function refreshListDetailPreview(): Promise<void> {
  if (!props.collection || !listDetailPanelEnabled.value) {
    listDetailPreviewLabels.value = []
    return
  }
  listDetailPreviewLoading.value = true
  try {
    const { fields } = await resolveRecordPageListDetailContent(props.collection, schema.value)
    listDetailPreviewLabels.value = fields.map(
      (field) => field.label?.trim() || field.relatedCollection || field.field,
    )
  } catch {
    listDetailPreviewLabels.value = []
  } finally {
    listDetailPreviewLoading.value = false
  }
}

const canvasScale = computed(() => {
  if (canvasZoom.value === 'fit') return fitScale.value
  const parsed = Number(canvasZoom.value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
})

const canvasStageStyle = computed(() => {
  void contentSizeVersion.value
  const content = canvasContentRef.value
  const height = content?.scrollHeight ?? 0
  const scale = canvasScale.value
  return {
    width: '100%',
    height: height > 0 ? `${height * scale}px` : 'auto',
  }
})

const canvasContentStyle = computed(() => {
  const scale = canvasScale.value
  return {
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    // Layout wider when zoomed out so the scaled result still fills the panel width.
    width: scale >= 0.999 ? '100%' : `${100 / scale}%`,
  }
})

function updateFitScale(): void {
  const viewport = canvasViewportRef.value
  const content = canvasContentRef.value
  contentSizeVersion.value += 1
  if (!viewport || !content) {
    fitScale.value = 1
    return
  }

  const availableHeight = Math.max(viewport.clientHeight - 8, 1)
  // Estimate at full width first; shrink only when the page is taller than the viewport.
  const contentHeight = Math.max(content.scrollHeight, 1)
  const next = Math.min(1, availableHeight / contentHeight)
  fitScale.value = Number.isFinite(next) && next > 0 ? next : 1
}

function bindCanvasObservers(): void {
  canvasResizeObserver?.disconnect()
  canvasResizeObserver = null
  const viewport = canvasViewportRef.value
  const content = canvasContentRef.value
  if (!viewport || !content || typeof ResizeObserver === 'undefined') {
    updateFitScale()
    return
  }
  canvasResizeObserver = new ResizeObserver(() => {
    updateFitScale()
  })
  canvasResizeObserver.observe(viewport)
  canvasResizeObserver.observe(content)
  updateFitScale()
}

const SPAN_OPTIONS = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    label: t(
      i + 1 === 1 ? 'formBuilder.columnSingular' : 'formBuilder.columns',
      i + 1 === 1 ? '{count} column' : '{count} columns',
      { count: i + 1 },
    ),
    value: i + 1,
  })),
)

const structuralComponentItems = computed<RecordPagePaletteItem[]>(() => [
  {
    id: 'cmp-highlights',
    kind: 'component',
    label: t('recordPage.component.highlights', 'Highlights'),
    icon: PALETTE_ICONS.highlights,
    componentType: 'highlights',
  },
  {
    id: 'cmp-fieldGroup',
    kind: 'component',
    label: t('recordPage.component.fieldGroup', 'Field group'),
    icon: PALETTE_ICONS.fieldGroup,
    componentType: 'fieldGroup',
  },
  {
    id: 'cmp-relatedList',
    kind: 'component',
    label: t('recordPage.component.relatedList', 'Related List'),
    icon: PALETTE_ICONS.relatedList,
    componentType: 'relatedList',
  },
  {
    id: 'cmp-files',
    kind: 'component',
    label: t('recordPage.component.files', 'Files'),
    icon: PALETTE_ICONS.files,
    componentType: 'files',
  },
  {
    id: 'cmp-activityLog',
    kind: 'component',
    label: t('recordPage.component.activityLog', 'Activity log'),
    icon: PALETTE_ICONS.activityLog,
    componentType: 'activityLog',
  },
  {
    id: 'cmp-tabs',
    kind: 'component',
    label: t('recordPage.component.tabs', 'Tabs'),
    icon: PALETTE_ICONS.tabs,
    componentType: 'tabs',
  },
])

const pageLayoutPaletteItems = computed<RecordPagePaletteItem[]>(() =>
  pageLayouts.value.map((layout) => ({
    id: `layout-${layout.id}`,
    kind: 'pageLayout' as const,
    label: layout.name,
    icon: PALETTE_ICONS.pageLayout,
    pageLayoutId: layout.id,
  })),
)

const fieldPaletteCards = computed<RecordPagePaletteItem[]>(() =>
  fieldPaletteItems.value.map((item) => ({
    id: item.id,
    kind: 'field' as const,
    label: item.label,
    icon: PALETTE_ICONS[item.component] ?? 'F',
    field: item.fieldKey,
    fieldComponent: item.component,
    relatedCollection: item.relatedCollection,
  })),
)

const availableFieldCards = computed(() =>
  fieldPaletteCards.value.filter((item) => !item.field || !assignedFieldKeys.value.has(item.field)),
)

const assignedFieldCards = computed(() =>
  fieldPaletteCards.value.filter((item) => item.field && assignedFieldKeys.value.has(item.field)),
)

/** Mutable palette list — vue-draggable-next needs a writable array, not a computed. */
const paletteDragList = ref<RecordPagePaletteItem[]>([])

function syncPaletteDragList(): void {
  if (paletteTab.value === 'pageLayouts') {
    paletteDragList.value = pageLayoutPaletteItems.value.slice()
    return
  }
  if (paletteTab.value === 'fields') {
    paletteDragList.value = availableFieldCards.value.slice()
    return
  }
  paletteDragList.value = structuralComponentItems.value.slice()
}

const pageLayoutOptions = computed(() =>
  pageLayouts.value.map((layout) => ({
    label: layout.name,
    value: layout.id,
  })),
)

const compactLayoutOptions = computed(() =>
  compactLayouts.value.map((layout) => ({
    label: layout.name,
    value: layout.id,
  })),
)

const headerRegions = computed(() =>
  schema.value.regions.filter((region) => region.key === 'header'),
)
const mainRegion = computed(
  () => schema.value.regions.find((region) => region.key === 'main') ?? null,
)
const sidebarRegion = computed(
  () => schema.value.regions.find((region) => region.key === 'sidebar') ?? null,
)

function walkComponents(
  components: RecordPageComponent[],
  visit: (component: RecordPageComponent) => boolean | void,
): boolean {
  for (const component of components) {
    if (visit(component) === true) return true
    if (component.type === 'fieldGroup' && component.components) {
      if (walkComponents(component.components, visit)) return true
    }
    if (component.tabs) {
      for (const tab of component.tabs) {
        if (walkComponents(tab.components, visit)) return true
      }
    }
  }
  return false
}

function findComponentById(id: string): RecordPageComponent | null {
  let found: RecordPageComponent | null = null
  for (const region of schema.value.regions) {
    walkComponents(region.components, (component) => {
      if (component.id === id) {
        found = component
        return true
      }
    })
    if (found) return found
  }
  return null
}

/** Parent Field group when the selected component is a nested field. */
function findParentFieldGroup(fieldId: string): RecordPageComponent | null {
  let parent: RecordPageComponent | null = null

  function walk(components: RecordPageComponent[]): boolean {
    for (const component of components) {
      if (component.type === 'fieldGroup' && component.components) {
        if (component.components.some((child) => child.id === fieldId)) {
          parent = component
          return true
        }
        if (walk(component.components)) return true
      }
      if (component.tabs) {
        for (const tab of component.tabs) {
          if (walk(tab.components)) return true
        }
      }
    }
    return false
  }

  for (const region of schema.value.regions) {
    if (walk(region.components)) return parent
  }
  return null
}

function collectFieldKeys(components: RecordPageComponent[], keys: Set<string>): void {
  walkComponents(components, (component) => {
    if (component.type === 'field' && component.field) {
      keys.add(component.field)
    }
  })
}

const assignedFieldKeys = computed(() => {
  const keys = new Set<string>()
  for (const region of schema.value.regions) {
    collectFieldKeys(region.components, keys)
  }
  return keys
})

const selectedComponent = computed(() => {
  if (!selectedComponentId.value) return null
  return findComponentById(selectedComponentId.value)
})

const activityLogActionOptions = computed(() => [
  { label: t('activityLog.actionCreate', 'Created'), value: 'create' as ActivityLogAction },
  { label: t('activityLog.actionUpdate', 'Updated'), value: 'update' as ActivityLogAction },
  { label: t('activityLog.actionDelete', 'Deleted'), value: 'delete' as ActivityLogAction },
])

const selectedActivityLogSettings = computed(() =>
  normalizeActivityLogSettings(selectedComponent.value?.activityLog),
)

function updateActivityLogSettings(
  patch: Partial<ReturnType<typeof normalizeActivityLogSettings>>,
): void {
  if (selectedComponent.value?.type !== 'activityLog') return
  updateSelected({
    activityLog: {
      ...selectedActivityLogSettings.value,
      ...patch,
    },
  })
}

const selectedFieldParentGroup = computed(() => {
  if (!selectedComponent.value || selectedComponent.value.type !== 'field') return null
  return findParentFieldGroup(selectedComponent.value.id)
})

const selectedFieldInlineLabels = computed({
  get: () => {
    if (selectedFieldParentGroup.value) {
      return selectedFieldParentGroup.value.inlineLabels !== false
    }
    return selectedComponent.value?.inlineLabels !== false
  },
  set: (inlineLabels: boolean) => {
    if (selectedFieldParentGroup.value) {
      selectedFieldParentGroup.value.inlineLabels = inlineLabels
      return
    }
    updateSelected({ inlineLabels })
  },
})

const selectedTabs = computed(() => {
  const current = selectedComponent.value
  if (!current || current.type !== 'tabs') return []
  return current.tabs ?? []
})

const defaultTabOptions = computed(() =>
  selectedTabs.value.map((tab) => ({
    label: tab.title || t('formBuilder.newTab', 'New Tab'),
    value: tab.id,
  })),
)

function ensureSelectedTabs(): NonNullable<RecordPageComponent['tabs']> {
  const current = selectedComponent.value
  if (!current || current.type !== 'tabs') return []
  if (!current.tabs) current.tabs = []
  return current.tabs
}

const selectedSupportsFormat = computed(() =>
  Boolean(
    selectedComponent.value?.type === 'field'
      && selectedComponent.value.fieldComponent
      && isDateComponent(selectedComponent.value.fieldComponent),
  ),
)

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

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

function pageLayoutName(pageLayoutId: string | null | undefined): string {
  if (!pageLayoutId) {
    return t('recordPage.useDefaultPageLayout', 'Use default')
  }
  return pageLayouts.value.find((layout) => layout.id === pageLayoutId)?.name
    ?? pageLayoutId
}

function clonePaletteItem(item: RecordPagePaletteItem): RecordPageComponent {
  if (item.kind === 'pageLayout') {
    return {
      id: newId('cmp'),
      type: 'detail',
      label: item.label,
      pageLayoutId: item.pageLayoutId ?? null,
    }
  }

  if (item.kind === 'field') {
    const fieldComponent = item.fieldComponent ?? 'InputText'
    return {
      id: newId('cmp'),
      type: 'field',
      label: item.label,
      field: item.field,
      fieldComponent,
      relatedCollection: item.relatedCollection,
      inlineLabels: true,
      span: ['DataTable', 'CrmTreeTable', 'CrmScheduler', 'CrmActivityLog', 'Files', 'M2ABuilder']
        .includes(fieldComponent)
        ? 12
        : 6,
    }
  }

  const type = item.componentType ?? 'highlights'
  if (type === 'tabs') {
    const tabId = newId('tab')
    return {
      id: newId('cmp'),
      type,
      label: item.label,
      pageLayoutId: null,
      defaultTabId: tabId,
      tabs: [{ id: tabId, title: t('formBuilder.newTab', 'New Tab'), components: [] }],
    }
  }

  if (type === 'fieldGroup') {
    return {
      id: newId('cmp'),
      type,
      label: t('recordPage.fieldGroupDefaultLabel', 'Section'),
      pageLayoutId: null,
      columns: 2,
      inlineLabels: true,
      collapsed: false,
      components: [],
    }
  }

  if (type === 'files') {
    return {
      id: newId('cmp'),
      type,
      label: item.label,
      relatedCollection: FILES_ASSET_COLLECTION,
    }
  }

  if (type === 'activityLog') {
    return {
      id: newId('cmp'),
      type,
      label: item.label,
      activityLog: { ...DEFAULT_ACTIVITY_LOG_SETTINGS },
    }
  }

  return {
    id: newId('cmp'),
    type,
    label: item.label,
    pageLayoutId: null,
    compactLayoutId: type === 'highlights' ? null : undefined,
    actionLayoutId: type === 'highlights' ? null : undefined,
    visibleActionButtons: type === 'highlights' ? DEFAULT_VISIBLE_ACTION_BUTTONS : undefined,
  }
}

function selectComponent(componentId: string): void {
  selectedComponentId.value = componentId
}

function openLayoutSetup(): void {
  selectedComponentId.value = null
}

const propertiesSelectionKind = computed(() => {
  if (selectedComponent.value) {
    return componentTypeLabel(selectedComponent.value.type)
  }
  return t('recordPage.pageSettings', 'Page settings')
})

function onRegionAdd(event: { newIndex?: number }, region: RecordPageRegion): void {
  const index = event.newIndex
  if (typeof index !== 'number') return
  const added = region.components[index]
  if (added?.id) {
    selectedComponentId.value = added.id
  }
  if (paletteTab.value === 'fields') {
    syncPaletteDragList()
  }
}

function onRegionChange(
  event: { added?: { newIndex: number; element: RecordPageComponent } },
  region: RecordPageRegion,
): void {
  if (event.added?.element?.id) {
    selectedComponentId.value = event.added.element.id
    if (paletteTab.value === 'fields') {
      syncPaletteDragList()
    }
    return
  }
  onRegionAdd(event as { newIndex?: number }, region)
}

function removeSelectedComponent(): void {
  if (!selectedComponentId.value) return
  const id = selectedComponentId.value

  function removeFromList(components: RecordPageComponent[]): boolean {
    const index = components.findIndex((component) => component.id === id)
    if (index >= 0) {
      components.splice(index, 1)
      return true
    }
    for (const component of components) {
      if (component.type === 'fieldGroup' && component.components) {
        if (removeFromList(component.components)) return true
      }
      if (!component.tabs) continue
      for (const tab of component.tabs) {
        if (removeFromList(tab.components)) return true
      }
    }
    return false
  }

  for (const region of schema.value.regions) {
    if (removeFromList(region.components)) {
      selectedComponentId.value = null
      if (paletteTab.value === 'fields') syncPaletteDragList()
      return
    }
  }
}

function updateSelected(patch: Partial<RecordPageComponent>): void {
  const current = selectedComponent.value
  if (!current) return
  Object.assign(current, patch)
}

function compactLayoutName(compactLayoutId: string | null | undefined): string {
  if (!compactLayoutId) {
    return t('recordPage.useRoleCompactLayout', 'Use role default')
  }
  return compactLayouts.value.find((layout) => layout.id === compactLayoutId)?.name
    ?? compactLayoutId
}

function activeTabIdFor(componentId: string): string | null {
  const component = findComponentById(componentId)
  const tabs = component?.tabs ?? []
  if (!tabs.length) return null
  const current = activeTabByComponentId.value[componentId]
  if (current && tabs.some((tab) => tab.id === current)) return current
  const preferred = component?.defaultTabId
  if (preferred && tabs.some((tab) => tab.id === preferred)) return preferred
  return tabs[0]?.id ?? null
}

function setActiveTab(componentId: string, tabId: string): void {
  activeTabByComponentId.value = {
    ...activeTabByComponentId.value,
    [componentId]: tabId,
  }
}

function addTabToSelected(): void {
  const current = selectedComponent.value
  if (!current || current.type !== 'tabs') return
  const tabs = ensureSelectedTabs()
  const tab = {
    id: newId('tab'),
    title: t('formBuilder.newTab', 'New Tab'),
    components: [] as RecordPageComponent[],
  }
  tabs.push(tab)
  if (!current.defaultTabId) {
    current.defaultTabId = tab.id
  }
  setActiveTab(current.id, tab.id)
}

function removeTabFromSelected(tabId: string): void {
  const current = selectedComponent.value
  if (!current || current.type !== 'tabs') return
  const tabs = ensureSelectedTabs()
  if (tabs.length <= 1) return
  const index = tabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return
  tabs.splice(index, 1)
  if (current.defaultTabId === tabId) {
    current.defaultTabId = tabs[0]?.id ?? null
  }
  const next = tabs[Math.max(0, index - 1)]
  if (next) setActiveTab(current.id, next.id)
}

function updateTabTitle(tabId: string, title: string): void {
  const tabs = ensureSelectedTabs()
  const tab = tabs.find((item) => item.id === tabId)
  if (tab) tab.title = title
}

function updateDefaultTab(tabId: string | null): void {
  const current = selectedComponent.value
  if (!current || current.type !== 'tabs') return
  current.defaultTabId = tabId
  if (tabId) setActiveTab(current.id, tabId)
}

function onTabRegionChange(
  event: { added?: { element: RecordPageComponent } },
): void {
  if (event.added?.element?.id) {
    selectedComponentId.value = event.added.element.id
    if (paletteTab.value === 'fields') syncPaletteDragList()
  }
}

function ensureFieldGroupChildren(component: RecordPageComponent): RecordPageComponent[] {
  if (component.type !== 'fieldGroup') return []
  if (!component.components) component.components = []
  return component.components
}

function onFieldGroupChange(
  event: { added?: { newIndex: number; element: RecordPageComponent } },
  fieldGroup: RecordPageComponent,
): void {
  const children = ensureFieldGroupChildren(fieldGroup)
  if (event.added?.element) {
    if (event.added.element.type !== 'field') {
      children.splice(event.added.newIndex, 1)
      return
    }
    // Match Field group column layout for newly added fields.
    const defaultSpan = (fieldGroup.columns ?? 2) === 1 ? 12 : 6
    if (event.added.element.span == null) {
      event.added.element.span = defaultSpan
    }
    selectedComponentId.value = event.added.element.id
    if (paletteTab.value === 'fields') syncPaletteDragList()
  }
}

async function loadPalette(): Promise<void> {
  if (!props.collection) {
    pageLayouts.value = []
    compactLayouts.value = []
    fieldPaletteItems.value = []
    return
  }

  paletteLoading.value = true
  paletteError.value = null
  try {
    const [forms, compact, fields] = await Promise.all([
      loadEntityForms(props.collection),
      loadCompactLayouts(props.collection),
      buildLivePalette(props.collection),
    ])
    pageLayouts.value = forms
    compactLayouts.value = compact
    fieldPaletteItems.value = fields
  } catch (err) {
    paletteError.value =
      err instanceof Error
        ? err.message
        : t('formBuilder.loadSchemaError', 'Failed to load collection schema from the registry.')
    pageLayouts.value = []
    compactLayouts.value = []
    fieldPaletteItems.value = []
  } finally {
    paletteLoading.value = false
  }
}

function onRelatedListBlockLayoutChange(pageLayoutId: string | null): void {
  updateSelected({
    pageLayoutId,
    relatedFieldId: null,
    relatedCollection: undefined,
  })
}

function ensureRegions(): void {
  const keys: Array<RecordPageRegion['key']> = ['header', 'main', 'sidebar']
  const titles: Record<RecordPageRegion['key'], string> = {
    header: t('recordPage.region.header', 'Header'),
    main: t('recordPage.region.main', 'Main'),
    sidebar: t('recordPage.region.sidebar', 'Sidebar'),
  }
  for (const key of keys) {
    if (!schema.value.regions.some((region) => region.key === key)) {
      schema.value.regions.push({
        id: newId('region'),
        key,
        title: titles[key],
        components: [],
      })
    }
  }
}

watch(
  () => props.collection,
  () => {
    void loadPalette()
  },
)

watch(
  () => [props.collection, schema.value.regions, schema.value.pageLayoutId, listDetailPanelEnabled.value] as const,
  () => {
    void refreshListDetailPreview()
  },
  { deep: true, immediate: true },
)

watch(
  [
    paletteTab,
    pageLayouts,
    fieldPaletteItems,
    assignedFieldKeys,
    structuralComponentItems,
  ],
  () => {
    syncPaletteDragList()
  },
  { deep: true, immediate: true },
)

watch(
  schema,
  () => {
    ensureRegions()
    if (
      selectedComponentId.value
      && !findComponentById(selectedComponentId.value)
    ) {
      selectedComponentId.value = null
    }
  },
  { deep: true, immediate: true },
)

onMounted(() => {
  void loadPalette()
  void nextTick(() => {
    bindCanvasObservers()
  })
})

onBeforeUnmount(() => {
  canvasResizeObserver?.disconnect()
  canvasResizeObserver = null
})

watch(
  () => [schema.value.regions, canvasZoom.value, paletteLoading.value] as const,
  async () => {
    await nextTick()
    bindCanvasObservers()
  },
  { deep: true },
)
</script>

<template>
  <div class="record-page-builder h-full min-h-0 min-w-0">
    <Splitter
      class="record-page-builder__main min-h-0 min-w-0 h-full"
      layout="horizontal"
      state-key="crm.recordPageBuilder.leftSplitter"
      state-storage="local"
      @resizestart="onBuilderSplitterResizeStart"
      @resizeend="onBuilderSplitterResizeEnd"
    >
      <SplitterPanel
        :size="22"
        :min-size="14"
        class="record-page-builder__palette-pane min-h-0 min-w-0"
      >
    <aside class="palette flex w-full h-full min-h-0 flex-col">
      <h2 class="m-0 mb-1 text-base font-semibold">
        {{ t('formBuilder.available', 'Available') }}
      </h2>
      <p class="mb-3 mt-0 text-[0.8rem] text-muted-color">
        {{ t('recordPage.fromObject', '{collection} · block layouts & fields', { collection }) }}
      </p>

      <div
        class="mb-3 grid shrink-0 grid-cols-1 gap-[0.35rem]"
        role="tablist"
        :aria-label="t('recordPage.availablePalette', 'Page layout palette')"
      >
        <button
          type="button"
          class="palette-tabs__tab"
          :class="{ 'palette-tabs__tab--active': paletteTab === 'pageLayouts' }"
          @click="paletteTab = 'pageLayouts'"
        >
          {{ t('recordPage.tab.pageLayouts', 'Block Layouts') }}
        </button>
        <button
          type="button"
          class="palette-tabs__tab"
          :class="{ 'palette-tabs__tab--active': paletteTab === 'fields' }"
          @click="paletteTab = 'fields'"
        >
          {{ t('formBuilder.fields', 'Fields') }}
        </button>
        <button
          type="button"
          class="palette-tabs__tab"
          :class="{ 'palette-tabs__tab--active': paletteTab === 'components' }"
          @click="paletteTab = 'components'"
        >
          {{ t('recordPage.tab.components', 'Components') }}
        </button>
      </div>

      <div class="palette-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          v-if="paletteLoading"
          class="flex flex-col items-stretch gap-3 py-2 text-[0.85rem] text-muted-color"
        >
          <ProgressSpinner
            class="h-9 w-9 self-center"
            stroke-width="4"
            :aria-label="t('formBuilder.loadingFields', 'Loading fields')"
          />
          <PaletteSkeleton :rows="5" />
        </div>

        <Message
          v-else-if="paletteError"
          severity="error"
          :closable="false"
          class="m-0"
        >
          {{ paletteError }}
        </Message>

        <template v-else>
          <p
            v-if="paletteDragList.length === 0 && paletteTab !== 'fields'"
            class="mb-0 mt-3 text-center text-[0.8rem] text-surface-400"
          >
            {{
              paletteTab === 'pageLayouts'
                ? t('recordPage.noPageLayouts', 'No Block Layouts yet. Create one under Block Layouts.')
                : t('recordPage.noComponents', 'No structural components.')
            }}
          </p>

          <VueDraggableNext
            v-if="paletteDragList.length > 0"
            :list="paletteDragList"
            :group="{ name: 'record-page', pull: 'clone', put: false }"
            :sort="false"
            :clone="clonePaletteItem"
            v-bind="DIALOG_SORTABLE_ATTRS"
            item-key="id"
            tag="div"
            class="flex min-h-8 flex-col gap-[0.55rem]"
          >
            <div
              v-for="element in paletteDragList"
              :key="element.id"
              class="palette-card"
            >
              <span
                class="palette-card__icon"
                aria-hidden="true"
              >{{ element.icon }}</span>
              <span class="min-w-0 flex-1 truncate text-[0.875rem] font-semibold leading-tight text-surface-950">
                {{ element.label }}
              </span>
              <span
                class="shrink-0 text-[0.9rem] tracking-[-0.15em] text-surface-300"
                aria-hidden="true"
              >⠿</span>
            </div>
          </VueDraggableNext>

          <div
            v-if="paletteTab === 'fields' && assignedFieldCards.length > 0"
            class="mt-4 flex flex-col gap-[0.45rem] border-t border-dashed border-surface-300 pt-3"
          >
            <p class="mb-1 mt-0 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-surface-400">
              {{ t('formBuilder.onCanvas', 'On canvas') }}
            </p>
            <div
              v-for="element in assignedFieldCards"
              :key="element.id"
              class="palette-card palette-card--assigned"
            >
              <span
                class="palette-card__icon"
                aria-hidden="true"
              >{{ element.icon }}</span>
              <span class="min-w-0 flex-1 truncate text-[0.875rem] font-semibold leading-tight text-surface-950">
                {{ element.label }}
              </span>
            </div>
          </div>

          <p
            v-if="paletteTab === 'fields' && paletteDragList.length === 0 && assignedFieldCards.length > 0"
            class="mb-0 mt-3 text-center text-[0.8rem] text-surface-400"
          >
            {{ t('formBuilder.allFieldsOnCanvas', 'All fields are on the canvas.') }}
          </p>
        </template>
      </div>
    </aside>
      </SplitterPanel>

      <SplitterPanel
        :size="78"
        :min-size="45"
        class="record-page-builder__workspace-pane min-h-0 min-w-0"
      >
      <Splitter
        class="record-page-builder__workspace min-h-0 min-w-0 h-full"
        layout="horizontal"
        state-key="crm.recordPageBuilder.rightSplitter"
        state-storage="local"
        @resizestart="onBuilderSplitterResizeStart"
        @resizeend="onBuilderSplitterResizeEnd"
      >
      <SplitterPanel
        :size="72"
        :min-size="40"
        class="record-page-builder__canvas-pane min-h-0 min-w-0"
      >
    <section class="record-page-canvas-panel flex h-full max-h-full min-h-0 flex-col overflow-hidden">
      <div class="record-page-canvas-toolbar flex shrink-0 flex-wrap items-end justify-between gap-3 p-4">
        <div>
          <h2 class="m-0 mb-1 text-base font-semibold">
            {{ t('recordPage.canvasTitle', 'Page layout canvas') }}
          </h2>
          <p class="m-0 text-[0.8rem] text-muted-color">
            {{ t('recordPage.canvasHint', 'Drag Block Layouts, fields, and components into regions.') }}
          </p>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-[10rem] flex-col gap-[0.35rem]">
            <label class="text-[0.8rem] font-semibold leading-tight text-surface-700">
              {{ t('recordPage.zoom.label', 'Zoom') }}
            </label>
            <Select
              v-model="canvasZoom"
              :options="canvasZoomOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>
          <div class="flex min-w-[14rem] flex-col gap-[0.35rem]">
            <label class="text-[0.8rem] font-semibold leading-tight text-surface-700">
              {{ t('recordPage.defaultPageLayout', 'Default Block Layout') }}
            </label>
            <Select
              v-model="schema.pageLayoutId"
              :options="pageLayoutOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('recordPage.selectPageLayout', 'Select a Block Layout')"
              show-clear
              class="w-full"
            />
          </div>
        </div>
      </div>

      <div
        ref="canvasViewportRef"
        class="record-page-canvas-viewport min-h-0 flex-1 overflow-auto p-4"
      >
        <div
          class="record-page-canvas-stage"
          :style="canvasStageStyle"
        >
          <div
            ref="canvasContentRef"
            class="record-page-canvas-content"
            :style="canvasContentStyle"
          >
      <div
        v-for="region in headerRegions"
        :key="region.id"
        class="record-page-region mb-3"
      >
        <div class="record-page-region__header">
          <h3 class="m-0 text-[0.9rem] font-semibold text-surface-900">
            {{ region.title || t('recordPage.region.header', 'Header') }}
          </h3>
        </div>
        <div class="record-page-region__drop">
          <VueDraggableNext
            :list="region.components"
            :group="{ name: 'record-page' }"
            item-key="id"
            tag="div"
            class="record-page-region__body grid min-h-[4.5rem] grid-cols-12 content-start gap-2"
            handle=".record-page-component__drag"
            ghost-class="record-page-component--ghost"
            chosen-class="record-page-component--chosen"
            v-bind="DIALOG_SORTABLE_ATTRS"
            @change="onRegionChange($event, region)"
          >
            <RecordPageCanvasComponent
              v-for="component in region.components"
              :key="component.id"
              :component="component"
              :collection="collection"
              :selected-component-id="selectedComponentId"
              :default-block-layout-id="schema.pageLayoutId"
              :block-layout-name="pageLayoutName"
              :compact-layout-name="compactLayoutName"
              :active-tab-id="activeTabIdFor(component.id)"
              :inline-labels="component.inlineLabels !== false"
              @select="selectComponent"
              @set-active-tab="setActiveTab"
              @tab-change="onTabRegionChange"
              @field-group-change="onFieldGroupChange"
            />
          </VueDraggableNext>
          <p
            v-if="region.components.length === 0"
            class="record-page-region__empty"
          >
            {{ t('recordPage.dragIntoRegion', 'Drag components into this region.') }}
          </p>
        </div>
      </div>

      <div
        v-if="mainRegion && !sidebarEnabled"
        class="record-page-region"
      >
        <div class="record-page-region__header record-page-region__header--row">
          <h3 class="m-0 text-[0.9rem] font-semibold text-surface-900">
            {{ mainRegion.title || t('recordPage.region.main', 'Main') }}
          </h3>
          <Button
            :label="t('recordPage.sidebarEnable', 'Enable Sidebar')"
            size="small"
            severity="secondary"
            text
            @click="sidebarEnabled = true"
          />
        </div>
        <div class="record-page-region__drop">
          <VueDraggableNext
            :list="mainRegion.components"
            :group="{ name: 'record-page' }"
            item-key="id"
            tag="div"
            class="record-page-region__body grid min-h-[12rem] grid-cols-12 content-start gap-2"
            handle=".record-page-component__drag"
            ghost-class="record-page-component--ghost"
            chosen-class="record-page-component--chosen"
            v-bind="DIALOG_SORTABLE_ATTRS"
            @change="onRegionChange($event, mainRegion)"
          >
            <RecordPageCanvasComponent
              v-for="component in mainRegion.components"
              :key="component.id"
              :component="component"
              :collection="collection"
              :selected-component-id="selectedComponentId"
              :default-block-layout-id="schema.pageLayoutId"
              :block-layout-name="pageLayoutName"
              :compact-layout-name="compactLayoutName"
              :active-tab-id="activeTabIdFor(component.id)"
              :inline-labels="component.inlineLabels !== false"
              @select="selectComponent"
              @set-active-tab="setActiveTab"
              @tab-change="onTabRegionChange"
              @field-group-change="onFieldGroupChange"
            />
          </VueDraggableNext>
          <p
            v-if="mainRegion.components.length === 0"
            class="record-page-region__empty"
          >
            {{ t('recordPage.dragIntoRegion', 'Drag components into this region.') }}
          </p>
        </div>
      </div>

      <Splitter
        v-else-if="mainRegion && sidebarRegion"
        class="record-page-body-splitter"
        layout="horizontal"
        @resizestart="onBuilderSplitterResizeStart"
        @resizeend="onBodySplitterResizeEnd"
      >
        <SplitterPanel
          :size="mainSize"
          :min-size="20"
          class="record-page-body-splitter__panel min-w-0"
        >
          <div class="record-page-region h-full">
            <div class="record-page-region__header">
              <h3 class="m-0 text-[0.9rem] font-semibold text-surface-900">
                {{ mainRegion.title || t('recordPage.region.main', 'Main') }}
              </h3>
            </div>
            <div class="record-page-region__drop">
              <VueDraggableNext
                :list="mainRegion.components"
                :group="{ name: 'record-page' }"
                item-key="id"
                tag="div"
                class="record-page-region__body grid min-h-[12rem] grid-cols-12 content-start gap-2"
                handle=".record-page-component__drag"
                ghost-class="record-page-component--ghost"
                chosen-class="record-page-component--chosen"
                v-bind="DIALOG_SORTABLE_ATTRS"
                @change="onRegionChange($event, mainRegion)"
              >
                <RecordPageCanvasComponent
                  v-for="component in mainRegion.components"
                  :key="component.id"
                  :component="component"
                  :collection="collection"
                  :selected-component-id="selectedComponentId"
                  :default-block-layout-id="schema.pageLayoutId"
                  :block-layout-name="pageLayoutName"
                  :compact-layout-name="compactLayoutName"
                  :active-tab-id="activeTabIdFor(component.id)"
                  :inline-labels="component.inlineLabels !== false"
                  @select="selectComponent"
                  @set-active-tab="setActiveTab"
                  @tab-change="onTabRegionChange"
                  @field-group-change="onFieldGroupChange"
                />
              </VueDraggableNext>
              <p
                v-if="mainRegion.components.length === 0"
                class="record-page-region__empty"
              >
                {{ t('recordPage.dragIntoRegion', 'Drag components into this region.') }}
              </p>
            </div>
          </div>
        </SplitterPanel>

        <SplitterPanel
          :size="sidebarSize"
          :min-size="20"
          class="record-page-body-splitter__panel min-w-0"
        >
          <div class="record-page-region h-full">
            <div class="record-page-region__header record-page-region__header--row">
              <h3 class="m-0 text-[0.9rem] font-semibold text-surface-900">
                {{ sidebarRegion.title || t('recordPage.region.sidebar', 'Sidebar') }}
              </h3>
              <Button
                :label="t('recordPage.sidebarDisable', 'Disable')"
                size="small"
                severity="secondary"
                text
                @click="sidebarEnabled = false"
              />
            </div>
            <div class="record-page-region__drop">
              <VueDraggableNext
                :list="sidebarRegion.components"
                :group="{ name: 'record-page' }"
                item-key="id"
                tag="div"
                class="record-page-region__body grid min-h-[12rem] grid-cols-12 content-start gap-2"
                handle=".record-page-component__drag"
                ghost-class="record-page-component--ghost"
                chosen-class="record-page-component--chosen"
                v-bind="DIALOG_SORTABLE_ATTRS"
                @change="onRegionChange($event, sidebarRegion)"
              >
                <RecordPageCanvasComponent
                  v-for="component in sidebarRegion.components"
                  :key="component.id"
                  :component="component"
                  :collection="collection"
                  :selected-component-id="selectedComponentId"
                  :default-block-layout-id="schema.pageLayoutId"
                  :block-layout-name="pageLayoutName"
                  :compact-layout-name="compactLayoutName"
                  :active-tab-id="activeTabIdFor(component.id)"
                  :inline-labels="component.inlineLabels !== false"
                  @select="selectComponent"
                  @set-active-tab="setActiveTab"
                  @tab-change="onTabRegionChange"
                  @field-group-change="onFieldGroupChange"
                />
              </VueDraggableNext>
              <p
                v-if="sidebarRegion.components.length === 0"
                class="record-page-region__empty"
              >
                {{ t('recordPage.dragIntoRegion', 'Drag components into this region.') }}
              </p>
            </div>
          </div>
        </SplitterPanel>
      </Splitter>
          </div>
        </div>
      </div>
    </section>
      </SplitterPanel>

      <SplitterPanel
        :size="28"
        :min-size="18"
        class="record-page-builder__properties-pane min-h-0 min-w-0"
      >
    <aside class="properties-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div class="properties-panel__header mb-3 flex shrink-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="m-0 text-base font-semibold">
            {{ t('formBuilder.properties', 'Properties') }}
          </h2>
          <p class="mb-0 mt-0.5 text-[0.8rem] text-muted-color">
            {{ propertiesSelectionKind }}
          </p>
        </div>
        <Button
          :label="t('setup.title', 'Setup')"
          icon="pi pi-cog"
          size="small"
          text
          class="shrink-0"
          @click="openLayoutSetup"
        />
      </div>

      <div class="properties-panel__body flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div
        v-if="selectedComponent"
        class="flex flex-col gap-4"
      >
        <div class="flex flex-col gap-[0.35rem]">
          <label class="text-[0.85rem] font-medium">
            {{ t('recordPage.componentType', 'Component') }}
          </label>
          <InputText
            :model-value="componentTypeLabel(selectedComponent.type)"
            disabled
            fluid
          />
        </div>

        <div
          v-if="selectedComponent.type !== 'tabs'"
          class="flex flex-col gap-[0.35rem]"
        >
          <label class="text-[0.85rem] font-medium">
            {{ t('recordPage.componentLabel', 'Label') }}
          </label>
          <InputText
            :model-value="selectedComponent.label ?? ''"
            fluid
            @update:model-value="updateSelected({ label: String($event ?? '') })"
          />
        </div>

        <div
          v-if="selectedComponent.type === 'detail'"
          class="flex flex-col gap-[0.35rem]"
        >
          <label class="text-[0.85rem] font-medium">
            {{ t('recordPage.pageLayout', 'Block Layout') }}
          </label>
          <Select
            :model-value="selectedComponent.pageLayoutId"
            :options="pageLayoutOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('recordPage.useDefaultPageLayout', 'Use default')"
            show-clear
            class="w-full"
            @update:model-value="updateSelected({ pageLayoutId: ($event as string | null) ?? null })"
          />
        </div>

        <div
          v-if="selectedComponent.type === 'highlights'"
          class="flex flex-col gap-4"
        >
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('recordPage.compactLayout', 'Compact Layout') }}
            </label>
            <Select
              :model-value="selectedComponent.compactLayoutId"
              :options="compactLayoutOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('recordPage.useRoleCompactLayout', 'Use role default')"
              show-clear
              class="w-full"
              @update:model-value="updateSelected({ compactLayoutId: ($event as string | null) ?? null })"
            />
            <p class="m-0 text-[0.75rem] text-muted-color">
              {{ t('recordPage.compactLayoutHint', 'Fields shown in the Highlights panel.') }}
            </p>
          </div>

          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('recordPage.actionLayout', 'Actions from Block Layout') }}
            </label>
            <Select
              :model-value="selectedComponent.actionLayoutId"
              :options="pageLayoutOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('recordPage.useDefaultPageLayout', 'Use default')"
              show-clear
              class="w-full"
              @update:model-value="updateSelected({ actionLayoutId: ($event as string | null) ?? null })"
            />
            <p class="m-0 text-[0.75rem] text-muted-color">
              {{ t('recordPage.highlightsActionLayoutHint', 'Custom actions from this Block Layout appear with Edit and Delete in the Highlights panel.') }}
            </p>
          </div>

          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium" for="highlights-visible-actions">
              {{ t('recordPage.visibleActionButtons', 'Visible Action Buttons') }}
            </label>
            <InputNumber
              input-id="highlights-visible-actions"
              :model-value="selectedComponent.visibleActionButtons ?? DEFAULT_VISIBLE_ACTION_BUTTONS"
              :min="1"
              :max="20"
              :show-buttons="true"
              class="w-full"
              @update:model-value="updateSelected({
                visibleActionButtons: typeof $event === 'number' ? $event : DEFAULT_VISIBLE_ACTION_BUTTONS,
              })"
            />
            <p class="m-0 text-[0.75rem] text-muted-color">
              {{ t('recordPage.visibleActionButtonsHint', 'Number of buttons shown before the overflow menu. Edit, Delete, and all custom actions are included automatically.') }}
            </p>
          </div>
        </div>

        <div
          v-if="selectedComponent.type === 'fieldGroup'"
          class="flex flex-col gap-4"
        >
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('recordPage.fieldGroupColumns', 'Columns') }}
            </label>
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <RadioButton
                  input-id="field-group-cols-1"
                  name="field-group-columns"
                  :value="1"
                  :model-value="selectedComponent.columns ?? 2"
                  @update:model-value="updateSelected({ columns: 1 })"
                />
                <label for="field-group-cols-1" class="text-sm">
                  {{ t('recordPage.fieldGroupOneColumn', '1 Column') }}
                </label>
              </div>
              <div class="flex items-center gap-2">
                <RadioButton
                  input-id="field-group-cols-2"
                  name="field-group-columns"
                  :value="2"
                  :model-value="selectedComponent.columns ?? 2"
                  @update:model-value="updateSelected({ columns: 2 })"
                />
                <label for="field-group-cols-2" class="text-sm">
                  {{ t('recordPage.fieldGroupTwoColumns', '2 Columns') }}
                </label>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox
              input-id="field-group-inline-labels"
              binary
              :model-value="selectedComponent.inlineLabels !== false"
              @update:model-value="updateSelected({ inlineLabels: Boolean($event) })"
            />
            <label for="field-group-inline-labels" class="text-sm">
              {{ t('formBuilder.inlineLabels', 'Inline labels') }}
            </label>
          </div>
          <p class="m-0 text-[0.75rem] text-muted-color">
            {{ t('recordPage.fieldGroupHint', 'Drag fields from the Fields palette into this group on the canvas.') }}
          </p>
        </div>

        <div
          v-if="selectedComponent.type === 'actions'"
          class="flex flex-col gap-[0.35rem]"
        >
          <p class="m-0 text-[0.85rem] text-muted-color">
            {{ t('recordPage.actionsDeprecated', 'Actions moved to Highlights. Remove this component.') }}
          </p>
        </div>

        <div
          v-if="selectedComponent.type === 'tabs'"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('recordPage.defaultTab', 'Default Tab') }}
            </label>
            <Select
              :model-value="selectedComponent.defaultTabId || selectedTabs[0]?.id || null"
              :options="defaultTabOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="updateDefaultTab(($event as string | null) ?? null)"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-[0.85rem] font-medium">
              {{ t('recordPage.tabsManage', 'Tabs') }}
            </label>
            <VueDraggableNext
              :list="ensureSelectedTabs()"
              item-key="id"
              tag="div"
              class="flex flex-col gap-2"
              handle=".record-page-tab-item__drag"
              ghost-class="record-page-component--ghost"
              chosen-class="record-page-component--chosen"
              v-bind="DIALOG_SORTABLE_ATTRS"
            >
              <div
                v-for="tab in selectedTabs"
                :key="tab.id"
                class="record-page-tab-item flex items-center gap-2 rounded-md border border-surface-200 bg-surface-0 px-2 py-1.5"
                :class="{ 'record-page-tab-item--selected': activeTabIdFor(selectedComponent.id) === tab.id }"
              >
                <span
                  class="record-page-tab-item__drag shrink-0 cursor-grab select-none text-surface-300 tracking-[-0.15em] active:cursor-grabbing"
                  aria-hidden="true"
                >⠿</span>
                <InputText
                  :model-value="tab.title"
                  fluid
                  class="min-w-0 flex-1"
                  @update:model-value="updateTabTitle(tab.id, String($event ?? ''))"
                  @focus="setActiveTab(selectedComponent.id, tab.id)"
                />
                <Button
                  type="button"
                  icon="pi pi-times"
                  severity="secondary"
                  text
                  rounded
                  size="small"
                  class="shrink-0"
                  :disabled="selectedTabs.length <= 1"
                  :aria-label="t('common.delete', 'Delete')"
                  @click="removeTabFromSelected(tab.id)"
                />
              </div>
            </VueDraggableNext>
            <Button
              :label="t('recordPage.addTab', 'Add Tab')"
              size="small"
              text
              class="self-start"
              @click="addTabToSelected"
            />
          </div>
        </div>

        <div
          v-if="selectedComponent.type === 'field'"
          class="flex flex-col gap-4"
        >
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('formBuilder.apiName', 'API name') }}
            </label>
            <InputText
              :model-value="selectedComponent.field ?? ''"
              disabled
              fluid
            />
          </div>
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('formBuilder.widthColumns', 'Grid width (columns)') }}
            </label>
            <Select
              :model-value="selectedComponent.span ?? 6"
              :options="SPAN_OPTIONS"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="updateSelected({ span: Number($event ?? 6) })"
            />
          </div>
          <div class="flex flex-col gap-[0.35rem]">
            <div class="flex items-center justify-between gap-2">
              <label for="record-page-field-inline-labels" class="text-[0.85rem] font-medium">
                {{ t('formBuilder.inlineLabels', 'Inline labels') }}
              </label>
              <ToggleSwitch
                input-id="record-page-field-inline-labels"
                v-model="selectedFieldInlineLabels"
              />
            </div>
            <p class="m-0 text-[0.75rem] text-muted-color">
              {{ t('formBuilder.inlineLabelsHint', 'Show labels beside values on wide screens; stack above values on small screens.') }}
            </p>
          </div>
          <div
            v-if="selectedSupportsFormat"
            class="flex flex-col gap-[0.35rem]"
          >
            <label class="text-[0.85rem] font-medium">
              {{ t('formBuilder.dateFormat', 'Format') }}
            </label>
            <InputText
              :model-value="selectedComponent.format ?? ''"
              fluid
              @update:model-value="updateSelected({ format: String($event ?? '') || undefined })"
            />
          </div>
        </div>

        <div
          v-if="selectedComponent.type === 'relatedList'"
          class="flex flex-col gap-[0.35rem]"
        >
          <label class="text-[0.85rem] font-medium">
            {{ t('recordPage.relatedListBlockLayout', 'Block Layout') }}
          </label>
          <Select
            :model-value="selectedComponent.pageLayoutId"
            :options="pageLayoutOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('recordPage.useDefaultPageLayout', 'Use default')"
            show-clear
            class="w-full"
            @update:model-value="onRelatedListBlockLayoutChange(($event as string | null) ?? null)"
          />
          <p class="m-0 text-[0.75rem] text-muted-color">
            {{ t('recordPage.relatedListBlockLayoutHint', 'Shows DataTable, Files, and M2A related fields configured on this Block Layout.') }}
          </p>
        </div>

        <div
          v-if="selectedComponent.type === 'files'"
          class="flex flex-col gap-[0.35rem]"
        >
          <p class="m-0 text-[0.75rem] text-muted-color">
            {{
              t(
                'recordPage.filesSharedHint',
                'Shows files attached to this record. Files is a shared object for every collection.',
              )
            }}
          </p>
        </div>

        <div
          v-if="selectedComponent.type === 'activityLog'"
          class="flex flex-col gap-3"
        >
          <p class="m-0 text-[0.75rem] text-muted-color">
            {{
              t(
                'activityLog.builderDescription',
                'Read-only audit trail from activity and revisions',
              )
            }}
          </p>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{ t('activityLog.maxItems', 'Maximum entries') }}
            <InputNumber
              :model-value="selectedActivityLogSettings.maxItems"
              :min="1"
              :max="200"
              fluid
              @update:model-value="updateActivityLogSettings({ maxItems: Number($event ?? 50) })"
            />
          </label>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{ t('activityLog.actions', 'Actions to show') }}
            <MultiSelect
              :model-value="selectedActivityLogSettings.actions"
              :options="activityLogActionOptions"
              option-label="label"
              option-value="value"
              display="chip"
              fluid
              @update:model-value="updateActivityLogSettings({ actions: ($event as ActivityLogAction[]) ?? [] })"
            />
          </label>
          <label class="flex items-center justify-between gap-3 text-[0.85rem] font-medium text-surface-700">
            {{ t('activityLog.showDeltas', 'Show field-level changes') }}
            <ToggleSwitch
              :model-value="selectedActivityLogSettings.showDeltas"
              @update:model-value="updateActivityLogSettings({ showDeltas: Boolean($event) })"
            />
          </label>
        </div>

        <Button
          :label="t('recordPage.removeComponent', 'Remove from page')"
          severity="danger"
          text
          class="self-start"
          @click="removeSelectedComponent"
        />
      </div>

      <div
        v-else
        class="flex flex-col gap-4"
      >
        <section class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="m-0 text-[0.9rem] font-semibold">
              {{ t('recordPage.region.sidebar', 'Sidebar') }}
            </h3>
            <Button
              v-if="!sidebarEnabled"
              :label="t('recordPage.sidebarEnable', 'Enable')"
              size="small"
              severity="secondary"
              @click="sidebarEnabled = true"
            />
            <Button
              v-else
              :label="t('recordPage.sidebarDisable', 'Disable')"
              size="small"
              severity="secondary"
              outlined
              @click="sidebarEnabled = false"
            />
          </div>
          <p class="m-0 text-[0.8rem] text-muted-color">
            {{
              sidebarEnabled
                ? t(
                    'recordPage.sidebarEnabledHint',
                    'Sidebar is visible. Drag the divider between Main and Sidebar to resize panels.',
                  )
                : t(
                    'recordPage.sidebarDisabledHint',
                    'Sidebar is hidden. Main uses the full page width. Components in Sidebar are kept.',
                  )
            }}
          </p>
          <div
            v-if="sidebarEnabled"
            class="flex flex-col gap-[0.35rem]"
          >
            <label
              class="text-[0.8rem] font-medium"
              for="record-page-main-size"
            >
              {{ t('recordPage.mainSize', 'Main panel size') }}
            </label>
            <InputNumber
              input-id="record-page-main-size"
              v-model="mainSize"
              :min="20"
              :max="80"
              :use-grouping="false"
              show-buttons
              suffix=" %"
              class="w-full"
            />
          </div>
        </section>

        <section class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="m-0 text-[0.9rem] font-semibold">
              {{ t('recordPage.listDetailPanel', 'Detail panel') }}
            </h3>
            <Button
              v-if="!listDetailPanelEnabled"
              :label="t('recordPage.listDetailPanelEnable', 'Enable')"
              size="small"
              severity="secondary"
              @click="enableListDetailPanel"
            />
            <Button
              v-else
              :label="t('recordPage.listDetailPanelDisable', 'Disable')"
              size="small"
              severity="secondary"
              outlined
              @click="disableListDetailPanel"
            />
          </div>
          <p class="m-0 text-[0.8rem] text-muted-color">
            {{
              listDetailPanelEnabled
                ? t(
                    'recordPage.listDetailPanelEnabledHint',
                    'On the object list, selecting a row shows related records from this Page Layout in a collapsible splitter panel.',
                  )
                : t(
                    'recordPage.listDetailPanelDisabledHint',
                    'Enable a detail panel on the object list using Related List, Files, and related fields from this Page Layout.',
                  )
            }}
          </p>
          <template v-if="listDetailPanelEnabled">
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-[0.35rem]">
                <label class="text-[0.8rem] font-medium" for="record-page-list-detail-master-size">
                  {{ t('recordPage.listDetailMasterSize', 'Master panel size') }}
                </label>
                <InputNumber
                  input-id="record-page-list-detail-master-size"
                  v-model="listDetailMasterSize"
                  :min="20"
                  :max="95"
                  :use-grouping="false"
                  show-buttons
                  suffix=" %"
                  class="w-full"
                />
              </div>
              <div class="flex flex-col gap-[0.35rem]">
                <label class="text-[0.8rem] font-medium" for="record-page-list-detail-min-size">
                  {{ t('recordPage.listDetailMinSize', 'Detail panel min size') }}
                </label>
                <InputNumber
                  input-id="record-page-list-detail-min-size"
                  v-model="listDetailMinSize"
                  :min="5"
                  :max="50"
                  :use-grouping="false"
                  show-buttons
                  suffix=" %"
                  class="w-full"
                />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <ToggleSwitch
                v-model="listDetailDefaultCollapsed"
                input-id="record-page-list-detail-collapsed"
              />
              <label for="record-page-list-detail-collapsed" class="text-[0.85rem]">
                {{ t('recordPage.listDetailDefaultCollapsed', 'Start collapsed') }}
              </label>
            </div>
            <p
              v-if="listDetailPreviewLoading"
              class="m-0 text-[0.8rem] text-muted-color"
            >
              {{ t('recordPage.listDetailPreviewLoading', 'Loading related lists…') }}
            </p>
            <p
              v-else-if="listDetailPreviewLabels.length === 0"
              class="m-0 text-[0.8rem] text-muted-color"
            >
              {{
                t(
                  'recordPage.listDetailPreviewEmpty',
                  'No related lists on this Page Layout yet. Add Related List, Files, or a Block Layout with related fields.',
                )
              }}
            </p>
            <p
              v-else
              class="m-0 text-[0.8rem] text-muted-color"
            >
              {{
                listDetailPreviewLabels.length === 1
                  ? t('recordPage.listDetailPreviewOne', 'Will show: {label}', {
                      label: listDetailPreviewLabels[0],
                    })
                  : t(
                      'recordPage.listDetailPreviewMany',
                      'Will show {count} related lists as tabs: {labels}',
                      {
                        count: listDetailPreviewLabels.length,
                        labels: listDetailPreviewLabels.join(', '),
                      },
                    )
              }}
            </p>
          </template>
        </section>

        <p class="m-0 rounded-lg border border-dashed border-surface-300 p-4 text-center text-surface-400">
          {{ t('recordPage.selectToEdit', 'Select a component on the canvas to edit its settings.') }}
        </p>
      </div>
      </div>
    </aside>
      </SplitterPanel>
      </Splitter>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<style scoped>
.record-page-builder {
  --page-wash: #edf3f4;
  --page-ink: #37352f;
  --page-line: #8fa3a8;
  --page-line-strong: #6f868c;
  font-family: Inter, system-ui, sans-serif;
  color: var(--page-ink);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.record-page-builder__main {
  border: 0;
  background: transparent;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.record-page-builder__main :deep(.p-splitter),
.record-page-builder__workspace :deep(.p-splitter) {
  height: 100%;
  min-height: 0;
  border: 0;
  background: transparent;
}

.record-page-builder__main :deep(.p-splitter-panel),
.record-page-builder__workspace :deep(.p-splitter-panel) {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.record-page-builder__main :deep(.p-splitter-gutter),
.record-page-builder__workspace :deep(.p-splitter-gutter) {
  width: 6px;
  margin: 0 0.2rem;
  background: transparent;
  transition: background-color 0.12s;
}

.record-page-builder__main :deep(.p-splitter-gutter:hover),
.record-page-builder__main :deep(.p-splitter-gutter-resizing),
.record-page-builder__workspace :deep(.p-splitter-gutter:hover),
.record-page-builder__workspace :deep(.p-splitter-gutter-resizing) {
  background: rgba(143, 163, 168, 0.45);
}

.record-page-builder__main :deep(.p-splitter-gutter-handle),
.record-page-builder__workspace :deep(.p-splitter-gutter-handle) {
  height: 2.5rem;
  width: 3px;
  border-radius: 999px;
  background: #8fa3a8;
}

.record-page-builder__workspace-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.record-page-builder__workspace {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-height: 0;
}

.record-page-builder__canvas-pane,
.record-page-builder__properties-pane,
.record-page-builder__palette-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.record-page-builder__canvas-pane > .record-page-canvas-panel,
.record-page-builder__properties-pane > .properties-panel,
.record-page-builder__palette-pane > .palette {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.palette {
  border: 0;
  border-radius: 8px;
  background: var(--page-wash);
  padding: 0.75rem 0.55rem;
}

.palette-body {
  padding-right: 0.15rem;
}

.palette-tabs__tab {
  border: 1px solid rgba(55, 53, 47, 0.12);
  border-radius: 6px;
  background: #fff;
  color: var(--page-ink);
  padding: 0.45rem 0.55rem;
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}

.palette-tabs__tab--active {
  border-color: var(--page-line-strong);
  background: #fff;
  color: #191918;
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--page-line-strong);
}

.palette-card {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.48rem 0.55rem;
  background: #fff;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  cursor: grab;
  user-select: none;
  box-shadow: none;
  color: var(--page-ink);
}

.palette-card:hover {
  background: rgba(55, 53, 47, 0.08);
}

.palette-card:active {
  cursor: grabbing;
}

.palette-card__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 0;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.7rem;
  font-weight: 600;
}

.palette-card--assigned {
  cursor: default;
  background: rgba(55, 53, 47, 0.05);
  border-color: transparent;
  color: rgba(55, 53, 47, 0.45);
}

.palette-card--assigned:hover {
  background: rgba(55, 53, 47, 0.08);
}

.palette-card--assigned .palette-card__icon {
  background: transparent;
  color: rgba(55, 53, 47, 0.4);
}

.record-page-canvas-panel {
  border: 1px solid rgba(55, 53, 47, 0.08);
  border-radius: 12px;
  background: #fff;
}

.record-page-canvas-toolbar {
  border-bottom: 1px solid rgba(55, 53, 47, 0.08);
  background: var(--page-wash);
}

.record-page-canvas-viewport {
  background: #fff;
}

.record-page-canvas-stage {
  width: 100%;
}

.record-page-canvas-content {
  width: 100%;
  box-sizing: border-box;
}

.record-page-body-splitter {
  border: 0;
  background: transparent;
  min-height: 14rem;
}

.record-page-body-splitter :deep(.p-splitter-panel) {
  min-width: 0;
  overflow: hidden;
}

.record-page-body-splitter :deep(.p-splitter-gutter) {
  width: 6px;
  margin: 0 0.35rem;
  background: transparent;
  transition: background-color 0.12s;
}

.record-page-body-splitter :deep(.p-splitter-gutter:hover),
.record-page-body-splitter :deep(.p-splitter-gutter-resizing) {
  background: rgba(143, 163, 168, 0.45);
}

.record-page-body-splitter :deep(.p-splitter-gutter-handle) {
  height: 2.5rem;
  width: 3px;
  border-radius: 999px;
  background: #8fa3a8;
}

.record-page-region {
  border: 1px solid var(--page-line);
  border-radius: 8px;
  background: var(--page-wash);
  padding: 0.75rem;
}

.record-page-region__header {
  margin-bottom: 0.65rem;
}

.record-page-region__header--row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.record-page-region__drop {
  position: relative;
}

.record-page-region__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  text-align: center;
  font-size: 0.8rem;
  color: rgba(55, 53, 47, 0.45);
  pointer-events: none;
}

.record-page-component--ghost {
  opacity: 0.45;
}

.record-page-component--chosen {
  cursor: grabbing;
}

.properties-panel {
  background: var(--page-wash);
  border: 0;
  border-radius: 12px;
  padding: 0.9rem 0.8rem 1rem;
  min-height: 0;
  overflow: hidden;
}

.properties-panel__body {
  min-height: 0;
  padding-right: 0.2rem;
}

.properties-panel :deep(.p-inputtext),
.properties-panel :deep(.p-select),
.properties-panel :deep(.p-dropdown),
.properties-panel :deep(.p-textarea),
.properties-panel :deep(.p-inputnumber),
.properties-panel :deep(.p-inputnumber-input),
.properties-panel :deep(.p-multiselect) {
  --p-select-background: #fff;
  --p-select-filled-background: #fff;
  --p-select-hover-background: #fff;
  --p-select-focus-background: #fff;
  --p-inputtext-background: #fff;
  background: #fff !important;
  border: 1px solid rgba(55, 53, 47, 0.12);
  box-shadow: none;
  border-radius: 6px;
  color: var(--page-ink);
}

.properties-panel :deep(.p-inputtext:enabled:focus),
.properties-panel :deep(.p-select:not(.p-disabled).p-focus),
.properties-panel :deep(.p-dropdown:not(.p-disabled).p-focus) {
  background: #fff !important;
  border-color: rgba(55, 53, 47, 0.28);
  box-shadow: none;
}

.record-page-builder :deep(.p-button.p-button-outlined),
.record-page-builder :deep(.p-button:not(.p-button-text):not(.p-button-danger)) {
  background: #fff;
  border-color: rgba(55, 53, 47, 0.16);
  color: var(--page-ink);
}

.record-page-builder :deep(.p-button.p-button-outlined:hover),
.record-page-builder :deep(.p-button:not(.p-button-text):not(.p-button-danger):hover) {
  background: rgba(55, 53, 47, 0.06);
  border-color: rgba(55, 53, 47, 0.16);
  color: var(--page-ink);
}

.record-page-builder :deep(.p-button.p-button-text:not(.p-button-danger)) {
  background: transparent;
  border-color: transparent;
  color: var(--page-ink);
}

.record-page-tab-item--selected {
  border-color: #6f868c !important;
  box-shadow: 0 0 0 1px #6f868c;
}
</style>
