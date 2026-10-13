<script lang="ts">
export default {
  name: 'ObjectListPage',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import CrmDataTable from '@/core/ui-kit/CrmDataTable.vue'
import CrmBarcodeScanToolbar from '@/core/ui-kit/CrmBarcodeScanToolbar.vue'
import CrmScheduler from '@/core/ui-kit/CrmScheduler.vue'
import CrmTreeTable from '@/core/ui-kit/CrmTreeTable.vue'
import ScheduleSlotGenerator from '@/core/ui-kit/ScheduleSlotGenerator.vue'
import {
  barcodeScanNeedsUpdate,
  isBarcodeScanEnabled,
  lookupRecordsByBarcode,
  mergeRawListFilters,
  normalizeBarcodeScanSettings,
  updateRecordFromBarcodeScan,
} from '@/core/barcodeScan'
import { useConfirm } from 'openvue/useconfirm'
import { SCHEDULE_TEMPLATE_COLLECTION } from '@/core/scheduleGeneration'
import DataTableFilter from '@/core/ui-kit/DataTableFilter.vue'
import ListFilterValuePanel from '@/core/ui-kit/ListFilterValuePanel.vue'
import ObjectListDetailPanel from '../components/ObjectListDetailPanel.vue'
import {
  listDetailSplitterStateKey,
  loadListDetailCollapsed,
  saveListDetailCollapsed,
} from '@/core/listDetailPanelState'
import {
  buildListFilter,
  buildListFilterMetaBlock,
  isAutoCompleteFilterComponent,
  isSelectFilterComponent,
  isUserVisibleCondition,
  resolveFilterConditionValue,
  seedRuntimeFilterValues,
  type ListFilterMetaBlock,
} from '@/core/listFilterUtils'
import { currentUserRole } from '@/core/currentUser'
import {
  fetchObjectRecordsByIds,
  fetchObjectRecords,
  type ObjectRecordList,
} from '../services/objectRecords'
import { useDataTableLazy } from '../composables/useDataTableLazy'
import type { DataTableRuntime } from '../services/dataTableRuntime'
import {
  ALL_RECORDS_FILTER_ID,
  ALL_RECORDS_FILTER,
  listFilterableFields,
  type SavedListFilter,
} from '@/modules/config/services/listFilterSettings'
import {
  loadListViewTableMeta,
  listViewToTableSettings,
  resolveListViewsForCurrentUser,
  resolvePinnedListViewId,
  resolvePredefinedViewTableSettings,
} from '@/modules/config/services/listViewSettings'
import { resolveRecordPageLayoutForCurrentUser } from '@/modules/config/services/recordPageSettings'
import { resolveRecordPageListDetailContent } from '@/modules/config/utils/recordPageRelatedList'
import { loadPinnedFilter, savePinnedFilter } from '@/modules/config/services/userSettings'
import type { SavedListView } from '@/interfaces'
import {
  buildDefaultTableSettings,
} from '../services/tableSettings'
import { loadSchedulerSettings } from '@/modules/config/services/schedulerSettings'
import { loadTreeTableSettings } from '../services/treeTableSettings'
import {
  listRecentlyViewedRecordIds,
  RECENTLY_VIEWED_FILTER,
  RECENTLY_VIEWED_FILTER_ID,
  type RecentRecordView,
} from '@/modules/dashboard/services/recentRecords'
import type {
  DataTableSettings,
  DataTableSortConfig,
  EntityAction,
  LayoutFieldMetadata,
  ListViewAction,
  ListViewDetailPanel,
  RecordPageListDetailPanel,
  SchedulerSettings,
  TreeTableSettings,
} from '@/interfaces'
import { defaultDateTimeDisplayFormat } from '@/core/dateFormatting'
import {
  useTranslation,
  useTranslatedCollection,
} from '@/core/translation'
import { useFavoriteContext } from '@/core/navigation/useFavoriteContext'
import { useEntityPermissions } from '@/core/entityPermissions'
import { recordDetailRoute } from '@/core/compactRecordRoutes'
import DocListReportDialog from '@/modules/documents/components/DocListReportDialog.vue'
import { DOC_LIST_REPORT_MAX_RECORDS } from '@/modules/documents/services/docPopulation'
import { useToast } from 'openvue/usetoast'

type ListLayout = 'table' | 'tree' | 'scheduler'

const route = useRoute()
const router = useRouter()
const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()
const collectionName = computed(() => String(route.params.collection ?? ''))
const barcodeScanBusy = ref(false)
const barcodeScanModeOn = ref(false)
const barcodeListFilter = ref<Record<string, unknown> | null>(null)
const barcodeToolbarRef = ref<InstanceType<typeof CrmBarcodeScanToolbar> | null>(null)
const barcodeToolbarRefDetail = ref<InstanceType<typeof CrmBarcodeScanToolbar> | null>(null)
const barcodeScanSettings = computed(() =>
  normalizeBarcodeScanSettings(tableSettings.value?.barcodeScan),
)
const showBarcodeScan = computed(() => isBarcodeScanEnabled(barcodeScanSettings.value))
const {
  ready: permissionsReady,
  canRead: canReadCollection,
} = useEntityPermissions(() => collectionName.value)
const collectionLabel = useTranslatedCollection(() => collectionName.value)
const routeFilterId = computed(() =>
  route.params.filter_id ? String(route.params.filter_id) : null,
)
const routeFilterName = computed(() =>
  route.params.filterName ? String(route.params.filterName) : null,
)
const selectedListFilter = ref<SavedListView | SavedListFilter | null>(null)
const tableSettings = ref<DataTableSettings | null>(null)
const treeSettings = ref<TreeTableSettings | null>(null)
const schedulerSettings = ref<SchedulerSettings | null>(null)
const listLayout = ref<ListLayout>('table')
const showArchived = ref(false)
const pinnedFilterId = ref<string | null>(null)
const slotGeneratorVisible = ref(false)
const selectedMasterRow = ref<Record<string, unknown> | null>(null)
const detailCollapsed = ref(false)
const pageListDetailPanel = ref<RecordPageListDetailPanel | null>(null)
const listDetailRelatedFields = ref<LayoutFieldMetadata[]>([])
const listDetailActions = ref<EntityAction[]>([])
const listDetailLoading = ref(false)
const listDetailLoadError = ref<string | null>(null)
const listReportVisible = ref(false)
const listReportLoading = ref(false)
const listReportTemplateId = ref('')
const listReportRecordIds = ref<string[]>([])
const listReportViewMode = ref<'html' | 'pdf'>('pdf')
const listReportFilter = ref<ListFilterMetaBlock | null>(null)
const listReportViewLabel = ref<string | null>(null)
const isScheduleTemplateCollection = computed(
  () => collectionName.value === SCHEDULE_TEMPLATE_COLLECTION,
)
const listToolbarActions = computed(
  () => tableSettings.value?.actions?.filter((action) => action.document?.templateId) ?? [],
)
const draftFilterValues = ref<Record<string, unknown>>({})
const appliedFilterValues = ref<Record<string, unknown>>({})
let filterReloadTimer: ReturnType<typeof setTimeout> | null = null
let filterReloadBusyRetries = 0

const isRecentlyViewedFilter = computed(
  () => selectedListFilter.value?.id === RECENTLY_VIEWED_FILTER_ID,
)

const { setFavoriteContext, clearFavoriteContext } = useFavoriteContext()

watchEffect(() => {
  const collection = collectionName.value
  if (!collection) return
  const filter = selectedListFilter.value
  const viewName = filter && !isRecentlyViewedFilter.value ? filter.name : null
  const label = viewName
    ? `${collectionLabel.value} · ${viewName}`
    : collectionLabel.value
  const target = viewName
    ? { kind: 'object' as const, collection, filterName: viewName }
    : { kind: 'object' as const, collection }
  setFavoriteContext({ defaultLabel: label, target })
})
onUnmounted(() => {
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  clearFavoriteContext()
})

const {
  runtime: objectList,
  loading,
  refreshing: refreshingRecords,
  error,
  pageSize,
  crmDataTableProps,
  loadMore: loadMoreRecords,
  handlePageSizeChange,
  handleSortChange,
  resetSort,
  updateRows,
  isStaleToken,
  nextLoadToken,
} = useDataTableLazy({
  settings: tableSettings,
  disableSort: isRecentlyViewedFilter,
  disableGroupBy: isRecentlyViewedFilter,
  loadErrorMessage: t('objectList.loadCollectionError', 'Failed to load collection records.'),
  loadMoreErrorMessage: t('objectList.loadMoreError', 'Failed to load more records.'),
  fetchFn: async ({ limit, offset, settings }) =>
    fetchListRecordsAsRuntime(collectionName.value, settings, { limit, offset }),
})

const isVirtualListFilter = computed(() => {
  const id = selectedListFilter.value?.id
  return id === RECENTLY_VIEWED_FILTER_ID || id === ALL_RECORDS_FILTER_ID
})

/** Query uses on-screen draft values (panel mounts after first fetch and may normalize dates). */
const effectiveFilterConditions = computed(() =>
  (selectedListFilter.value?.conditions ?? []).map((condition) => ({
    ...condition,
    value: resolveFilterConditionValue(
      draftFilterValues.value,
      condition.id,
      condition.value,
    ),
  })),
)

const visibleFilterConditions = computed(() =>
  (selectedListFilter.value?.conditions ?? []).filter(isUserVisibleCondition),
)

const showFilterValuePanel = computed(
  () => !isVirtualListFilter.value && visibleFilterConditions.value.length > 0,
)

const legacyDetailPanelConfig = computed<ListViewDetailPanel | null>(() => {
  const panel = tableSettings.value?.detailPanel
  if (!panel?.enabled) return null
  if (panel.blockLayoutId?.trim()) return panel
  if (panel.relatedCollection?.trim()) return panel
  return null
})

/** Prefer Page Layout listDetailPanel; fall back to legacy list-view detailPanel. */
const detailPanelEnabled = computed(
  () =>
    Boolean(pageListDetailPanel.value?.enabled) || legacyDetailPanelConfig.value !== null,
)

const usesPageListDetail = computed(() => Boolean(pageListDetailPanel.value?.enabled))

const isMasterDetailLayout = computed(
  () =>
    listLayout.value === 'table' &&
    detailPanelEnabled.value &&
    !detailCollapsed.value,
)

const selectedParentId = computed(() => {
  if (!selectedMasterRow.value || !objectList.value) return null
  const id = selectedMasterRow.value[objectList.value.primaryKey]
  if (id === null || id === undefined || id === '') return null
  return id as string | number
})

const masterPaneSize = computed(
  () =>
    pageListDetailPanel.value?.masterSize
    ?? legacyDetailPanelConfig.value?.masterSize
    ?? 60,
)
const detailPaneMinSize = computed(
  () =>
    pageListDetailPanel.value?.detailMinSize
    ?? legacyDetailPanelConfig.value?.detailMinSize
    ?? 15,
)
const detailPaneSize = computed(() => Math.max(100 - masterPaneSize.value, 1))
const splitterStateKey = computed(() =>
  listDetailSplitterStateKey(collectionName.value || 'unknown'),
)

const detailDefaultCollapsed = computed(
  () =>
    pageListDetailPanel.value?.defaultCollapsed === true
    || legacyDetailPanelConfig.value?.defaultCollapsed === true,
)

watch(
  collectionName,
  (collection) => {
    selectedMasterRow.value = null
    detailCollapsed.value = loadListDetailCollapsed(
      collection,
      detailDefaultCollapsed.value,
    )
  },
  { immediate: true },
)

watch(
  detailDefaultCollapsed,
  (defaultCollapsed) => {
    if (!collectionName.value) return
    detailCollapsed.value = loadListDetailCollapsed(
      collectionName.value,
      defaultCollapsed,
    )
  },
)

watch(
  () => objectList.value?.rows,
  (rows) => {
    const selected = selectedMasterRow.value
    if (!selected || !objectList.value) return
    const pk = objectList.value.primaryKey
    const selectedId = selected[pk]
    if (selectedId === null || selectedId === undefined) {
      selectedMasterRow.value = null
      return
    }
    const stillPresent = (rows ?? []).some((row) => row[pk] === selectedId)
    if (!stillPresent) {
      selectedMasterRow.value = null
    }
  },
)

function setDetailCollapsed(collapsed: boolean): void {
  detailCollapsed.value = collapsed
  saveListDetailCollapsed(collectionName.value, collapsed)
}

function toggleDetailCollapsed(): void {
  setDetailCollapsed(!detailCollapsed.value)
}

function openDetailRelatedRecord(
  row: Record<string, unknown>,
  relatedCollection: string,
): void {
  if (!objectList.value || selectedParentId.value === null) return
  const relatedId = row.id
  if (relatedId === null || relatedId === undefined || relatedId === '') return
  const childCollection = relatedCollection.trim()
  if (!childCollection) return

  void router.push({
    name: 'related-record-details',
    params: {
      collection: objectList.value.collection,
      id: String(selectedParentId.value),
      related_collection: childCollection,
      related_id: String(relatedId),
    },
  })
}

const activeListFilter = computed<Record<string, unknown> | null>(() => {
  const f = selectedListFilter.value
  if (!f) return null
  if (isVirtualListFilter.value) return null
  return buildListFilter(effectiveFilterConditions.value, f.logic)
})

watch(
  selectedListFilter,
  (filter) => {
    const seeded = filter ? seedRuntimeFilterValues(filter.conditions) : {}
    draftFilterValues.value = { ...seeded }
    appliedFilterValues.value = { ...seeded }
  },
  { immediate: true, flush: 'sync' },
)

/**
 * Reload list from current on-screen draft values.
 * Debounced so typing in string filters (Note contains, etc.) does not fetch every key.
 */
function scheduleDraftFilterReload(): void {
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  filterReloadTimer = setTimeout(() => {
    filterReloadTimer = null
    if (!collectionName.value || !objectList.value) {
      filterReloadBusyRetries = 0
      return
    }
    if (loading.value || refreshingRecords.value) {
      // Keep waiting — do not drop string/date edits that landed mid-refresh.
      if (filterReloadBusyRetries < 40) {
        filterReloadBusyRetries += 1
        scheduleDraftFilterReload()
      } else {
        filterReloadBusyRetries = 0
      }
      return
    }
    filterReloadBusyRetries = 0
    syncInteractiveFilterValues()
    void loadRecords(collectionName.value, { inPlace: true })
  }, 400)
}

// Catch all draft edits (InputText keystrokes, DatePicker, Select), not only emit paths.
watch(
  draftFilterValues,
  () => {
    if (!collectionName.value || !objectList.value) return
    if (loading.value) return
    scheduleDraftFilterReload()
  },
  { deep: true },
)

/** After rows render, filter inputs mount and may normalize values — re-query once. */
async function settleFilterPanelAfterLoad(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100)
  })
  if (!collectionName.value || !objectList.value) return
  if (loading.value || refreshingRecords.value) return
  syncInteractiveFilterValues()
  void loadRecords(collectionName.value, { inPlace: true })
}

