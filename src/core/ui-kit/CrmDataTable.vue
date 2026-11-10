<script lang="ts">
export default {
  name: 'CrmDataTable',
}
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'
import Button from 'openvue/button'
import Dialog from 'openvue/dialog'
import Menu from 'openvue/menu'
import Message from 'openvue/message'
import ProgressSpinner from 'openvue/progressspinner'
import { useConfirm } from 'openvue/useconfirm'
import CrmDataTableGrid from '@/core/ui-kit/CrmDataTableGrid.vue'
import type { CrmDataTableEditRequest } from '@/core/ui-kit/CrmDataTableGrid.vue'
import CrmInlineCellEditor from '@/core/ui-kit/CrmInlineCellEditor.vue'
import FormRenderer from '@/modules/entities/components/FormRenderer.vue'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import { useToast } from 'openvue/usetoast'
import { bridgeUpdateItem } from '@/core/graphql/itemsBridge'
import {
  buildInlinePatchedFieldValue,
  inlineCellValuesEqual,
  isInlineEditableColumn,
  resolveInlineCellEditorKind,
  serializeInlineCellValue,
  toInlineEditorModel,
  type InlineCellEditorKind,
} from '@/core/inlineCellEdit'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import {
  archiveObjectRecord,
  fetchObjectRecord,
  fetchObjectRecordForEdit,
  isRecordArchived,
  restoreObjectRecord,
  updateObjectRecord,
  createObjectRecord,
} from '@/modules/entities/services/recordDetails'
import { useCompactTooltip } from '@/core/useCompactTooltip'
import { buildChangedFormPayload } from '@/core/entityFormPayload'
import { prepareEntityFormDraft } from '@/core/entityFormValues'
import { recordDetailRoute, childRecordDetailRoute } from '@/core/compactRecordRoutes'
import {
  fetchChoiceLabelMap,
  fetchCollectionDisplayTemplate,
  fetchRelatedCollectionOptionById,
  isCollectionFieldReadonly,
  resolveRelatedCreateTarget,
  type RelatedCreateTarget,
} from '@/modules/entities/services/collectionSchema'
import {
  usesPrimaryKeyRecordLink,
  resolveAutoRecordLinkField,
  resolveNameLinkSortFields,
} from '@/modules/entities/services/tableSettings'
import type { EntityLayoutSchema, LayoutFieldChildLookup } from '@/interfaces/config'
import type {
  DataTableGroupConfig,
  DataTableNumberDisplayOptions,
  DataTableSettings,
  PrimeVueComponentType,
} from '@/interfaces/entities'
import { fetchDataTableRuntime } from '@/modules/entities/services/dataTableRuntime'
import { loadChildLookupFieldSettings } from '@/modules/config/services/layoutSettings'
import { isNestedFieldPath, resolveNestedCellValue } from '@/core/dataTableFieldPath'
import {
  extractTemplateFields,
  formatDisplayValue,
  formatNumberDisplayValue,
  relatedRecordFallbackLabel,
  resolvePrimaryKeyRecordLabel,
  templateReferencesParent,
} from '@/modules/entities/utils/recordDisplay'
import { formatDateValue } from '@/core/dateFormatting'
import { formatScheduleRuleSummary } from '@/core/scheduleRuleDisplay'
import { formatAddressSummary } from '@/core/addressField'
import { formatJsonCodeSummary } from '@/core/jsonField'
import {
  isBooleanColumn,
  isHtmlEditorColumn,
  isNumericFieldDefinition,
} from '@/core/fieldHelpers'
import { plainTextFromHtml } from '@/core/htmlContent'
import {
  useTranslation,
  useTranslatedCollection,
} from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'

export interface CrmDataTableColumn {
  field: string
  header: string
  component?: PrimeVueComponentType
  relatedCollection?: string
  template?: string
  format?: string
  numberDisplay?: DataTableNumberDisplayOptions | null
  autoRecordId?: boolean
  recordLink?: boolean
  valueCollection?: string
  inlineEditable?: boolean
  childLookup?: LayoutFieldChildLookup | null
}

interface M2OCellValue {
  __crmValueType: 'm2o'
  id?: string | number | null
  label?: string
  relatedCollection?: string
}

const AUTO_ID_HEADER = 'Id'
const AUTO_NAME_HEADER = 'Name'
const { t } = useTranslation()

const props = withDefaults(
  defineProps<{
    rows: Record<string, unknown>[]
    columns: CrmDataTableColumn[]
    paginator?: boolean
    rowsPerPage?: number
    emptyMessage?: string
    showNewButton?: boolean
    newButtonLabel?: string
    showDeleteButton?: boolean
    deleteButtonLabel?: string
    parentId?: string | number
    parentName?: string
    parentCollection?: string
    parentRecord?: Record<string, unknown>
    /**
     * When false, parentId/parentName still prefill create/edit but do not
     * filter displayed rows (e.g. ObjectList tree mode already filters server-side).
     */
    filterRowsByParent?: boolean
    sortableColumns?: boolean
    reorderableColumns?: boolean
    defaultSortField?: string | null
    defaultSortOrder?: 1 | -1 | null
    collection?: string
    primaryKey?: string
    maxLocalRows?: number | null
    lazy?: boolean
    hasMore?: boolean
    loadingMore?: boolean
    loading?: boolean
    totalRecords?: number | null
    rowDraggable?: boolean
    rowDragDisabled?: boolean
    groupBy?: DataTableGroupConfig | null
    /** When true, row grouping works even with lazy loading (e.g. related records view-all). */
    allowRowGrouping?: boolean
    /** Field that links to the record detail page; null/primary key uses auto Id column. */
    recordLinkField?: string | null
    /**
     * When false, do not turn the row Id/Name into a detail link
     * (e.g. M2M junction related lists).
     */
    recordLinksEnabled?: boolean
    /** Show Edit in the row ⋮ menu (default true). */
    showEditRecordAction?: boolean
    /** Show View in the row ⋮ menu (default true). */
    showViewRecordAction?: boolean
    /** Enable PrimeVue row selection (list master/detail or multi-select). */
    selectionMode?: 'single' | 'multiple' | null
    /** Currently selected row(s) when selectionMode is set. */
    selection?: Record<string, unknown> | Record<string, unknown>[] | null
    /** Salesforce-style leftmost 1-based row index column. */
    showRowNumbers?: boolean
    /**
     * After inline cell save, re-fetch row so automation/formula fields update.
     * Default off.
     */
    inlineEditRefresh?: 'off' | 'row' | 'fields'
    /** Field names merged when `inlineEditRefresh` is `fields`. */
    inlineEditRefreshFields?: string[]
  }>(),
  {
    paginator: false,
    rowsPerPage: 25,
    emptyMessage: 'No records found.',
    showNewButton: false,
    newButtonLabel: 'New',
    showDeleteButton: false,
    deleteButtonLabel: 'Delete',
    sortableColumns: true,
    reorderableColumns: true,
    defaultSortField: null,
    defaultSortOrder: null,
    collection: '',
    primaryKey: 'id',
    maxLocalRows: null,
    lazy: false,
    hasMore: false,
    loadingMore: false,
    loading: false,
    totalRecords: null,
    rowDraggable: false,
    rowDragDisabled: false,
    groupBy: null,
    allowRowGrouping: false,
    recordLinkField: null,
    recordLinksEnabled: true,
    showEditRecordAction: true,
    showViewRecordAction: true,
    selectionMode: null,
    selection: null,
    showRowNumbers: true,
    inlineEditRefresh: 'off',
    inlineEditRefreshFields: () => [],
    filterRowsByParent: true,
  },
)

const emit = defineEmits<{
  'update:rows': [rows: Record<string, unknown>[]]
  'update:selection': [
    row: Record<string, unknown> | Record<string, unknown>[] | null,
  ]
  'page-size-change': [pageSize: number]
  'load-more': [payload: { offset: number; limit: number }]
  'sort-change': [payload: { field: string | null; order: 1 | -1 | null; sortKey: string | null }]
  'row-select': [row: Record<string, unknown>]
  newRecord: []
  editRecord: [row: Record<string, unknown>]
  viewRecord: [row: Record<string, unknown>]
  deleteRecord: [row: Record<string, unknown>]
  restoreRecord: [row: Record<string, unknown>]
  'record-created': [row: Record<string, unknown>]
  'record-updated': [row: Record<string, unknown>]
  'record-deleted': [row: Record<string, unknown>]
  'record-restored': [row: Record<string, unknown>]
  'row-drag-start': [payload: { row: Record<string, unknown>; event: DragEvent }]
  'row-drag-end': [payload: { row: Record<string, unknown>; event: DragEvent }]
}>()

const confirm = useConfirm()
const toast = useToast()
const route = useRoute()

// Route names that correspond to a record-detail page at any nesting depth.
const DETAIL_ROUTE_NAMES = new Set(['record-details', 'related-record-details', 'deep-record-details'])
const filteredRows = computed(() => {
  if (
    props.filterRowsByParent === false ||
    props.parentId === undefined ||
    props.parentId === null ||
    !props.parentName
  ) {
    return props.rows
  }
  const parentId = props.parentId
  const parentName = props.parentName

  return props.rows.filter((row) => matchesParent(row, parentName, parentId))
})
const localColumns = ref<CrmDataTableColumn[]>([...props.columns])
const columnLayoutKey = ref(0)
/** User-resized column widths (px), keyed by column field/header. */
const columnWidthOverrides = ref<Record<string, string>>({})
/** User column order (resolveColumnKey values), restored from localStorage. */
const storedColumnOrder = ref<string[] | null>(null)
const sortField = ref<string | null>(props.defaultSortField ?? null)
const sortOrder = ref<1 | -1 | null>(props.defaultSortOrder ?? null)
const scrollPanel = ref<HTMLElement | null>(null)
const innerScroller = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
const measuredRowHeight = ref(rootFontSize() * 2.5)
const panelHeight = ref(initialPanelHeight())
const dynamicPageSize = ref(props.rowsPerPage)
const compactTooltip = useCompactTooltip()
const m2oCellLabels = reactive<Record<string, string>>({})
const m2oCellLabelRequests = new Set<string>()
const choiceCellLabels = reactive<Record<string, Record<string, string>>>({})
const choiceCellLabelRequests = new Set<string>()
const actionMenu = ref<InstanceType<typeof Menu> | null>(null)
const selectedActionRow = ref<Record<string, unknown> | null>(null)
const createDialogVisible = ref(false)
const relatedCreateTarget = ref<RelatedCreateTarget | null>(null)
const editDialogVisible = ref(false)
const editLoading = ref(false)
const editLayoutSchema = ref<EntityLayoutSchema | null>(null)
const editDraft = ref<Record<string, unknown>>({})
const editFormRendererRef = ref<{
  validateRequired: () => { valid: boolean; missingLabels: string[] }
} | null>(null)
const editRecordId = ref<string | null>(null)
const editOriginalRow = ref<Record<string, unknown> | null>(null)
const editOriginalRecord = ref<Record<string, unknown> | null>(null)
const editSaving = ref(false)
const editError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const loadingMoreVisible = ref(false)
const expandedRowGroups = ref<unknown[]>([])
const managedCollection = computed(() => props.collection.trim() || null)
const managedCollectionLabel = useTranslatedCollection(() => managedCollection.value ?? '')
const managedPrimaryKey = computed(() => props.primaryKey || 'id')
const tableSelection = computed({
  get: () => props.selection ?? (props.selectionMode === 'multiple' ? [] : null),
  set: (row: Record<string, unknown> | Record<string, unknown>[] | null) => {
    emit('update:selection', row)
  },
})
const isSelectionEnabled = computed(
  () => props.selectionMode === 'single' || props.selectionMode === 'multiple',
)
const isMultipleSelection = computed(() => props.selectionMode === 'multiple')

