<script lang="ts">
export default {
  name: 'FormBuilder',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import type {
  FilesSettings,
  M2ASettings,
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  LayoutGroup,
  LayoutSection,
  CloneRelatedFromSettings,
} from '@/interfaces'
import type { PaletteItem } from '@/modules/entities/utils/fieldPalette'
import PaletteSkeleton from './PaletteSkeleton.vue'
import FilesSettingsDesigner from './FilesSettingsDesigner.vue'
import M2ASettingsDesigner from './M2ASettingsDesigner.vue'
import RelatedFieldSettingsDialog, {
  type RelatedFieldSettingsApplyPayload,
} from './RelatedFieldSettingsDialog.vue'
import CloneRelatedFromSettingsDialog from './CloneRelatedFromSettingsDialog.vue'
import { normalizeSchedulerSettings } from '../services/schedulerSettings'
import { loadEntityForms } from '../services/layoutSettings'
import type { SavedRoleScopedLayout } from '@/interfaces'
import { loadDocTemplateListItems } from '@/modules/documents/services/docTemplateService'
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  normalizeActivityLogSettings,
  type ActivityLogAction,
} from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  isSystemAuditLayoutField,
  isSystemInfoEnabled,
} from '@/core/layoutFieldRules'
import { defaultValueForField, generateFieldId } from '@/modules/entities/utils/fieldDefaults'
import { resolvePrimeVueComponent } from '@/core/primevue'
import { isDateComponent } from '@/core/dateFormatting'
import {
  buildLivePalette,
  buildRelatedObjectPalette,
} from '@/modules/entities/services/collectionSchema'
import { DIALOG_SORTABLE_ATTRS } from '../utils/dialogSortable'
import { FILES_ASSET_COLLECTION } from '@/core/filesField'
import { filesSettings, isFilesField, isM2ABuilderField } from '@/core/fieldHelpers'
import {
  DEFAULT_DOC_ENGINE_SETTINGS,
  normalizeDocEngineSettings,
} from '@/interfaces/documents'

const props = withDefaults(
  defineProps<{
    modelValue: EntityLayoutSchema
    /** Registry collection slug whose fields populate the palette. */
    collection?: string
    /** Record-detail actions editor — hidden for compact layouts. */
    showRecordActions?: boolean
    /** Block Layouts palette tab — enabled for compact layouts. */
    showBlockLayoutsPalette?: boolean
  }>(),
  {
    collection: 'patient',
    showRecordActions: true,
    showBlockLayoutsPalette: false,
  },
)
const { t } = useTranslation()

const PROPERTIES_SCROLL_KEY = 'crm.formBuilder.propertiesScroll'
const propertiesBodyRef = ref<HTMLElement | null>(null)

function onPropertiesScroll(event: Event): void {
  const el = event.target
  if (!(el instanceof HTMLElement)) return
  try {
    localStorage.setItem(PROPERTIES_SCROLL_KEY, String(Math.max(0, el.scrollTop)))
  } catch {
    /* ignore quota / private mode */
  }
}

function restorePropertiesScroll(): void {
  const el = propertiesBodyRef.value
  if (!el) return
  let top = 0
  try {
    top = Number(localStorage.getItem(PROPERTIES_SCROLL_KEY) ?? 0)
  } catch {
    top = 0
  }
  if (!Number.isFinite(top) || top <= 0) return
  el.scrollTop = top
}

onMounted(() => {
  void nextTick(restorePropertiesScroll)
})

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

/** Full field list from registry schema (clone source for unassigned fields). */
const allPaletteItems = ref<PaletteItem[]>([])
const allRelatedObjectItems = ref<PaletteItem[]>([])
const customPaletteItems = computed<PaletteItem[]>(() => [
  {
    id: `attachments-${collectionName.value}`,
    label: t('formBuilder.attachments', 'Attachments'),
    component: 'Files',
    fieldKey: `files:${collectionName.value}`,
    fieldType: 'custom',
    relatedCollection: FILES_ASSET_COLLECTION,
    multiple: true,
    description: t(
      'formBuilder.attachmentsHint',
      'Files attached to this record (shared Files object)',
    ),
    paletteKind: 'field',
  },
  {
    id: `tree-table-${collectionName.value}`,
    label: t('formBuilder.treeTablePicker', 'Tree table picker'),
    component: 'CrmTreeTable',
    fieldKey: 'tree_items',
    fieldType: 'custom',
    description: t('formBuilder.treeTablePicker', 'Tree table picker'),
    paletteKind: 'field',
  },
  {
    id: `scheduler-${collectionName.value}`,
    label: t('scheduler.scheduler', 'Scheduler'),
    component: 'CrmScheduler',
    fieldKey: 'scheduler',
    fieldType: 'custom',
    description: t('formBuilder.resourceScheduler', 'Resource scheduler'),
    paletteKind: 'field',
  },
  {
    id: `doc-engine-${collectionName.value}`,
    label: t('formBuilder.docEngine', 'DocEngine'),
    component: 'CrmDocEngine',
    fieldKey: 'doc_engine',
    fieldType: 'custom',
    description: t(
      'formBuilder.docEngineHint',
      'List and fill documents for this record',
    ),
    paletteKind: 'field',
  },
])
const paletteLoading = ref(false)
const paletteError = ref<string | null>(null)
const paletteQuery = ref('')
const blockLayoutItems = ref<SavedRoleScopedLayout[]>([])
const relatedFieldDialogVisible = ref(false)
const cloneRelatedFromDialogVisible = ref(false)

const emit = defineEmits<{
  'update:modelValue': [EntityLayoutSchema]
}>()

const selectedFieldId = ref<string | null>(null)
const selectedGroupId = ref<string | null>(null)
const selectedTabId = ref<string | null>(null)
const selectedActionId = ref<string | null>(null)
const actionDragList = ref<EntityAction[]>([])
const activeTabId = ref<string | null>(null)
const selectedFieldGroupId = ref<string | null>(null)

const SPAN_OPTIONS = computed(() => Array.from({ length: 12 }, (_, i) => ({
  label: t(
    i + 1 === 1 ? 'formBuilder.columnSingular' : 'formBuilder.columns',
    i + 1 === 1 ? '{count} column' : '{count} columns',
    { count: i + 1 },
  ),
  value: i + 1,
})))
const GROUP_STATE_OPTIONS = computed(() => [
  { label: t('formBuilder.expanded', 'Expanded'), value: false },
  { label: t('formBuilder.collapsed', 'Collapsed'), value: true },
])
const ACTION_DISPLAY_OPTIONS = computed(() => [
  { label: t('formBuilder.detailButton', 'Detail page button'), value: 'detailButton' },
  { label: t('formBuilder.detailLink', 'Detail page link'), value: 'detailLink' },
  { label: t('formBuilder.document', 'Document'), value: 'document' },
])
const ACTION_BEHAVIOR_OPTIONS = computed(() => [
  { label: t('formBuilder.actionBehaviorFlow', 'Flow webhook'), value: 'flow' },
  {
    label: t('formBuilder.actionBehaviorCloneRelated', 'Clone structure'),
    value: 'cloneRelated',
  },
])
const DOCUMENT_VIEW_MODE_OPTIONS = computed(() => [
  { label: t('formBuilder.documentViewHtml', 'HTML preview'), value: 'html' },
  { label: t('formBuilder.documentViewPdf', 'PDF viewer'), value: 'pdf' },
])
const docTemplateOptions = ref<Array<{ label: string; value: string }>>([])
const actionCloneRelatedDialogVisible = ref(false)

function createLayoutTab(title = t('formBuilder.newTab', 'New Tab')): LayoutSection {
  return {
    id: `tab_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
    title,
    columns: 12,
    groups: [createLayoutGroup(t('builder.defaultGroupGeneral', 'General'))],
  }
}

function createLayoutGroup(title = t('formBuilder.newGroup', 'New Group')): LayoutGroup {
  return {
    id: `grp_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
    title,
    fields: [],
    collapsed: false,
    inlineLabels: true,
  }
}

const activeSection = computed((): LayoutSection => {
  const sections = props.modelValue.sections
  const selected = sections.find((section) => section.id === activeTabId.value)
  const existing = selected ?? sections[0]
  if (existing) return existing
  return {
    id: 'main',
    title: t('treeSettings.main', 'Main'),
    columns: 12,
    groups: [],
  }
})

const collectionName = computed(
  () => props.collection || props.modelValue.entity || 'leads',
)

const assignedFieldKeys = computed(
  () =>
    new Set(
      props.modelValue.sections.reduce<string[]>((keys, section) =>
        [
          ...keys,
          ...(section.groups ?? []).reduce<string[]>(
            (groupKeys, group) => [
              ...groupKeys,
              ...group.fields.map((f) => f.field),
            ],
            [],
          ),
        ],
        [],
      ),
    ),
)

watch(
  () => props.modelValue.sections.map((section) => section.id).join('|'),
  () => {
    ensureSectionsHaveGroups()
    const sections = props.modelValue.sections
    if (sections.length === 0) {
      activeTabId.value = null
      return
    }

    if (!sections.some((section) => section.id === activeTabId.value)) {
      activeTabId.value = sections[0].id
    }
  },
  { immediate: true },
)

const blockLayoutPaletteItems = computed<PaletteItem[]>(() =>
  blockLayoutItems.value.map((layout) => ({
    id: `block-layout-${layout.id}`,
    label: layout.name,
    component: 'BlockLayout' as const,
    fieldKey: `block_layout_${layout.id}`,
    fieldType: 'blockLayout',
    description: t('recordPage.pageLayout', 'Block Layout'),
    paletteKind: 'blockLayout' as const,
    blockLayoutId: layout.id,
  })),
)

function matchesPaletteQuery(item: PaletteItem): boolean {
  const q = paletteQuery.value.trim().toLowerCase()
  if (!q) return true
  return (
    item.label.toLowerCase().includes(q) ||
    item.fieldKey.toLowerCase().includes(q) ||
    item.component.toLowerCase().includes(q)
  )
}

const paletteSections = computed(() => {
  const sections: Array<{ id: string; label: string; items: PaletteItem[] }> = []
  if (props.showBlockLayoutsPalette) {
    sections.push({
      id: 'blockLayouts',
      label: t('recordPage.tab.pageLayouts', 'Block Layouts'),
      items: blockLayoutPaletteItems.value,
    })
  }
  sections.push(
    {
      id: 'fields',
      label: t(
        'formBuilder.paletteRegister',
        '{collection} (register)',
        { collection: collectionName.value },
      ),
      items: allPaletteItems.value,
    },
    {
      id: 'relatedObjects',
      label: t('formBuilder.availableRelatedObject', 'Available related object'),
      items: allRelatedObjectItems.value,
    },
    {
      id: 'custom',
      label: t('formBuilder.custom', 'Custom'),
      items: customPaletteItems.value,
    },
  )
  return sections
})

/** Stacked Notion sections: assigned (grey) then available (white cards). */
const visiblePaletteSections = computed(() =>
  paletteSections.value
    .map((section) => {
      const matched = section.items.filter(matchesPaletteQuery)
      return {
        ...section,
        assigned: matched.filter((item) => assignedFieldKeys.value.has(item.fieldKey)),
        available: matched.filter((item) => !assignedFieldKeys.value.has(item.fieldKey)),
      }
    })
    .filter((section) => section.assigned.length > 0 || section.available.length > 0),
)

/** Writable copies for vue-draggable-next (computed lists break Sortable clone). */
const sectionDragLists = ref<Record<string, PaletteItem[]>>({})

watch(
  visiblePaletteSections,
  (sections) => {
    const next: Record<string, PaletteItem[]> = {}
    for (const section of sections) {
      next[section.id] = section.available.slice()
    }
    sectionDragLists.value = next
  },
  { immediate: true },
)

const paletteHasItems = computed(() =>
  paletteSections.value.some((section) => section.items.length > 0),
)

watch(
  collectionName,
  async (name) => {
    if (props.modelValue.entity !== name) {
      emit('update:modelValue', { ...props.modelValue, entity: name })
    }
    await loadFieldPalette(name)
    if (props.showBlockLayoutsPalette) {
      void loadBlockLayouts(name)
    }
  },
  { immediate: true },
)

watch(
  () => props.showBlockLayoutsPalette,
  (enabled) => {
    if (enabled) {
      void loadBlockLayouts(collectionName.value)
    }
  },
)

async function loadBlockLayouts(collection: string): Promise<void> {
  try {
    blockLayoutItems.value = await loadEntityForms(collection)
  } catch {
    blockLayoutItems.value = []
  }
}

async function loadFieldPalette(collection: string): Promise<void> {
  paletteLoading.value = true
  paletteError.value = null
  try {
    const [fields, relatedObjects] = await Promise.all([
      buildLivePalette(collection),
      buildRelatedObjectPalette(collection),
    ])
    // Files/Attachments live under Custom (shared Files object), not Fields/Related.
    allPaletteItems.value = fields.filter((item) => item.component !== 'Files')
    allRelatedObjectItems.value = relatedObjects.filter(
      (item) => item.component !== 'Files',
    )
  } catch (err) {
    paletteError.value =
      err instanceof Error
        ? err.message
        : t('formBuilder.loadSchemaError', 'Failed to load collection schema from the registry.')
    allPaletteItems.value = []
    allRelatedObjectItems.value = []
  } finally {
    paletteLoading.value = false
  }
}