/**
 * Empty Select/FK conditions were saved as 0 (Number(null)). Clear those before the
 * first query so Facility Equals "Select..." does not become `_eq: 0`.
 */
async function sanitizeDraftSelectValues(collection: string): Promise<void> {
  const filter = selectedListFilter.value
  if (!filter?.conditions.length) return

  try {
    const fields = await listFilterableFields(collection)
    const selectFields = new Set(
      fields
        .filter(
          (field) =>
            isSelectFilterComponent(field.component) ||
            isAutoCompleteFilterComponent(field.component),
        )
        .map((field) => field.field),
    )

    let changed = false
    const next = { ...draftFilterValues.value }
    for (const condition of filter.conditions) {
      if (!selectFields.has(condition.field)) continue
      const value = Object.prototype.hasOwnProperty.call(next, condition.id)
        ? next[condition.id]
        : condition.value
      if (value === 0 || value === '0' || value === '') {
        next[condition.id] = null
        changed = true
      }
    }
    if (!changed) return
    draftFilterValues.value = next
    appliedFilterValues.value = { ...next }
  } catch {
    // Keep seeded values if field metadata is unavailable.
  }
}

watch(
  [collectionName, routeFilterId, routeFilterName, permissionsReady, canReadCollection],
  ([collection, filterId, filterName, ready, canRead]) => {
    if (!collection || !ready) return
    if (!canRead) {
      objectList.value = null
      error.value = null
      loading.value = false
      return
    }
    void loadListPage(collection, filterId, filterName)
  },
  { immediate: true },
)

