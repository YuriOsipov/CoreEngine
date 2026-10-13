<script lang="ts">
export default {
  name: 'DataTableFilter',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import { useConfirm } from 'openvue/useconfirm'
import {
  listFilterableFields,
  ALL_RECORDS_FILTER_ID,
  ALL_RECORDS_FILTER,
  DEFAULT_FILTER_FIELD_WIDTH,
  resolveConditionFieldWidth,
  type FilterLogic,
  type FilterableField,
  type ListFilterCondition,
  type SavedListFilter,
} from '@/modules/config/services/listFilterSettings'
import {
  deleteListView,
  loadListViews,
  resolveListViewsForCurrentUser,
  saveListView,
  savePredefinedViewTableSettings,
} from '@/modules/config/services/listViewSettings'
import { isPredefinedListViewId } from '@/interfaces/listViews'
import {
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
  searchRelatedCollectionOptions,
} from '@/modules/entities/services/collectionSchema'
import { useTranslation } from '@/core/translation'
import { buildRoleSelectOptions, roleIdToSelectValue, selectValueToRoleId } from '@/core/settingRoleUtils'
import {
  normalizeConditionValue,
  isEmptyFilterValue,
  filterConditionComponentProps,
  isAutoCompleteFilterComponent,
  resolveFilterValueComponent,
} from '@/core/listFilterUtils'
import { isDateComponent } from '@/core/dateFormatting'
import {
  DYNAMIC_FILTER_TOKEN_TODAY,
  DYNAMIC_FILTER_TOKEN_YESTERDAY,
  isDynamicFilterValue,
  resolveDynamicFilterValue,
} from '@/core/dynamicFilterValues'
import { resolvePrimeVueComponent } from '@/core/primevue'
import { DIALOG_SORTABLE_ATTRS } from '@/modules/config/utils/dialogSortable'
import type { DataTableSettings, AppRoleOption, PrimeVueComponentType, SavedListView } from '@/interfaces'
import {
  RECENTLY_VIEWED_FILTER,
  RECENTLY_VIEWED_FILTER_ID,
} from '@/modules/dashboard/services/recentRecords'

type DraggableFilterField = FilterableField & {
  id: string
  operator: string
  value: string
}

interface SelectOption {
  label: string
  value: string | number
}

interface FilterConditionDraft extends Omit<ListFilterCondition, 'value'> {
  label: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
  value: unknown
  userVisible?: boolean
  fieldWidth?: number
}

const props = withDefaults(
  defineProps<{
    collection: string
    selectedFilterId?: string | null
    pinnedFilterId?: string | null
    showBuilder?: boolean
    viewTableSettings?: Pick<DataTableSettings, 'columns' | 'sort' | 'groupBy' | 'recordLinkField'> | null
    roleId?: string | null
    roleOptions?: AppRoleOption[]
    setupMode?: boolean
    lockPredefinedView?: boolean
    createNew?: boolean
  }>(),
  {
    selectedFilterId: null,
    pinnedFilterId: null,
    showBuilder: true,
    viewTableSettings: null,
    roleId: null,
    roleOptions: () => [],
    setupMode: false,
    lockPredefinedView: false,
    createNew: false,
  },
)
const confirm = useConfirm()
const { t } = useTranslation()

const emit = defineEmits<{
  viewSelected: [view: SavedListView | SavedListFilter | null]
  viewSaved: [view: SavedListView]
  /** Live filter criteria for the selected / edited list view (DocEngine meta.filter). */
  filterConditions: [conditions: ListFilterCondition[]]
  pinFilter: [filterId: string | null]
  'update:roleId': [value: string | null]
}>()

const fields = ref<FilterableField[]>([])
const conditions = ref<FilterConditionDraft[]>([])
const savedViews = ref<SavedListView[]>([])
const selectedFilterIdModel = ref<string | null>(null)
const editingFilterId = ref<string | null>(null)
const filterName = ref('')
const logic = ref<FilterLogic>('and')
const showDesigner = ref(false)
/** Setup List view: Filter panel starts collapsed. */
const filterPanelCollapsed = ref(true)

function toEmittedFilterConditions(
  source: Array<Pick<ListFilterCondition, 'id' | 'field' | 'operator' | 'value' | 'type' | 'userVisible' | 'fieldWidth'>>,
): ListFilterCondition[] {
  return source.map((condition) => ({
    id: condition.id,
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
    ...(condition.type ? { type: condition.type } : {}),
    ...(condition.userVisible === false ? { userVisible: false } : {}),
    ...(condition.fieldWidth ? { fieldWidth: condition.fieldWidth } : {}),
  }))
}

/** Prefer live designer rows; fall back to the selected saved view body. */
function emitCurrentFilterConditions(
  view: SavedListView | SavedListFilter | null = null,
): void {
  if (showDesigner.value && conditions.value.length > 0) {
    emit('filterConditions', toEmittedFilterConditions(conditions.value))
    return
  }
  if (view?.conditions?.length) {
    emit('filterConditions', toEmittedFilterConditions(view.conditions))
    return
  }
  const selected = savedViews.value.find(
    (item) => item.id === selectedFilterIdModel.value,
  )
  emit(
    'filterConditions',
    selected?.conditions?.length
      ? toEmittedFilterConditions(selected.conditions)
      : [],
  )
}
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const status = ref<string | null>(null)
const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
const autoCompleteSuggestions = reactive<Record<string, SelectOption[]>>({})
const autoCompleteSelections = reactive<Record<string, SelectOption | null>>({})
const autoCompleteTemplates = reactive<Record<string, string | undefined>>({})
const dateValueModes = reactive<Record<string, 'fixed' | 'relative'>>({})

const dateValueModeOptions = computed(() => [
  { label: t('view.dynamicValue.fixedDate', 'Fixed date'), value: 'fixed' as const },
  { label: t('view.dynamicValue.relativeDate', 'Relative date'), value: 'relative' as const },
])

const dynamicDateValueOptions = computed(() => [
  { label: t('view.dynamicValue.today', 'Today'), value: DYNAMIC_FILTER_TOKEN_TODAY },
  { label: t('view.dynamicValue.yesterday', 'Yesterday'), value: DYNAMIC_FILTER_TOKEN_YESTERDAY },
])

const LOGIC_OPTIONS = [
  { label: t('filter.allConditions', 'All conditions (AND)'), value: 'and' },
  { label: t('filter.anyCondition', 'Any condition (OR)'), value: 'or' },
]

const CONDITION_OPTIONS = [
  { label: t('filter.equals', 'Equals'), value: '_eq' },
  { label: t('filter.notEquals', 'Not equals'), value: '_neq' },
  { label: t('filter.contains', 'Contains'), value: '_contains' },
  { label: t('filter.greaterThan', 'Greater than'), value: '_gt' },
  { label: t('filter.greaterOrEqual', 'Greater or equal'), value: '_gte' },
  { label: t('filter.lessThan', 'Less than'), value: '_lt' },
  { label: t('filter.lessOrEqual', 'Less or equal'), value: '_lte' },
  { label: t('filter.isEmpty', 'Is empty'), value: '_null' },
  { label: t('filter.isNotEmpty', 'Is not empty'), value: '_nnull' },
]

const savedFilterOptions = computed(() => [
  { label: t('view.allRecords', 'All records'), value: ALL_RECORDS_FILTER_ID },
  {
    label: t('filter.recentlyViewed', 'Recently Viewed'),
    value: RECENTLY_VIEWED_FILTER_ID,
  },
  ...savedViews.value.map((view) => ({
    label: view.name,
    value: view.id,
  })),
])
const canEditSelectedFilter = computed(() =>
  Boolean(selectedFilterIdModel.value) &&
    selectedFilterIdModel.value !== RECENTLY_VIEWED_FILTER_ID &&
    selectedFilterIdModel.value !== ALL_RECORDS_FILTER_ID,
)
const canDeleteSetupView = computed(() =>
  props.setupMode && Boolean(editingFilterId.value) && !isSetupPredefinedView.value,
)
const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(
    props.roleOptions,
    t('layoutRole.defaultRole', 'Default (all roles)'),
  ),
)
const isVirtualSelectedView = computed(() =>
  selectedFilterIdModel.value === ALL_RECORDS_FILTER_ID ||
  selectedFilterIdModel.value === RECENTLY_VIEWED_FILTER_ID,
)
const isSetupPredefinedView = computed(() => {
  if (!props.setupMode || props.createNew) return false
  if (props.lockPredefinedView) return true
  const filterId = props.selectedFilterId ?? selectedFilterIdModel.value
  if (!filterId) return false
  return isPredefinedListViewId(filterId)
})
const setupSaveLabel = computed(() =>
  isSetupPredefinedView.value
    ? t('view.saveColumns', 'Save columns')
    : t('view.saveView', 'Save view'),
)
const filterDesignerButtonLabel = computed(() =>
  showDesigner.value
    ? t('filter.hideDesigner', 'Hide filter')
    : t('filter.editSelected', 'Edit filter'),
)
const isCurrentFilterPinned = computed(() =>
  Boolean(selectedFilterIdModel.value) &&
    selectedFilterIdModel.value === props.pinnedFilterId,
)