function handleRowSelect(event: unknown): void {
  const data = (event as { data?: Record<string, unknown> } | null)?.data
  if (data) emit('row-select', data)
}

function handleRowUnselect(): void {
  if (props.selectionMode === 'multiple') return
  emit('update:selection', null)
}

const usePrimaryKeyLinkColumn = computed(() =>
  usesPrimaryKeyRecordLink(props.recordLinkField, managedPrimaryKey.value),
)
const autoRecordLinkField = computed(() =>
  resolveAutoRecordLinkField(
    props.recordLinkField,
    managedPrimaryKey.value,
    true,
  ),
)
const collectionDisplayTemplate = ref<string | null>(null)
const isManaged = computed(() => Boolean(managedCollection.value))

watch(
  [managedCollection, usePrimaryKeyLinkColumn],
  async ([collection, usePrimaryKeyLink]) => {
    if (!collection || !usePrimaryKeyLink) {
      collectionDisplayTemplate.value = null
      return
    }
    collectionDisplayTemplate.value =
      (await fetchCollectionDisplayTemplate(collection)) ?? null
  },
  { immediate: true },
)

let loadingMoreHideTimer: number | null = null
const displayedColumns = computed<CrmDataTableColumn[]>(() => {
  const collection = managedCollection.value
  if (!collection || !props.recordLinksEnabled) return localColumns.value

  if (!usePrimaryKeyLinkColumn.value) {
    const linkField = props.recordLinkField?.trim()
    return localColumns.value.map((column) => {
      if (column.field !== linkField) return column
      return {
        ...column,
        recordLink: true,
        relatedCollection: collection,
      }
    })
  }

  const primaryKey = managedPrimaryKey.value
  const linkField = autoRecordLinkField.value
  const columns = localColumns.value.filter((column) => {
    if (column.field === linkField) return false
    // Name replaces Id as the default link column — hide raw PK unless chosen.
    if (linkField === 'name' && column.field === primaryKey) return false
    return true
  })
  const existingColumn = localColumns.value.find(
    (column) => column.field === linkField,
  )

  return [
    {
      ...existingColumn,
      field: linkField,
      header:
        existingColumn?.header ||
        (linkField === 'name' ? AUTO_NAME_HEADER : AUTO_ID_HEADER),
      relatedCollection: collection,
      autoRecordId: true,
      template:
        collectionDisplayTemplate.value
        ?? existingColumn?.template
        ?? undefined,
    },
    ...columns,
  ]
})
const actionMenuItems = computed(() => {
  const archived = isRecordArchived(selectedActionRow.value)
  const items: Array<{ label: string; command: () => void }> = []
  if (props.showEditRecordAction) {
    items.push({
      label: t('common.edit', 'Edit'),
      command: () => emitAction('editRecord'),
    })
  }
  if (props.showViewRecordAction) {
    items.push({
      label: t('common.view', 'View'),
      command: () => emitAction('viewRecord'),
    })
  }
  items.push(
    archived
      ? {
          label: t('common.restore', 'Restore'),
          command: () => emitAction('restoreRecord'),
        }
      : {
          label: t('common.delete', 'Delete'),
          command: () => emitAction('deleteRecord'),
        },
  )
  return items
})
const emptyMessageText = computed(() =>
  props.emptyMessage === 'No records found.'
    ? t('datatable.defaultEmpty', 'No records found.')
    : props.emptyMessage,
)
const newButtonText = computed(() =>
  props.newButtonLabel === 'New'
    ? t('common.new', 'New')
    : props.newButtonLabel,
)
const { canCreate: canCreateRecords, canDelete: canDeleteRecords } =
  useEntityPermissions(
    () => relatedCreateTarget.value?.createCollection || props.collection || managedCollection.value,
  )
const { canUpdate: canUpdateRecords } = useEntityPermissions(
  () => managedCollection.value,
)

interface InlineEditingCell {
  rowKey: string
  field: string
}

const inlineEditingCell = ref<InlineEditingCell | null>(null)
const inlineDraft = ref<unknown>(null)
const inlineKind = ref<InlineCellEditorKind | null>(null)
const inlineOriginalSerialized = ref<unknown>(null)
const inlineSaving = ref(false)
const inlineCellRect = ref<DOMRect | null>(null)
const inlineFieldReadonly = reactive<Record<string, boolean>>({})
const childLookupByField = ref<Record<string, LayoutFieldChildLookup>>({})
let inlineCommitLock: Promise<void> | null = null