async function loadListPage(
  collection: string,
  filterId: string | null,
  filterName: string | null = null,
): Promise<void> {
  const inPlace =
    objectList.value !== null &&
    objectList.value.collection === collection &&
    tableSettings.value !== null
  const token = nextLoadToken()

  if (inPlace) {
    refreshingRecords.value = true
  } else {
    loading.value = true
    objectList.value = null
    selectedListFilter.value = null
    treeSettings.value = null
    schedulerSettings.value = null
    pageListDetailPanel.value = null
    listDetailRelatedFields.value = []
    listDetailActions.value = []
    listDetailLoadError.value = null
  }
  error.value = null
  resetSort()

  try {
    await resolveSelectedListView(collection, filterId, filterName, token)
    if (isStaleToken(token)) return

    await sanitizeDraftSelectValues(collection)
    if (isStaleToken(token)) return

    if (!inPlace) {
      treeSettings.value = await loadOptionalTreeSettings(collection)
      schedulerSettings.value = await loadOptionalSchedulerSettings(collection)
      if (isStaleToken(token)) return
      syncListLayoutWithAvailableSettings()
      await loadPageListDetail(collection)
      if (isStaleToken(token)) return
    }

    const settings =
      tableSettings.value ?? (await loadDefaultTableSettingsWithMeta(collection))
    if (isStaleToken(token)) return
    tableSettings.value = settings

    const result = await fetchListRecordsAsRuntime(
      collection,
      settings,
      {
        limit: pageSize.value,
        offset: 0,
      },
    )
    if (isStaleToken(token)) return
    objectList.value = result
  } catch (err) {
    if (isStaleToken(token)) return
    error.value =
      err instanceof Error
        ? err.message
        : t('objectList.loadCollectionError', 'Failed to load collection records.')
  } finally {
    if (!isStaleToken(token)) {
      if (inPlace) {
        refreshingRecords.value = false
      } else {
        loading.value = false
      }
      if (objectList.value) {
        void settleFilterPanelAfterLoad()
      }
    }
  }
}