function togglePinFilter(): void {
  const next = isCurrentFilterPinned.value ? null : (selectedFilterIdModel.value || null)
  emit('pinFilter', next)
}

/** Writable copy — computed lists break vue-draggable-next Sortable clone. */
const draggableFields = ref<DraggableFilterField[]>([])

watch(
  fields,
  (nextFields) => {
    draggableFields.value = nextFields.map((field) => ({
      ...field,
      id: `field_${field.field}`,
      operator: '_eq',
      value: '',
    }))
    void syncRuntimeFieldMetadata(nextFields)
  },
  { deep: true, immediate: true },
)

watch(
  () => props.collection,
  (collection) => {
    if (!collection) return
    void loadFilterState(collection)
  },
  { immediate: true },
)

watch(
  conditions,
  () => {
    if (!props.setupMode) return
    emitCurrentFilterConditions()
  },
  { deep: true },
)

watch(
  () => [props.selectedFilterId, props.createNew] as const,
  () => {
    selectedFilterIdModel.value = resolveSelectedFilterId()
    if (props.setupMode) {
      syncSetupViewSelection()
    }
  },
)

watch(
  () => props.createNew,
  () => {
    if (!props.setupMode || !props.createNew) return
    syncSetupViewSelection()
  },
)

watch(isVirtualSelectedView, (virtual) => {
  if (virtual && props.showBuilder !== false) {
    clearBuilder()
    showDesigner.value = false
  }
})

function resolveSelectedFilterId(): string | null {
  if (props.createNew) return null
  return props.selectedFilterId ?? ALL_RECORDS_FILTER_ID
}

function beginNewSetupView(): void {
  clearBuilder()
  selectedFilterIdModel.value = null
  editingFilterId.value = null
  filterName.value = ''
  showDesigner.value = false
  emit('viewSelected', null)
  emitCurrentFilterConditions(null)
}

async function loadFilterState(collection: string): Promise<void> {
  loading.value = true
  error.value = null
  status.value = null
  selectedFilterIdModel.value = resolveSelectedFilterId()
  conditions.value = []
  filterName.value = ''
  showDesigner.value = false

  try {
    const [nextFields, nextViews] = await Promise.all([
      props.showBuilder === false
        ? Promise.resolve([])
        : listFilterableFields(collection),
      props.showBuilder === false
        ? resolveListViewsForCurrentUser(collection)
        : loadListViews(collection, props.setupMode ? undefined : props.roleId),
    ])

    fields.value = nextFields
    savedViews.value = nextViews
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('view.loadError', 'Failed to load list views.')
  } finally {
    loading.value = false
    syncSetupViewSelection()
  }
}