const selectedField = computed(() =>
  activeSection.value.groups
    .reduce<LayoutFieldMetadata[]>(
      (fields, group) => [...fields, ...group.fields],
      [],
    )
    .find((f) => f.id === selectedFieldId.value) ??
  null,
)
const selectedGroup = computed(
  () =>
    activeSection.value.groups.find((group) => group.id === selectedGroupId.value) ??
    null,
)

const selectedFieldParentGroup = computed(
  () =>
    activeSection.value.groups.find((group) => group.id === selectedFieldGroupId.value) ??
    null,
)

const selectedTab = computed(
  () =>
    props.modelValue.sections.find((section) => section.id === selectedTabId.value) ??
    null,
)
const selectedAction = computed(
  () =>
    (props.modelValue.actions ?? []).find((action) => action.id === selectedActionId.value) ??
    null,
)

const isDocumentAction = computed(
  () =>
    selectedAction.value?.displayType === 'document'
    || selectedAction.value?.behavior === 'openDocument',
)
const isCloneRelatedAction = computed(
  () => selectedAction.value?.behavior === 'cloneRelated',
)
const actionCloneRelatedSettings = computed<CloneRelatedFromSettings>(() => ({
  children: selectedAction.value?.cloneRelated?.children ?? [],
}))
const actionCloneRelatedSummary = computed(() => {
  const count = actionCloneRelatedSettings.value.children?.length ?? 0
  if (!count) return ''
  return t('formBuilder.cloneRelatedFromSummary', '{count} child pair(s)', { count })
})

async function loadDocTemplateOptionsForBuilder(): Promise<void> {
  if (!collectionName.value) {
    docTemplateOptions.value = []
    return
  }

  try {
    const items = await loadDocTemplateListItems(collectionName.value)
    docTemplateOptions.value = items.map((item) => ({
      label: item.name,
      value: item.id,
    }))
  } catch {
    docTemplateOptions.value = []
  }
}

watch(
  [collectionName, selectedActionId, isDocumentAction],
  () => {
    if (isDocumentAction.value) {
      void loadDocTemplateOptionsForBuilder()
    }
  },
)

const configLabel = computed({
  get: () => selectedField.value?.label ?? '',
  set: (label: string) => {
    if (!selectedFieldId.value) return
    updateField(selectedFieldId.value, { label })
  },
})

const configSpan = computed({
  get: () => selectedField.value?.span ?? 12,
  set: (span: number) => {
    if (!selectedFieldId.value) return
    updateField(selectedFieldId.value, { span })
  },
})
const configFormat = computed({
  get: () => selectedField.value?.format ?? '',
  set: (format: string) => {
    if (!selectedFieldId.value) return
    updateField(selectedFieldId.value, { format: format.trim() || undefined })
  },
})
const configReadonly = computed({
  get: () => selectedField.value?.readonly ?? false,
  set: (readonly: boolean) => {
    if (!selectedFieldId.value) return
    updateField(selectedFieldId.value, { readonly })
  },
})

const blockLayoutOptions = computed(() =>
  blockLayoutItems.value.map((layout) => ({
    label: layout.name,
    value: layout.id,
  })),
)

const configBlockLayoutId = computed({
  get: () => selectedField.value?.blockLayoutId ?? null,
  set: (blockLayoutId: string | null) => {
    if (!selectedFieldId.value) return
    const layout = blockLayoutItems.value.find((item) => item.id === blockLayoutId)
    updateField(selectedFieldId.value, {
      blockLayoutId,
      label: layout?.name ?? selectedField.value?.label ?? '',
      field: blockLayoutId ? `block_layout_${blockLayoutId}` : selectedField.value?.field ?? '',
    })
  },
})

function blockLayoutDisplayName(field: LayoutFieldMetadata): string {
  if (!field.blockLayoutId) {
    return t('recordPage.selectPageLayout', 'Select a Block Layout')
  }
  return (
    blockLayoutItems.value.find((layout) => layout.id === field.blockLayoutId)?.name
    ?? field.label
    ?? field.blockLayoutId
  )
}

const systemInfoEnabled = computed({
  get: () => isSystemInfoEnabled(props.modelValue),
  set: (enabled: boolean) => {
    emit('update:modelValue', {
      ...props.modelValue,
      systemInfo: {
        ...props.modelValue.systemInfo,
        enabled,
        collapsed: props.modelValue.systemInfo?.collapsed ?? false,
      },
    })
  },
})
const systemInfoCollapsedDefault = computed({
  get: () => props.modelValue.systemInfo?.collapsed ?? false,
  set: (collapsed: boolean) => {
    emit('update:modelValue', {
      ...props.modelValue,
      systemInfo: {
        enabled: isSystemInfoEnabled(props.modelValue),
        ...props.modelValue.systemInfo,
        collapsed,
      },
    })
  },
})
const selectedFieldSupportsFormat = computed(() =>
  Boolean(selectedField.value && isDateComponent(selectedField.value.component)),
)
const selectedFieldSupportsReadonly = computed(() =>
  Boolean(
    selectedField.value &&
      !isDataTableField(selectedField.value) &&
      !isTreeTableField(selectedField.value) &&
      !isSchedulerField(selectedField.value) &&
      !isActivityLogField(selectedField.value) &&
      !isDocEngineField(selectedField.value) &&
      !isBlockLayoutField(selectedField.value) &&
      !isFilesField(selectedField.value) &&
      !isSystemAuditLayoutField(selectedField.value),
  ),
)
const selectedFieldSupportsCloneRelated = computed(() =>
  Boolean(
    selectedField.value?.relatedCollection &&
      !isDataTableField(selectedField.value) &&
      !isTreeTableField(selectedField.value) &&
      !isSchedulerField(selectedField.value) &&
      !isFilesField(selectedField.value) &&
      !isBlockLayoutField(selectedField.value) &&
      !isActivityLogField(selectedField.value),
  ),
)
const cloneRelatedFromEnabled = computed(() =>
  Boolean(selectedField.value?.cloneRelatedFrom),
)
const cloneRelatedFromSettings = computed<CloneRelatedFromSettings>(() =>
  selectedField.value?.cloneRelatedFromSettings ?? { children: [] },
)
const cloneRelatedFromSummary = computed(() => {
  const count = cloneRelatedFromSettings.value.children?.length ?? 0
  if (!count) return ''
  return t('formBuilder.cloneRelatedFromSummary', '{count} child pair(s)', { count })
})
const configGroupTitle = computed({
  get: () => selectedGroup.value?.title ?? '',
  set: (title: string) => {
    if (!selectedGroupId.value) return
    updateGroupTitle(selectedGroupId.value, title)
  },
})

const configGroupCollapsed = computed({
  get: () => selectedGroup.value?.collapsed ?? false,
  set: (collapsed: boolean) => {
    if (!selectedGroupId.value) return
    updateGroup(selectedGroupId.value, { collapsed })
  },
})

const configGroupInlineLabels = computed({
  get: () => selectedGroup.value?.inlineLabels ?? true,
  set: (inlineLabels: boolean) => {
    if (!selectedGroupId.value) return
    updateGroup(selectedGroupId.value, { inlineLabels })
  },
})

const configFieldGroupInlineLabels = computed({
  get: () => selectedFieldParentGroup.value?.inlineLabels ?? true,
  set: (inlineLabels: boolean) => {
    if (!selectedFieldGroupId.value) return
    updateGroup(selectedFieldGroupId.value, { inlineLabels })
  },
})

const configTabTitle = computed({
  get: () => selectedTab.value?.title ?? '',
  set: (title: string) => {
    if (!selectedTabId.value) return
    updateTab(selectedTabId.value, { title })
  },
})

const configTabDescription = computed({
  get: () => selectedTab.value?.description ?? '',
  set: (description: string) => {
    if (!selectedTabId.value) return
    updateTab(selectedTabId.value, { description })
  },
})
const configActionLabel = computed({
  get: () => selectedAction.value?.label ?? '',
  set: (label: string) => {
    updateSelectedAction({ label })
  },
})
const configActionName = computed({
  get: () => selectedAction.value?.name ?? '',
  set: (name: string) => {
    updateSelectedAction({ name: slugifyActionName(name) })
  },
})
const configActionDisplayType = computed({
  get: () => selectedAction.value?.displayType ?? 'detailButton',
  set: (displayType: EntityAction['displayType']) => {
    if (displayType === 'document') {
      updateSelectedAction({
        displayType: 'document',
        behavior: 'openDocument',
        document: {
          templateId: selectedAction.value?.document?.templateId ?? null,
          skipInteractiveFill: selectedAction.value?.document?.skipInteractiveFill ?? false,
          viewMode: selectedAction.value?.document?.viewMode ?? 'html',
          autoSave: selectedAction.value?.document?.autoSave ?? false,
        },
        flow: undefined,
        payload: undefined,
        cloneRelated: undefined,
      })
      void loadDocTemplateOptionsForBuilder()
      return
    }

    if (selectedAction.value?.behavior === 'cloneRelated') {
      updateSelectedAction({
        displayType,
        behavior: 'cloneRelated',
        cloneRelated: selectedAction.value.cloneRelated ?? {
          children: [],
          confirmBeforeRun: true,
          successMessage: t('formBuilder.cloneStructureCompleted', 'Structure cloned.'),
          refreshRecordAfterRun: true,
          replaceExisting: false,
        },
        flow: undefined,
        payload: undefined,
        document: undefined,
      })
      return
    }

    updateSelectedAction({
      displayType,
      behavior: 'flow',
      flow: {
        webhook: selectedAction.value?.flow?.webhook ?? '',
        method: 'POST',
        confirmBeforeRun: selectedAction.value?.flow?.confirmBeforeRun ?? true,
        successMessage:
          selectedAction.value?.flow?.successMessage
          ?? t('formBuilder.actionCompleted', 'Action completed.'),
        refreshRecordAfterRun: selectedAction.value?.flow?.refreshRecordAfterRun ?? true,
      },
      payload: {
        includeCollection: true,
        includeRecordId: true,
        includeRecord: selectedAction.value?.payload?.includeRecord ?? false,
      },
      document: undefined,
      cloneRelated: undefined,
    })
  },
})
const configActionBehavior = computed({
  get: () =>
    selectedAction.value?.behavior === 'cloneRelated' ? 'cloneRelated' : 'flow',
  set: (behavior: 'flow' | 'cloneRelated') => {
    if (behavior === 'cloneRelated') {
      updateSelectedAction({
        displayType:
          selectedAction.value?.displayType === 'detailLink' ? 'detailLink' : 'detailButton',
        behavior: 'cloneRelated',
        cloneRelated: selectedAction.value?.cloneRelated ?? {
          children: [],
          confirmBeforeRun: true,
          successMessage: t('formBuilder.cloneStructureCompleted', 'Structure cloned.'),
          refreshRecordAfterRun: true,
          replaceExisting: false,
        },
        flow: undefined,
        payload: undefined,
        document: undefined,
      })
      return
    }
    updateSelectedAction({
      displayType:
        selectedAction.value?.displayType === 'detailLink' ? 'detailLink' : 'detailButton',
      behavior: 'flow',
      flow: {
        webhook: selectedAction.value?.flow?.webhook ?? '',
        method: 'POST',
        confirmBeforeRun: selectedAction.value?.cloneRelated?.confirmBeforeRun ?? true,
        successMessage:
          selectedAction.value?.cloneRelated?.successMessage
          ?? t('formBuilder.actionCompleted', 'Action completed.'),
        refreshRecordAfterRun:
          selectedAction.value?.cloneRelated?.refreshRecordAfterRun ?? true,
      },
      payload: {
        includeCollection: true,
        includeRecordId: true,
        includeRecord: false,
      },
      cloneRelated: undefined,
      document: undefined,
    })
  },
})
const configActionCloneConfirm = computed({
  get: () => selectedAction.value?.cloneRelated?.confirmBeforeRun ?? true,
  set: (confirmBeforeRun: boolean) => {
    updateSelectedActionCloneRelated({ confirmBeforeRun })
  },
})
const configActionCloneSuccessMessage = computed({
  get: () => selectedAction.value?.cloneRelated?.successMessage ?? '',
  set: (successMessage: string) => {
    updateSelectedActionCloneRelated({ successMessage })
  },
})
const configActionCloneRefresh = computed({
  get: () => selectedAction.value?.cloneRelated?.refreshRecordAfterRun ?? true,
  set: (refreshRecordAfterRun: boolean) => {
    updateSelectedActionCloneRelated({ refreshRecordAfterRun })
  },
})
const configActionCloneReplaceExisting = computed({
  get: () => Boolean(selectedAction.value?.cloneRelated?.replaceExisting),
  set: (replaceExisting: boolean) => {
    updateSelectedActionCloneRelated({ replaceExisting: Boolean(replaceExisting) })
  },
})
const configActionTemplateId = computed({
  get: () => selectedAction.value?.document?.templateId ?? null,
  set: (templateId: string | null) => {
    updateSelectedActionDocument({
      templateId: templateId || null,
      ...(templateId ? {} : { skipInteractiveFill: false }),
    })
  },
})
const configActionSkipInteractiveFill = computed({
  get: () => selectedAction.value?.document?.skipInteractiveFill ?? false,
  set: (skipInteractiveFill: boolean) => {
    updateSelectedActionDocument({ skipInteractiveFill })
  },
})
const configActionViewMode = computed({
  get: () => selectedAction.value?.document?.viewMode ?? 'html',
  set: (viewMode: 'html' | 'pdf') => {
    updateSelectedActionDocument({ viewMode })
  },
})
const configActionAutoSave = computed({
  get: () => selectedAction.value?.document?.autoSave ?? false,
  set: (autoSave: boolean) => {
    updateSelectedActionDocument({ autoSave })
  },
})
const canSkipInteractiveFill = computed(
  () => Boolean(selectedAction.value?.document?.templateId),
)
const configActionWebhook = computed({
  get: () => selectedAction.value?.flow?.webhook ?? '',
  set: (webhook: string) => {
    updateSelectedActionFlow({ webhook })
  },
})
const configActionConfirmBeforeRun = computed({
  get: () => selectedAction.value?.flow?.confirmBeforeRun ?? true,
  set: (confirmBeforeRun: boolean) => {
    updateSelectedActionFlow({ confirmBeforeRun })
  },
})
const configActionSuccessMessage = computed({
  get: () => selectedAction.value?.flow?.successMessage ?? '',
  set: (successMessage: string) => {
    updateSelectedActionFlow({ successMessage })
  },
})
const configActionRefreshAfterRun = computed({
  get: () => selectedAction.value?.flow?.refreshRecordAfterRun ?? true,
  set: (refreshRecordAfterRun: boolean) => {
    updateSelectedActionFlow({ refreshRecordAfterRun })
  },
})
const configActionIncludeRecord = computed({
  get: () => selectedAction.value?.payload?.includeRecord ?? false,
  set: (includeRecord: boolean) => {
    updateSelectedActionPayload({ includeRecord })
  },
})