async function resolveSelectedListView(
  collection: string,
  filterId: string | null,
  filterName: string | null,
  token: number,
): Promise<void> {
  const roleId = await currentUserRole()
  if (isStaleToken(token)) return

  const meta = await loadListViewTableMeta(collection, roleId)
  if (isStaleToken(token)) return

  if (filterId === ALL_RECORDS_FILTER_ID) {
    selectedListFilter.value = ALL_RECORDS_FILTER
    tableSettings.value = await resolvePredefinedViewTableSettings(
      collection,
      ALL_RECORDS_FILTER_ID,
      meta,
      roleId,
    )
    return
  }

  if (filterId === RECENTLY_VIEWED_FILTER_ID) {
    selectedListFilter.value = RECENTLY_VIEWED_FILTER
    tableSettings.value = await resolvePredefinedViewTableSettings(
      collection,
      RECENTLY_VIEWED_FILTER_ID,
      meta,
      roleId,
    )
    return
  }

  const views = await resolveListViewsForCurrentUser(collection)
  if (isStaleToken(token)) return

  if (filterId || filterName) {
    const matched = filterId
      ? views.find((view) => view.id === filterId)
      : views.find((view) => view.name === filterName)

    if (!matched) {
      throw new Error(t(
        'objectList.savedFilterMissing',
        'Saved view "{id}" was not found.',
        { id: filterId ?? filterName ?? '' },
      ))
    }

    selectedListFilter.value = matched
    tableSettings.value = listViewToTableSettings(matched, meta)
    return
  }

  const pinned = await loadPinnedFilter(collection)
  if (isStaleToken(token)) return

  const resolvedPin = await resolvePinnedListViewId(collection, pinned)
  if (resolvedPin && pinned && resolvedPin !== pinned) {
    await savePinnedFilter(collection, resolvedPin)
  }
  pinnedFilterId.value = resolvedPin

  if (resolvedPin === ALL_RECORDS_FILTER_ID) {
    selectedListFilter.value = ALL_RECORDS_FILTER
    tableSettings.value = await resolvePredefinedViewTableSettings(
      collection,
      ALL_RECORDS_FILTER_ID,
      meta,
      roleId,
    )
    void router.replace({
      name: 'object-list-filter',
      params: { collection, filter_id: ALL_RECORDS_FILTER_ID },
    })
  } else if (resolvedPin === RECENTLY_VIEWED_FILTER_ID) {
    selectedListFilter.value = RECENTLY_VIEWED_FILTER
    tableSettings.value = await resolvePredefinedViewTableSettings(
      collection,
      RECENTLY_VIEWED_FILTER_ID,
      meta,
      roleId,
    )
    void router.replace({
      name: 'object-list-filter',
      params: { collection, filter_id: RECENTLY_VIEWED_FILTER_ID },
    })
  } else if (resolvedPin) {
    const found = views.find((view) => view.id === resolvedPin)
    selectedListFilter.value = found ?? RECENTLY_VIEWED_FILTER
    tableSettings.value = found
      ? listViewToTableSettings(found, meta)
      : await resolvePredefinedViewTableSettings(
        collection,
        RECENTLY_VIEWED_FILTER_ID,
        meta,
        roleId,
      )
    if (found) {
      void router.replace({
        name: 'object-list-filter',
        params: { collection, filter_id: resolvedPin },
      })
    }
  } else {
    selectedListFilter.value = RECENTLY_VIEWED_FILTER
    tableSettings.value = await resolvePredefinedViewTableSettings(
      collection,
      RECENTLY_VIEWED_FILTER_ID,
      meta,
      roleId,
    )
  }
}

async function loadRecords(
  collection: string,
  options: { inPlace?: boolean } = {},
): Promise<void> {
  const inPlace = options.inPlace === true && objectList.value !== null
  const token = nextLoadToken()

  if (inPlace) {
    refreshingRecords.value = true
  } else {
    loading.value = true
    objectList.value = null
  }
  error.value = null
  try {
    const settings =
      tableSettings.value ?? (await loadDefaultTableSettingsWithMeta(collection))
    if (isStaleToken(token)) return
    tableSettings.value = settings

    const result = await fetchListRecordsAsRuntime(
      collection,
      settings,
      {
        limit: pageSize.value,
        offset: 0,
      },
    )
    if (isStaleToken(token)) return
    objectList.value = result
  } catch (err) {
    if (isStaleToken(token)) return
    error.value =
      err instanceof Error
        ? err.message
        : t('objectList.loadCollectionError', 'Failed to load collection records.')
  } finally {
    if (!isStaleToken(token)) {
      if (inPlace) {
        refreshingRecords.value = false
      } else {
        loading.value = false
      }
    }
  }
}

async function fetchListRecordsAsRuntime(
  collection: string,
  settings: DataTableSettings,
  options: { limit: number; offset: number },
): Promise<DataTableRuntime> {
  const list = await fetchListRecords(collection, settings, options)
  return objectRecordListToRuntime(list)
}

function objectRecordListToRuntime(list: ObjectRecordList): DataTableRuntime {
  return {
    collection: list.collection,
    label: list.label,
    columns: list.columns,
    rows: list.records,
    primaryKey: list.primaryKey,
    totalCount: list.totalCount,
  }
}

async function fetchListRecords(
  collection: string,
  settings: DataTableSettings,
  options: { limit: number; offset: number },
): Promise<ObjectRecordList> {
  if (!isRecentlyViewedFilter.value) {
    return fetchObjectRecords(
      collection,
      mergeRawListFilters(activeListFilter.value, barcodeListFilter.value),
      settings,
      {
        ...options,
        archivedOnly: showArchived.value,
      },
    )
  }

  const recent = await listRecentlyViewedRecordIds(collection, options)
  const result = await fetchObjectRecordsByIds(
    collection,
    recent.ids,
    recent.totalCount,
    settings,
  )
  const withColumns = withRecentViewColumns(result, recent.views)

  const sort = settings.sort
  if (sort?.field?.startsWith('__')) {
    return {
      ...withColumns,
      records: applyClientSort(withColumns.records, sort),
    }
  }

  return withColumns
}

function applyClientSort(
  records: Record<string, unknown>[],
  sort: DataTableSortConfig,
): Record<string, unknown>[] {
  const { field, order } = sort
  return [...records].sort((a, b) => {
    const av = a[field]
    const bv = b[field]
    let cmp: number
    if (av instanceof Date && bv instanceof Date) {
      cmp = av.getTime() - bv.getTime()
    } else if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    }
    return order === -1 ? -cmp : cmp
  })
}

function withRecentViewColumns(
  result: ObjectRecordList,
  views: RecentRecordView[],
): ObjectRecordList {
  const viewById = new Map(
    views.map((view) => [String(view.record_id), view]),
  )

  return {
    ...result,
    columns: [
      ...result.columns,
      {
        field: '__recentViewedAt',
        header: t('objectList.lastViewedAt', 'Last Viewed At'),
        format: defaultDateTimeDisplayFormat(),
      },
    ],
    records: result.records.map((record) => {
      const view = viewById.get(String(record[result.primaryKey]))
      return {
        ...record,
        __recentViewedAt: formatRecentDateTime(view?.viewed_at),
      }
    }),
  }
}

function formatRecentDateTime(value: string | undefined): Date | string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date
}

function openRecord(row: Record<string, unknown>): void {
  if (!objectList.value) return
  const id = row[objectList.value.primaryKey]
  if (id === null || id === undefined) return

  void router.push(recordDetailRoute(objectList.value.collection, String(id)))
}