const inlineOverlayStyle = computed(() => {
  const rect = inlineCellRect.value
  if (!rect) return {}
  // Inset 1px so the focus ring sits inside the td borders / row rules.
  const inset = 1
  const width = Math.max(Math.round(rect.width) - inset * 2, 72)
  const height = Math.max(Math.round(rect.height) - inset * 2, 24)
  return {
    position: 'fixed' as const,
    top: `${Math.round(rect.top) + inset}px`,
    left: `${Math.round(rect.left) + inset}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: 1100,
  }
})

const inlineEditingColumn = computed(() => {
  const field = inlineEditingCell.value?.field
  if (!field) return null
  const column = findInlineColumn(field)
  return column ? resolveInlineColumn(column) : null
})

const inlineEditingRow = computed(() => {
  const rowKey = inlineEditingCell.value?.rowKey
  if (!rowKey) return null
  return findInlineRow(rowKey) ?? null
})

const inlineOverlayChildLookup = computed(() => {
  const column = inlineEditingColumn.value
  if (!column) return null
  return column.childLookup ?? childLookupByField.value[column.field] ?? null
})
const showNewButtonEffective = computed(
  () => props.showNewButton && canCreateRecords.value,
)
const showDeleteButtonEffective = computed(
  () => props.showDeleteButton && canDeleteRecords.value,
)

watch(
  () =>
    [
      props.collection,
      props.parentCollection,
      props.parentName,
      props.parentId,
    ] as const,
  ([collection, parentCollection]) => {
    if (!collection?.trim()) {
      relatedCreateTarget.value = null
      return
    }
    void resolveRelatedCreateTarget(collection, parentCollection).then((target) => {
      relatedCreateTarget.value = target
    })
  },
  { immediate: true },
)
const isCompact = computed(() => typeof props.maxLocalRows === 'number' && props.maxLocalRows > 0)

const isRowGroupingActive = computed(() => {
  if (!props.groupBy?.field?.trim()) return false
  if (props.allowRowGrouping) return true
  return !props.lazy
})

const activeGroupField = computed(() =>
  isRowGroupingActive.value ? props.groupBy?.field?.trim() ?? null : null,
)

const effectiveSortField = computed(() => sortField.value ?? undefined)

const effectiveSortOrder = computed(() => sortOrder.value ?? undefined)

/** Client-side sort for non-lazy tables (related lists); lazy pages sort on the server. */
const useClientColumnSort = computed(() => !props.lazy)

const tableRows = computed(() => {
  const rows = [...filteredRows.value]

  if (isRowGroupingActive.value) {
    const groupField = activeGroupField.value
    if (!groupField) return rows

    const secondaryField = sortField.value
    const secondaryOrder = (sortOrder.value ?? 1) as 1 | -1

    rows.sort((left, right) => {
      const groupCompare = compareRowsByField(left, right, groupField, 1)
      if (groupCompare !== 0) return groupCompare
      if (!secondaryField || secondaryField === groupField) return 0
      return compareRowsByField(left, right, secondaryField, secondaryOrder)
    })

    return rows
  }

  // Default OpenVue sort compares raw cell values; M2O cells are { id, label }
  // objects, so related-list header clicks must sort by display label instead.
  if (
    useClientColumnSort.value &&
    sortField.value &&
    sortOrder.value != null &&
    sortOrder.value !== 0
  ) {
    const field = sortField.value
    const order = (sortOrder.value === -1 ? -1 : 1) as 1 | -1
    rows.sort((left, right) => compareRowsByField(left, right, field, order))
  }

  return rows
})

const activeRowsPerPage = computed(() =>
  isCompact.value ? (props.maxLocalRows as number) : props.rowsPerPage,
)

const scrollPanelStyle = computed(() =>
  isCompact.value ? {} : { height: `${panelHeight.value}px` },
)
const canDragRows = computed(() => props.rowDraggable && !props.rowDragDisabled)

watch(
  () => props.columns,
  (columns) => {
    localColumns.value = applyStoredColumnOrder([...columns])
  },
  { deep: true },
)

watch(
  () => [props.defaultSortField, props.defaultSortOrder] as const,
  ([field, order]) => {
    sortField.value = field ?? null
    sortOrder.value = order ?? null
  },
)

watch(
  [() => props.rows, displayedColumns],
  () => {
    syncM2OCellLabels()
    syncChoiceCellLabels()
    void nextTick(() => {
      updatePanelHeight()
      measureRowsAndPageSize()
    })
  },
  { immediate: true, deep: true },
)

watch(
  [managedCollection, displayedColumns],
  ([collection, columns]) => {
    if (!collection || !props.recordLinksEnabled) return
    const pending = columns.filter((column) => {
      if (
        !isInlineEditableColumn(resolveInlineColumn(column), {
          recordLinksEnabled: props.recordLinksEnabled,
        })
      ) {
        return false
      }
      const key = inlineReadonlyKey(collection, column.field)
      return !(key in inlineFieldReadonly)
    })
    if (pending.length === 0) return
    // Resolve readonly flags in one pass so we don't re-render the table per field.
    void Promise.all(
      pending.map(async (column) => {
        const key = inlineReadonlyKey(collection, column.field)
        const readonly = await isCollectionFieldReadonly(collection, column.field)
        return [key, readonly] as const
      }),
    ).then((entries) => {
      for (const [key, readonly] of entries) {
        inlineFieldReadonly[key] = readonly
      }
    })
  },
  { immediate: true },
)

let childLookupSettingsLoadKey = ''

async function loadInlineChildLookupSettings(
  collection: string,
  fieldNames: string[],
): Promise<void> {
  const loadKey = `${collection}::${fieldNames.join('\0')}`
  if (loadKey === childLookupSettingsLoadKey) return
  childLookupSettingsLoadKey = loadKey
  if (!collection.trim() || fieldNames.length === 0) {
    childLookupByField.value = {}
    return
  }
  try {
    childLookupByField.value = await loadChildLookupFieldSettings(
      collection,
      fieldNames,
      null,
    )
  } catch {
    if (childLookupSettingsLoadKey === loadKey) {
      childLookupByField.value = {}
    }
  }
}

watch(
  () =>
    [
      managedCollection.value,
      displayedColumns.value.map((column) => column.field).join('\0'),
    ] as const,
  ([collection, fieldKey]) => {
    if (!collection?.trim() || !fieldKey) {
      childLookupByField.value = {}
      return
    }
    void loadInlineChildLookupSettings(
      collection,
      fieldKey.split('\0').filter(Boolean),
    )
  },
  { immediate: true },
)

function resolveInlineColumn(
  column: CrmDataTableColumn,
): CrmDataTableColumn {
  const childLookup =
    column.childLookup ?? childLookupByField.value[column.field] ?? null
  if (!childLookup) return column
  if (column.childLookup === childLookup) return column
  return { ...column, childLookup }
}

/** Field names that support inline edit — computed once, not per cell render. */
const inlineEditableFieldSet = computed(() => {
  const fields = new Set<string>()
  if (!isManaged.value || !canUpdateRecords.value) return fields
  for (const column of displayedColumns.value) {
    if (
      isInlineEditableColumn(resolveInlineColumn(column), {
        recordLinksEnabled: props.recordLinksEnabled,
      })
    ) {
      fields.add(column.field)
    }
  }
  return fields
})

const inlineEditCollection = computed(() => managedCollection.value ?? '')

watch(
  () => props.loadingMore,
  (loading) => {
    if (loadingMoreHideTimer) {
      window.clearTimeout(loadingMoreHideTimer)
      loadingMoreHideTimer = null
    }

    if (loading) {
      loadingMoreVisible.value = true
      return
    }

    loadingMoreHideTimer = window.setTimeout(() => {
      loadingMoreVisible.value = false
      loadingMoreHideTimer = null
    }, 500)
  },
  { immediate: true },
)

onMounted(() => {
  void nextTick(() => {
    updatePanelHeight()
    measureRowsAndPageSize()
    attachResizeObserver()
  })
  window.addEventListener('resize', handleResize)
  attachInnerScrollListener()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  detachInnerScrollListener()
  resizeObserver?.disconnect()
  resizeObserver = null
  if (loadingMoreHideTimer) {
    window.clearTimeout(loadingMoreHideTimer)
  }
})

function handleResize(): void {
  updatePanelHeight()
  void nextTick(() => {
    measureRowsAndPageSize()
  })
}

function updatePanelHeight(): void {
  const panel = scrollPanel.value
  if (!panel) {
    panelHeight.value = initialPanelHeight()
    return
  }

  const minHeight = minimumPanelHeight()
  const panelTop = panel.getBoundingClientRect().top
  const containedBottom = containingPanelBottom(panel)
  const availableHeight = Math.max(
    minHeight,
    Math.floor(
      containedBottom !== null
        ? containedBottom - panelTop - 4
        : viewportHeight() - panelTop - bottomLayoutInset(panel),
    ),
  )

  panelHeight.value = availableHeight
}

function containingPanelBottom(panel: HTMLElement): number | null {
  const host = panel.closest(
    '.object-list-master-detail__master, .object-list-master-detail__detail',
  )
  if (!(host instanceof HTMLElement)) return null
  return host.getBoundingClientRect().bottom
}

function measureRowsAndPageSize(): void {
  const panel = scrollPanel.value
  if (!panel) return

  const row = panel.querySelector('.p-datatable-tbody > tr')
  if (row) {
    measuredRowHeight.value = Math.max(
      rootFontSize() * 1.5,
      Math.ceil(row.getBoundingClientRect().height),
    )
  }

  const nextPageSize = Math.max(
    1,
    Math.ceil(panelHeight.value / measuredRowHeight.value) + pageSizeBufferRows(),
  )
  if (nextPageSize === dynamicPageSize.value) return

  dynamicPageSize.value = nextPageSize
  if (props.lazy) {
    emit('page-size-change', nextPageSize)
  }
}

function attachResizeObserver(): void {
  if (isCompact.value) return
  const panel = scrollPanel.value
  if (!panel) return
  const target =
    panel.closest('.object-list-master-detail__master') ??
    panel.closest('.object-list-master-detail__detail') ??
    panel.closest('.app-shell') ??
    panel.parentElement
  if (!target) return
  resizeObserver = new ResizeObserver(() => {
    updatePanelHeight()
  })
  resizeObserver.observe(target)
}

function attachInnerScrollListener(): void {
  const inner = scrollPanel.value?.querySelector<HTMLElement>('.p-datatable-table-container')
  if (!inner) return
  innerScroller.value = inner
  inner.addEventListener('scroll', handleScroll)
}

function detachInnerScrollListener(): void {
  if (innerScroller.value) {
    innerScroller.value.removeEventListener('scroll', handleScroll)
    innerScroller.value = null
  }
}

function handleScroll(): void {
  if (!props.lazy || !props.hasMore || props.loadingMore) return
  const panel = innerScroller.value ?? scrollPanel.value
  if (!panel) return

  const distanceToBottom =
    panel.scrollHeight - panel.scrollTop - panel.clientHeight
  if (distanceToBottom > loadMoreThreshold()) return

  emit('load-more', {
    offset: props.rows.length,
    limit: dynamicPageSize.value,
  })
}

function handleCompactWheel(event: WheelEvent): void {
  if (!isCompact.value || event.deltaY === 0) return

  // Let the table consume horizontal scroll (shift+wheel / trackpad X).
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  const panel = scrollPanel.value
  if (!panel) return

  const canScrollY = panel.scrollHeight > panel.clientHeight + 1
  if (canScrollY) {
    const scrollingUp = event.deltaY < 0
    const scrollingDown = event.deltaY > 0
    const atTop = panel.scrollTop <= 0
    const atBottom =
      panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1
    if ((scrollingUp && !atTop) || (scrollingDown && !atBottom)) {
      return
    }
  }

  window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' })
}

function rootFontSize(): number {
  const fontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  )
  return Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : window.innerHeight / 50
}

function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function initialPanelHeight(): number {
  return Math.max(viewportHeight() * 0.45, minimumPanelHeight())
}

function minimumPanelHeight(): number {
  return measuredRowHeight.value * 4
}

function bottomLayoutInset(panel: HTMLElement): number {
  const pane = panel.closest('.workspace-pane')
  const shell = panel.closest('.app-shell')

  return elementBoxInset(pane, ['padding-bottom', 'border-bottom-width'])
    + elementBoxInset(shell, ['padding-bottom'])
}

function pageSizeBufferRows(): number {
  return Math.max(1, Math.ceil(panelHeight.value / measuredRowHeight.value * 0.2))
}

function loadMoreThreshold(): number {
  return measuredRowHeight.value * 3
}

function elementBoxInset(
  element: Element | null,
  properties: string[],
): number {
  if (!(element instanceof HTMLElement)) return 0

  const style = getComputedStyle(element)
  return properties.reduce((total, property) => {
    const value = Number.parseFloat(style.getPropertyValue(property))
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)
}

function resolveColumnKey(column: CrmDataTableColumn): string {
  return column.field || column.header
}

/** PrimeVue horizontal scroll: minWidth keeps columns from squeezing. */
/** Cap JsonCode / Textarea so expand-mode resize cannot blow out the grid. */
const LONG_CONTENT_COLUMN_WIDTH = '18rem'
const LONG_CONTENT_CELL_CHARS = 100
const LONG_CONTENT_TITLE_CHARS = 500

function isLongContentColumn(column: CrmDataTableColumn): boolean {
  return column.component === 'JsonCode' || column.component === 'Textarea'
}

function columnMinWidth(column: CrmDataTableColumn): string {
  if (column.autoRecordId) return '6rem'
  if (isBooleanColumn(column)) return '5rem'
  if (isNumericColumn(column)) return numericColumnWidth(column)
  if (column.format?.trim() || isDateLikeColumn(column)) return '12rem'
  if (column.relatedCollection || column.recordLink) return '8rem'
  if (column.component === 'Repeater') return '14rem'
  if (column.component === 'Address') return '16rem'
  if (isHtmlEditorColumn(column)) return '16rem'
  if (isLongContentColumn(column)) return LONG_CONTENT_COLUMN_WIDTH
  // Header text truncates in the grid; keep floors modest so short values can shrink.
  const headerLen = (column.header || column.field || '').length
  if (headerLen > 18) return '12rem'
  if (headerLen > 12) return '10rem'
  if (headerLen > 6) return '8rem'
  return '6rem'
}

function numericColumnWidth(column: CrmDataTableColumn): string {
  const display = column.numberDisplay
  const hasAffix = Boolean(
    (typeof display?.prefix === 'string' && display.prefix.trim()) ||
      (typeof display?.suffix === 'string' && display.suffix.trim()),
  )
  return hasAffix ? '9rem' : '7rem'
}

function isDateLikeColumn(column: CrmDataTableColumn): boolean {
  return column.component === 'DatePicker' || column.component === 'Calendar'
}

function isNumericColumn(column: CrmDataTableColumn): boolean {
  // Global rule: numeric / integer / currency cells align right.
  return (
    isNumericFieldDefinition({ component: column.component }) ||
    Boolean(column.numberDisplay)
  )
}

function columnStyle(column: CrmDataTableColumn): Record<string, string> {
  const key = resolveColumnKey(column)
  const override = columnWidthOverrides.value[key]
  // Floor stays at the type default — never pin minWidth to the last resize,
  // or columns can only grow (PrimeVue won't shrink below minWidth).
  const style: Record<string, string> = {
    minWidth: columnMinWidth(column),
  }
  if (override) {
    // maxWidth is required so scrollable tables keep the resized size on reload
    // (width alone is treated as a hint and columns expand again).
    style.width = override
    style.maxWidth = override
  } else if (isLongContentColumn(column)) {
    style.width = LONG_CONTENT_COLUMN_WIDTH
  }
  if (isLongContentColumn(column)) {
    // Bound expand-mode growth from long JSON / textarea content.
    style.maxWidth = override || LONG_CONTENT_COLUMN_WIDTH
  }
  if (isNumericColumn(column)) {
    style.textAlign = 'right'
  }
  return style
}

function inlineReadonlyKey(collection: string, field: string): string {
  return `${collection}.${field}`
}

function inlineRowKey(row: Record<string, unknown>): string | null {
  const id = row[managedPrimaryKey.value]
  if (id === null || id === undefined || id === '') return null
  return String(id)
}

function resolveInlineRawValue(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
): unknown {
  return isNestedFieldPath(column.field)
    ? resolveNestedCellValue(row, column.field)
    : resolveValue(row, column.field)
}

function isCellInlineEditable(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
): boolean {
  if (!inlineEditableFieldSet.value.has(column.field)) return false
  if (isRecordArchived(row)) return false
  if (column.field === managedPrimaryKey.value) return false
  if (inlineRowKey(row) === null) return false
  const collection = managedCollection.value
  if (!collection) return false
  return inlineFieldReadonly[inlineReadonlyKey(collection, column.field)] !== true
}

function isEditingCell(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
): boolean {
  const rowKey = inlineRowKey(row)
  return (
    inlineEditingCell.value?.rowKey === rowKey &&
    inlineEditingCell.value?.field === column.field
  )
}

function isSavingCell(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
): boolean {
  return inlineSaving.value && isEditingCell(row, column)
}

function findInlineColumn(field: string): CrmDataTableColumn | undefined {
  return displayedColumns.value.find((column) => column.field === field)
}

function findInlineRow(rowKey: string): Record<string, unknown> | undefined {
  return props.rows.find((row) => inlineRowKey(row) === rowKey)
}

async function startInlineEdit(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
  cellRect: DOMRect,
): Promise<void> {
  if (!isCellInlineEditable(row, column)) return
  const rowKey = inlineRowKey(row)
  if (!rowKey) return

  if (
    inlineEditingCell.value &&
    (inlineEditingCell.value.rowKey !== rowKey ||
      inlineEditingCell.value.field !== column.field)
  ) {
    await commitCurrentInlineEdit()
  }

  if (
    inlineEditingCell.value?.rowKey === rowKey &&
    inlineEditingCell.value.field === column.field
  ) {
    inlineCellRect.value = cellRect
    return
  }

  const resolvedColumn = resolveInlineColumn(column)
  const kind = resolveInlineCellEditorKind(resolvedColumn)
  if (!kind) return

  // Use the display cell (with M2O label), not the raw FK id.
  const draftSource =
    kind === 'lookup' || kind === 'childLookup'
      ? resolveCellValue(row, resolvedColumn)
      : resolveInlineRawValue(row, resolvedColumn)
  const draft = toInlineEditorModel(kind, draftSource)

  // Paint the overlay editor immediately — never block on label fetches.
  inlineKind.value = kind
  inlineDraft.value = draft
  inlineOriginalSerialized.value = serializeInlineCellValue(kind, draft)
  inlineSaving.value = false
  inlineCellRect.value = cellRect
  inlineEditingCell.value = { rowKey, field: column.field }

  if (kind === 'lookup' && draft && typeof draft === 'object') {
    const option = draft as { label?: string; value?: string | number }
    const id = option.value
    if (
      id != null &&
      resolvedColumn.relatedCollection &&
      (!option.label?.trim() || option.label === String(id))
    ) {
      const fetched = await fetchRelatedCollectionOptionById(
        resolvedColumn.relatedCollection,
        id,
        resolvedColumn.template,
      )
      if (
        fetched &&
        inlineEditingCell.value?.rowKey === rowKey &&
        inlineEditingCell.value.field === column.field
      ) {
        inlineDraft.value = fetched
        inlineOriginalSerialized.value = serializeInlineCellValue(kind, fetched)
      }
    }
  }
}

/** Keep master/detail selection in sync without letting DataTable steal focus from the editor. */
function selectRowForDetail(row: Record<string, unknown>): void {
  if (!isSelectionEnabled.value) return
  if (tableSelection.value === row) return
  const selectedId = tableSelection.value?.[managedPrimaryKey.value]
  const rowId = row[managedPrimaryKey.value]
  if (
    selectedId !== undefined &&
    selectedId !== null &&
    rowId !== undefined &&
    rowId !== null &&
    String(selectedId) === String(rowId)
  ) {
    return
  }
  tableSelection.value = row
  emit('row-select', row)
}

function handleEditRequest(payload: CrmDataTableEditRequest): void {
  const column = payload.column as CrmDataTableColumn
  if (isEditingCell(payload.row, column)) return
  void startInlineEdit(payload.row, column, payload.cellRect)
  requestAnimationFrame(() => selectRowForDetail(payload.row))
}

function handleGridRowDragStart(payload: {
  row: Record<string, unknown>
  event: DragEvent
}): void {
  handleRowDragStart(payload.row, payload.event)
}

function handleGridRowDragEnd(payload: {
  row: Record<string, unknown>
  event: DragEvent
}): void {
  handleRowDragEnd(payload.row, payload.event)
}

function handleOpenActionMenu(payload: {
  event: Event
  row: Record<string, unknown>
}): void {
  const mouseEvent =
    payload.event instanceof MouseEvent
      ? payload.event
      : new MouseEvent('click')
  openActionMenu(mouseEvent, payload.row)
}

async function commitCurrentInlineEdit(): Promise<void> {
  if (!inlineEditingCell.value || !inlineKind.value) {
    cancelInlineEdit()
    return
  }
  await commitInlineEdit(serializeInlineCellValue(inlineKind.value, inlineDraft.value))
}

async function commitInlineEdit(serialized: unknown): Promise<void> {
  if (inlineCommitLock) {
    await inlineCommitLock
    return
  }

  const editing = inlineEditingCell.value
  const kind = inlineKind.value
  const collection = managedCollection.value
  if (!editing || !kind || !collection || inlineSaving.value) return

  if (inlineCellValuesEqual(serialized, inlineOriginalSerialized.value)) {
    cancelInlineEdit()
    return
  }

  const column = findInlineColumn(editing.field)
  const row = findInlineRow(editing.rowKey)
  if (!column || !row) {
    cancelInlineEdit()
    return
  }
  const resolvedColumn = resolveInlineColumn(column)

  inlineSaving.value = true
  const run = (async () => {
    try {
      await bridgeUpdateItem(collection, editing.rowKey, {
        [editing.field]: serialized,
      })

      const refreshMode = props.inlineEditRefresh ?? 'off'
      if (refreshMode === 'row' || refreshMode === 'fields') {
        const refreshed = await refreshInlineEditedRow(
          editing.rowKey,
          refreshMode,
          props.inlineEditRefreshFields ?? [],
          editing.field,
        )
        cancelInlineEdit()
        if (refreshed) emit('record-updated', refreshed)
        return
      }

      let editorValue = inlineDraft.value
      if (
        kind === 'childLookup' &&
        resolvedColumn.relatedCollection &&
        serialized != null &&
        serialized !== ''
      ) {
        const fetched = await fetchRelatedCollectionOptionById(
          resolvedColumn.relatedCollection,
          serialized as string | number,
          resolvedColumn.template,
        )
        if (fetched) editorValue = fetched
      }
      const displayValue = buildInlinePatchedFieldValue(
        kind,
        editorValue,
        serialized,
        resolvedColumn,
      )
      const patched = patchInlineField(editing.rowKey, editing.field, displayValue)
      if (
        (kind === 'lookup' || kind === 'childLookup') &&
        displayValue &&
        typeof displayValue === 'object'
      ) {
        const cell = displayValue as M2OCellValue
        if (cell.id != null && cell.label) {
          m2oCellLabels[m2oCellLabelKey(resolvedColumn, cell.id)] = cell.label
        }
      }
      cancelInlineEdit()
      if (patched) emit('record-updated', patched)
    } catch (err) {
      toast.add({
        severity: 'error',
        summary: t('datatable.inlineSaveError', 'Failed to save {field}.', {
          field: column.header || column.field,
        }),
        detail: err instanceof Error ? err.message : undefined,
        life: 4000,
      })
      cancelInlineEdit()
    } finally {
      inlineSaving.value = false
    }
  })()

  inlineCommitLock = run.finally(() => {
    inlineCommitLock = null
  })
  await inlineCommitLock
}

function cancelInlineEdit(): void {
  inlineEditingCell.value = null
  inlineKind.value = null
  inlineDraft.value = null
  inlineOriginalSerialized.value = null
  inlineSaving.value = false
  inlineCellRect.value = null
}

function patchInlineField(
  id: string,
  field: string,
  displayValue: unknown,
): Record<string, unknown> | null {
  let patchedRow: Record<string, unknown> | null = null
  const rows = props.rows.map((row) => {
    if (String(row[managedPrimaryKey.value] ?? '') !== id) return row
    patchedRow = { ...row, [field]: displayValue }
    return patchedRow
  })
  emitRows(rows)
  return patchedRow
}

function replaceInlineRow(
  id: string,
  nextRow: Record<string, unknown>,
): Record<string, unknown> | null {
  let patchedRow: Record<string, unknown> | null = null
  const rows = props.rows.map((row) => {
    if (String(row[managedPrimaryKey.value] ?? '') !== id) return row
    patchedRow = { ...row, ...nextRow }
    return patchedRow
  })
  emitRows(rows)
  return patchedRow
}

async function refreshInlineEditedRow(
  rowKey: string,
  mode: 'row' | 'fields',
  refreshFields: string[],
  editedField: string,
): Promise<Record<string, unknown> | null> {
  const collection = managedCollection.value
  if (!collection) return null

  const settings: DataTableSettings = {
    columns: localColumns.value
      .filter((column) => column.field && !column.autoRecordId)
      .map((column) => ({
        field: column.field,
        header: column.header,
        component: column.component,
        relatedCollection: column.relatedCollection,
        template: column.template,
        format: column.format,
        enabled: true,
        ...(column.inlineEditable === true ? { inlineEditable: true } : {}),
      })),
  }

  try {
    const runtime = await fetchDataTableRuntime({
      collection,
      settings,
      recordIds: [rowKey],
      limit: 1,
      swallowFetchErrors: true,
    })
    const fetched = runtime.rows[0]
    if (!fetched) return null

    if (mode === 'row') {
      return replaceInlineRow(rowKey, fetched)
    }

    const fields = refreshFields
      .map((field) => field.trim())
      .filter(Boolean)
    if (fields.length === 0) {
      return replaceInlineRow(rowKey, fetched)
    }

    const patch: Record<string, unknown> = {}
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(fetched, field)) {
        patch[field] = fetched[field]
      }
    }
    // Always keep the cell that was just edited in sync when present on the fetch.
    if (Object.prototype.hasOwnProperty.call(fetched, editedField)) {
      patch[editedField] = fetched[editedField]
    }
    return replaceInlineRow(rowKey, patch)
  } catch {
    return null
  }
}

function applyColumnOrder(ordered: CrmDataTableColumn[]): void {
  const collection = managedCollection.value
  if (!collection) {
    localColumns.value = ordered
    return
  }

  const primaryKey = managedPrimaryKey.value
  const dataColumns = ordered
    .filter((column) => !column.autoRecordId)
    .map(({ autoRecordId: _autoRecordId, ...column }) => column)

  const existingPrimary = localColumns.value.find(
    (column) => column.field === primaryKey,
  )
  if (
    existingPrimary &&
    !dataColumns.some((column) => column.field === primaryKey)
  ) {
    localColumns.value = [existingPrimary, ...dataColumns]
    return
  }

  localColumns.value = dataColumns
}

function applyStoredColumnOrder(
  columns: CrmDataTableColumn[],
): CrmDataTableColumn[] {
  const order = storedColumnOrder.value
  if (!order?.length) return columns

  const byKey = new Map(
    columns.map((column) => [resolveColumnKey(column), column] as const),
  )
  const next: CrmDataTableColumn[] = []
  const used = new Set<string>()

  for (const key of order) {
    const column = byKey.get(key)
    if (!column || used.has(key)) continue
    next.push(column)
    used.add(key)
  }

  for (const column of columns) {
    const key = resolveColumnKey(column)
    if (used.has(key)) continue
    next.push(column)
    used.add(key)
  }

  return next
}

function columnLayoutStorageKey(collection: string): string {
  return `coreengine.datatable.columnWidths.${collection}`
}

function legacyColumnLayoutStorageKey(collection: string): string {
  return `helix.datatable.columnWidths.${collection}`
}

function parseStoredWidth(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+(\.\d+)?px$/.test(value)) return value
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return `${Math.round(value)}px`
  }
  return null
}

function parseStoredOrder(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const order = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return order.length > 0 ? order : null
}

function loadColumnLayoutState(collection: string | null): void {
  if (!collection || typeof window === 'undefined') {
    columnWidthOverrides.value = {}
    storedColumnOrder.value = null
    return
  }
  try {
    const key = columnLayoutStorageKey(collection)
    const legacyKey = legacyColumnLayoutStorageKey(collection)
    let raw = window.localStorage.getItem(key)
    if (!raw) {
      raw = window.localStorage.getItem(legacyKey)
      if (raw) {
        window.localStorage.setItem(key, raw)
        window.localStorage.removeItem(legacyKey)
      }
    }
    if (!raw) {
      columnWidthOverrides.value = {}
      storedColumnOrder.value = null
      return
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      columnWidthOverrides.value = {}
      storedColumnOrder.value = null
      return
    }
    const record = parsed as Record<string, unknown>
    // New shape: { widths, order? } (tableWidth ignored — caused sibling stretch)
    // Legacy shape: flat Record<field, width>
    const widthSource =
      record.widths && typeof record.widths === 'object' && !Array.isArray(record.widths)
        ? (record.widths as Record<string, unknown>)
        : record
    const next: Record<string, string> = {}
    for (const [keyName, value] of Object.entries(widthSource)) {
      if (keyName === 'widths' || keyName === 'tableWidth' || keyName === 'order') continue
      const width = parseStoredWidth(value)
      if (width) next[keyName] = width
    }
    columnWidthOverrides.value = next
    storedColumnOrder.value = parseStoredOrder(record.order)
    if (storedColumnOrder.value?.length) {
      localColumns.value = applyStoredColumnOrder([...props.columns])
    }
  } catch {
    columnWidthOverrides.value = {}
    storedColumnOrder.value = null
  }
}

function persistColumnLayoutState(): void {
  const collection = managedCollection.value
  if (!collection || typeof window === 'undefined') return
  try {
    const payload: {
      widths: Record<string, string>
      order?: string[]
    } = {
      widths: columnWidthOverrides.value,
    }
    if (storedColumnOrder.value?.length) {
      payload.order = storedColumnOrder.value
    }
    window.localStorage.setItem(
      columnLayoutStorageKey(collection),
      JSON.stringify(payload),
    )
    window.localStorage.removeItem(legacyColumnLayoutStorageKey(collection))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

watch(
  managedCollection,
  (collection) => {
    loadColumnLayoutState(collection)
  },
  { immediate: true },
)

/** Leading fixed columns in CrmDataTableGrid (row #, multi-select) before data columns. */
function leadingFixedColumnCount(): number {
  let count = 0
  if (props.showRowNumbers) count += 1
  if (isMultipleSelection.value) count += 1
  return count
}

function handleColumnResizeEnd(event: {
  element?: HTMLElement | null
  delta?: number
}): void {
  const th = event?.element ?? null
  if (!th) return

  const headers = th.parentElement
    ? Array.from(th.parentElement.children).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      )
    : []
  const dataStart = leadingFixedColumnCount()
  const dataIndex = headers.indexOf(th) - dataStart
  const column = displayedColumns.value[dataIndex]
  if (!column || column.autoRecordId) return

  const width = Math.round(th.getBoundingClientRect().width)
  if (width < 40) return

  // Persist only the dragged column. Do not remount: OpenVue expand-mode
  // already keeps siblings at their pre-resize sizes; remounting clears that
  // and redistributes every column.
  columnWidthOverrides.value = {
    ...columnWidthOverrides.value,
    [resolveColumnKey(column)]: `${width}px`,
  }

  persistColumnLayoutState()
}

function handleColumnReorder(event: unknown): void {
  const { dragIndex, dropIndex } = (event ?? {}) as {
    dragIndex?: number
    dropIndex?: number
  }
  if (dragIndex === undefined || dropIndex === undefined) return
  if (dragIndex === dropIndex) return

  // OpenVue indices include fixed columns (row #, selection, actions); map to data columns.
  const offset = leadingFixedColumnCount()
  const from = dragIndex - offset
  const dataCount = displayedColumns.value.length
  if (from < 0 || from >= dataCount) return
  if (displayedColumns.value[from]?.autoRecordId) return

  let to = dropIndex - offset
  if (to < 0) to = 0
  if (to >= dataCount) to = dataCount - 1
  if (from === to) return

  const ordered = [...displayedColumns.value]
  const [moved] = ordered.splice(from, 1)
  if (!moved) return
  ordered.splice(to, 0, moved)

  applyColumnOrder(ordered)
  storedColumnOrder.value = ordered
    .filter((column) => !column.autoRecordId)
    .map((column) => resolveColumnKey(column))
  persistColumnLayoutState()
  columnLayoutKey.value += 1
}

function coerceSortOrder(value: unknown): 1 | -1 | null {
  if (value === 1 || value === -1) return value
  if (value === '1') return 1
  if (value === '-1') return -1
  const numeric = Number(value)
  if (numeric === 1 || numeric === -1) return numeric
  return null
}

function handleSort(event: unknown): void {
  const payload = (event ?? {}) as {
    sortField?: string | ((item: unknown) => string)
    sortOrder?: number | string | null
  }
  sortField.value =
    typeof payload.sortField === 'string' ? payload.sortField : null
  sortOrder.value = coerceSortOrder(payload.sortOrder)

  emit('sort-change', {
    field: sortField.value,
    order: sortOrder.value,
    sortKey: sortField.value ? resolveSortKey(sortField.value) : null,
  })
}

function resolveSortKey(fieldName: string): string {
  const column = displayedColumns.value.find((c) => c.field === fieldName)
  // Auto Name link: sort by Display Template fields, not auto-number `name`.
  if (column?.autoRecordId && fieldName === 'name') {
    const fields = resolveNameLinkSortFields(
      'name',
      column.template || collectionDisplayTemplate.value,
    )
    return fields.join(',')
  }
  if (column?.field && isNestedFieldPath(column.field)) {
    return column.field
  }
  if (column?.relatedCollection) {
    const templateFields = column.template
      ? extractTemplateFields(column.template)
      : []
    if (templateFields.length > 0) {
      return `${fieldName}.${templateFields[0]}`
    }
    // M2O without an explicit column template: send the bare field so the
    // server sorts by the related entity's Display Template (authoritative
    // label), not a guessed `name` column.
    return fieldName
  }
  return fieldName
}

function handleRowDragStart(
  row: Record<string, unknown>,
  event: DragEvent,
): void {
  event.stopPropagation()
  if (!canDragRows.value) {
    event.preventDefault()
    return
  }

  const rowId = row[managedPrimaryKey.value]
  const transferValue =
    typeof rowId === 'string' || typeof rowId === 'number'
      ? String(rowId)
      : 'row'
  event.dataTransfer?.setData('text/plain', transferValue)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
  emit('row-drag-start', { row, event })
}

function handleRowDragEnd(
  row: Record<string, unknown>,
  event: DragEvent,
): void {
  emit('row-drag-end', { row, event })
}

function openActionMenu(
  event: MouseEvent,
  row: Record<string, unknown>,
): void {
  selectedActionRow.value = row
  actionMenu.value?.toggle(event)
}

function emitAction(
  action: 'editRecord' | 'viewRecord' | 'deleteRecord' | 'restoreRecord',
): void {
  if (!selectedActionRow.value) return
  if (action === 'editRecord') {
    if (isManaged.value) {
      void openManagedEditDialog(selectedActionRow.value)
      return
    }
    emit('editRecord', selectedActionRow.value)
    return
  }
  if (action === 'viewRecord') {
    emit('viewRecord', selectedActionRow.value)
    return
  }
  if (action === 'restoreRecord') {
    if (isManaged.value) {
      restoreManagedRecord(selectedActionRow.value)
      return
    }
    emit('restoreRecord', selectedActionRow.value)
    return
  }
  if (isManaged.value) {
    deleteManagedRecord(selectedActionRow.value)
    return
  }
  emit('deleteRecord', selectedActionRow.value)
}

function handleNewRecord(): void {
  if (!canCreateRecords.value) return
  if (!isManaged.value) {
    emit('newRecord')
    return
  }
  createDialogVisible.value = true
}

const createDialogCollection = computed(
  () =>
    relatedCreateTarget.value?.createCollection?.trim() ||
    managedCollection.value ||
    '',
)
const createDialogParentField = computed(() => {
  const target = relatedCreateTarget.value
  if (target?.junction) return undefined
  return target?.parentField || props.parentName
})

defineExpose({ handleNewRecord })

async function openManagedEditDialog(
  row: Record<string, unknown>,
): Promise<void> {
  const collection = managedCollection.value
  if (!collection) return
  const id = row[managedPrimaryKey.value]
  if (id === null || id === undefined || id === '') return

  editDialogVisible.value = true
  editLoading.value = true
  editSaving.value = false
  editError.value = null
  editRecordId.value = String(id)
  editOriginalRow.value = cloneRecord(row)
  editOriginalRecord.value = null
  editLayoutSchema.value = null
  editDraft.value = {}

  try {
    const { blockLayout: schema } = await resolvePreferredBlockLayoutForCurrentUser(
      collection,
    )
    editLayoutSchema.value = schema ? editableSchema(schema) : null
    const record = editLayoutSchema.value
      ? await fetchObjectRecordForEdit(
          collection,
          String(id),
          editLayoutSchema.value,
        )
      : await fetchObjectRecord(collection, String(id))
    if (editLayoutSchema.value) {
      editOriginalRecord.value = cloneRecord(record)
      editDraft.value = await prepareEntityFormDraft(
        collection,
        editLayoutSchema.value,
        cloneRecord(record),
        editOriginalRow.value,
      )
    } else {
      editDraft.value = cloneRecord(record)
    }
    if (!schema) {
      editError.value = t(
        'datatable.noSavedDetailLayout',
        'No saved detail layout found for "{collection}".',
        { collection: managedCollectionLabel.value },
      )
    }
  } catch (err) {
    editError.value =
      err instanceof Error
        ? err.message
        : t('datatable.loadEditError', 'Failed to load record for editing.')
  } finally {
    editLoading.value = false
  }
}

function updateEditDialogVisible(visible: boolean): void {
  if (editSaving.value && !visible) return
  editDialogVisible.value = visible
  if (!visible) {
    editError.value = null
    editRecordId.value = null
    editOriginalRow.value = null
    editOriginalRecord.value = null
  }
}

async function saveEditDialog(): Promise<void> {
  const collection = managedCollection.value
  if (
    !collection ||
    !editLayoutSchema.value ||
    !editRecordId.value ||
    !editOriginalRecord.value
  ) {
    return
  }

  const validation = editFormRendererRef.value?.validateRequired()
  if (validation && !validation.valid) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: t('formRenderer.missingRequiredFields', 'Required fields are missing: {fields}', {
        fields: validation.missingLabels.join(', '),
      }),
      life: 5000,
    })
    return
  }

  editSaving.value = true
  editError.value = null

  try {
    const payload = await buildChangedFormPayload(
      collection,
      editLayoutSchema.value,
      editDraft.value,
      editOriginalRecord.value,
      { primaryKey: managedPrimaryKey.value },
    )

    if (Object.keys(payload).length === 0) {
      editDialogVisible.value = false
      editOriginalRecord.value = null
      return
    }

    const updated = await updateObjectRecord(
      collection,
      editRecordId.value,
      payload,
    )
    editDialogVisible.value = false
    const patched = patchRows(editRecordId.value, updated)
    if (patched) {
      emit('record-updated', patched)
    }
  } catch (err) {
    editError.value =
      err instanceof Error
        ? err.message
        : t('datatable.saveRecordError', 'Failed to save record.')
  } finally {
    editSaving.value = false
  }
}

async function handleRecordCreated(row: Record<string, unknown>): Promise<void> {
  createDialogVisible.value = false

  const target = relatedCreateTarget.value
  const junction = target?.junction
  let listRow = normalizeCreatedRow(row)

  if (
    junction &&
    props.parentId !== undefined &&
    props.parentId !== null &&
    row.id !== undefined &&
    row.id !== null &&
    row.id !== ''
  ) {
    try {
      listRow = normalizeCreatedRow(
        await createObjectRecord(junction.collection, {
          [junction.parentField]: props.parentId,
          [junction.relatedField]: row.id,
        }),
      )
    } catch (err) {
      actionError.value =
        err instanceof Error
          ? err.message
          : t(
              'datatable.linkCreatedRecordError',
              'Record created, but linking to the parent failed.',
            )
      emit('record-created', normalizeCreatedRow(row))
      return
    }
  }

  const nextRows = [listRow, ...props.rows]
  const maxRows =
    typeof props.maxLocalRows === 'number' && props.maxLocalRows > 0
      ? props.maxLocalRows
      : null

  // A user-selected sort would move the freshly-created row away from the top.
  sortField.value = null
  sortOrder.value = null
  emitRows(maxRows ? nextRows.slice(0, maxRows) : nextRows)
  emit('record-created', listRow)
}

function deleteManagedRecord(row: Record<string, unknown>): void {
  const collection = managedCollection.value
  if (!collection) return
  const id = row[managedPrimaryKey.value]
  if (id === null || id === undefined || id === '') return

  confirm.require({
    message: t('datatable.confirmDeleteMessage', 'Delete this record?'),
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
      void archiveRecordConfirmed(collection, String(id), row)
    },
  })
}

async function archiveRecordConfirmed(
  collection: string,
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  actionError.value = null

  try {
    await archiveObjectRecord(collection, id)
    emitRows(
      props.rows.filter(
        (candidate) => String(candidate[managedPrimaryKey.value] ?? '') !== id,
      ),
    )
    emit('record-deleted', row)
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : t('datatable.deleteError', 'Failed to delete record.')
    actionError.value = detail
    toast.add({
      severity: 'error',
      summary: t('datatable.deleteError', 'Failed to delete record.'),
      detail,
      life: 6000,
    })
  }
}

function restoreManagedRecord(row: Record<string, unknown>): void {
  const collection = managedCollection.value
  if (!collection) return
  const id = row[managedPrimaryKey.value]
  if (id === null || id === undefined || id === '') return

  confirm.require({
    message: t('datatable.confirmRestoreMessage', 'Restore this record?'),
    header: t('datatable.confirmRestoreHeader', 'Confirm Restore'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('common.restore', 'Restore'),
    },
    accept: () => {
      void restoreRecordConfirmed(collection, String(id), row)
    },
  })
}

async function restoreRecordConfirmed(
  collection: string,
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  actionError.value = null

  try {
    const restored = await restoreObjectRecord(collection, id)
    emitRows(
      props.rows.filter(
        (candidate) => String(candidate[managedPrimaryKey.value] ?? '') !== id,
      ),
    )
    emit('record-restored', { ...row, ...restored, is_deleted: false })
  } catch (err) {
    actionError.value =
      err instanceof Error
        ? err.message
        : t('datatable.restoreError', 'Failed to restore record.')
  }
}

function patchRows(
  id: string,
  updated: Record<string, unknown>,
): Record<string, unknown> | null {
  let patchedRow: Record<string, unknown> | null = null
  const rows = props.rows.map((row) => {
    if (String(row[managedPrimaryKey.value] ?? '') !== id) return row

    patchedRow = mergeDisplayRow(editOriginalRow.value ?? row, updated)
    return patchedRow
  })

  emitRows(rows)
  return patchedRow
}

function emitRows(rows: Record<string, unknown>[]): void {
  emit('update:rows', rows)
}

function editableSchema(schema: EntityLayoutSchema): EntityLayoutSchema {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      groups: section.groups
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => field.component !== 'DataTable'),
        }))
        .filter((group) => group.fields.length > 0),
    })),
  }
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}

function mergeDisplayRow(
  baseRow: Record<string, unknown>,
  updated: Record<string, unknown>,
): Record<string, unknown> {
  const nextRow = { ...baseRow }
  const fields = new Set([...Object.keys(updated), ...Object.keys(editDraft.value)])

  for (const field of fields) {
    const nextValue = Object.prototype.hasOwnProperty.call(updated, field)
      ? updated[field]
      : editDraft.value[field]
    nextRow[field] = mergeDisplayValue(baseRow[field], nextValue, field)
  }

  return nextRow
}

function mergeDisplayValue(
  previous: unknown,
  nextValue: unknown,
  field: string,
): unknown {
  if (isM2ODisplayValue(previous) || isM2OColumn(field)) {
    const id =
      nextValue && typeof nextValue === 'object'
        ? (nextValue as Record<string, unknown>).id
        : nextValue
    const relatedCollection =
      m2oCellValue(previous)?.relatedCollection ??
      localColumns.value.find((column) => column.field === field)?.relatedCollection

    return {
      __crmValueType: 'm2o',
      id,
      label: String(id ?? ''),
      relatedCollection,
    }
  }

  return nextValue
}

function normalizeCreatedRow(row: Record<string, unknown>): Record<string, unknown> {
  const nextRow = { ...row }

  for (const column of displayedColumns.value) {
    if (column.autoRecordId) continue
    if (!column.relatedCollection) continue
    const value = nextRow[column.field]
    nextRow[column.field] = mergeDisplayValue(undefined, value, column.field)
  }

  return nextRow
}

function isM2ODisplayValue(value: unknown): value is M2OCellValue {
  return Boolean(m2oCellValue(value))
}

function isM2OColumn(field: string): boolean {
  return Boolean(
    localColumns.value.find((column) => column.field === field)?.relatedCollection,
  )
}

function syncChoiceCellLabels(): void {
  const collection = managedCollection.value

  for (const column of displayedColumns.value) {
    if (column.autoRecordId || column.relatedCollection) continue

    const choiceCollection = column.valueCollection ?? collection
    if (!choiceCollection) continue

    const key = choiceCellLabelKey(choiceCollection, column.field)
    if (choiceCellLabels[key] || choiceCellLabelRequests.has(key)) continue

    void loadChoiceCellLabels(choiceCollection, column)
  }
}

async function loadChoiceCellLabels(
  collection: string,
  column: CrmDataTableColumn,
): Promise<void> {
  const key = choiceCellLabelKey(collection, column.field)
  const fieldName = isNestedFieldPath(column.field)
    ? column.field.split('.').slice(1).join('.')
    : column.field
  choiceCellLabelRequests.add(key)

  try {
    const labels = await fetchChoiceLabelMap(
      collection,
      fieldName,
      column.component ?? 'Select',
    )
    if (Object.keys(labels).length > 0) {
      choiceCellLabels[key] = labels
    }
  } catch {
    // Fields without choice options simply keep their raw value.
  } finally {
    choiceCellLabelRequests.delete(key)
  }
}

function choiceCellLabelKey(collection: string, field: string): string {
  return `${collection}.${field}`
}

function choiceMappedValue(column: CrmDataTableColumn, value: unknown): unknown {
  const collection = column.valueCollection ?? managedCollection.value
  if (!collection || column.relatedCollection || column.autoRecordId) return value

  const labels = choiceCellLabels[choiceCellLabelKey(collection, column.field)]
  if (!labels) return value

  if (Array.isArray(value)) {
    return value.map((item) => labels[String(item)] ?? String(item)).join(', ')
  }

  return labels[String(value)] ?? value
}

function syncM2OCellLabels(): void {
  for (const row of props.rows) {
    for (const column of displayedColumns.value) {
      if (column.autoRecordId) continue

      const rawValue = isNestedFieldPath(column.field)
        ? resolveNestedCellValue(row, column.field)
        : resolveValue(row, column.field)
      const cell = m2oCellValue(rawValue)
      const relatedCollection =
        column.relatedCollection?.trim() ||
        cell?.relatedCollection?.trim() ||
        ''
      if (!relatedCollection) continue

      const id = cell?.id ?? m2oId(rawValue)
      if (id === null) continue
      if (
        cell?.label &&
        cell.label !== String(id) &&
        !templateReferencesParent(column.template)
      ) {
        continue
      }

      void loadM2OCellLabel(
        { ...column, relatedCollection, template: column.template },
        id,
      )
    }
  }
}

async function loadM2OCellLabel(
  column: CrmDataTableColumn,
  id: string | number,
): Promise<void> {
  if (!column.relatedCollection) return
  const key = m2oCellLabelKey(column, id)
  const cached = m2oCellLabels[key]
  // Never treat a raw FK/id as a finished Display Template label.
  if ((cached && cached !== String(id)) || m2oCellLabelRequests.has(key)) return

  m2oCellLabelRequests.add(key)
  try {
    const option = await fetchRelatedCollectionOptionById(
      column.relatedCollection,
      id,
      column.template,
    )
    if (option?.label && option.label !== String(id)) {
      m2oCellLabels[key] = option.label
    }
  } finally {
    m2oCellLabelRequests.delete(key)
  }
}

function m2oCellLabelKey(column: CrmDataTableColumn, id: string | number): string {
  return [column.relatedCollection ?? '', id, column.template ?? ''].join('.')
}

function m2oId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!value || typeof value !== 'object') return null
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

function resolveScalarCellValue(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
): unknown {
  const value = isNestedFieldPath(column.field)
    ? resolveNestedCellValue(row, column.field)
    : resolveValue(row, column.field)
  return choiceMappedValue(column, value)
}

function resolveRecordId(row: Record<string, unknown>): string | number | null {
  const rawId = row[managedPrimaryKey.value]
  if (typeof rawId === 'string' || typeof rawId === 'number') return rawId
  if (rawId === null || rawId === undefined) return null
  return String(rawId)
}

function resolveCellValue(
  row: Record<string, unknown>,
  column: CrmDataTableColumn,
): unknown {
  if (column.autoRecordId) {
    const id = resolveRecordId(row)
    const pkLabel = id != null ? String(id) : ''
    const template = collectionDisplayTemplate.value?.trim() || undefined
    const templateLabel = template
      ? resolvePrimaryKeyRecordLabel(
          template,
          row,
          managedPrimaryKey.value,
        ).trim()
      : ''
    const nameLabel =
      autoRecordLinkField.value === 'name'
        ? String(row.name ?? '').trim()
        : ''
    // Prefer entity Display Template over auto-numbered `name` (e.g. 0210).
    return {
      __crmValueType: 'm2o',
      id,
      label:
        (templateLabel && templateLabel !== pkLabel ? templateLabel : '') ||
        nameLabel ||
        pkLabel,
      relatedCollection: managedCollection.value ?? undefined,
    } satisfies M2OCellValue
  }

  if (column.recordLink) {
    const id = resolveRecordId(row)
    const displayValue = resolveScalarCellValue(row, column)
    return {
      __crmValueType: 'm2o',
      id,
      label: formatValue(displayValue, column),
      relatedCollection: managedCollection.value ?? undefined,
    } satisfies M2OCellValue
  }

  const value = resolveScalarCellValue(row, column)
  const cell = m2oCellValue(value)
  const relatedCollection =
    column.relatedCollection?.trim() ||
    cell?.relatedCollection?.trim() ||
    ''
  const isM2OColumn = Boolean(relatedCollection)

  if (!isM2OColumn) {
    return value
  }

  const resolvedColumn = {
    ...column,
    relatedCollection,
  } satisfies CrmDataTableColumn
  const id = cell?.id ?? m2oId(value)
  if (id === null) return value
  const cachedLabel = m2oCellLabels[m2oCellLabelKey(resolvedColumn, id)]
  const cachedIsDisplayLabel = Boolean(cachedLabel && cachedLabel !== String(id))

  if (cell) {
    const inlineLabel =
      templateReferencesParent(column.template) ? undefined : cell.label
    const label =
      (cachedIsDisplayLabel ? cachedLabel : undefined) ??
      (inlineLabel && inlineLabel !== String(id) ? inlineLabel : undefined) ??
      (cachedLabel && cachedLabel !== String(id) ? cachedLabel : undefined) ??
      String(id)
    return {
      ...cell,
      relatedCollection,
      label,
    } satisfies M2OCellValue
  }

  return {
    __crmValueType: 'm2o',
    id,
    label:
      (cachedIsDisplayLabel ? cachedLabel : undefined) ??
      relatedRecordFallbackLabel(value, id),
    relatedCollection,
  } satisfies M2OCellValue
}

function resolveValue(row: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') {
      return (value as Record<string, unknown>)[key]
    }
    return undefined
  }, row)
}

function matchesParent(
  row: Record<string, unknown>,
  parentName: string,
  parentId: string | number,
): boolean {
  const value = resolveValue(row, parentName)
  if (value === null || value === undefined) return false
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.id ?? '') === String(parentId)
  }
  return String(value) === String(parentId)
}

function truncateCellText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

function formatValueBase(value: unknown, column?: CrmDataTableColumn): string {
  const relatedCell = m2oCellValue(value)
  if (relatedCell) return relatedCell.label || String(relatedCell.id ?? '')
  if (column?.component === 'Repeater') return formatScheduleRuleSummary(value)
  if (column?.component === 'Address') return formatAddressSummary(value)
  if (column?.component === 'JsonCode') return formatJsonCodeSummary(value)
  if (column?.format?.trim()) return formatDateValue(value, column.format)
  if (column && isHtmlEditorColumn(column)) {
    const plain = plainTextFromHtml(value)
    return plain || '-'
  }
  const numberLabel = formatNumberDisplayValue(value, column?.numberDisplay)
  if (numberLabel !== null) return numberLabel
  return formatDisplayValue(value, {
    arrayDisplay: 'count',
    itemLabel: (count) =>
      t(
        count === 1 ? 'datatable.itemCount' : 'datatable.itemCountPlural',
        count === 1 ? '{count} item' : '{count} items',
        { count },
      ),
  })
}

function formatValue(value: unknown, column?: CrmDataTableColumn): string {
  const label = formatValueBase(value, column)
  if (column && isLongContentColumn(column)) {
    return truncateCellText(label, LONG_CONTENT_CELL_CHARS)
  }
  return label
}

/** Hover title: longer preview for JsonCode / Textarea without dumping full payloads. */
function formatCellTitle(value: unknown, column?: CrmDataTableColumn): string {
  const label = formatValueBase(value, column)
  if (column && isLongContentColumn(column)) {
    return truncateCellText(label, LONG_CONTENT_TITLE_CHARS)
  }
  return label
}

function m2oCellValue(value: unknown): M2OCellValue | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<M2OCellValue>
  return record.__crmValueType === 'm2o' ? (record as M2OCellValue) : null
}

function canShowM2OTooltip(
  column: CrmDataTableColumn,
  value: unknown,
): boolean {
  const cell = m2oCellValue(value)
  return Boolean(cell?.id && (cell.relatedCollection || column.relatedCollection))
}

function canLinkM2OCell(column: CrmDataTableColumn, value: unknown): boolean {
  if (!props.recordLinksEnabled) return false
  return canShowM2OTooltip(column, value)
}

function compactTooltipState(column: CrmDataTableColumn, value: unknown) {
  const cell = m2oCellValue(value)
  const relatedCollection = cell?.relatedCollection || column.relatedCollection
  if (!cell?.id || !relatedCollection) return null
  return compactTooltip.getState(relatedCollection, cell.id)
}

async function loadCompactTooltip(
  column: CrmDataTableColumn,
  value: unknown,
): Promise<void> {
  const cell = m2oCellValue(value)
  const relatedCollection = cell?.relatedCollection || column.relatedCollection
  if (!cell?.id || !relatedCollection) return
  await compactTooltip.load(relatedCollection, cell.id)
}

function relatedRecordRoute(column: CrmDataTableColumn, value: unknown) {
  const cell = m2oCellValue(value)
  const relatedCollection = cell?.relatedCollection || column.relatedCollection
  if (!cell?.id || !relatedCollection) return { name: 'home' }

  // For child-row columns (the primary-key Id column or a named recordLink field),
  // append the child collection/id to the current page path so the URL chain
  // is preserved at any nesting depth:
  //   /object/patient/2          → /object/patient/2/visit/47
  //   /object/patient/2/visit/47 → /object/patient/2/visit/47/lab_result/5
  const isChildRow = column.autoRecordId || column.recordLink
  if (isChildRow && DETAIL_ROUTE_NAMES.has(String(route.name))) {
    return {
      path: `${route.path}/${encodeURIComponent(relatedCollection)}/${encodeURIComponent(String(cell.id))}`,
    }
  }

  // Embedded related tables on list / form pages: keep parent context in the URL
  // so Back returns to the parent record (e.g. Visit 61), not the child list.
  if (
    isChildRow &&
    props.parentCollection &&
    props.parentId !== undefined &&
    props.parentId !== null &&
    props.parentId !== ''
  ) {
    return childRecordDetailRoute(
      props.parentCollection,
      props.parentId,
      relatedCollection,
      cell.id,
    )
  }

  // M2O field links pointing to a different collection stay as flat routes.
  return recordDetailRoute(relatedCollection, cell.id)
}

function groupByColumn(): CrmDataTableColumn | undefined {
  const field = props.groupBy?.field
  if (!field) return undefined
  return displayedColumns.value.find((column) => column.field === field)
}

function formatGroupHeader(row: Record<string, unknown>): string {
  const field = activeGroupField.value
  if (!field) return ''

  const column = groupByColumn()
  const value = column
    ? resolveCellValue(row, column)
    : isNestedFieldPath(field)
      ? resolveNestedCellValue(row, field)
      : resolveValue(row, field)
  return formatValue(value, column ?? { field, header: field })
}

/** Coerce InputNumber / currency cell values (often decimal strings from GraphQL). */
function coerceSortNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const raw = value.trim().replace(/,/g, '')
    if (!raw) return null
    const numeric = Number(raw)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function sortableValue(value: unknown, column?: CrmDataTableColumn): string | number {
  const cell = m2oCellValue(value)
  if (cell?.label) return cell.label.toLowerCase()
  if (value === null || value === undefined) return ''
  // Related-list client sort: decimals often arrive as strings ("536.50" vs "53.25").
  if (column && (isNumericColumn(column) || column.numberDisplay)) {
    const numeric = coerceSortNumber(value)
    return numeric === null ? '' : numeric
  }
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  if (column?.component === 'Repeater') {
    return formatScheduleRuleSummary(value).toLowerCase()
  }
  if (column?.component === 'Address') {
    return formatAddressSummary(value, '').toLowerCase()
  }
  if (column && isHtmlEditorColumn(column)) {
    return plainTextFromHtml(value).toLowerCase()
  }
  return String(value).toLowerCase()
}

function compareRowsByField(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  field: string,
  order: 1 | -1,
): number {
  const column = displayedColumns.value.find((item) => item.field === field)
  const leftValue = column
    ? resolveCellValue(left, column)
    : isNestedFieldPath(field)
      ? resolveNestedCellValue(left, field)
      : resolveValue(left, field)
  const rightValue = column
    ? resolveCellValue(right, column)
    : isNestedFieldPath(field)
      ? resolveNestedCellValue(right, field)
      : resolveValue(right, field)

  const leftKey = sortableValue(leftValue, column)
  const rightKey = sortableValue(rightValue, column)

  // Empty / invalid numeric cells sort after real values in both directions.
  if (leftKey === '' && rightKey === '') return 0
  if (leftKey === '') return 1
  if (rightKey === '') return -1

  if (typeof leftKey === 'number' && typeof rightKey === 'number') {
    if (leftKey < rightKey) return -1 * order
    if (leftKey > rightKey) return 1 * order
    return 0
  }

  if (leftKey < rightKey) return -1 * order
  if (leftKey > rightKey) return 1 * order
  return 0
}
</script>

<template>
  <div class="crm-data-table-wrap">
    <div
      v-if="
        showNewButtonEffective ||
        $slots.toolbar ||
        $slots['toolbar-actions'] ||
        $slots['toolbar-filters'] ||
        $slots['toolbar-tools']
      "
      class="crm-data-table__toolbar"
    >
      <div class="crm-data-table__toolbar-row crm-data-table__toolbar-row--primary">
        <div class="crm-data-table__toolbar-start">
          <slot name="toolbar" />
        </div>
        <div
          v-if="$slots['toolbar-actions'] || showNewButtonEffective"
          class="crm-data-table__toolbar-actions"
        >
          <slot name="toolbar-actions" />
          <Button
            v-if="showNewButtonEffective"
            :label="newButtonText"
            size="small"
            @click="handleNewRecord"
          />
        </div>
      </div>
      <div
        v-if="$slots['toolbar-filters'] || $slots['toolbar-tools']"
        class="crm-data-table__toolbar-row crm-data-table__toolbar-row--secondary"
      >
        <div
          v-if="$slots['toolbar-filters']"
          class="crm-data-table__toolbar-filters"
        >
          <slot name="toolbar-filters" />
        </div>
        <div
          v-if="$slots['toolbar-tools']"
          class="crm-data-table__toolbar-tools"
        >
          <slot name="toolbar-tools" />
        </div>
      </div>
    </div>

    <Message
      v-if="actionError"
      severity="error"
      :closable="false"
      class="crm-data-table__message"
    >
      {{ actionError }}
    </Message>

    <Message
      v-if="groupBy?.field && lazy && !allowRowGrouping"
      severity="info"
      :closable="false"
      class="crm-data-table__message"
    >
      {{ t('datatable.groupingDisabledLazy', 'Row grouping is available only on embedded related tables, not on infinite-scroll lists.') }}
    </Message>

    <div
      ref="scrollPanel"
      class="crm-data-table__scroll-panel"
      :class="{ 'crm-data-table__scroll-panel--compact': isCompact }"
      :style="scrollPanelStyle"
      @scroll="handleScroll"
      @wheel="handleCompactWheel"
    >
      <CrmDataTableGrid
        :column-layout-key="columnLayoutKey"
        :table-rows="tableRows"
        :displayed-columns="displayedColumns"
        :managed-primary-key="managedPrimaryKey"
        :loading="loading"
        :lazy="lazy"
        :paginator="paginator"
        :active-rows-per-page="activeRowsPerPage"
        :is-compact="isCompact"
        :show-row-numbers="showRowNumbers"
        :is-selection-enabled="isSelectionEnabled"
        :is-multiple-selection="isMultipleSelection"
        :selection="tableSelection"
        :expanded-row-groups="expandedRowGroups"
        :is-row-grouping-active="isRowGroupingActive"
        :group-expandable="groupBy?.expandable !== false"
        :active-group-field="activeGroupField"
        :effective-sort-field="effectiveSortField"
        :effective-sort-order="effectiveSortOrder"
        :sortable-columns="sortableColumns"
        :reorderable-columns="reorderableColumns"
        :resizable-columns="true"
        :row-draggable="rowDraggable"
        :row-drag-disabled="rowDragDisabled"
        :can-drag-rows="canDragRows"
        :show-delete-button="showDeleteButtonEffective"
        :empty-message="emptyMessageText"
        :format-group-header="formatGroupHeader"
        :resolve-column-key="resolveColumnKey"
        :column-style="columnStyle"
        :is-numeric-column="isNumericColumn"
        :resolve-cell-value="resolveCellValue"
        :format-value="formatValue"
        :format-cell-title="formatCellTitle"
        :can-link-m2-o-cell="canLinkM2OCell"
        :related-record-route="relatedRecordRoute"
        :compact-tooltip-state="compactTooltipState"
        :load-compact-tooltip="loadCompactTooltip"
        :is-cell-inline-editable="isCellInlineEditable"
        @update:selection="tableSelection = $event"
        @update:expanded-row-groups="expandedRowGroups = $event"
        @sort="handleSort"
        @column-reorder="handleColumnReorder"
        @column-resize-end="handleColumnResizeEnd"
        @row-select="handleRowSelect"
        @row-unselect="handleRowUnselect"
        @edit-request="handleEditRequest"
        @row-drag-start="handleGridRowDragStart"
        @row-drag-end="handleGridRowDragEnd"
        @open-action-menu="handleOpenActionMenu"
      >
        <template v-if="$slots.cell" #cell="slotProps">
          <slot name="cell" v-bind="slotProps" />
        </template>
        <template v-if="$slots.actions" #actions="slotProps">
          <slot name="actions" v-bind="slotProps" />
        </template>
      </CrmDataTableGrid>
    </div>

    <Teleport to="body">
      <div
        v-if="inlineEditingCell && inlineKind && inlineEditingColumn"
        class="crm-inline-edit-overlay"
        :class="{ 'crm-inline-edit-overlay--saving': inlineSaving }"
        :style="inlineOverlayStyle"
      >
        <CrmInlineCellEditor
          :model-value="inlineDraft"
          :kind="inlineKind"
          :collection="inlineEditCollection"
          :field="inlineEditingColumn.field"
          :related-collection="inlineEditingColumn.relatedCollection"
          :template="inlineEditingColumn.template"
          :format="inlineEditingColumn.format"
          :saving="inlineSaving"
          :child-lookup="inlineOverlayChildLookup"
          :source-record="inlineEditingRow"
          :parent-collection="parentCollection"
          :parent-id="parentId"
          :parent-name="parentName"
          :parent-record="parentRecord"
          @update:model-value="inlineDraft = $event"
          @commit="commitInlineEdit($event)"
          @cancel="cancelInlineEdit"
        />
      </div>
    </Teleport>
    <div
      v-if="loadingMoreVisible"
      class="crm-data-table__loading-more"
      role="status"
      aria-live="polite"
    >
      <ProgressSpinner
        style="width: 50px; height: 50px; color: green"
        stroke-width="8"
        fill="transparent"
        animation-duration="1.0s"
        :aria-label="t('datatable.customProgressSpinner', 'Custom ProgressSpinner')"
      />
    </div>
    <Menu
      id="overlay_menu"
      ref="actionMenu"
      :model="actionMenuItems"
      :popup="true"
    />

    <RecordCreateDialog
      v-if="createDialogCollection"
      :visible="createDialogVisible"
      :collection="createDialogCollection"
      :parent-field="createDialogParentField"
      :parent-id="createDialogParentField ? parentId : undefined"
      :parent-collection="parentCollection"
      :parent-record="parentRecord"
      @update:visible="createDialogVisible = $event"
      @created="handleRecordCreated"
    />

    <Dialog
      :visible="editDialogVisible"
      modal
      :header="t('datatable.editDialogHeader', 'Edit Record')"
      :style="{ width: 'min(960px, 95vw)' }"
      @update:visible="updateEditDialogVisible"
    >
      <div v-if="editLoading" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('datatable.loadingRecord', 'Loading record...') }}</span>
      </div>

      <Message
        v-if="editError"
        severity="error"
        :closable="false"
        class="crm-data-table__message"
      >
        {{ editError }}
      </Message>

      <FormRenderer
        v-if="editLayoutSchema && !editLoading"
        ref="editFormRendererRef"
        v-model="editDraft"
        :schema="editLayoutSchema"
        :parent-id="parentId"
        :parent-name="parentName"
        :record-id="editRecordId ?? undefined"
      />

      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          severity="secondary"
          text
          :disabled="editSaving"
          @click="updateEditDialogVisible(false)"
        />
        <Button
          :label="t('common.save', 'Save')"
          :loading="editSaving"
          :disabled="editLoading || !editLayoutSchema"
          @click="saveEditDialog"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.crm-data-table__toolbar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
  position: relative;
  z-index: 5;
}

.crm-data-table__toolbar-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  justify-content: space-between;
  min-width: 0;
  width: 100%;
}

/* Filters + search stay on one row; filters shrink, search stays fixed-width. */
.crm-data-table__toolbar-row--secondary {
  flex-wrap: nowrap;
}

.crm-data-table__toolbar-start {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.crm-data-table__toolbar-filters {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  overflow: visible;
  position: relative;
  z-index: 1;
}

.crm-data-table__toolbar-actions,
.crm-data-table__toolbar-tools {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-left: auto;
  min-width: 0;
}

.crm-data-table-wrap {
  position: relative;
}

.crm-data-table--selectable :deep(.p-datatable-tbody > tr) {
  cursor: pointer;
}

.crm-data-table__message {
  margin-bottom: 0.75rem;
}

.crm-data-table__scroll-panel {
  position: relative;
  overflow: auto;
  overscroll-behavior: contain;
  z-index: 0;
}

.crm-data-table__scroll-panel--compact {
  /* Vertical: page scrolls; horizontal: table scrolls when columns exceed width. */
  overflow-x: auto;
  overflow-y: visible;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
}

.crm-data-table__scroll-panel--compact :deep(.p-datatable-table-container) {
  overflow-x: auto !important;
  overflow-y: visible !important;
}

.crm-inline-edit-overlay {
  align-items: stretch;
  background: var(--p-surface-0, #fff);
  box-shadow: inset 0 0 0 2px var(--p-primary-color, #0f766e);
  box-sizing: border-box;
  display: flex;
  overflow: hidden;
  padding: 0;
}

.crm-inline-edit-overlay--saving {
  opacity: 0.85;
  pointer-events: none;
}

.crm-inline-edit-overlay :deep(.crm-inline-cell-editor) {
  align-items: stretch;
  display: flex;
  flex: 1 1 auto;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}

.crm-inline-edit-overlay :deep(.crm-inline-cell-editor > *) {
  border-radius: 0;
  flex: 1 1 auto;
  height: 100%;
  max-height: 100%;
  min-width: 0;
  width: 100%;
}

.crm-inline-edit-overlay :deep(.p-inputtext),
.crm-inline-edit-overlay :deep(.p-select),
.crm-inline-edit-overlay :deep(.p-datepicker),
.crm-inline-edit-overlay :deep(.p-inputnumber),
.crm-inline-edit-overlay :deep(.p-autocomplete) {
  border-color: transparent;
  border-radius: 0;
  height: 100%;
  max-height: 100%;
  width: 100%;
}

.crm-inline-edit-overlay :deep(.p-select .p-select-label),
.crm-inline-edit-overlay :deep(.p-inputnumber-input),
.crm-inline-edit-overlay :deep(.p-autocomplete-input),
.crm-inline-edit-overlay :deep(.p-datepicker-input) {
  align-items: center;
  display: flex;
  height: 100%;
}

.crm-inline-edit-overlay :deep(.p-inputnumber),
.crm-inline-edit-overlay :deep(.p-autocomplete),
.crm-inline-edit-overlay :deep(.p-datepicker) {
  align-items: stretch;
  display: flex;
}

.crm-data-table__scroll-panel--compact :deep(.p-datatable-header),
.crm-data-table__scroll-panel--compact :deep(.p-datatable-thead > tr > th) {
  position: static;
}

.crm-data-table__scroll-panel :deep(.p-datatable-header) {
  position: sticky;
  top: 0;
  z-index: 2;
}

.crm-data-table__scroll-panel :deep(.p-datatable-thead > tr > th) {
  position: sticky;
  top: 0;
  z-index: 2;
}

.crm-data-table__scroll-panel :deep(.p-datatable-row-group-header > td) {
  background: var(--p-surface-100);
  border-block: 1px solid var(--p-surface-200);
  padding-block: 0.45rem;
}

.crm-data-table__scroll-panel :deep(.p-datatable-row-group-header:first-child > td) {
  border-top: none;
}

.crm-data-table__scroll-panel :deep(.p-datatable-row-group-header .p-datatable-row-toggle-button) {
  color: var(--p-primary-color);
  margin-right: 0.35rem;
}

.crm-data-table__loading-more {
  align-items: center;
  background: rgba(255, 255, 255, 0.7);
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 4;
}
</style>