const configFilesSettings = computed<FilesSettings>({
  get: () =>
    (selectedField.value ? filesSettings(selectedField.value) : undefined) ?? {
      multiple: false,
      display: 'thumbnail',
      allowedMimeTypes: [],
      columns: [],
    },
  set: (files: FilesSettings) => {
    if (!selectedFieldId.value) return
    updateField(selectedFieldId.value, { files })
  },
})

const configM2aSettings = computed<M2ASettings>({
  get: () => selectedField.value?.m2a ?? {},
  set: (m2a: M2ASettings) => {
    if (!selectedFieldId.value) return
    updateField(selectedFieldId.value, {
      m2a: Object.keys(m2a).length > 0 ? m2a : undefined,
    })
  },
})

function m2aCanvasSummary(field: LayoutFieldMetadata): string {
  const rowLimit = field.m2a?.rowLimit
  const blockTypes = field.m2a?.blockFields?.length ?? 0
  return t(
    'm2aBuilder.canvasSummary',
    'M2A · {rows} rows · {types} block types',
    {
      rows: rowLimit ?? 5,
      types: blockTypes,
    },
  )
}

function patchSchema(sectionPatch: Partial<LayoutSection>): void {
  const baseSection = activeSection.value
  const nextSection: LayoutSection = {
    id: sectionPatch.id ?? baseSection.id,
    title: sectionPatch.title ?? baseSection.title,
    description: sectionPatch.description ?? baseSection.description,
    columns: sectionPatch.columns ?? baseSection.columns,
    sort: sectionPatch.sort ?? baseSection.sort,
    groups: sectionPatch.groups ?? baseSection.groups,
  }
  const sectionIndex = props.modelValue.sections.findIndex(
    (section) => section.id === nextSection.id,
  )
  const sections =
    sectionIndex === -1
      ? [nextSection, ...props.modelValue.sections]
      : props.modelValue.sections.map((section, index) =>
          index === sectionIndex ? nextSection : section,
        )

  emit('update:modelValue', {
    ...props.modelValue,
    sections,
  })
}

function ensureSectionsHaveGroups(): void {
  let changed = false
  const sections = props.modelValue.sections.map((section) => {
    const hasLegacyFieldsProp = 'fields' in section
    const legacyFields =
      hasLegacyFieldsProp && Array.isArray((section as any).fields)
        ? ((section as any).fields as LayoutFieldMetadata[])
        : []
    const existingGroups = section.groups ?? []

    if (existingGroups.length > 0 && !hasLegacyFieldsProp) {
      return section
    }

    changed = true
    return {
      id: section.id,
      title: section.title,
      description: section.description,
      columns: section.columns,
      sort: section.sort,
      groups:
        existingGroups.length > 0
          ? [
              {
                ...existingGroups[0],
                fields: [...legacyFields, ...existingGroups[0].fields],
              },
              ...existingGroups.slice(1),
            ]
          : [
              {
                ...createLayoutGroup(t('builder.defaultGroupGeneral', 'General')),
                fields: legacyFields,
              },
            ],
    }
  })

  if (changed) {
    emit('update:modelValue', {
      ...props.modelValue,
      sections,
    })
  }
}

function addTab(): void {
  const nextTab = createLayoutTab(`Tab ${props.modelValue.sections.length + 1}`)
  activeTabId.value = nextTab.id
  selectTab(nextTab.id)
  emit('update:modelValue', {
    ...props.modelValue,
    sections: [...props.modelValue.sections, nextTab],
  })
}

function removeActiveTab(): void {
  const sections = props.modelValue.sections
  if (sections.length <= 1) return

  const activeIndex = sections.findIndex(
    (section) => section.id === activeSection.value.id,
  )
  const nextSections = sections.filter(
    (section) => section.id !== activeSection.value.id,
  )
  activeTabId.value =
    nextSections[Math.max(0, activeIndex - 1)]?.id ?? nextSections[0]?.id ?? null
  selectedFieldId.value = null
  selectedGroupId.value = null
  selectedTabId.value = null

  emit('update:modelValue', {
    ...props.modelValue,
    sections: nextSections,
  })
}

function updateTab(tabId: string, patch: Partial<LayoutSection>): void {
  emit('update:modelValue', {
    ...props.modelValue,
    sections: props.modelValue.sections.map((section) =>
      section.id === tabId ? { ...section, ...patch } : section,
    ),
  })
}

function patchTabs(sections: LayoutSection[]): void {
  emit('update:modelValue', {
    ...props.modelValue,
    sections: [...sections],
  })
}

function patchActions(actions: EntityAction[]): void {
  emit('update:modelValue', {
    ...props.modelValue,
    actions: [...actions],
  })
}

watch(
  () => props.modelValue.actions,
  (actions) => {
    actionDragList.value = [...(actions ?? [])]
  },
  { immediate: true },
)