function exitBarcodeScanMode(): void {
  barcodeScanModeOn.value = false
  barcodeToolbarRef.value?.exitScanMode()
  barcodeToolbarRefDetail.value?.exitScanMode()
}

function clearBarcodeListFilter(): void {
  const hadFilter = barcodeListFilter.value !== null
  barcodeListFilter.value = null
  barcodeToolbarRef.value?.markFilterActive(false)
  barcodeToolbarRefDetail.value?.markFilterActive(false)
  if (hadFilter) {
    void loadRecords(collectionName.value, { inPlace: true })
  }
}

watch(barcodeScanModeOn, (on, wasOn) => {
  if (wasOn && !on) {
    clearBarcodeListFilter()
  }
})

async function handleBarcodeScanSubmit(payload: {
  code: string
  value: string
}): Promise<void> {
  const settings = barcodeScanSettings.value
  const collection = collectionName.value
  if (!settings || !collection || barcodeScanBusy.value) return

  const run = async (): Promise<void> => {
    barcodeScanBusy.value = true
    try {
      const lookup = await lookupRecordsByBarcode({
        collection,
        field: settings.field,
        code: payload.code,
        fields: ['id', settings.field],
        limit: 25,
      })

      if (lookup.totalCount === 0 || lookup.records.length === 0) {
        toast.add({
          severity: 'warn',
          summary: t('barcodeScan.notFoundTitle', 'Not found'),
          detail: t(
            'barcodeScan.notFound',
            'No record found for “{code}”.',
            { code: payload.code },
          ),
          life: 5000,
        })
        return
      }

      const unique = lookup.totalCount === 1 ? lookup.records[0] : null
      if (unique && barcodeScanNeedsUpdate(settings, payload.value)) {
        const id = unique.id
        if (
          (typeof id === 'string' || typeof id === 'number') &&
          id !== ''
        ) {
          await updateRecordFromBarcodeScan({
            collection,
            id,
            settings,
            scanCode: payload.code,
            updateValue: payload.value,
            record: unique,
          })
          toast.add({
            severity: 'success',
            summary: t('common.saved', 'Saved'),
            detail: t('barcodeScan.updated', 'Record updated.'),
            life: 3000,
          })
        }
      }

      const mode = settings.matchMode ?? 'open-or-filter'
      if (unique && (mode === 'open' || mode === 'open-or-filter')) {
        exitBarcodeScanMode()
        openRecord(unique)
        return
      }

      if (lookup.totalCount > 1) {
        toast.add({
          severity: 'info',
          summary: t('barcodeScan.multipleTitle', 'Multiple matches'),
          detail: t(
            'barcodeScan.multipleFound',
            'Multiple records match “{code}”. Showing filtered list.',
            { code: payload.code },
          ),
          life: 5000,
        })
      }

      if (mode === 'filter' || mode === 'open-or-filter' || lookup.totalCount > 1) {
        barcodeListFilter.value = lookup.filter
        barcodeToolbarRef.value?.markFilterActive(true)
        barcodeToolbarRefDetail.value?.markFilterActive(true)
        await loadRecords(collection, { inPlace: true })
      }
    } catch (err) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail:
          err instanceof Error
            ? err.message
            : t('barcodeScan.lookupError', 'Barcode lookup failed.'),
        life: 6000,
      })
    } finally {
      barcodeScanBusy.value = false
    }
  }

  if (
    settings.confirmUpdate &&
    barcodeScanNeedsUpdate(settings, payload.value)
  ) {
    confirm.require({
      message: t(
        'barcodeScan.confirmUpdateMessage',
        'Update the matching record for “{code}”?',
        { code: payload.code },
      ),
      header: t('barcodeScan.confirmUpdateHeader', 'Confirm barcode update'),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        void run()
      },
    })
    return
  }

  await run()
}

function openTreeRecord(row: Record<string, unknown>): void {
  const settings = treeSettings.value
  if (!settings) return

  const id = row[settings.main.primaryKey]
  if (id === null || id === undefined) return

  void router.push(
    recordDetailRoute(
      settings.main.collection || collectionName.value,
      String(id),
    ),
  )
}

function handleViewSelected(view: SavedListView | SavedListFilter | null): void {
  selectedListFilter.value = view
  barcodeListFilter.value = null
  barcodeToolbarRef.value?.markFilterActive(false)
  barcodeToolbarRefDetail.value?.markFilterActive(false)
  if (!collectionName.value) return

  void (async () => {
    const roleId = await currentUserRole()

    if (view && isSavedListView(view)) {
      const meta = await loadListViewTableMeta(collectionName.value, roleId)
      tableSettings.value = listViewToTableSettings(view, meta)
    } else if (
      view?.id === ALL_RECORDS_FILTER_ID ||
      view?.id === RECENTLY_VIEWED_FILTER_ID
    ) {
      tableSettings.value = await resolvePredefinedViewTableSettings(
        collectionName.value,
        view.id,
        undefined,
        roleId,
      )
    } else if (!view) {
      tableSettings.value = await resolvePredefinedViewTableSettings(
        collectionName.value,
        ALL_RECORDS_FILTER_ID,
        undefined,
        roleId,
      )
    }

    const effectiveId = view?.id ?? ALL_RECORDS_FILTER_ID
    const currentId = routeFilterId.value ?? (routeFilterName.value ? null : ALL_RECORDS_FILTER_ID)

    if (effectiveId === currentId) {
      void loadRecords(collectionName.value, { inPlace: true })
      return
    }

    void router.push({
      name: 'object-list-filter',
      params: {
        collection: collectionName.value,
        filter_id: effectiveId,
      },
    })
  })()
}

function isSavedListView(
  view: SavedListView | SavedListFilter,
): view is SavedListView {
  return Array.isArray((view as SavedListView).columns)
}

async function handlePinFilter(filterId: string | null): Promise<void> {
  await savePinnedFilter(collectionName.value, filterId)
  pinnedFilterId.value = filterId
}

function handleRefreshFilterValues(): void {
  if (!collectionName.value) return

  syncInteractiveFilterValues()
  void loadRecords(collectionName.value, { inPlace: true })
}

function toggleShowArchived(): void {
  showArchived.value = !showArchived.value
  if (!collectionName.value) return
  void loadRecords(collectionName.value, { inPlace: true })
}

/** Push interactive filter panel values into the query used by list + DocEngine report. */
function syncInteractiveFilterValues(): void {
  const filter = selectedListFilter.value
  if (!filter || isVirtualListFilter.value) return

  appliedFilterValues.value = Object.fromEntries(
    filter.conditions.map((condition) => [
      condition.id,
      resolveFilterConditionValue(
        draftFilterValues.value,
        condition.id,
        condition.value,
      ),
    ]),
  )
}