function syncSetupViewSelection(): void {
  if (!props.setupMode) return

  const filterId = props.selectedFilterId
  if (filterId === ALL_RECORDS_FILTER_ID) {
    clearBuilder()
    selectedFilterIdModel.value = ALL_RECORDS_FILTER_ID
    filterName.value = t('view.allRecords', 'All records')
    emit('viewSelected', ALL_RECORDS_FILTER)
    emitCurrentFilterConditions(ALL_RECORDS_FILTER)
    return
  }

  if (filterId === RECENTLY_VIEWED_FILTER_ID) {
    clearBuilder()
    selectedFilterIdModel.value = RECENTLY_VIEWED_FILTER_ID
    filterName.value = t('filter.recentlyViewed', 'Recently Viewed')
    emit('viewSelected', RECENTLY_VIEWED_FILTER)
    emitCurrentFilterConditions(RECENTLY_VIEWED_FILTER)
    return
  }

  if (!filterId) {
    if (props.createNew) {
      beginNewSetupView()
    } else {
      clearBuilder()
    }
    emitCurrentFilterConditions(null)
    return
  }

  const view = savedViews.value.find((item) => item.id === filterId)
  if (!view) return

  selectedFilterIdModel.value = view.id
  editingFilterId.value = view.id
  filterName.value = view.name
  logic.value = view.logic
  emit('update:roleId', view.roleId ?? null)
  emit('viewSelected', view)
  emitCurrentFilterConditions(view)
}