function addAction(): void {
  const label = t('formBuilder.newAction', 'New Action')
  const action: EntityAction = {
    id: `act_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
    label,
    name: uniqueActionName(slugifyActionName(label)),
    displayType: 'detailButton',
    behavior: 'flow',
    flow: {
      webhook: '',
      method: 'POST',
      confirmBeforeRun: true,
      successMessage: t('formBuilder.actionCompleted', 'Action completed.'),
      refreshRecordAfterRun: true,
    },
    payload: {
      includeCollection: true,
      includeRecordId: true,
      includeRecord: false,
    },
  }
  patchActions([...(props.modelValue.actions ?? []), action])
  selectAction(action.id)
}

function removeSelectedAction(): void {
  if (!selectedActionId.value) return
  patchActions(
    (props.modelValue.actions ?? []).filter(
      (action) => action.id !== selectedActionId.value,
    ),
  )
  selectedActionId.value = null
}

function updateSelectedAction(patch: Partial<EntityAction>): void {
  if (!selectedActionId.value) return
  patchActions(
    (props.modelValue.actions ?? []).map((action) =>
      action.id === selectedActionId.value ? { ...action, ...patch } : action,
    ),
  )
}

function updateSelectedActionFlow(
  patch: Partial<NonNullable<EntityAction['flow']>>,
): void {
  if (!selectedAction.value) return
  updateSelectedAction({
    flow: {
      webhook: '',
      method: 'POST',
      confirmBeforeRun: true,
      refreshRecordAfterRun: true,
      ...selectedAction.value.flow,
      ...patch,
    },
  })
}

function updateSelectedActionPayload(
  patch: Partial<NonNullable<EntityAction['payload']>>,
): void {
  if (!selectedAction.value) return
  updateSelectedAction({
    payload: {
      includeCollection: true,
      includeRecordId: true,
      includeRecord: false,
      ...selectedAction.value.payload,
      ...patch,
    },
  })
}

function updateSelectedActionDocument(
  patch: Partial<NonNullable<EntityAction['document']>>,
): void {
  if (!selectedAction.value) return
  updateSelectedAction({
    document: {
      templateId: selectedAction.value.document?.templateId ?? null,
      skipInteractiveFill: selectedAction.value.document?.skipInteractiveFill ?? false,
      viewMode: selectedAction.value.document?.viewMode ?? 'html',
      autoSave: selectedAction.value.document?.autoSave ?? false,
      ...patch,
    },
  })
}

function updateSelectedActionCloneRelated(
  patch: Partial<NonNullable<EntityAction['cloneRelated']>>,
): void {
  if (!selectedAction.value) return
  updateSelectedAction({
    behavior: 'cloneRelated',
    cloneRelated: {
      children: selectedAction.value.cloneRelated?.children ?? [],
      confirmBeforeRun: selectedAction.value.cloneRelated?.confirmBeforeRun ?? true,
      successMessage:
        selectedAction.value.cloneRelated?.successMessage
        ?? t('formBuilder.cloneStructureCompleted', 'Structure cloned.'),
      refreshRecordAfterRun:
        selectedAction.value.cloneRelated?.refreshRecordAfterRun ?? true,
      replaceExisting: selectedAction.value.cloneRelated?.replaceExisting ?? false,
      ...patch,
    },
  })
}

function saveActionCloneRelatedSettings(settings: CloneRelatedFromSettings): void {
  updateSelectedActionCloneRelated({ children: settings.children ?? [] })
}

function slugifyActionName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return slug || 'custom_action'
}

function uniqueActionName(base: string): string {
  const existing = new Set((props.modelValue.actions ?? []).map((action) => action.name))
  if (!existing.has(base)) return base

  let index = 2
  while (existing.has(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

function addGroup(): void {
  const group = createLayoutGroup()
  patchSchema({
    groups: [...activeSection.value.groups, group],
  })
  selectGroup(group.id)
}

function updateGroupTitle(groupId: string, title: string): void {
  updateGroup(groupId, { title })
}

function updateGroup(groupId: string, patch: Partial<LayoutGroup>): void {
  patchGroups((group) => (group.id === groupId ? { ...group, ...patch } : group))
}

function toggleGroup(groupId: string): void {
  patchGroups((group) =>
    group.id === groupId ? { ...group, collapsed: !group.collapsed } : group,
  )
}

function removeGroup(groupId: string): void {
  if (activeSection.value.groups.length <= 1) return

  const group = activeSection.value.groups.find((g) => g.id === groupId)
  const remainingGroups = activeSection.value.groups.filter((g) => g.id !== groupId)
  const targetGroupId = remainingGroups[0]?.id

  patchSchema({
    groups: remainingGroups.map((remainingGroup) =>
      remainingGroup.id === targetGroupId
        ? {
            ...remainingGroup,
            fields: [...remainingGroup.fields, ...(group?.fields ?? [])],
          }
        : remainingGroup,
    ),
  })

  if (selectedGroupId.value === groupId) {
    selectedGroupId.value = null
  }
  if (selectedFieldGroupId.value === groupId) {
    closeFieldConfig()
  }
}

function patchGroupFields(
  groupId: string,
  fields: LayoutFieldMetadata[],
): void {
  patchGroups((group) =>
    group.id === groupId ? { ...group, fields: [...fields] } : group,
  )
}

function patchGroups(
  mapper: (group: LayoutGroup) => LayoutGroup,
): void {
  patchSchema({
    groups: activeSection.value.groups.map(mapper),
  })
}

function clonePaletteItem(item: PaletteItem): LayoutFieldMetadata {
  const id = generateFieldId()
  if (item.component === 'BlockLayout' || item.paletteKind === 'blockLayout') {
    return {
      id,
      field: item.fieldKey,
      label: item.label,
      component: 'BlockLayout',
      span: 12,
      blockLayoutId: item.blockLayoutId ?? null,
    }
  }
  return {
    id,
    field: item.fieldKey,
    label: item.label,
    component: item.component,
    span: ['DataTable', 'CrmTreeTable', 'CrmScheduler', 'CrmActivityLog', 'CrmDocEngine', 'Files', 'M2ABuilder'].includes(item.component)
      ? 12
      : 6,
    relatedCollection: item.relatedCollection,
    dataTable:
      item.component === 'DataTable'
        ? {
            columns: [],
            sort: null,
          }
        : undefined,
    files:
      item.component === 'Files'
        ? {
            multiple: item.multiple ?? false,
            display: 'thumbnail',
            allowedMimeTypes: [],
            columns: [],
          }
        : undefined,
    treeTable:
      item.component === 'CrmTreeTable'
        ? {
            group: {
              collection: '',
              primaryKey: 'id',
              parentField: null,
              labelField: 'name',
            },
            main: {
              collection: '',
              groupField: '',
              primaryKey: 'id',
              labelField: 'name',
              labelFields: ['name'],
            },
            destination: {
              collection: '',
              key: 'items',
            },
          }
        : undefined,
    scheduler:
      item.component === 'CrmScheduler'
        ? normalizeSchedulerSettings({
            event: {
              collection: collectionName.value,
              primaryKey: 'id',
              titleField: 'name',
              startField: 'start',
              endField: 'end',
              resourceField: '',
              defaultTitle: t('scheduler.createDefaultTitle', 'New visit'),
            },
          })
        : undefined,
    activityLog:
      item.component === 'CrmActivityLog'
        ? { ...DEFAULT_ACTIVITY_LOG_SETTINGS }
        : undefined,
    docEngine:
      item.component === 'CrmDocEngine'
        ? { ...DEFAULT_DOC_ENGINE_SETTINGS }
        : undefined,
  }
}

function paletteIcon(component: string): string {
  const icons: Record<string, string> = {
    InputText: 'pi-file',
    InputNumber: 'pi-hashtag',
    Textarea: 'pi-align-left',
    Editor: 'pi-file-edit',
    Select: 'pi-database',
    Dropdown: 'pi-database',
    AutoComplete: 'pi-database',
    MultiSelect: 'pi-database',
    DatePicker: 'pi-calendar',
    Checkbox: 'pi-check-square',
    ToggleSwitch: 'pi-check-square',
    DataTable: 'pi-database',
    CrmTreeTable: 'pi-sitemap',
    CrmScheduler: 'pi-calendar',
    CrmActivityLog: 'pi-history',
    CrmDocEngine: 'pi-file',
    Files: 'pi-paperclip',
    ChildLookup: 'pi-link',
    M2ABuilder: 'pi-database',
    Repeater: 'pi-replay',
    Address: 'pi-map-marker',
    JsonList: 'pi-list',
    JsonCode: 'pi-code',
    BlockLayout: 'pi-th-large',
  }
  return icons[component] ?? 'pi-file'
}

function updateField(
  id: string,
  patch: Partial<LayoutFieldMetadata>,
): void {
  const groups = activeSection.value.groups.map((group) => ({
    ...group,
    fields: group.fields.map((f) => {
      if (f.id !== id) return f
      const next = { ...f, ...patch }
      if ('childLookup' in patch && !patch.childLookup) {
        delete next.childLookup
      }
      if ('cloneRelatedFromSettings' in patch && !patch.cloneRelatedFromSettings) {
        delete next.cloneRelatedFromSettings
      }
      if ('cloneRelatedFrom' in patch && !patch.cloneRelatedFrom) {
        delete next.cloneRelatedFrom
        delete next.cloneRelatedFromSettings
      }
      return next
    }),
  }))
  patchSchema({ groups })
}

function setCloneRelatedFromEnabled(enabled: boolean): void {
  if (!selectedFieldId.value) return
  if (enabled) {
    updateField(selectedFieldId.value, {
      cloneRelatedFrom: true,
      cloneRelatedFromSettings:
        selectedField.value?.cloneRelatedFromSettings ?? { children: [] },
    })
    return
  }
  updateField(selectedFieldId.value, {
    cloneRelatedFrom: false,
    cloneRelatedFromSettings: undefined,
  })
}

function saveCloneRelatedFromSettings(settings: CloneRelatedFromSettings): void {
  if (!selectedFieldId.value) return
  updateField(selectedFieldId.value, {
    cloneRelatedFrom: true,
    cloneRelatedFromSettings: settings,
  })
}

function openFieldConfig(
  field: LayoutFieldMetadata,
  groupId: string | null = null,
): void {
  selectedFieldId.value = field.id
  selectedFieldGroupId.value = groupId
  selectedGroupId.value = null
  selectedTabId.value = null
  selectedActionId.value = null
}

function selectGroup(groupId: string): void {
  selectedGroupId.value = groupId
  selectedFieldId.value = null
  selectedFieldGroupId.value = null
  selectedTabId.value = null
  selectedActionId.value = null
}

function selectTab(tabId: string): void {
  activeTabId.value = tabId
  selectedTabId.value = tabId
  selectedGroupId.value = null
  selectedFieldId.value = null
  selectedFieldGroupId.value = null
  selectedActionId.value = null
}

function selectAction(actionId: string): void {
  selectedActionId.value = actionId
  selectedTabId.value = null
  selectedGroupId.value = null
  selectedFieldId.value = null
  selectedFieldGroupId.value = null
}

function closeFieldConfig(): void {
  selectedFieldId.value = null
  selectedFieldGroupId.value = null
  selectedGroupId.value = null
  selectedTabId.value = null
  selectedActionId.value = null
}

function openLayoutSetup(): void {
  closeFieldConfig()
}

const propertiesPanelTitle = computed(() => {
  if (selectedAction.value) return t('formBuilder.actionProperties', 'Action Properties')
  if (selectedTab.value) return t('formBuilder.tabProperties', 'Tab Properties')
  if (selectedGroup.value) return t('formBuilder.groupProperties', 'Group Properties')
  if (selectedField.value) return t('formBuilder.fieldProperties', 'Field Properties')
  return t('formBuilder.properties', 'Properties')
})

watch(propertiesPanelTitle, () => {
  void nextTick(restorePropertiesScroll)
})

function removeSelectedField(): void {
  if (!selectedFieldId.value) return
  const groups = activeSection.value.groups.map((group) => ({
    ...group,
    fields:
      group.id === selectedFieldGroupId.value || selectedFieldGroupId.value === null
        ? group.fields.filter((f) => f.id !== selectedFieldId.value)
        : group.fields,
  }))
  patchSchema({ groups })
  closeFieldConfig()
}

function spanStyle(span: number | undefined): Record<string, string> {
  const cols = span ?? 12
  return { gridColumn: `span ${Math.min(12, Math.max(1, cols))}` }
}

function isDataTableField(field: LayoutFieldMetadata): boolean {
  return field.component === 'DataTable'
}

function isBlockLayoutField(field: LayoutFieldMetadata): boolean {
  return field.component === 'BlockLayout'
}

function isTreeTableField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmTreeTable'
}

function isSchedulerField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmScheduler'
}

function isActivityLogField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmActivityLog'
}

function isDocEngineField(field: LayoutFieldMetadata): boolean {
  return field.component === 'CrmDocEngine'
}

function canConfigureRelatedField(field: LayoutFieldMetadata): boolean {
  if (isDataTableField(field)) return Boolean(field.relatedCollection)
  return isTreeTableField(field) || isSchedulerField(field)
}

function openRelatedFieldDialog(field: LayoutFieldMetadata, groupId: string): void {
  openFieldConfig(field, groupId)
  relatedFieldDialogVisible.value = true
}

function openSelectedRelatedFieldDialog(): void {
  if (!selectedField.value || !canConfigureRelatedField(selectedField.value)) return
  relatedFieldDialogVisible.value = true
}

function applyRelatedFieldSettings(payload: RelatedFieldSettingsApplyPayload): void {
  if (!selectedFieldId.value) return
  updateField(selectedFieldId.value, payload)
}

const relatedFieldSettingsSummary = computed(() => {
  const field = selectedField.value
  if (!field) return ''

  if (isDataTableField(field)) {
    const settings = field.dataTable
    const columnCount =
      settings?.columns?.filter((column) => column.enabled !== false).length ?? 0
    const parts = [
      t('formBuilder.relatedSummaryColumns', '{count} columns', { count: columnCount }),
    ]
    if (settings?.sort?.field) {
      parts.push(
        t('formBuilder.relatedSummarySort', 'Sort: {field}', {
          field: settings.sort.field,
        }),
      )
    }
    if (settings?.groupBy?.field) {
      parts.push(
        t('formBuilder.relatedSummaryGroup', 'Group: {field}', {
          field: settings.groupBy.field,
        }),
      )
    }
    if (settings?.relatedTransfer) {
      parts.push(t('formBuilder.relatedSummaryBatchInsert', 'Batch insert enabled'))
    }
    return parts.join(' · ')
  }

  if (isTreeTableField(field)) {
    const settings = field.treeTable
    const parts = [
      t('formBuilder.relatedSummaryTreeTable', 'Tree table picker'),
    ]
    if (settings?.main.collection) {
      parts.push(settings.main.collection)
    }
    return parts.join(' · ')
  }

  if (isSchedulerField(field)) {
    return t('formBuilder.relatedSummaryScheduler', 'Resource scheduler configured')
  }

  if (isActivityLogField(field)) {
    const settings = normalizeActivityLogSettings(field.activityLog)
    return t('activityLog.settingsSummary', 'Max {count} items · {actions}', {
      count: settings.maxItems,
      actions: settings.actions.join(', '),
    })
  }

  if (isDocEngineField(field)) {
    const settings = normalizeDocEngineSettings(field.docEngine)
    if (!settings.templateId) {
      return t('formBuilder.docEngineSummary', 'All templates')
    }
    const label =
      docTemplateOptions.value.find((opt) => opt.value === settings.templateId)?.label
      ?? settings.templateId
    return t('formBuilder.docEngineSummaryTemplate', 'Template: {id}', {
      id: label,
    })
  }

  return ''
})

const activityLogActionOptions = computed(() => [
  { label: t('activityLog.actionCreate', 'Created'), value: 'create' as ActivityLogAction },
  { label: t('activityLog.actionUpdate', 'Updated'), value: 'update' as ActivityLogAction },
  { label: t('activityLog.actionDelete', 'Deleted'), value: 'delete' as ActivityLogAction },
])

const selectedActivityLogSettings = computed(() =>
  normalizeActivityLogSettings(selectedField.value?.activityLog),
)

const selectedDocEngineSettings = computed(() =>
  normalizeDocEngineSettings(selectedField.value?.docEngine),
)

const docEngineTemplateSelectOptions = computed(() => [
  {
    label: t('formBuilder.docEngineAllTemplates', 'All templates'),
    value: '',
  },
  ...docTemplateOptions.value,
])

watch(
  [collectionName, selectedFieldId, () => selectedField.value?.component],
  () => {
    if (selectedField.value && isDocEngineField(selectedField.value)) {
      void loadDocTemplateOptionsForBuilder()
    }
  },
)

function updateActivityLogSettings(
  patch: Partial<ReturnType<typeof normalizeActivityLogSettings>>,
): void {
  if (!selectedFieldId.value) return
  updateField(selectedFieldId.value, {
    activityLog: {
      ...selectedActivityLogSettings.value,
      ...patch,
    },
  })
}

function updateDocEngineSettings(
  patch: Partial<ReturnType<typeof normalizeDocEngineSettings>>,
): void {
  if (!selectedFieldId.value) return
  updateField(selectedFieldId.value, {
    docEngine: {
      ...selectedDocEngineSettings.value,
      ...patch,
    },
  })
}

function canvasComponentProps(
  field: LayoutFieldMetadata,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    modelValue: defaultValueForField(field),
    disabled: true,
    fluid: true,
    placeholder: field.label,
  }

  if (['Select', 'Dropdown', 'SelectButton'].includes(field.component)) {
    base.options = [{ label: t('formBuilder.option', 'Option'), value: 'option' }]
    base.optionLabel = 'label'
    base.optionValue = 'value'
  }

  if (field.component === 'MultiSelect') {
    base.options = [{ label: t('formBuilder.option', 'Option'), value: 'option' }]
    base.optionLabel = 'label'
    base.optionValue = 'value'
    base.modelValue = []
  }

  if (field.component === 'AutoComplete') {
    base.suggestions = []
    base.optionLabel = 'label'
    base.dropdown = true
  }

  if (field.component === 'Checkbox' || field.component === 'ToggleSwitch') {
    base.binary = true
    base.modelValue = false
  }

  if (field.component === 'CrmTreeTable') {
    base.modelValue = []
  }

  if (field.component === 'CrmScheduler') {
    base.settings = field.scheduler
  }

  if (isDateComponent(field.component)) {
    base.showIcon = true
  }

  return base
}

function hintTooltip(value: string) {
  return { value, class: 'property-hint-tooltip' }
}
</script>

<template>
  <div class="form-builder h-full min-h-0 min-w-0">
    <Splitter
      class="form-builder__main min-h-0 min-w-0 h-full"
      layout="horizontal"
      state-key="crm.formBuilder.leftSplitter"
      state-storage="local"
      @resizestart="onBuilderSplitterResizeStart"
      @resizeend="onBuilderSplitterResizeEnd"
    >
      <SplitterPanel
        :size="22"
        :min-size="14"
        class="form-builder__palette-pane min-h-0 min-w-0"
      >
    <aside class="palette flex w-full h-full min-h-0 flex-col">
      <h2 class="m-0 mb-2 text-[0.95rem] font-semibold text-surface-900">{{ t('formBuilder.available', 'Available') }}</h2>

      <IconField class="palette-search mb-3 shrink-0">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="paletteQuery"
          :placeholder="t('formBuilder.searchFields', 'Search all fields...')"
          fluid
          size="small"
        />
      </IconField>

      <div class="palette-body flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div v-if="paletteLoading" class="flex flex-col items-stretch gap-3 py-2 text-muted-color text-[0.85rem]">
        <ProgressSpinner
          class="self-center w-9 h-9"
          stroke-width="4"
          :aria-label="t('formBuilder.loadingFields', 'Loading fields')"
        />
        <PaletteSkeleton :rows="5" />
        <span class="text-center">{{ t('formBuilder.loadingSchema', 'Loading {collection} schema...', { collection: collectionName }) }}</span>
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
          v-if="!paletteHasItems"
          class="mt-3 mb-0 text-[0.8rem] text-surface-400 text-center"
        >
          {{
            t(
              'formBuilder.noPaletteItems',
              'No {kind} available. Pick another collection or check access permissions.',
              { kind: t('formBuilder.fieldsKind', 'fields') },
            )
          }}
        </p>

        <p
          v-else-if="visiblePaletteSections.length === 0"
          class="mt-3 mb-0 text-[0.8rem] text-surface-400 text-center"
        >
          {{ t('formBuilder.noSearchResults', 'No fields match your search.') }}
        </p>

        <section
          v-for="section in visiblePaletteSections"
          :key="section.id"
          class="palette-section"
        >
          <p class="palette-section-label">{{ section.label }}</p>

          <div v-if="section.assigned.length > 0" class="flex flex-col gap-1.5 mb-1.5">
            <div
              v-for="element in section.assigned"
              :key="element.id"
              class="palette-card palette-card--assigned"
              :title="element.fieldKey"
            >
              <span class="palette-card__drag palette-card__drag--muted" aria-hidden="true">⠿</span>
              <i class="palette-card__icon pi" :class="paletteIcon(element.component)" aria-hidden="true" />
              <span class="flex-1 min-w-0 truncate text-[0.84rem] leading-tight">
                {{ element.label }}
              </span>
            </div>
          </div>

          <VueDraggableNext
            v-if="(sectionDragLists[section.id] ?? []).length > 0"
            :list="sectionDragLists[section.id]"
            :group="{ name: 'layout-fields', pull: 'clone', put: false }"
            :sort="false"
            :clone="clonePaletteItem"
            v-bind="DIALOG_SORTABLE_ATTRS"
            item-key="id"
            tag="div"
            class="flex flex-col gap-1.5 min-h-8"
          >
            <div
              v-for="element in sectionDragLists[section.id]"
              :key="element.id"
              class="palette-card"
              :title="element.fieldKey"
            >
              <span class="palette-card__drag" aria-hidden="true">⠿</span>
              <i class="palette-card__icon pi" :class="paletteIcon(element.component)" aria-hidden="true" />
              <span class="flex-1 min-w-0 truncate text-[0.84rem] text-surface-800 leading-tight">
                {{ element.label }}
              </span>
            </div>
          </VueDraggableNext>
        </section>
      </template>
      </div>
    </aside>
      </SplitterPanel>

      <SplitterPanel
        :size="78"
        :min-size="45"
        class="form-builder__workspace-pane min-h-0 min-w-0"
      >
      <Splitter
        class="form-builder__workspace min-h-0 min-w-0 h-full"
        layout="horizontal"
        state-key="crm.formBuilder.rightSplitter"
        state-storage="local"
        @resizestart="onBuilderSplitterResizeStart"
        @resizeend="onBuilderSplitterResizeEnd"
      >
      <SplitterPanel
        :size="72"
        :min-size="40"
        class="form-builder__canvas-pane min-h-0 min-w-0"
      >
    <section class="canvas-panel flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
      <div class="canvas-sheet">
      <div
        v-if="showRecordActions"
        class="action-builder"
      >
        <div class="flex gap-3 items-center justify-between mb-2">
          <h3 class="m-0 text-surface-700 text-[0.8rem] font-medium">{{ t('formBuilder.recordActions', 'Record actions') }}</h3>
          <Button
            :label="t('formBuilder.addAction', '+ Action')"
            size="small"
            severity="secondary"
            text
            @click="addAction"
          />
        </div>

        <VueDraggableNext
          v-if="actionDragList.length > 0"
          :list="actionDragList"
          item-key="id"
          tag="div"
          class="flex flex-wrap gap-1.5"
          handle=".action-builder__drag"
          ghost-class="action-builder__item--ghost"
          v-bind="DIALOG_SORTABLE_ATTRS"
          @change="patchActions(actionDragList)"
        >
          <button
            v-for="action in actionDragList"
            :key="action.id"
            type="button"
            class="action-builder__item"
            :class="{ 'action-builder__item--selected': selectedActionId === action.id }"
            @click="selectAction(action.id)"
          >
            <span class="action-builder__drag" aria-hidden="true">⠿</span>
            <span>{{ action.label }}</span>
          </button>
        </VueDraggableNext>

        <p v-else class="mt-0 mb-0 text-muted-color text-[0.75rem]">
          {{ t('formBuilder.noRecordActions', 'No custom actions yet.') }}
        </p>
      </div>

      <div class="canvas-sheet__bar">
        <span class="canvas-sheet__tabs-label">{{ t('formBuilder.tabs', 'Tabs') }}</span>
        <div class="min-w-0 flex-1">
          <VueDraggableNext
            :list="modelValue.sections"
            item-key="id"
            tag="div"
            class="flex flex-wrap gap-[0.35rem] min-w-0"
            handle=".tab-builder__drag"
            ghost-class="tab-builder__tab--ghost"
            chosen-class="tab-builder__tab--chosen"
            v-bind="DIALOG_SORTABLE_ATTRS"
            role="tablist"
            :aria-label="t('formBuilder.layoutTabs', 'Layout tabs')"
            @change="patchTabs(modelValue.sections)"
          >
            <button
              v-for="section in modelValue.sections"
              :key="section.id"
              type="button"
              class="tab-builder__tab"
              :class="{
                'tab-builder__tab--active': section.id === activeSection.id,
                'tab-builder__tab--selected': section.id === selectedTabId,
              }"
              role="tab"
              :aria-selected="section.id === activeSection.id"
              @click="selectTab(section.id)"
            >
              <span class="tab-builder__drag inline-block mr-[0.35rem] text-surface-400 cursor-grab tracking-[-0.15em] active:cursor-grabbing" aria-hidden="true">⠿</span>
              {{ section.title || t('formBuilder.untitledTab', 'Untitled tab') }}
            </button>
          </VueDraggableNext>
        </div>
        <div class="flex flex-wrap gap-2 items-center shrink-0">
          <Button
            :label="t('formBuilder.addTab', '+ Tab')"
            size="small"
            severity="secondary"
            outlined
            @click="addTab"
          />
          <Button
            :label="t('formBuilder.addGroup', '+ Group')"
            size="small"
            severity="secondary"
            outlined
            @click="addGroup"
          />
        </div>
      </div>

      <VueDraggableNext
        :list="activeSection.groups"
        item-key="id"
        tag="div"
        class="flex flex-col gap-4"
        handle=".group-block__drag"
        ghost-class="group-block--ghost"
        chosen-class="group-block--chosen"
        v-bind="DIALOG_SORTABLE_ATTRS"
        @change="patchSchema({ groups: activeSection.groups })"
      >
        <div
          v-for="group in activeSection.groups"
          :key="group.id"
          class="group-block"
          :class="{ 'group-block--selected': selectedGroupId === group.id }"
        >
          <div
            class="group-block__header"
            role="button"
            tabindex="0"
            @click="selectGroup(group.id)"
            @keydown.enter="selectGroup(group.id)"
          >
            <span class="group-block__drag" aria-hidden="true">⠿</span>
            <span class="group-block__title">{{ group.title }}</span>
            <button
              type="button"
              class="group-block__arrow"
              :aria-expanded="!group.collapsed"
              :aria-label="group.collapsed ? t('formBuilder.show', 'Show') : t('formBuilder.hide', 'Hide')"
              @click.stop="toggleGroup(group.id)"
            >
              {{ group.collapsed ? '▶' : '▼' }}
            </button>
          </div>

          <VueDraggableNext
            v-show="!group.collapsed"
            :list="group.fields"
            :group="{ name: 'layout-fields' }"
            item-key="id"
            tag="div"
            class="canvas-grid canvas-grid--group"
            ghost-class="canvas-field--ghost"
            chosen-class="canvas-field--chosen"
            v-bind="DIALOG_SORTABLE_ATTRS"
            @change="patchGroupFields(group.id, group.fields)"
          >
            <div
              v-for="element in group.fields"
              :key="element.id"
              class="canvas-field"
              :class="{
                'canvas-field--selected': selectedFieldId === element.id,
                'canvas-field--inline': group.inlineLabels !== false,
              }"
              :style="spanStyle(element.span)"
              role="button"
              tabindex="0"
              @click="openFieldConfig(element, group.id)"
              @keydown.enter="openFieldConfig(element, group.id)"
            >
              <div class="flex items-start justify-between gap-2" :class="{ 'canvas-field__label-row': group.inlineLabels !== false }">
                <span class="canvas-field__label">{{ element.label }}</span>
                <span v-if="group.inlineLabels === false" class="text-[0.7rem] text-muted-color whitespace-nowrap">
                  {{ element.component }} · {{ element.span ?? 12 }} {{ t('formBuilder.col', 'col') }}
                </span>
              </div>

              <div class="canvas-field__control">
                <div v-if="isBlockLayoutField(element)" class="canvas-datatable">
                  <div class="flex items-center justify-between gap-2 w-full">
                    <span>
                      {{ t('recordPage.pageLayout', 'Block Layout') }}
                      ·
                      {{ blockLayoutDisplayName(element) }}
                    </span>
                  </div>
                </div>
                <div v-else-if="isDataTableField(element)" class="canvas-datatable">
                  <div class="flex items-center justify-between gap-2 w-full">
                    <span>
                      {{ t('formBuilder.relatedCollectionTable', 'Related {collection} table', { collection: element.relatedCollection ?? 'collection' }) }}
                    </span>
                    <Button
                      v-if="canConfigureRelatedField(element)"
                      icon="pi pi-cog"
                      size="small"
                      text
                      rounded
                      :aria-label="t('formBuilder.configureRelatedField', 'Configure related field')"
                      @click.stop="openRelatedFieldDialog(element, group.id)"
                    />
                  </div>
                </div>
                <div v-else-if="isTreeTableField(element)" class="canvas-datatable">
                  <div class="flex items-center justify-between gap-2 w-full">
                    <span>{{ t('formBuilder.treeTablePicker', 'Tree table picker') }}</span>
                    <Button
                      icon="pi pi-cog"
                      size="small"
                      text
                      rounded
                      :aria-label="t('formBuilder.configureRelatedField', 'Configure related field')"
                      @click.stop="openRelatedFieldDialog(element, group.id)"
                    />
                  </div>
                </div>
                <div v-else-if="isSchedulerField(element)" class="canvas-datatable">
                  <div class="flex items-center justify-between gap-2 w-full">
                    <span>{{ t('formBuilder.resourceScheduler', 'Resource scheduler') }}</span>
                    <Button
                      icon="pi pi-cog"
                      size="small"
                      text
                      rounded
                      :aria-label="t('formBuilder.configureRelatedField', 'Configure related field')"
                      @click.stop="openRelatedFieldDialog(element, group.id)"
                    />
                  </div>
                </div>
                <div v-else-if="isActivityLogField(element)" class="canvas-datatable">
                  <span>{{ t('activityLog.title', 'Activity history') }}</span>
                </div>
                <div v-else-if="isDocEngineField(element)" class="canvas-datatable">
                  <span>{{ t('formBuilder.docEngine', 'DocEngine') }}</span>
                </div>
                <div v-else-if="isFilesField(element)" class="canvas-datatable">
                  <i class="pi pi-paperclip" aria-hidden="true" />
                  {{ filesSettings(element)?.multiple
                    ? t('formBuilder.filesMultiple', 'Multiple files (gallery)')
                    : t('formBuilder.filesSingle', 'Single file attachment') }}
                </div>
                <div v-else-if="element.component === 'M2ABuilder'" class="canvas-datatable">
                  {{ m2aCanvasSummary(element) }}
                </div>
                <div v-else-if="element.component === 'Repeater'" class="canvas-datatable">
                  {{ t('formBuilder.repeaterPreview', 'Schedule recurrence rule') }}
                </div>
                <div v-else-if="element.component === 'Address'" class="canvas-datatable">
                  {{ t('formBuilder.addressPreview', 'Country · State · City · Address · Post code') }}
                </div>
                <div v-else-if="element.component === 'JsonList'" class="canvas-datatable">
                  {{ t('formBuilder.jsonListPreview', 'JSON list (rows)') }}
                </div>
                <div v-else-if="element.component === 'JsonCode'" class="canvas-datatable">
                  {{ t('formBuilder.jsonCodePreview', 'JSON (raw)') }}
                </div>
                <div v-else-if="element.component === 'ChildLookup'" class="canvas-datatable">
                  {{ t('formBuilder.childLookupPreview', 'Child lookup select') }}
                </div>
                <div v-else-if="element.childLookup" class="canvas-datatable">
                  {{ t('formBuilder.childLookupValuePreview', 'Child lookup value') }}
                </div>
                <div
                  v-else-if="resolvePrimeVueComponent(element.component)"
                  class="canvas-placeholder"
                >
                  {{ element.label }}
                </div>
                <p v-else class="m-0 text-red-600 text-[0.8rem]">
                  {{ t('formBuilder.unknownComponent', 'Unknown component: {component}', { component: element.component }) }}
                </p>
              </div>
            </div>
          </VueDraggableNext>

            <p
              v-if="!group.collapsed && group.fields.length === 0"
              class="mt-2 mb-0 text-[0.85rem] text-surface-400 text-center"
            >
              {{ t('formBuilder.dragFieldsGroup', 'Drag fields into this group.') }}
            </p>
        </div>
      </VueDraggableNext>

      <p v-if="activeSection.groups.length === 0" class="mt-2 mb-0 text-[0.85rem] text-surface-400 text-center">
        {{ t('formBuilder.addGroupToStart', 'Add a group to start building this tab.') }}
      </p>

      <div
        v-if="showRecordActions && systemInfoEnabled"
        class="group-block mt-4"
      >
        <div class="group-block__header cursor-default">
          <span class="group-block__arrow" aria-hidden="true">▼</span>
          <span class="group-block__title">{{ t('formRenderer.systemInfo', 'System') }}</span>
          <span class="text-[0.75rem] font-normal text-muted-color">
            {{ t('formBuilder.systemInfoPreview', 'Auto on detail view') }}
          </span>
        </div>
        <div class="grid grid-cols-12 gap-3 p-3">
          <div class="col-span-12 md:col-span-6 flex flex-col gap-1">
            <span class="text-[0.8rem] font-medium text-surface-700">
              {{ t('formRenderer.createdBy', 'Created By') }}
            </span>
            <span class="text-[0.8rem] text-muted-color">
              {{ t('formBuilder.systemInfoCreatedPlaceholder', 'User name · created date') }}
            </span>
          </div>
          <div class="col-span-12 md:col-span-6 flex flex-col gap-1">
            <span class="text-[0.8rem] font-medium text-surface-700">
              {{ t('formRenderer.lastModifiedBy', 'Last Modified By') }}
            </span>
            <span class="text-[0.8rem] text-muted-color">
              {{ t('formBuilder.systemInfoUpdatedPlaceholder', 'User name · modified date') }}
            </span>
          </div>
        </div>
      </div>
      </div>
    </section>
      </SplitterPanel>

      <SplitterPanel
        :size="28"
        :min-size="18"
        class="form-builder__properties-pane min-h-0 min-w-0"
      >
    <aside class="properties-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div class="properties-panel__header shrink-0">
        <h2 class="properties-panel__title">{{ propertiesPanelTitle }}</h2>
        <Button
          :label="t('setup.title', 'Setup')"
          icon="pi pi-cog"
          size="small"
          severity="secondary"
          text
          class="properties-panel__setup shrink-0"
          @click="openLayoutSetup"
        />
      </div>

      <div
        ref="propertiesBodyRef"
        class="properties-panel__body flex-1 min-h-0 overflow-y-auto overscroll-contain"
        @scroll="onPropertiesScroll"
      >
      <div v-if="showRecordActions && selectedAction" class="flex flex-col gap-4">
        <div class="flex flex-col gap-[0.35rem]">
          <label for="action-label" class="text-[0.85rem] font-medium">{{ t('formBuilder.label', 'Label') }}</label>
          <InputText
            id="action-label"
            v-model="configActionLabel"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="action-name" class="text-[0.85rem] font-medium">{{ t('formBuilder.actionName', 'Action name') }}</label>
          <InputText
            id="action-name"
            v-model="configActionName"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="action-display-type" class="text-[0.85rem] font-medium">{{ t('formBuilder.displayType', 'Display type') }}</label>
          <Select
            overlay-class="property-select-overlay"
            id="action-display-type"
            v-model="configActionDisplayType"
            :options="ACTION_DISPLAY_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>

        <template v-if="isDocumentAction">
          <div class="flex flex-col gap-[0.35rem]">
            <label for="action-doc-template" class="text-[0.85rem] font-medium">
              {{ t('formBuilder.documentTemplate', 'Document template') }}
            </label>
            <Select
              overlay-class="property-select-overlay"
              id="action-doc-template"
              v-model="configActionTemplateId"
              :options="docTemplateOptions"
              option-label="label"
              option-value="value"
              show-clear
              :placeholder="t('formBuilder.documentTemplateRuntime', 'Choose at runtime')"
              fluid
            />
          </div>
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.documentTemplateHint', 'Leave empty to let users choose a template when they click the button.'))"
            :aria-label="t('formBuilder.documentTemplateHint', 'Leave empty to let users choose a template when they click the button.')"
          />
          <div class="properties-switch" :class="{ 'opacity-60': !canSkipInteractiveFill }">
            <span>{{ t('formBuilder.skipInteractiveFill', 'Skip interactive filling') }}</span>
            <ToggleSwitch
              v-model="configActionSkipInteractiveFill"
              :disabled="!canSkipInteractiveFill"
            />
          </div>
          <button
            v-if="!canSkipInteractiveFill"
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.skipInteractiveFillRequiresTemplate', 'Select a document template to enable direct view.'))"
            :aria-label="t('formBuilder.skipInteractiveFillRequiresTemplate', 'Select a document template to enable direct view.')"
          />
          <button
            v-else
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.skipInteractiveFillHint', 'Populate from field mapping and open the rendered document directly.'))"
            :aria-label="t('formBuilder.skipInteractiveFillHint', 'Populate from field mapping and open the rendered document directly.')"
          />
          <template v-if="configActionSkipInteractiveFill">
            <div class="flex flex-col gap-[0.35rem]">
              <label for="action-doc-view-mode" class="text-[0.85rem] font-medium">
                {{ t('formBuilder.documentViewMode', 'Show as') }}
              </label>
              <Select
                overlay-class="property-select-overlay"
                id="action-doc-view-mode"
                v-model="configActionViewMode"
                :options="DOCUMENT_VIEW_MODE_OPTIONS"
                option-label="label"
                option-value="value"
                fluid
              />
            </div>
            <div class="properties-switch">
              <span>{{ t('formBuilder.autoSaveDocument', 'Save document after generation') }}</span>
              <ToggleSwitch v-model="configActionAutoSave" />
            </div>
          </template>
        </template>

        <template v-else-if="isCloneRelatedAction">
          <div class="flex flex-col gap-[0.35rem]">
            <label for="action-behavior" class="text-[0.85rem] font-medium">
              {{ t('formBuilder.actionBehavior', 'Behavior') }}
            </label>
            <Select
              overlay-class="property-select-overlay"
              id="action-behavior"
              v-model="configActionBehavior"
              :options="ACTION_BEHAVIOR_OPTIONS"
              option-label="label"
              option-value="value"
              fluid
            />
          </div>
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.cloneStructureActionHint', 'Clone related child objects from this record onto itself (e.g. stages → visits or appointments). Configure source/target pairs below.'))"
            :aria-label="t('formBuilder.cloneStructureActionHint', 'Clone related child objects from this record onto itself (e.g. stages → visits or appointments). Configure source/target pairs below.')"
          />
          <Tag
            v-if="actionCloneRelatedSummary"
            severity="secondary"
            :value="actionCloneRelatedSummary"
          />
          <Button
            :label="t('formBuilder.configureCloneRelatedFrom', 'Configure clone mapping')"
            icon="pi pi-sitemap"
            size="small"
            outlined
            @click="actionCloneRelatedDialogVisible = true"
          />
          <div class="flex flex-col gap-[0.35rem]">
            <label for="action-clone-success" class="text-[0.85rem] font-medium">
              {{ t('formBuilder.successMessage', 'Success message') }}
            </label>
            <InputText
              id="action-clone-success"
              v-model="configActionCloneSuccessMessage"
              fluid
            />
          </div>
          <div class="properties-switch">
            <span>{{ t('formBuilder.confirmBeforeRun', 'Confirm before running') }}</span>
            <ToggleSwitch v-model="configActionCloneConfirm" />
          </div>
          <div class="properties-switch">
            <span>{{ t('formBuilder.refreshAfterClone', 'Refresh record after clone') }}</span>
            <ToggleSwitch v-model="configActionCloneRefresh" />
          </div>
          <div class="properties-switch">
            <span>
              {{
                t(
                  'formBuilder.replaceExistingCloneTargets',
                  'Replace existing target rows before cloning',
                )
              }}
            </span>
            <ToggleSwitch v-model="configActionCloneReplaceExisting" />
          </div>
        </template>

        <template v-else>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="action-behavior-flow" class="text-[0.85rem] font-medium">
            {{ t('formBuilder.actionBehavior', 'Behavior') }}
          </label>
          <Select
            overlay-class="property-select-overlay"
            id="action-behavior-flow"
            v-model="configActionBehavior"
            :options="ACTION_BEHAVIOR_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="action-webhook" class="text-[0.85rem] font-medium">{{ t('formBuilder.flowWebhook', 'Flow webhook') }}</label>
          <InputText
            id="action-webhook"
            v-model="configActionWebhook"
            :placeholder="t('formBuilder.flowWebhookPlaceholder', 'my-webhook-key or /flows/trigger/my-webhook-key')"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="action-success-message" class="text-[0.85rem] font-medium">{{ t('formBuilder.successMessage', 'Success message') }}</label>
          <InputText
            id="action-success-message"
            v-model="configActionSuccessMessage"
            fluid
          />
        </div>
        <div class="properties-switch">
          <span>{{ t('formBuilder.confirmBeforeRun', 'Confirm before running') }}</span>
          <ToggleSwitch v-model="configActionConfirmBeforeRun" />
        </div>
        <div class="properties-switch">
          <span>{{ t('formBuilder.refreshAfterRun', 'Refresh record after flow runs') }}</span>
          <ToggleSwitch v-model="configActionRefreshAfterRun" />
        </div>
        <div class="properties-switch">
          <span>{{ t('formBuilder.includeRecordPayload', 'Include full record in payload') }}</span>
          <ToggleSwitch v-model="configActionIncludeRecord" />
        </div>
        <button
          type="button"
          class="property-hint"
          v-tooltip.bottom="hintTooltip(t('formBuilder.flowPayloadHint', 'Payload always includes selected collection and record id.'))"
          :aria-label="t('formBuilder.flowPayloadHint', 'Payload always includes selected collection and record id.')"
        />
        </template>
        <div class="flex flex-wrap gap-2">
          <Button
            :label="t('formBuilder.removeAction', 'Remove action')"
            severity="danger"
            text
            @click="removeSelectedAction"
          />
        </div>
      </div>

      <div v-else-if="selectedTab" class="flex flex-col gap-4">
        <div class="flex flex-col gap-[0.35rem]">
          <label for="tab-label" class="text-[0.85rem] font-medium">{{ t('formBuilder.tabTitle', 'Tab title') }}</label>
          <InputText
            id="tab-label"
            v-model="configTabTitle"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="tab-description" class="text-[0.85rem] font-medium">{{ t('formBuilder.description', 'Description') }}</label>
          <InputText
            id="tab-description"
            v-model="configTabDescription"
            fluid
          />
        </div>
        <p class="m-0 text-[0.8rem] text-muted-color">
          {{ t('formBuilder.tabId', 'Tab id') }}: <code>{{ selectedTab.id }}</code>
        </p>
        <p class="m-0 text-[0.8rem] text-muted-color">
          {{ t('treeSettings.group', 'Group') }}: <code>{{ selectedTab.groups.length }}</code>
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            :label="t('formBuilder.removeTab', 'Remove tab')"
            severity="danger"
            text
            :disabled="modelValue.sections.length <= 1"
            @click="removeActiveTab"
          />
        </div>
      </div>

      <div v-else-if="selectedGroup" class="flex flex-col gap-4">
        <div class="flex flex-col gap-[0.35rem]">
          <label for="group-label" class="text-[0.85rem] font-medium">{{ t('formBuilder.groupTitle', 'Group title') }}</label>
          <InputText
            id="group-label"
            v-model="configGroupTitle"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
          <label for="group-state" class="text-[0.85rem] font-medium">{{ t('formBuilder.groupState', 'Group state') }}</label>
          <Select
            overlay-class="property-select-overlay"
            id="group-state"
            v-model="configGroupCollapsed"
            :options="GROUP_STATE_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div class="flex flex-col gap-[0.35rem]">
        <div class="properties-switch">
          <label for="group-inline-labels">
            {{ t('formBuilder.inlineLabels', 'Inline labels') }}
          </label>
          <ToggleSwitch
            id="group-inline-labels"
            v-model="configGroupInlineLabels"
          />
        </div>
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.inlineLabelsHint', 'Show labels beside values on wide screens; stack above values on small screens.'))"
            :aria-label="t('formBuilder.inlineLabelsHint', 'Show labels beside values on wide screens; stack above values on small screens.')"
          />
        </div>
        <p class="m-0 text-[0.8rem] text-muted-color">
          {{ t('formBuilder.groupId', 'Group id') }}: <code>{{ selectedGroup.id }}</code>
        </p>
        <p class="m-0 text-[0.8rem] text-muted-color">
          {{ t('formBuilder.fields', 'Fields') }}: <code>{{ selectedGroup.fields.length }}</code>
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            :label="t('formBuilder.removeGroup', 'Remove group')"
            severity="danger"
            text
            :disabled="activeSection.groups.length <= 1"
            @click="removeGroup(selectedGroup.id)"
          />
        </div>
      </div>

      <div v-else-if="selectedField" class="flex flex-col gap-4">
        <div class="flex flex-col gap-[0.35rem]">
          <label for="field-label" class="text-[0.85rem] font-medium">{{ t('formBuilder.label', 'Label') }}</label>
          <InputText
            id="field-label"
            v-model="configLabel"
            fluid
          />
        </div>

        <div
          v-if="isBlockLayoutField(selectedField)"
          class="flex flex-col gap-[0.35rem]"
        >
          <label for="field-block-layout" class="text-[0.85rem] font-medium">
            {{ t('recordPage.pageLayout', 'Block Layout') }}
          </label>
          <Select
            overlay-class="property-select-overlay"
            id="field-block-layout"
            v-model="configBlockLayoutId"
            :options="blockLayoutOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('recordPage.selectPageLayout', 'Select a Block Layout')"
            show-clear
            fluid
          />
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.blockLayoutHint', 'Fields from this Block Layout are included in compact details.'))"
            :aria-label="t('formBuilder.blockLayoutHint', 'Fields from this Block Layout are included in compact details.')"
          />
        </div>

        <div
          v-if="!isBlockLayoutField(selectedField)"
          class="flex flex-col gap-[0.35rem]"
        >
          <label for="field-span" class="text-[0.85rem] font-medium">{{ t('formBuilder.widthColumns', 'Grid width (columns)') }}</label>
          <Select
            overlay-class="property-select-overlay"
            id="field-span"
            v-model="configSpan"
            :options="SPAN_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div
          v-if="selectedFieldParentGroup && !isBlockLayoutField(selectedField)"
          class="flex flex-col gap-[0.35rem]"
        >
          <div class="properties-switch">
            <label for="field-inline-labels">
              {{ t('formBuilder.inlineLabels', 'Inline labels') }}
            </label>
            <ToggleSwitch
              id="field-inline-labels"
              v-model="configFieldGroupInlineLabels"
            />
          </div>
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.inlineLabelsHint', 'Show labels beside values on wide screens; stack above values on small screens.'))"
            :aria-label="t('formBuilder.inlineLabelsHint', 'Show labels beside values on wide screens; stack above values on small screens.')"
          />
        </div>
        <div
          v-if="selectedFieldSupportsFormat"
          class="flex flex-col gap-[0.35rem]"
        >
          <label for="field-format" class="text-[0.85rem] font-medium">{{ t('formBuilder.dateFormat', 'Date format') }}</label>
          <InputText
            id="field-format"
            v-model="configFormat"
            :placeholder="t('formBuilder.dateFormatExample', 'yy-mm-dd HH:mm')"
            fluid
          />
        </div>
        <label
          v-if="selectedFieldSupportsReadonly"
          class="flex items-center justify-between gap-3 text-[0.85rem] font-medium text-surface-700"
        >
          {{ t('formBuilder.readOnlyField', 'Read-only in edit forms') }}
          <ToggleSwitch v-model="configReadonly" />
        </label>
        <p class="m-0 text-[0.8rem] text-muted-color">
          {{ t('formBuilder.bindingKey', 'Binding key') }}: <code>{{ selectedField.field }}</code>
        </p>

        <p class="m-0 text-[0.8rem] text-muted-color">
          {{ t('formBuilder.component', 'Component') }}: <code>{{ selectedField.component }}</code>
        </p>

        <p v-if="selectedField.relatedCollection" class="m-0 text-[0.8rem] text-muted-color">
          {{ t('formBuilder.relatedCollection', 'Related collection') }}:
          <code>{{ selectedField.relatedCollection }}</code>
        </p>

        <section
          v-if="selectedFieldSupportsCloneRelated"
          class="flex min-w-0 flex-col gap-3 border-t border-surface-200 pt-3"
        >
          <label class="flex min-w-0 items-center justify-between gap-3 text-[0.85rem] font-medium text-surface-700">
            {{ t('formBuilder.cloneRelatedFrom', 'Clone related from this record') }}
            <ToggleSwitch
              class="shrink-0"
              :model-value="cloneRelatedFromEnabled"
              @update:model-value="setCloneRelatedFromEnabled(Boolean($event))"
            />
          </label>
          <template v-if="cloneRelatedFromEnabled">
            <p
              v-if="cloneRelatedFromSummary"
              class="m-0 text-[0.8rem] text-muted-color"
            >
              {{ cloneRelatedFromSummary }}
            </p>
            <Button
              :label="t('formBuilder.configureCloneRelatedFrom', 'Configure clone mapping')"
              icon="pi pi-cog"
              size="small"
              outlined
              class="justify-self-start self-start"
              @click="cloneRelatedFromDialogVisible = true"
            />
          </template>
        </section>

        <section
          v-if="selectedField && isActivityLogField(selectedField)"
          class="border-t border-surface-200 grid gap-3 pt-3"
        >
          <h3 class="text-[0.9rem] m-0">
            {{ t('activityLog.settingsTitle', 'Activity log settings') }}
          </h3>
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
          <label class="flex items-center justify-between gap-3 text-[0.8rem] font-semibold text-surface-700">
            {{ t('activityLog.showDeltas', 'Show field-level changes') }}
            <ToggleSwitch
              :model-value="selectedActivityLogSettings.showDeltas"
              @update:model-value="updateActivityLogSettings({ showDeltas: Boolean($event) })"
            />
          </label>
          <p class="m-0 text-[0.85rem] text-muted-color">
            {{ relatedFieldSettingsSummary }}
          </p>
        </section>

        <section
          v-if="selectedField && isDocEngineField(selectedField)"
          class="border-t border-surface-200 grid gap-3 pt-3"
        >
          <h3 class="text-[0.9rem] m-0">
            {{ t('formBuilder.docEngineSettings', 'DocEngine settings') }}
          </h3>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{ t('formBuilder.docEngineTemplate', 'Template') }}
            <Select
              overlay-class="property-select-overlay"
              :model-value="selectedDocEngineSettings.templateId ?? ''"
              :options="docEngineTemplateSelectOptions"
              option-label="label"
              option-value="value"
              filter
              fluid
              :placeholder="t('formBuilder.docEngineAllTemplates', 'All templates')"
              @update:model-value="
                updateDocEngineSettings({
                  templateId: String($event ?? '').trim() || null,
                })
              "
            />
          </label>
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.docEngineTemplateHint', 'All templates lets the user pick at runtime. Export format comes from the template.'))"
            :aria-label="t('formBuilder.docEngineTemplateHint', 'All templates lets the user pick at runtime. Export format comes from the template.')"
          />
          <p class="m-0 text-[0.85rem] text-muted-color">
            {{ relatedFieldSettingsSummary }}
          </p>
        </section>

        <section
          v-if="selectedField && canConfigureRelatedField(selectedField)"
          class="border-t border-surface-200 grid gap-3 pt-3"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-[0.9rem] m-0">
              {{
                isDataTableField(selectedField)
                  ? t('formBuilder.dataTableFieldsAndSort', 'DataTable fields and sort')
                  : isTreeTableField(selectedField)
                    ? t('formBuilder.treeTableSettings', 'TreeTable settings')
                    : t('formBuilder.schedulerSettings', 'Scheduler settings')
              }}
            </h3>
            <Button
              :label="t('formBuilder.configureRelatedField', 'Configure')"
              icon="pi pi-cog"
              size="small"
              outlined
              @click="openSelectedRelatedFieldDialog"
            />
          </div>
          <p class="m-0 text-[0.85rem] text-muted-color">
            {{ relatedFieldSettingsSummary || t('formBuilder.relatedFieldNotConfigured', 'Not configured yet.') }}
          </p>
        </section>

        <div
          v-if="isFilesField(selectedField)"
          class="border-t border-surface-200 grid gap-3 pt-3"
        >
          <h3 class="text-[0.9rem] m-0">{{ t('formBuilder.filesSettings', 'Files settings') }}</h3>
          <FilesSettingsDesigner v-model="configFilesSettings" />
        </div>

        <div
          v-if="selectedField && isM2ABuilderField(selectedField)"
          class="border-t border-surface-200 grid gap-3 pt-3"
        >
          <h3 class="text-[0.9rem] m-0">{{ t('m2aSettings.title', 'M2A settings') }}</h3>
          <M2ASettingsDesigner
            v-model="configM2aSettings"
            :parent-collection="collectionName"
            :field-name="selectedField.field"
          />
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            :label="t('formBuilder.removeField', 'Remove field')"
            severity="danger"
            text
            @click="removeSelectedField"
          />
        </div>
      </div>

      <div v-else class="flex flex-col gap-4">
        <section
          v-if="showRecordActions"
          class="border border-surface-200 rounded-lg p-4 grid gap-3"
        >
          <h3 class="text-[0.9rem] m-0">
            {{ t('formBuilder.systemInformation', 'System information') }}
          </h3>
          <button
            type="button"
            class="property-hint"
            v-tooltip.bottom="hintTooltip(t('formBuilder.systemInformationHint', 'Shows Created By and Last Modified By at the bottom of the record detail view.'))"
            :aria-label="t('formBuilder.systemInformationHint', 'Shows Created By and Last Modified By at the bottom of the record detail view.')"
          />
          <label class="flex items-center justify-between gap-3 text-[0.85rem] font-medium text-surface-700">
            {{ t('formBuilder.showSystemInfo', 'Show system block on detail view') }}
            <ToggleSwitch v-model="systemInfoEnabled" />
          </label>
          <label
            v-if="systemInfoEnabled"
            class="flex items-center justify-between gap-3 text-[0.85rem] font-medium text-surface-700"
          >
            {{ t('formBuilder.systemInfoCollapsedDefault', 'Collapsed by default') }}
            <ToggleSwitch v-model="systemInfoCollapsedDefault" />
          </label>
        </section>

        <p class="m-0 border border-dashed border-surface-300 rounded-lg text-surface-400 p-4 text-center">
          {{ t('formBuilder.selectTypeToEdit', 'Select a tab, group, or field to edit parameters.') }}
        </p>
      </div>
      </div>
    </aside>
      </SplitterPanel>
      </Splitter>
      </SplitterPanel>
    </Splitter>

    <RelatedFieldSettingsDialog
      v-model:visible="relatedFieldDialogVisible"
      :field="selectedField"
      :parent-collection="collectionName"
      @apply="applyRelatedFieldSettings"
    />
    <CloneRelatedFromSettingsDialog
      v-model:visible="cloneRelatedFromDialogVisible"
      :field-label="selectedField?.label"
      :source-collection="selectedField?.relatedCollection"
      :target-collection="collectionName"
      :settings="cloneRelatedFromSettings"
      @save="saveCloneRelatedFromSettings"
    />
    <CloneRelatedFromSettingsDialog
      v-model:visible="actionCloneRelatedDialogVisible"
      :field-label="selectedAction?.label"
      :source-collection="collectionName"
      :target-collection="collectionName"
      :settings="actionCloneRelatedSettings"
      @save="saveActionCloneRelatedSettings"
    />
  </div>
</template>

<style scoped>
.form-builder {
  --notion-wash: #f7f7f5;
  --notion-block: #f1f1ef;
  --notion-ink: #37352f;
  --notion-hover: rgba(55, 53, 47, 0.06);
  --notion-line: rgba(55, 53, 47, 0.16);
  --notion-card: #fff;
  --notion-muted: #f1f1ef;
  --notion-input: #f1f1ef;
  font-family: Inter, system-ui, sans-serif;
  color: var(--notion-ink);
}

.form-builder__main {
  border: 0;
  background: transparent;
}

.form-builder__main :deep(.p-splitter),
.form-builder__workspace :deep(.p-splitter) {
  height: 100%;
  min-height: 0;
  border: 0;
  background: transparent;
  gap: 0;
}

.form-builder__main :deep(.p-splitter-panel),
.form-builder__workspace :deep(.p-splitter-panel) {
  min-width: 0;
  overflow: hidden;
}

.form-builder__main :deep(.p-splitter-gutter),
.form-builder__workspace :deep(.p-splitter-gutter) {
  width: 6px;
  margin: 0 0.2rem;
  background: transparent;
  transition: background-color 0.12s;
}

.form-builder__main :deep(.p-splitter-gutter:hover),
.form-builder__main :deep(.p-splitter-gutter-resizing),
.form-builder__workspace :deep(.p-splitter-gutter:hover),
.form-builder__workspace :deep(.p-splitter-gutter-resizing) {
  background: rgba(143, 163, 168, 0.45);
}

.form-builder__main :deep(.p-splitter-gutter-handle),
.form-builder__workspace :deep(.p-splitter-gutter-handle) {
  height: 2.5rem;
  width: 3px;
  border-radius: 999px;
  background: #8fa3a8;
}

.form-builder__workspace-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.form-builder__workspace {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-height: 0;
}

.form-builder__canvas-pane,
.form-builder__properties-pane,
.form-builder__palette-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.form-builder__canvas-pane > .canvas-panel,
.form-builder__properties-pane > .properties-panel,
.form-builder__palette-pane > .palette {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.palette {
  border: 0;
  border-radius: 8px;
  background: #edf3f4;
  padding: 0.75rem 0.55rem;
}

.palette-body {
  padding-right: 0.15rem;
}

.palette-search :deep(.p-inputtext) {
  background: var(--notion-card);
  border-color: color-mix(in srgb, var(--p-surface-300) 70%, transparent);
  border-radius: 8px;
}

.palette-search :deep(.p-inputtext::placeholder) {
  color: rgba(55, 53, 47, 0.4);
  opacity: 1;
}

.palette-section {
  margin-bottom: 0.85rem;
}

.palette-section-label {
  margin: 0 0 0.4rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--p-surface-500);
}

.palette-card {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.48rem 0.55rem;
  background: #fff;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  cursor: grab;
  user-select: none;
  box-shadow: none;
  color: var(--notion-ink);
}

.palette-card:active {
  cursor: grabbing;
}

.palette-card:hover,
.palette-card--assigned:hover {
  background: rgba(55, 53, 47, 0.08);
}

.palette-card__icon {
  flex-shrink: 0;
  width: 1rem;
  font-size: 0.75rem;
  line-height: 1;
  color: rgba(55, 53, 47, 0.55);
  background: transparent;
}

.palette-card__drag {
  flex-shrink: 0;
  color: var(--p-surface-300);
  font-size: 0.85rem;
  letter-spacing: -0.15em;
  line-height: 1;
}

.palette-card__drag--muted {
  opacity: 0.45;
}

.palette-card--assigned {
  cursor: default;
  background: rgba(55, 53, 47, 0.05);
  border-color: transparent;
  color: rgba(55, 53, 47, 0.45);
}

.canvas-panel {
  background: transparent;
  border: 0;
  padding: 0 0.15rem;
}

.canvas-sheet__tabs-label {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(55, 53, 47, 0.45);
}

.canvas-sheet {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid rgba(55, 53, 47, 0.08);
  border-radius: 12px;
  background: #fff;
}

.canvas-sheet__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid #8fa3a8;
  border-radius: 8px;
  background: #edf3f4;
}

.canvas-sheet__title {
  border: 0;
  background: transparent;
  padding: 0.15rem 0.25rem;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--p-surface-900);
  cursor: pointer;
  border-radius: 6px;
}

.canvas-sheet__title--selected {
  box-shadow: 0 0 0 1px var(--p-primary-color);
}

.tab-builder__tab,
.tab-builder__add {
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--notion-ink);
  padding: 0.28rem 0.5rem;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.tab-builder__tab:hover {
  background: var(--notion-hover);
}

.tab-builder__tab--active {
  border-color: #6f868c;
  background: #fff;
  color: var(--notion-ink);
  font-size: 0.92rem;
  font-weight: 600;
  box-shadow: 0 0 0 1px #6f868c;
}

.tab-builder__tab--selected {
  border-color: #6f868c;
  background: #fff;
  box-shadow: 0 0 0 1px #6f868c;
}

.tab-builder__tab--ghost {
  opacity: 0.4;
  background: var(--p-surface-100);
}

.tab-builder__tab--chosen {
  box-shadow: 0 4px 12px rgb(15 23 42 / 0.08);
}

.action-builder {
  padding: 0.55rem 0.65rem;
  border: 1px solid #8fa3a8;
  border-radius: 8px;
  background: #edf3f4;
}

.action-builder__item {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(55, 53, 47, 0.14);
  border-radius: 8px;
  background: #fff;
  color: var(--notion-ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.38rem 0.7rem;
  text-align: left;
}

.action-builder__item:hover {
  background: var(--notion-hover);
  color: var(--notion-ink);
  border-color: var(--notion-line);
}

.action-builder__drag {
  margin-right: 0.35rem;
  color: var(--p-surface-400);
  cursor: grab;
  letter-spacing: -0.15em;
  line-height: 1;
}

.action-builder__drag:active {
  cursor: grabbing;
}

.action-builder__item--ghost {
  opacity: 0.45;
}

.action-builder__item--selected {
  border-color: #6f868c;
  background: #fff;
  color: #191918;
  font-weight: 600;
  box-shadow: 0 0 0 1px #6f868c;
}

.group-block {
  border: 1px solid #8fa3a8;
  border-radius: 8px;
  background: #edf3f4;
  overflow: hidden;
  user-select: none;
}

.group-block--selected {
  background: #e4eef0;
  border-color: #6f868c;
  box-shadow: 0 0 0 1px #6f868c;
}

.group-block--selected .group-block__title {
  color: #111;
}

.group-block--ghost {
  opacity: 0.4;
  background: var(--p-surface-200);
}

.group-block--chosen {
  box-shadow: 0 6px 16px rgb(15 23 42 / 0.08);
}

.group-block__header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.85rem 0.9rem 0.35rem;
  border: 0;
  background: transparent;
  color: #111;
  font: inherit;
  cursor: pointer;
}

.group-block__header:hover {
  background: transparent;
}

.group-block__title {
  flex: 1;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #111;
}

.group-block__arrow {
  flex-shrink: 0;
  margin-left: auto;
  width: 0.85rem;
  border: 0;
  background: transparent;
  color: rgba(55, 53, 47, 0.4);
  cursor: pointer;
  font: inherit;
  font-size: 0.62rem;
  line-height: 1;
  padding: 0;
}

.group-block__drag {
  color: #9ca3af;
  cursor: grab;
  letter-spacing: -0.14em;
  font-size: 0.9rem;
  line-height: 1;
}

.group-block .canvas-grid--group {
  gap: 0.25rem 0.4rem;
  padding: 0.55rem 0.75rem 0.7rem;
}

.group-block .canvas-field {
  padding: 0.4rem 0.6rem;
  gap: 0.65rem;
  background: #fff;
  border: 1px solid transparent;
  box-shadow: none;
  border-radius: 6px;
}

.group-block .canvas-field__label {
  font-size: 0.82rem;
  font-weight: 700;
  color: #111;
}

.group-block .canvas-field--inline .canvas-field__label-row {
  flex: 0 0 7.1rem;
}

.group-block .canvas-placeholder,
.group-block .canvas-datatable {
  min-height: 2rem;
  border-radius: 6px;
  background: #edf3f4;
  color: #9ca3af;
  font-weight: 500;
  padding: 0.35rem 0.75rem;
  box-shadow: none;
}

.group-block .canvas-field--selected {
  background: #fff;
  border-color: #6f868c;
  box-shadow: 0 0 0 1px #6f868c;
}

.group-block .canvas-field:hover {
  background: #fff;
  box-shadow: none;
}

.group-block .canvas-field--selected .canvas-field__label,
.group-block .canvas-field:hover .canvas-field__label {
  color: #111;
  font-weight: 700;
}

.group-block .canvas-field--selected .canvas-placeholder,
.group-block .canvas-field--selected .canvas-datatable {
  background: #edf3f4;
  color: #374151;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px #8fa3a8;
}

.group-block .canvas-field:hover .canvas-placeholder,
.group-block .canvas-field:hover .canvas-datatable {
  background: #edf3f4;
  color: #6b7280;
  font-weight: 500;
  box-shadow: none;
}

.group-block__toggle {
  display: none;
}

.canvas-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 0.55rem 1rem;
  flex: 1;
  min-height: 4.5rem;
  align-content: start;
  padding: 0.2rem 0.85rem 0.95rem;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.canvas-grid--group {
  min-height: 3.25rem;
  background: transparent;
}

.canvas-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.35rem 0.4rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: grab;
  user-select: none;
  transition: border-color 0.12s, background-color 0.12s;
}

.canvas-field:active,
.canvas-field--chosen {
  cursor: grabbing;
}

.canvas-field__label {
  font-size: 0.82rem;
  font-weight: 500;
  color: #2f2e2a;
}

.canvas-field--inline {
  flex-direction: row;
  align-items: center;
  gap: 0.65rem;
}

.canvas-field--inline .canvas-field__label-row {
  flex: 0 0 7.5rem;
  min-width: 0;
}

.canvas-field--inline .canvas-field__control {
  flex: 1 1 auto;
  min-width: 0;
}

.canvas-field--selected {
  background: var(--notion-hover);
  border-color: transparent;
  box-shadow: none;
}

.canvas-field--selected .canvas-field__label,
.canvas-field--selected .canvas-placeholder,
.canvas-field--selected .canvas-datatable {
  color: #191918;
  font-weight: 600;
}

.canvas-field:hover {
  background: transparent;
  box-shadow: none;
}

.canvas-field:hover .canvas-field__label,
.canvas-field:hover .canvas-placeholder,
.canvas-field:hover .canvas-datatable {
  color: #191918;
  font-weight: 600;
}

.canvas-field:hover .canvas-placeholder,
.canvas-field:hover .canvas-datatable {
  background: #fff;
}

.canvas-field--ghost {
  opacity: 0.4;
  background: var(--p-surface-100);
}

.canvas-field--chosen {
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.06);
}

.canvas-field__control {
  pointer-events: none;
}

.canvas-field__control :deep(.p-button) {
  pointer-events: auto;
}

.canvas-placeholder {
  display: flex;
  align-items: center;
  min-height: 2.4rem;
  width: 100%;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  background: #e7edf2;
  color: rgba(55, 53, 47, 0.62);
  font-size: 0.8rem;
  line-height: 1.2;
  transition: background-color 0.12s, color 0.12s;
}

.canvas-field__control :deep(.p-component),
.canvas-field__control :deep(.p-inputtext),
.canvas-field__control :deep(.p-textarea),
.canvas-field__control :deep(.p-select) {
  width: 100%;
}

.canvas-field__control :deep(.p-inputtext),
.canvas-field__control :deep(.p-textarea),
.canvas-field__control :deep(.p-select),
.canvas-field__control :deep(.p-datepicker-input) {
  background: var(--notion-muted);
  border-color: transparent;
  box-shadow: none;
  color: var(--p-surface-600);
  min-height: 2rem;
}

.canvas-field__control :deep(.p-select-label),
.canvas-field__control :deep(.p-datepicker-input) {
  color: var(--p-surface-500);
}

.canvas-datatable {
  border: 0;
  border-radius: 8px;
  background: #e7edf2;
  color: rgba(55, 53, 47, 0.72);
  padding: 0.5rem 0.8rem;
  min-height: 2.4rem;
  font-size: 0.8rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.properties-panel {
  background: #edf3f4;
  border: 0;
  border-radius: 12px;
  padding: 0.9rem 0.8rem 1rem;
  min-height: 0;
  overflow: hidden;
}

.properties-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}

.properties-panel__body {
  min-height: 0;
  padding-right: 0.2rem;
}

.properties-panel__body > div {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding-bottom: 0.35rem;
}

.properties-panel__title {
  margin: 0;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--p-surface-900);
  text-decoration: none;
}

.properties-panel__setup {
  color: var(--p-surface-600);
}

.properties-panel label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--p-surface-800);
}

.properties-panel .text-muted-color,
.properties-panel :deep(.p-inputtext::placeholder),
.properties-panel :deep(.p-textarea::placeholder),
.properties-panel :deep(.p-placeholder) {
  color: rgba(55, 53, 47, 0.4);
  opacity: 1;
}

.properties-panel .property-hint {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.properties-panel .property-hint:focus-visible {
  outline: 2px solid rgba(55, 53, 47, 0.35);
  outline-offset: 2px;
}

.properties-panel .property-hint::before {
  content: "i";
}

:global(.property-hint-tooltip),
:global(.property-hint-tooltip .p-tooltip-text) {
  max-width: 16rem;
  white-space: normal;
  line-height: 1.4;
}

.properties-panel code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
  color: var(--p-surface-500);
}

.properties-panel :deep(.p-inputtext),
.properties-panel :deep(.p-select),
.properties-panel :deep(.p-dropdown),
.properties-panel :deep(.p-textarea),
.properties-panel :deep(.p-inputnumber),
.properties-panel :deep(.p-inputnumber-input),
.properties-panel :deep(.p-multiselect) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  --p-select-background: #fff;
  --p-select-filled-background: #fff;
  --p-select-filled-hover-background: #fff;
  --p-select-filled-focus-background: #fff;
  --p-select-hover-background: #fff;
  --p-select-focus-background: #fff;
  --p-select-border-color: rgba(55, 53, 47, 0.12);
  --p-select-hover-border-color: rgba(55, 53, 47, 0.2);
  --p-select-focus-border-color: rgba(55, 53, 47, 0.28);
  --p-select-color: #37352f;
  --p-inputtext-background: #fff;
  --p-inputtext-filled-background: #fff;
  background: #fff !important;
  border: 1px solid rgba(55, 53, 47, 0.12);
  box-shadow: none;
  border-radius: 6px;
  color: var(--notion-ink);
}

.properties-panel :deep(.p-select .p-select-label),
.properties-panel :deep(.p-select .p-select-dropdown),
.properties-panel :deep(.p-dropdown .p-dropdown-label),
.properties-panel :deep(.p-select-label),
.properties-panel :deep(.p-select-dropdown),
.properties-panel :deep(.p-dropdown-label) {
  background: transparent !important;
  color: var(--notion-ink);
}

.properties-panel :deep(.p-inputtext:enabled:focus),
.properties-panel :deep(.p-textarea:enabled:focus),
.properties-panel :deep(.p-select:not(.p-disabled).p-focus),
.properties-panel :deep(.p-dropdown:not(.p-disabled).p-focus),
.properties-panel :deep(.p-inputnumber-input:enabled:focus),
.properties-panel :deep(.p-multiselect:not(.p-disabled).p-focus) {
  background: #fff !important;
  border-color: rgba(55, 53, 47, 0.28);
  box-shadow: none;
}

.properties-panel :deep(.p-button-danger.p-button-text) {
  align-self: flex-start;
  padding-left: 0;
  padding-right: 0;
}

.properties-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.properties-switch span {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--notion-ink);
}

.form-builder :deep(.p-button.p-button-outlined),
.form-builder :deep(.p-button:not(.p-button-text):not(.p-button-danger)) {
  background: transparent;
  border: 1px solid var(--notion-line);
  color: var(--notion-ink);
}

.form-builder :deep(.p-button.p-button-outlined:hover),
.form-builder :deep(.p-button:not(.p-button-text):not(.p-button-danger):hover) {
  background: var(--notion-hover);
  border-color: var(--notion-line);
  color: var(--notion-ink);
}

.form-builder :deep(.p-button.p-button-text:not(.p-button-danger)) {
  background: transparent;
  border-color: transparent;
  color: var(--notion-ink);
}

.form-builder :deep(.p-button.p-button-text:not(.p-button-danger):hover) {
  background: var(--notion-hover);
  color: var(--notion-ink);
}
</style>

<style>
.property-select-overlay {
  border: 1px solid rgba(55, 53, 47, 0.12);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 15, 15, 0.08);
}

.property-select-overlay .p-select-option {
  color: #37352f;
  border-radius: 4px;
}

.property-select-overlay .p-select-option.p-select-option-selected,
.property-select-overlay .p-select-option.p-select-option-selected.p-focus,
.property-select-overlay .p-select-option:not(.p-disabled).p-focus,
.property-select-overlay .p-select-option:not(.p-disabled):hover {
  background: #edf3f4;
  color: #191918;
}
</style>