/**
 * Same filter the object list uses after Refresh: saved conditions + interactive panel values.
 */
function resolveListReportConditions() {
  syncInteractiveFilterValues()

  const filter = selectedListFilter.value
  if (!filter || isVirtualListFilter.value) return null

  return filter.conditions.map((condition) => ({
    ...condition,
    value: resolveFilterConditionValue(
      appliedFilterValues.value,
      condition.id,
      condition.value,
    ),
  }))
}

function resolveListReportFilter(): Record<string, unknown> | null {
  const filter = selectedListFilter.value
  const conditions = resolveListReportConditions()
  if (!filter || !conditions) return null
  return buildListFilter(conditions, filter.logic)
}

async function resolveListActionRecordIds(action: ListViewAction): Promise<string[]> {
  const pk = objectList.value?.primaryKey ?? 'id'
  if (action.recordScope === 'visible') {
    // Visible rows already reflect the last loaded (applied) filter.
    syncInteractiveFilterValues()
    return (objectList.value?.rows ?? [])
      .map((row) => row[pk])
      .filter((id) => id !== null && id !== undefined && id !== '')
      .map(String)
  }

  if (isRecentlyViewedFilter.value) {
    const recent = await listRecentlyViewedRecordIds(collectionName.value, {
      limit: DOC_LIST_REPORT_MAX_RECORDS,
      offset: 0,
    })
    return recent.ids.map(String)
  }

  const listFilter = resolveListReportFilter()
  const list = await fetchObjectRecords(
    collectionName.value,
    listFilter,
    tableSettings.value,
    {
      limit: DOC_LIST_REPORT_MAX_RECORDS,
      offset: 0,
      archivedOnly: showArchived.value,
    },
  )
  return list.records
    .map((row) => row[list.primaryKey])
    .filter((id) => id !== null && id !== undefined && id !== '')
    .map(String)
}

async function runListDocumentAction(action: ListViewAction): Promise<void> {
  const templateId = action.document.templateId?.trim()
  if (!templateId || !collectionName.value || listReportLoading.value) return

  listReportLoading.value = true
  try {
    const ids = await resolveListActionRecordIds(action)
    if (ids.length === 0) {
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail: t('documents.listReportNoRecords', 'No records to include in the report.'),
        life: 4000,
      })
      return
    }

    listReportTemplateId.value = templateId
    listReportRecordIds.value = ids
    listReportViewMode.value = action.document.viewMode === 'html' ? 'html' : 'pdf'
    const reportConditions = resolveListReportConditions()
    listReportFilter.value = reportConditions?.length
      ? await buildListFilterMetaBlock(collectionName.value, reportConditions)
      : {}
    listReportViewLabel.value = action.label
    listReportVisible.value = true
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.listReportError', 'Failed to generate list report.'),
      life: 6000,
    })
  } finally {
    listReportLoading.value = false
  }
}

async function loadPageListDetail(collection: string): Promise<void> {
  listDetailLoading.value = true
  listDetailLoadError.value = null
  try {
    const pageLayout = await resolveRecordPageLayoutForCurrentUser(collection)
    const panel = pageLayout?.listDetailPanel ?? null
    if (panel?.enabled) {
      pageListDetailPanel.value = panel
      const content = await resolveRecordPageListDetailContent(collection, pageLayout)
      listDetailRelatedFields.value = content.fields
      listDetailActions.value = content.actions
    } else {
      pageListDetailPanel.value = null
      listDetailRelatedFields.value = []
      listDetailActions.value = []
    }
  } catch (err) {
    pageListDetailPanel.value = null
    listDetailRelatedFields.value = []
    listDetailActions.value = []
    listDetailLoadError.value =
      err instanceof Error
        ? err.message
        : t('objectList.detailLoadLayoutError', 'Failed to load Page Layout related lists.')
  } finally {
    listDetailLoading.value = false
  }
}

async function loadDefaultTableSettingsWithMeta(
  collection: string,
  meta?: Awaited<ReturnType<typeof loadListViewTableMeta>>,
): Promise<DataTableSettings> {
  const resolvedMeta = meta ?? await loadListViewTableMeta(collection)
  const defaults = await buildDefaultTableSettings(collection)
  return {
    ...defaults,
    relatedTransfer: resolvedMeta.relatedTransfer ?? null,
    detailPanel: resolvedMeta.detailPanel ?? null,
    actions: resolvedMeta.actions ?? null,
    barcodeScan: resolvedMeta.barcodeScan ?? null,
    ...(resolvedMeta.inlineEditRefresh === 'row' ||
    resolvedMeta.inlineEditRefresh === 'fields'
      ? { inlineEditRefresh: resolvedMeta.inlineEditRefresh }
      : {}),
    ...(resolvedMeta.inlineEditRefresh === 'fields' &&
    Array.isArray(resolvedMeta.inlineEditRefreshFields) &&
    resolvedMeta.inlineEditRefreshFields.length
      ? { inlineEditRefreshFields: resolvedMeta.inlineEditRefreshFields }
      : {}),
  }
}

async function loadOptionalTreeSettings(
  collection: string,
): Promise<TreeTableSettings | null> {
  try {
    return await loadTreeTableSettings(collection)
  } catch {
    return null
  }
}

async function loadOptionalSchedulerSettings(
  collection: string,
): Promise<SchedulerSettings | null> {
  try {
    return await loadSchedulerSettings(collection)
  } catch {
    return null
  }
}

function syncListLayoutWithAvailableSettings(): void {
  if (listLayout.value === 'tree' && !treeSettings.value) {
    listLayout.value = 'table'
  }
  if (listLayout.value === 'scheduler' && !schedulerSettings.value) {
    listLayout.value = 'table'
  }
}
</script>