function cloneField(field: DraggableFilterField): FilterConditionDraft {
  return {
    id: `flt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    field: field.field,
    label: field.label,
    type: field.type,
    component: field.component,
    relatedCollection: field.relatedCollection,
    operator: '_eq',
    value: defaultConditionValue(field),
    userVisible: true,
    fieldWidth: DEFAULT_FILTER_FIELD_WIDTH,
  }
}

/** forceFallback drag otherwise paints a native text selection across the page. */
function onFilterDragStart(): void {
  window.getSelection()?.removeAllRanges()
  document.documentElement.style.userSelect = 'none'
}

function onFilterDragEnd(): void {
  document.documentElement.style.userSelect = ''
  window.getSelection()?.removeAllRanges()
}

onBeforeUnmount(() => {
  document.documentElement.style.userSelect = ''
})

function removeCondition(index: number): void {
  conditions.value.splice(index, 1)
}

function clearBuilder(): void {
  conditions.value = []
  filterName.value = ''
  logic.value = 'and'
  editingFilterId.value = null
  status.value = null
  error.value = null
  syncDateValueModes([])
}

function openNewView(): void {
  if (props.showBuilder === false) return
  clearBuilder()
  if (isVirtualSelectedView.value) {
    editingFilterId.value = null
  }
  showDesigner.value = true
}

function toggleFilterDesigner(): void {
  if (props.showBuilder === false) return
  if (isSetupPredefinedView.value) return

  if (showDesigner.value) {
    showDesigner.value = false
    if (props.setupMode) filterPanelCollapsed.value = true
    return
  }

  editSelectedFilter()
  if (props.setupMode) filterPanelCollapsed.value = false
}

function onSetupFilterPanelToggle(collapsed: boolean): void {
  filterPanelCollapsed.value = collapsed
  if (collapsed) {
    showDesigner.value = false
    return
  }
  expandSetupFilterDesigner()
}

watch(showDesigner, (open) => {
  if (props.setupMode && !open) {
    filterPanelCollapsed.value = true
  }
})

function expandSetupFilterDesigner(): void {
  if (props.showBuilder === false || isSetupPredefinedView.value) return
  const view = savedViews.value.find(
    (item) => item.id === selectedFilterIdModel.value,
  )
  if (view) {
    showDesigner.value = true
    loadViewIntoDesigner(view)
    return
  }
  showDesigner.value = true
}

function confirmDuplicateRoleSave(existingName: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirm.require({
      message: t(
        'setup.duplicateRoleListViewConfirm',
        'Another list view "{name}" already uses this role. Save this configuration anyway?',
        { name: existingName },
      ),
      header: t('setup.duplicateRoleListViewTitle', 'Role already in use'),
      icon: 'pi pi-exclamation-triangle',
      rejectProps: {
        label: t('common.cancel', 'Cancel'),
        severity: 'secondary',
        outlined: true,
      },
      acceptProps: {
        label: t('common.save', 'Save'),
        severity: 'warning',
      },
      accept: () => resolve(true),
      reject: () => resolve(false),
    })
  })
}

async function saveView(): Promise<void> {
  if (!props.viewTableSettings?.columns?.length) {
    error.value = t('view.columnsRequired', 'Configure at least one column before saving.')
    return
  }

  if (isVirtualSelectedView.value || isSetupPredefinedView.value) {
    const viewId = selectedFilterIdModel.value
      ?? props.selectedFilterId
      ?? ALL_RECORDS_FILTER_ID
    if (!isPredefinedListViewId(viewId)) return

    saving.value = true
    error.value = null
    status.value = null

    try {
      await savePredefinedViewTableSettings(props.collection, viewId, {
        columns: props.viewTableSettings.columns,
        sort: props.viewTableSettings.sort ?? null,
        groupBy: props.viewTableSettings.groupBy ?? null,
        recordLinkField: props.viewTableSettings.recordLinkField ?? null,
        inlineEditRefresh: props.viewTableSettings.inlineEditRefresh ?? 'off',
        inlineEditRefreshFields: props.viewTableSettings.inlineEditRefreshFields ?? [],
      }, props.roleId)
      status.value = t('view.columnsSaved', 'View columns saved.')
      emit('viewSaved', {
        id: viewId,
        name: viewId === ALL_RECORDS_FILTER_ID
          ? t('view.allRecords', 'All records')
          : t('filter.recentlyViewed', 'Recently Viewed'),
        roleId: props.roleId ?? null,
        logic: 'and',
        conditions: [],
        columns: props.viewTableSettings.columns,
        sort: props.viewTableSettings?.sort ?? null,
        groupBy: props.viewTableSettings?.groupBy ?? null,
        recordLinkField: props.viewTableSettings?.recordLinkField ?? null,
      })
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : t('view.saveError', 'Failed to save list view.')
    } finally {
      saving.value = false
    }
    return
  }

  if (props.setupMode && !showDesigner.value) {
    const name = filterName.value.trim()
    if (!name) {
      error.value = t('view.enterName', 'Enter view name before saving.')
      return
    }

    const currentId = editingFilterId.value ?? ''
    const duplicateRoleView = savedViews.value.find(
      (item) =>
        item.id !== currentId
        && item.roleId === (props.roleId ?? null),
    )
    if (duplicateRoleView) {
      const proceed = await confirmDuplicateRoleSave(duplicateRoleView.name)
      if (!proceed) return
    }

    saving.value = true
    error.value = null
    status.value = null

    try {
      const existing = editingFilterId.value
        ? savedViews.value.find((item) => item.id === editingFilterId.value)
        : null
      const view: SavedListView = {
        id: editingFilterId.value ?? '',
        name,
        roleId: props.roleId ?? null,
        logic: existing?.logic ?? logic.value,
        conditions: existing?.conditions ?? [],
        columns: props.viewTableSettings.columns,
        sort: props.viewTableSettings.sort ?? null,
        groupBy: props.viewTableSettings.groupBy ?? null,
        recordLinkField: props.viewTableSettings.recordLinkField ?? null,
      }
      const saved = await saveListView(props.collection, view)
      savedViews.value = [
        ...savedViews.value.filter((item) => item.id !== saved.id),
        saved,
      ].sort((a, b) => a.name.localeCompare(b.name))
      selectedFilterIdModel.value = saved.id
      editingFilterId.value = saved.id
      status.value = t('view.saved', 'View saved.')
      emit('viewSaved', saved)
      emit('viewSelected', saved)
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : t('view.saveError', 'Failed to save list view.')
    } finally {
      saving.value = false
    }
    return
  }

  if (!showDesigner.value) {
    const selected = savedViews.value.find(
      (item) => item.id === selectedFilterIdModel.value,
    )
    if (!selected) {
      error.value = t('view.selectViewToSave', 'Select a view to save.')
      return
    }

    saving.value = true
    error.value = null
    status.value = null

    try {
      const saved = await saveListView(props.collection, {
        ...selected,
        columns: props.viewTableSettings.columns,
        sort: props.viewTableSettings.sort ?? null,
        groupBy: props.viewTableSettings.groupBy ?? null,
        recordLinkField: props.viewTableSettings.recordLinkField ?? null,
      })
      savedViews.value = [
        ...savedViews.value.filter((item) => item.id !== saved.id),
        saved,
      ].sort((a, b) => a.name.localeCompare(b.name))
      status.value = t('view.columnsSaved', 'View columns saved.')
      emit('viewSaved', saved)
      emit('viewSelected', saved)
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : t('view.saveError', 'Failed to save list view.')
    } finally {
      saving.value = false
    }
    return
  }

  const name = filterName.value.trim()
  if (!name) {
    error.value = t('view.enterName', 'Enter view name before saving.')
    return
  }
  if (conditions.value.length === 0) {
    error.value = t('view.dragAtLeastOne', 'Drag at least one field into the view.')
    return
  }

  saving.value = true
  error.value = null
  status.value = null

  try {
    const view: SavedListView = {
      id: editingFilterId.value ?? '',
      name,
      roleId: props.roleId ?? null,
      logic: logic.value,
      conditions: conditions.value.map((condition) => ({
        id: condition.id,
        field: condition.field,
        operator: condition.operator,
        // Keep empty selects as null — normalizeConditionValue used to turn null into 0.
        value: isEmptyFilterValue(condition.value)
          ? null
          : normalizeConditionValue(condition),
        ...(condition.type ? { type: condition.type } : {}),
        ...(condition.userVisible === false ? { userVisible: false } : {}),
        ...(condition.fieldWidth && condition.fieldWidth !== DEFAULT_FILTER_FIELD_WIDTH
          ? { fieldWidth: resolveConditionFieldWidth(condition.fieldWidth) }
          : {}),
      })),
      columns: props.viewTableSettings?.columns ?? [],
      sort: props.viewTableSettings?.sort ?? null,
      groupBy: props.viewTableSettings?.groupBy ?? null,
      recordLinkField: props.viewTableSettings?.recordLinkField ?? null,
    }

    const saved = await saveListView(props.collection, view)
    savedViews.value = [
      ...savedViews.value.filter((item) => item.id !== saved.id),
      saved,
    ].sort((a, b) => a.name.localeCompare(b.name))
    selectedFilterIdModel.value = saved.id
    editingFilterId.value = saved.id
    status.value = t('view.saved', 'View saved.')
    emit('viewSaved', saved)
    emit('viewSelected', saved)
    emitCurrentFilterConditions(saved)
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('view.saveError', 'Failed to save list view.')
  } finally {
    saving.value = false
  }
}

function selectSavedFilter(filterId: string): void {
  selectedFilterIdModel.value = filterId
  if (filterId === ALL_RECORDS_FILTER_ID) {
    emit('viewSelected', ALL_RECORDS_FILTER)
    emitCurrentFilterConditions(ALL_RECORDS_FILTER)
    if (props.showBuilder !== false) {
      clearBuilder()
      showDesigner.value = false
    }
    return
  }
  if (filterId === RECENTLY_VIEWED_FILTER_ID) {
    emit('viewSelected', RECENTLY_VIEWED_FILTER)
    emitCurrentFilterConditions(RECENTLY_VIEWED_FILTER)
    if (props.showBuilder !== false) {
      clearBuilder()
      showDesigner.value = false
    }
    return
  }
  const view = savedViews.value.find((item) => item.id === filterId)
  emit('viewSelected', view ?? null)
  if (props.showBuilder !== false && showDesigner.value && view) {
    loadViewIntoDesigner(view)
  } else {
    emitCurrentFilterConditions(view ?? null)
  }
}

function loadViewIntoDesigner(view: SavedListView): void {
  editingFilterId.value = view.id
  filterName.value = view.name
  logic.value = view.logic
  conditions.value = view.conditions.map((condition) => {
    const field = fields.value.find((item) => item.field === condition.field)
    return {
      ...condition,
      label: field?.label ?? condition.field,
      type: field?.type ?? condition.type ?? 'string',
      component: field?.component ?? 'InputText',
      relatedCollection: field?.relatedCollection,
      userVisible: condition.userVisible !== false,
      fieldWidth: resolveConditionFieldWidth(condition.fieldWidth),
      value:
        condition.value === null || condition.value === undefined
          ? ''
          : condition.value,
    }
  })
  syncDateValueModes(conditions.value)
  void syncAutoCompleteSelections(conditions.value)
  emitCurrentFilterConditions(view)
}

function editSelectedFilter(): void {
  if (props.showBuilder === false) return
  if (isVirtualSelectedView.value || isSetupPredefinedView.value) return
  const view = savedViews.value.find(
    (item) => item.id === selectedFilterIdModel.value,
  )
  if (!view) return

  showDesigner.value = true
  loadViewIntoDesigner(view)
}

function deleteSelectedFilter(): void {
  const filterId = editingFilterId.value ?? selectedFilterIdModel.value
  if (!filterId || isPredefinedListViewId(filterId)) return
  const view = savedViews.value.find(
    (item) => item.id === filterId,
  )
  if (!view) return

  setTimeout(() => {
    confirm.require({
      message: t('view.deleteConfirm', 'Delete view "{name}"?', { name: view.name }),
      header: t('datatable.confirmDeleteHeader', 'Confirm Delete'),
      rejectProps: {
        label: t('common.cancel', 'Cancel'),
        severity: 'secondary',
        text: true,
      },
      acceptProps: {
        label: t('common.delete', 'Delete'),
        severity: 'danger',
      },
      accept: () => {
        void deleteViewConfirmed(view)
      },
    })
  }, 0)
}

async function deleteViewConfirmed(view: SavedListView): Promise<void> {
  saving.value = true
  error.value = null
  status.value = null

  try {
    await deleteListView(props.collection, view.id)
    savedViews.value = savedViews.value.filter((item) => item.id !== view.id)
    selectedFilterIdModel.value = ALL_RECORDS_FILTER_ID

    if (filterName.value === view.name) {
      clearBuilder()
      showDesigner.value = false
    }

    status.value = t('view.deleted', 'View deleted.')
    emit('viewSelected', null)
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('view.deleteError', 'Failed to delete list view.')
  } finally {
    saving.value = false
  }
}

function isDateCondition(condition: FilterConditionDraft): boolean {
  return isDateComponent(condition.component)
}

function dateValueMode(condition: FilterConditionDraft): 'fixed' | 'relative' {
  return dateValueModes[condition.id] ??
    (isDynamicFilterValue(condition.value) ? 'relative' : 'fixed')
}

function setDateValueMode(
  condition: FilterConditionDraft,
  mode: 'fixed' | 'relative',
): void {
  dateValueModes[condition.id] = mode
  if (mode === 'relative') {
    condition.value = isDynamicFilterValue(condition.value)
      ? condition.value
      : DYNAMIC_FILTER_TOKEN_TODAY
    return
  }

  const resolved = resolveDynamicFilterValue(condition.value)
  condition.value = resolved instanceof Date ? resolved : new Date()
}

function syncDateValueModes(items: FilterConditionDraft[]): void {
  for (const id of Object.keys(dateValueModes)) {
    if (!items.some((item) => item.id === id)) {
      delete dateValueModes[id]
    }
  }

  for (const condition of items) {
    if (!isDateCondition(condition)) continue
    dateValueModes[condition.id] = isDynamicFilterValue(condition.value)
      ? 'relative'
      : 'fixed'
  }
}

function defaultConditionValue(field: FilterableField): unknown {
  switch (field.component) {
    case 'InputNumber':
      return null
    case 'Checkbox':
    case 'ToggleSwitch':
      return false
    case 'DatePicker':
    case 'Calendar':
      return null
    case 'Select':
    case 'Dropdown':
    case 'AutoComplete':
      return null
    default:
      return ''
  }
}

function conditionComponent(condition: FilterConditionDraft) {
  return resolvePrimeVueComponent(
    resolveFilterValueComponent(
      condition.component,
      runtimeFieldProps[condition.field],
    ),
  )
}

function conditionComponentProps(
  condition: FilterConditionDraft,
): Record<string, unknown> {
  return filterConditionComponentProps(condition, runtimeFieldProps)
}

function isNoValueOperator(condition: FilterConditionDraft): boolean {
  return condition.operator === '_null' || condition.operator === '_nnull'
}

function isAutoCompleteCondition(condition: FilterConditionDraft): boolean {
  return isAutoCompleteFilterComponent(condition.component)
}

function conditionStringValue(condition: FilterConditionDraft): string {
  if (condition.value === null || condition.value === undefined) return ''
  return String(condition.value)
}

async function syncRuntimeFieldMetadata(
  nextFields: FilterableField[],
): Promise<void> {
  for (const field of nextFields) {
    try {
      const metadata = await fetchFieldRuntimeMetadata(
        props.collection,
        field.field,
        field.component,
      )
      runtimeFieldProps[field.field] = metadata.props
      autoCompleteTemplates[field.field] = metadata.template
    } catch {
      runtimeFieldProps[field.field] = {}
    }
  }
}

async function searchAutoCompleteOptions(
  condition: FilterConditionDraft,
  event: { query?: string },
): Promise<void> {
  if (!condition.relatedCollection) {
    autoCompleteSuggestions[condition.id] = []
    return
  }

  autoCompleteSuggestions[condition.id] = await searchRelatedCollectionOptions(
    condition.relatedCollection,
    event.query ?? '',
    autoCompleteTemplates[condition.field],
  )
}

function updateAutoCompleteValue(
  condition: FilterConditionDraft,
  value: SelectOption | null,
): void {
  autoCompleteSelections[condition.id] = value
  condition.value = value?.value ?? null
}

async function syncAutoCompleteSelections(
  items: FilterConditionDraft[],
): Promise<void> {
  for (const condition of items.filter(isAutoCompleteCondition)) {
    const value = condition.value
    if (
      !condition.relatedCollection ||
      (typeof value !== 'string' && typeof value !== 'number')
    ) {
      autoCompleteSelections[condition.id] = null
      continue
    }

    const option = await fetchRelatedCollectionOptionById(
      condition.relatedCollection,
      value,
      autoCompleteTemplates[condition.field],
    )
    autoCompleteSelections[condition.id] = option
  }
}
</script>

<template>
  <section
    class="rounded-lg bg-surface-0"
    :class="setupMode || props.showBuilder === false
      ? 'list-view-filter-shell'
      : 'mt-6 border border-surface-200 p-4'"
  >
    <div
      v-if="(props.showBuilder === true || loading) && !setupMode"
      class="flex items-center justify-between gap-3"
    >
      <div v-if="props.showBuilder === true">
        <h2 class="m-0 text-base">{{ t('view.listViews', 'List views') }}</h2>
        <p class="mt-1 mb-0 text-muted-color text-[0.85rem]">
          {{ t('view.hint', 'Drag fields into conditions, save them as a view, then choose one for this list.') }}
        </p>
      </div>
      <ProgressSpinner
        v-if="loading"
        class="w-7 h-7"
        stroke-width="4"
      />
    </div>

    <div
      v-else-if="loading && setupMode"
      class="page-loading mb-3"
    >
      <ProgressSpinner stroke-width="4" />
    </div>

    <Message
      v-if="error"
      severity="error"
      :closable="false"
    >
      {{ error }}
    </Message>
    <Message
      v-else-if="status"
      severity="info"
      :closable="false"
    >
      {{ status }}
    </Message>
    <div
      v-if="setupMode"
      class="list-view-toolbar flex w-full items-end flex-wrap gap-1.5 mt-0"
    >
      <div class="list-view-toolbar__field flex flex-col gap-[0.2rem]">
        <label class="list-view-toolbar__label">
          {{ t('layoutRole.layoutName', 'Layout name') }}
        </label>
        <InputText
          v-model="filterName"
          class="list-view-toolbar__control"
          :disabled="loading || isSetupPredefinedView"
        />
      </div>
      <div class="list-view-toolbar__field flex flex-col gap-[0.2rem]">
        <label class="list-view-toolbar__label">
          {{ t('layoutRole.role', 'Role') }}
        </label>
        <Select
          :model-value="roleIdToSelectValue(roleId)"
          :options="roleSelectOptions"
          option-label="label"
          option-value="value"
          class="list-view-toolbar__control"
          :disabled="loading"
          @update:model-value="emit('update:roleId', selectValueToRoleId($event))"
        />
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-1.5 pb-[1px]">
        <Button
          :label="setupSaveLabel"
          icon="pi pi-save"
          size="small"
          :loading="saving"
          :disabled="saving"
          @click="saveView"
        />
        <Button
          v-if="!isSetupPredefinedView"
          :label="t('view.deleteView', 'Delete view')"
          icon="pi pi-trash"
          size="small"
          severity="danger"
          outlined
          :disabled="!canDeleteSetupView || saving"
          @click="deleteSelectedFilter"
        />
      </div>
    </div>

    <div
      v-else
      class="flex items-end flex-wrap justify-start gap-3"
      :class="props.showBuilder === false ? 'mt-0' : 'mt-4'"
    >
      <div class="flex flex-col gap-[0.35rem]">
        <label class="text-surface-700 text-[0.8rem] font-semibold leading-tight">
          {{ t('view.listView', 'View') }}
        </label>
        <div class="flex items-center gap-2">
          <Select
            :model-value="selectedFilterIdModel ?? ''"
            :options="savedFilterOptions"
            option-label="label"
            option-value="value"
            :class="props.showBuilder === false ? 'min-w-[220px]' : 'min-w-[260px]'"
            @update:model-value="selectSavedFilter(String($event ?? ''))"
          />
          <Button
            :icon="isCurrentFilterPinned ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
            size="small"
            text
            :disabled="!selectedFilterIdModel"
            :title="isCurrentFilterPinned
              ? t('view.unpinView', 'Unpin default view')
              : t('view.pinView', 'Pin as default view for this collection')"
            @click="togglePinFilter"
          />
        </div>
      </div>
      <div
        v-if="props.showBuilder !== false"
        class="flex flex-wrap gap-2"
      >
        <Button
          v-if="showDesigner || canEditSelectedFilter"
          :label="filterDesignerButtonLabel"
          size="small"
          :text="showDesigner"
          @click="toggleFilterDesigner"
        />
        <Button
          :label="t('view.newView', 'New view')"
          size="small"
          text
          @click="openNewView"
        />
        <Button
          :label="t('view.deleteView', 'Delete view')"
          size="small"
          severity="danger"
          text
          :disabled="!canEditSelectedFilter || saving"
          @click="deleteSelectedFilter"
        />
        <Button
          :label="t('view.saveView', 'Save view')"
          size="small"
          :loading="saving"
          :disabled="saving"
          @click="saveView"
        />
      </div>
    </div>

    <div
      v-if="props.showBuilder !== false && !isSetupPredefinedView && (setupMode || showDesigner)"
      class="list-filter-panel"
      :class="{ 'list-filter-panel--collapsed': setupMode && filterPanelCollapsed }"
    >
      <button
        v-if="setupMode"
        type="button"
        class="list-filter-panel__header"
        :aria-expanded="!filterPanelCollapsed"
        @click="onSetupFilterPanelToggle(!filterPanelCollapsed)"
      >
        <span class="list-filter-panel__title">{{ t('datatable.filter', 'Filter') }}</span>
        <i
          class="pi text-[0.75rem]"
          :class="filterPanelCollapsed ? 'pi-chevron-down' : 'pi-chevron-up'"
          aria-hidden="true"
        />
      </button>

      <div
        v-show="!setupMode || (showDesigner && !filterPanelCollapsed)"
        class="list-filter-designer grid grid-cols-[260px_1fr] gap-3 max-[900px]:grid-cols-1"
        :class="setupMode ? 'list-filter-panel__body' : 'mt-3'"
      >
        <aside class="list-filter-designer__panel flex flex-col min-h-0">
          <h3 class="list-filter-designer__title m-0 mb-2.5 shrink-0">{{ t('filter.fields', 'Fields') }}</h3>
          <VueDraggableNext
            :list="draggableFields"
            :group="{ name: 'filter-fields', pull: 'clone', put: false }"
            :sort="false"
            :clone="cloneField"
            item-key="id"
            v-bind="DIALOG_SORTABLE_ATTRS"
            class="flex flex-col gap-1.5 min-h-[44px] max-h-[min(70vh,28rem)] overflow-y-auto pr-1 select-none"
            @start="onFilterDragStart"
            @end="onFilterDragEnd"
          >
            <div
              v-for="field in draggableFields"
              :key="field.id"
              class="list-filter-designer__field flex items-center justify-between gap-2 cursor-grab select-none active:cursor-grabbing"
            >
              <span class="text-[0.85rem] font-medium truncate">{{ field.label }}</span>
              <small class="list-filter-designer__meta shrink-0">{{ field.type }}</small>
            </div>
          </VueDraggableNext>
        </aside>

        <section class="list-filter-designer__panel">
          <div
            v-if="!setupMode"
            class="grid gap-[0.35rem] mb-[0.55rem]"
          >
            <label for="filter-name" class="list-view-toolbar__label">{{ t('view.viewName', 'View name') }}</label>
            <InputText
              id="filter-name"
              v-model="filterName"
              :placeholder="t('filter.nameExample', 'e.g. Active patients')"
              fluid
            />
          </div>

          <div class="grid gap-[0.35rem] mb-[0.55rem]">
            <label for="filter-logic" class="list-view-toolbar__label">{{ t('filter.logic', 'Logic') }}</label>
            <Select
              id="filter-logic"
              v-model="logic"
              :options="LOGIC_OPTIONS"
              option-label="label"
              option-value="value"
              fluid
            />
          </div>

          <div
            class="relative rounded-lg border-2 border-dashed min-h-[10rem] transition-colors"
            :class="conditions.length === 0
              ? 'border-primary-300 bg-primary-50/40'
              : 'border-surface-300 bg-surface-50/50'"
          >
            <p
              v-if="conditions.length === 0"
              class="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[0.9rem] font-medium text-primary-700"
            >
              {{ t('view.dragFieldsHere', 'Drag fields here to build a view.') }}
            </p>

            <VueDraggableNext
              v-model="conditions"
              :group="{ name: 'filter-fields', pull: false, put: true }"
              item-key="id"
              handle=".list-filter-condition__drag"
              v-bind="DIALOG_SORTABLE_ATTRS"
              class="flex flex-col gap-[0.4rem] min-h-[10rem] p-3"
              @start="onFilterDragStart"
              @end="onFilterDragEnd"
            >
              <div
                v-for="(condition, index) in conditions"
                :key="condition.id"
                class="list-filter-condition flex flex-wrap items-center gap-2 border border-surface-300 rounded-md bg-surface-0 p-[0.4rem_0.55rem]"
              >
                <button
                  type="button"
                  class="list-filter-condition__drag inline-flex shrink-0 items-center justify-center border-0 bg-transparent px-0.5 py-0.5 text-surface-300 cursor-grab select-none tracking-[-0.15em] leading-none active:cursor-grabbing"
                  :aria-label="t('filter.reorderCondition', 'Drag to reorder')"
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <strong class="list-filter-condition__field shrink-0 text-[0.85rem]">
                  {{ condition.label }}
                </strong>
                <Select
                  v-model="condition.operator"
                  class="list-filter-condition__operator shrink-0"
                  :options="CONDITION_OPTIONS"
                  option-label="label"
                  option-value="value"
                  :aria-label="t('filter.operator', 'Operator')"
                />
                <div class="list-filter-condition__value flex min-w-0 flex-1 items-center gap-1.5">
                  <InputText
                    v-if="isNoValueOperator(condition)"
                    model-value=""
                    disabled
                    :placeholder="t('filter.value', 'Value')"
                    class="w-full"
                  />
                  <template v-else-if="isDateCondition(condition)">
                    <Select
                      :model-value="dateValueMode(condition)"
                      class="list-filter-condition__date-mode shrink-0"
                      :options="dateValueModeOptions"
                      option-label="label"
                      option-value="value"
                      :aria-label="t('filter.value', 'Value')"
                      @update:model-value="setDateValueMode(condition, $event as 'fixed' | 'relative')"
                    />
                    <Select
                      v-if="dateValueMode(condition) === 'relative'"
                      :model-value="String(condition.value ?? '')"
                      class="min-w-0 flex-1"
                      :options="dynamicDateValueOptions"
                      option-label="label"
                      option-value="value"
                      @update:model-value="condition.value = $event"
                    />
                    <component
                      :is="conditionComponent(condition)"
                      v-else
                      v-model="condition.value"
                      class="min-w-0 flex-1"
                      v-bind="conditionComponentProps(condition)"
                    />
                  </template>
                  <component
                    v-else-if="
                      conditionComponent(condition) &&
                      !isAutoCompleteCondition(condition)
                    "
                    :is="conditionComponent(condition)"
                    v-model="condition.value"
                    class="w-full"
                    v-bind="conditionComponentProps(condition)"
                  />
                  <component
                    :is="conditionComponent(condition)"
                    v-else-if="conditionComponent(condition)"
                    class="w-full"
                    :model-value="autoCompleteSelections[condition.id]"
                    :suggestions="autoCompleteSuggestions[condition.id] ?? []"
                    v-bind="conditionComponentProps(condition)"
                    @update:model-value="updateAutoCompleteValue(condition, $event)"
                    @complete="searchAutoCompleteOptions(condition, $event)"
                  />
                  <InputText
                    v-else
                    class="w-full"
                    :model-value="conditionStringValue(condition)"
                    :placeholder="t('filter.value', 'Value')"
                    @update:model-value="condition.value = $event"
                  />
                </div>
                <label
                  class="list-filter-condition__meta inline-flex shrink-0 items-center gap-1.5 text-[0.75rem] text-surface-600"
                  :title="t('filter.userVisible', 'Visible to users')"
                >
                  <ToggleSwitch v-model="condition.userVisible" />
                  <span class="list-filter-condition__meta-label">{{ t('filter.userVisible', 'Visible') }}</span>
                </label>
                <label class="list-filter-condition__meta inline-flex shrink-0 items-center gap-1 text-[0.75rem] text-surface-600">
                  <span class="list-filter-condition__meta-label">{{ t('filter.fieldWidth', 'Width') }}</span>
                  <InputNumber
                    v-model="condition.fieldWidth"
                    :min="1"
                    :max="12"
                    show-buttons
                    button-layout="horizontal"
                    :input-style="{ width: '2.5rem' }"
                  />
                  <span class="text-muted-color">/12</span>
                </label>
                <Button
                  icon="pi pi-times"
                  size="small"
                  severity="danger"
                  text
                  rounded
                  class="shrink-0"
                  :aria-label="t('common.remove', 'Remove')"
                  @click="removeCondition(index)"
                />
              </div>
            </VueDraggableNext>
          </div>

          <div class="flex items-center gap-3 mt-3">
            <Button
              :label="t('common.clear', 'Clear')"
              size="small"
              severity="secondary"
              text
              @click="clearBuilder"
            />
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.list-view-filter-shell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex-shrink: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
}

.list-view-toolbar {
  width: 100%;
  box-sizing: border-box;
  background: #edf3f4;
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
  font-family: Inter, system-ui, sans-serif;
  color: #37352f;
}

.list-view-toolbar__field {
  min-width: 0;
}

.list-view-toolbar__control {
  width: 11rem;
  min-width: 0;
}

.list-view-toolbar__label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.25;
  color: var(--p-surface-600, rgba(55, 53, 47, 0.55));
}

.list-filter-panel {
  width: 100%;
  box-sizing: border-box;
  margin-top: 0;
  border-radius: 8px;
  background: #edf3f4;
  font-family: Inter, system-ui, sans-serif;
  color: #37352f;
}

.list-filter-panel__header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.list-filter-panel__header:hover {
  background: rgba(55, 53, 47, 0.04);
}

.list-filter-panel__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.list-filter-panel__body {
  padding: 0 0.5rem 0.5rem;
}

.list-filter-panel--collapsed .list-filter-panel__header {
  border-radius: 8px;
}

.list-filter-designer {
  font-family: Inter, system-ui, sans-serif;
  color: #37352f;
}

.list-filter-designer__panel {
  border: 0;
  border-radius: 8px;
  background: #edf3f4;
  padding: 0.75rem 0.65rem;
}

.list-filter-panel .list-filter-designer__panel {
  background: rgba(255, 255, 255, 0.55);
}

.list-filter-designer__title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #111;
}

.list-filter-designer__field {
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  background: #fff;
}

.list-filter-designer__field:hover {
  background: rgba(55, 53, 47, 0.06);
}

.list-filter-designer__meta {
  font-size: 0.75rem;
  color: rgba(55, 53, 47, 0.45);
}

.list-filter-condition__field {
  min-width: 7rem;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #111;
}

.list-filter-condition__operator {
  width: 9.5rem;
}

.list-filter-condition__date-mode {
  width: 8.5rem;
}

.list-filter-condition__value {
  min-width: 10rem;
}

@media (max-width: 1100px) {
  .list-filter-condition__meta-label {
    display: none;
  }
}
</style>