<template>
  <main
    class="app-shell"
    :class="{ 'app-shell--master-detail': isMasterDetailLayout }"
  >
    <header class="app-header" :class="{ 'app-header--master-detail': isMasterDetailLayout }">
      <div class="app-header__row">
        <div class="flex-1 min-w-0">
          <RouterLink to="/" class="nav-link">
            {{ t('common.allCollections', 'All collections') }}
          </RouterLink>
          <div class="flex flex-wrap items-center gap-4 w-full">
            <h1 class="m-0">{{ objectList?.label ?? collectionLabel }}</h1>
            <div class="flex items-center gap-2 ml-auto">
              <Button
                :label="t('objectList.table', 'Table')"
                size="small"
                :severity="listLayout === 'table' ? undefined : 'secondary'"
                :outlined="listLayout !== 'table'"
                @click="listLayout = 'table'"
              />
              <Button
                v-if="treeSettings"
                :label="t('objectList.tree', 'Tree')"
                size="small"
                :severity="listLayout === 'tree' ? undefined : 'secondary'"
                :outlined="listLayout !== 'tree'"
                @click="listLayout = 'tree'"
              />
              <Button
                v-if="schedulerSettings"
                :label="t('scheduler.scheduler', 'Scheduler')"
                size="small"
                :severity="listLayout === 'scheduler' ? undefined : 'secondary'"
                :outlined="listLayout !== 'scheduler'"
                @click="listLayout = 'scheduler'"
              />
            </div>
          </div>
        </div>
        <RouterLink
          :to="{
            name: 'setup-collection',
            params: { collection: collectionName },
            query: { layoutType: 'table' },
          }"
          class="nav-link"
        >
          {{ t('setup.title', 'Setup') }}
        </RouterLink>
      </div>
    </header>

    <section
      class="workspace-pane min-h-0"
      :class="
        isMasterDetailLayout
          ? 'workspace-pane--master-detail overflow-hidden'
          : 'overflow-visible'
      "
    >      <div v-if="!permissionsReady" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('permissions.checkingAccess', 'Checking access...') }}</span>
      </div>

      <Message
        v-else-if="!canReadCollection"
        severity="warn"
        :closable="false"
        class="collections-message"
      >
        {{
          t(
            'permissions.noReadAccess',
            'You do not have permission to view {collection}.',
            { collection: collectionLabel || collectionName },
          )
        }}
      </Message>

      <div v-else-if="loading && !objectList" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('objectList.loadingRecords', 'Loading records...') }}</span>
      </div>

      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
        class="collections-message"
      >
        {{ error }}
      </Message>

      <template v-else-if="objectList">
        <div
          v-if="listLayout === 'table' && detailPanelEnabled && !detailCollapsed"
          class="object-list-master-detail"
        >
          <Splitter
            layout="vertical"
            :state-key="splitterStateKey"
            state-storage="local"
            class="object-list-master-detail__splitter"
          >
            <SplitterPanel
              :size="masterPaneSize"
              :min-size="25"
              class="object-list-master-detail__master"
            >
              <CrmDataTable
                v-bind="crmDataTableProps"
                v-model:selection="selectedMasterRow"
                selection-mode="single"
                :record-link-field="tableSettings?.recordLinkField ?? null"
                :inline-edit-refresh="tableSettings?.inlineEditRefresh ?? 'off'"
                :inline-edit-refresh-fields="tableSettings?.inlineEditRefreshFields ?? []"
                :collection="objectList.collection"
                :primary-key="objectList.primaryKey"
                :empty-message="t('objectList.noRecords', 'No records found in this collection.')"
                :show-new-button="!showArchived"
                show-delete-button
                :loading="refreshingRecords"
                @view-record="openRecord"
                @update:rows="updateRows"
                @page-size-change="handlePageSizeChange"
                @load-more="loadMoreRecords"
                @sort-change="handleSortChange"
                @record-restored="handleRefreshFilterValues"
              >
                <template #toolbar>
                  <div class="flex flex-wrap items-end gap-3 w-full min-w-0">
                    <DataTableFilter
                      class="flex-shrink-0"
                      :collection="collectionName"
                      :selected-filter-id="selectedListFilter?.id"
                      :pinned-filter-id="pinnedFilterId"
                      :show-builder="false"
                      @view-selected="handleViewSelected"
                      @pin-filter="handlePinFilter"
                    />
                    <ListFilterValuePanel
                      v-if="showFilterValuePanel"
                      v-model="draftFilterValues"
                      class="flex-1 min-w-0"
                      :collection="collectionName"
                      :conditions="visibleFilterConditions"
                      @values-change="scheduleDraftFilterReload"
                    />
                    <CrmBarcodeScanToolbar
                      v-if="showBarcodeScan"
                      ref="barcodeToolbarRefDetail"
                      v-model:scan-mode="barcodeScanModeOn"
                      hide-toggle
                      class="w-full basis-full"
                      :settings="barcodeScanSettings"
                      :busy="barcodeScanBusy"
                      @submit="handleBarcodeScanSubmit"
                      @clear-filter="clearBarcodeListFilter"
                    />
                  </div>
                </template>
                <template #toolbar-actions>
                  <CrmBarcodeScanToolbar
                    v-if="showBarcodeScan"
                    v-model:scan-mode="barcodeScanModeOn"
                    toggle-only
                    :settings="barcodeScanSettings"
                    :busy="barcodeScanBusy"
                  />
                  <Button
                    v-for="action in listToolbarActions"
                    :key="action.id"
                    :label="action.label"
                    icon="pi pi-file"
                    size="small"
                    severity="secondary"
                    :loading="listReportLoading"
                    @click="runListDocumentAction(action)"
                  />
                  <Button
                    v-if="isScheduleTemplateCollection"
                    :label="t('schedule.generate', 'Generate slots')"
                    icon="pi pi-calendar-plus"
                    size="small"
                    severity="secondary"
                    @click="slotGeneratorVisible = true"
                  />
                  <Button
                    :label="
                      showArchived
                        ? t('objectList.hideArchived', 'Hide archived')
                        : t('objectList.showArchived', 'Show archived')
                    "
                    :icon="showArchived ? 'pi pi-inbox' : 'pi pi-folder-open'"
                    size="small"
                    severity="secondary"
                    :outlined="!showArchived"
                    @click="toggleShowArchived"
                  />
                  <Button
                    :label="t('objectList.hideDetail', 'Hide detail')"
                    icon="pi pi-chevron-down"
                    size="small"
                    severity="secondary"
                    outlined
                    @click="toggleDetailCollapsed"
                  />
                  <Button
                    :label="t('common.refresh', 'Refresh')"
                    icon="pi pi-refresh"
                    size="small"
                    :loading="refreshingRecords"
                    @click="handleRefreshFilterValues"
                  />
                </template>
              </CrmDataTable>
            </SplitterPanel>

            <SplitterPanel
              :size="detailPaneSize"
              :min-size="detailPaneMinSize"
              class="object-list-master-detail__detail"
            >
              <ObjectListDetailPanel
                v-if="detailPanelEnabled"
                :collection="collectionName"
                :related-fields="usesPageListDetail ? listDetailRelatedFields : undefined"
                :detail-actions="usesPageListDetail ? listDetailActions : undefined"
                :detail-panel="usesPageListDetail ? null : legacyDetailPanelConfig"
                :loading="usesPageListDetail ? listDetailLoading : undefined"
                :load-error="usesPageListDetail ? listDetailLoadError : undefined"
                :parent-id="selectedParentId"
                :parent-record="selectedMasterRow"
                @view-record="openDetailRelatedRecord"
              />
            </SplitterPanel>
          </Splitter>
        </div>

        <CrmDataTable
          v-else-if="listLayout === 'table'"
          v-bind="crmDataTableProps"
          v-model:selection="selectedMasterRow"
          :selection-mode="detailPanelEnabled ? 'single' : null"
          :record-link-field="tableSettings?.recordLinkField ?? null"
          :inline-edit-refresh="tableSettings?.inlineEditRefresh ?? 'off'"
          :inline-edit-refresh-fields="tableSettings?.inlineEditRefreshFields ?? []"
          :collection="objectList.collection"
          :primary-key="objectList.primaryKey"
          :empty-message="t('objectList.noRecords', 'No records found in this collection.')"
          :show-new-button="!showArchived"
          show-delete-button
          :loading="refreshingRecords"
          @view-record="openRecord"
          @update:rows="updateRows"
          @page-size-change="handlePageSizeChange"
          @load-more="loadMoreRecords"
          @sort-change="handleSortChange"
          @record-restored="handleRefreshFilterValues"
        >
          <template #toolbar>
            <div class="flex flex-wrap items-end gap-3 w-full min-w-0">
              <DataTableFilter
                class="flex-shrink-0"
                :collection="collectionName"
                :selected-filter-id="selectedListFilter?.id"
                :pinned-filter-id="pinnedFilterId"
                :show-builder="false"
                @view-selected="handleViewSelected"
                @pin-filter="handlePinFilter"
              />
              <ListFilterValuePanel
                v-if="showFilterValuePanel"
                v-model="draftFilterValues"
                class="flex-1 min-w-0"
                :collection="collectionName"
                :conditions="visibleFilterConditions"
                @values-change="scheduleDraftFilterReload"
              />
              <CrmBarcodeScanToolbar
                v-if="showBarcodeScan"
                ref="barcodeToolbarRef"
                v-model:scan-mode="barcodeScanModeOn"
                hide-toggle
                class="w-full basis-full"
                :settings="barcodeScanSettings"
                :busy="barcodeScanBusy"
                @submit="handleBarcodeScanSubmit"
                @clear-filter="clearBarcodeListFilter"
              />
            </div>
          </template>
          <template #toolbar-actions>
            <CrmBarcodeScanToolbar
              v-if="showBarcodeScan"
              v-model:scan-mode="barcodeScanModeOn"
              toggle-only
              :settings="barcodeScanSettings"
              :busy="barcodeScanBusy"
            />
            <Button
              v-for="action in listToolbarActions"
              :key="action.id"
              :label="action.label"
              icon="pi pi-file"
              size="small"
              severity="secondary"
              :loading="listReportLoading"
              @click="runListDocumentAction(action)"
            />
            <Button
              v-if="isScheduleTemplateCollection"
              :label="t('schedule.generate', 'Generate slots')"
              icon="pi pi-calendar-plus"
              size="small"
              severity="secondary"
              @click="slotGeneratorVisible = true"
            />
            <Button
              :label="
                showArchived
                  ? t('objectList.hideArchived', 'Hide archived')
                  : t('objectList.showArchived', 'Show archived')
              "
              :icon="showArchived ? 'pi pi-inbox' : 'pi pi-folder-open'"
              size="small"
              severity="secondary"
              :outlined="!showArchived"
              @click="toggleShowArchived"
            />
            <Button
              v-if="detailPanelEnabled"
              :label="t('objectList.showDetail', 'Show detail')"
              icon="pi pi-chevron-up"
              size="small"
              severity="secondary"
              outlined
              @click="toggleDetailCollapsed"
            />
            <Button
              :label="t('common.refresh', 'Refresh')"
              icon="pi pi-refresh"
              size="small"
              :loading="refreshingRecords"
              @click="handleRefreshFilterValues"
            />
          </template>
        </CrmDataTable>
        <CrmTreeTable
          v-else-if="listLayout === 'tree' && treeSettings"
          :settings="treeSettings"
          :filter="activeListFilter"
          mode="browse"
          @item-selected="openTreeRecord"
        />
        <CrmScheduler
          v-else-if="listLayout === 'scheduler' && schedulerSettings"
          :settings="schedulerSettings"
        />
        <Message
          v-else
          severity="warn"
          :closable="false"
          class="collections-message"
        >
          {{ listLayout === 'scheduler'
            ? t('objectList.schedulerNotConfigured', 'Scheduler layout is not configured for this collection. Open Setup and save Scheduler settings first.')
            : t('objectList.treeNotConfigured', 'Tree layout is not configured for this collection. Open Setup and save Tree settings first.')
          }}
        </Message>
        <p
          v-if="listLayout === 'table' && !isMasterDetailLayout && objectList.rows.length === 0"
          class="form-empty"
        >
          {{ t('objectList.noRecords', 'No records found in this collection.') }}
        </p>
      </template>
    </section>

    <ScheduleSlotGenerator
      v-if="isScheduleTemplateCollection"
      v-model:visible="slotGeneratorVisible"
    />

    <DocListReportDialog
      v-model:visible="listReportVisible"
      :collection="collectionName"
      :record-ids="listReportRecordIds"
      :template-id="listReportTemplateId"
      :view-mode="listReportViewMode"
      :filter="listReportFilter"
      :view-label="listReportViewLabel"
    />
  </main>
</template>

<style scoped>
.app-shell--master-detail {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 100%;
  max-height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

.app-header--master-detail {
  flex: 0 0 auto;
}

.workspace-pane--master-detail {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.object-list-master-detail {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.object-list-master-detail__splitter {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: none;
  background: transparent;
}

.object-list-master-detail__splitter :deep(.p-splitter) {
  height: 100%;
}

.object-list-master-detail__splitter :deep(.p-splitter-panel) {
  overflow: hidden;
}

.object-list-master-detail__master,
.object-list-master-detail__detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.object-list-master-detail__master :deep(.crm-data-table-wrap) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.object-list-master-detail__master :deep(.crm-data-table__toolbar) {
  flex: 0 0 auto;
}

.object-list-master-detail__master :deep(.crm-data-table__scroll-panel) {
  flex: 1 1 auto;
  min-height: 0;
}

.object-list-master-detail__detail :deep(.object-list-detail-panel) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
</style>

