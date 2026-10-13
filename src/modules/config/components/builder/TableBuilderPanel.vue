<script lang="ts">

export default {

  name: 'TableBuilderPanel',

}

</script>



<script setup lang="ts">

import { onMounted, ref, watch, computed } from 'vue'

import RoleScopedLayoutSelector from './RoleScopedLayoutSelector.vue'

import DataTableFilter from '@/core/ui-kit/DataTableFilter.vue'

import DataTableSettingsDesigner from '../DataTableSettingsDesigner.vue'

import { useTranslation } from '@/core/translation'

import { loadAppRoles, pickUnusedRoleId } from '@/core/settingRoleUtils'

import type { DataTableSettings, AppRoleOption, SavedListView } from '@/interfaces'
import { isPredefinedListViewId } from '@/interfaces/listViews'

import type { SavedListFilter } from '@/modules/config/services/listFilterSettings'

import {

  ALL_RECORDS_FILTER_ID,

} from '@/modules/config/services/listFilterSettings'

import {
  RECENTLY_VIEWED_FILTER_ID,
  loadListViews,
  loadListViewTableMeta,
  resolvePredefinedViewTableSettings,
  saveListViewTableMeta,
  savePredefinedViewTableSettings,
} from '@/modules/config/services/listViewSettings'

import { buildDefaultTableSettings } from '@/modules/entities/services/tableSettings'
import { normalizeBarcodeScanSettings } from '@/core/barcodeScan'



const props = withDefaults(
  defineProps<{
    collection: string
    initialViewId?: string | null
    createNew?: boolean
    setupMode?: boolean
  }>(),
  {
    initialViewId: null,
    createNew: false,
    setupMode: false,
  },
)



const emit = defineEmits<{

  status: [message: string | null]

  error: [message: string | null]

}>()



const { t } = useTranslation()



const tableSettings = ref<DataTableSettings>({ columns: [], sort: null, groupBy: null })

const tableLoading = ref(false)

const layoutRoleId = ref<string | null>(null)

const roleOptions = ref<AppRoleOption[]>([])

/** Current list view filter conditions for `$payload.meta.filter` sample. */
const activeListViewConditions = ref<SavedListFilter['conditions'] | null>(null)

const lockedPredefinedViewId = computed(() => {
  const viewId = props.initialViewId
  return viewId && isPredefinedListViewId(viewId) ? viewId : null
})

const activeViewId = computed(() => {
  if (props.createNew) return null
  return props.initialViewId ?? ALL_RECORDS_FILTER_ID
})

const showRecentlyViewedHint = computed(
  () => activeViewId.value === RECENTLY_VIEWED_FILTER_ID,
)



let tableLoadToken = 0



onMounted(async () => {

  roleOptions.value = await loadAppRoles()

})



async function loadCollectionTableMeta(
  collection: string,
  roleId: string | null = layoutRoleId.value,
): Promise<
  Pick<
    DataTableSettings,
    | 'relatedTransfer'
    | 'detailPanel'
    | 'actions'
    | 'inlineEditRefresh'
    | 'inlineEditRefreshFields'
    | 'barcodeScan'
  >
> {
  const meta = await loadListViewTableMeta(collection, roleId)
  return {
    // Batch Insert is configured on Block / entity DataTable fields only.
    relatedTransfer: null,
    detailPanel: meta.detailPanel ?? null,
    actions: meta.actions ?? null,
    barcodeScan: meta.barcodeScan ?? null,
    ...(meta.inlineEditRefresh === 'row' || meta.inlineEditRefresh === 'fields'
      ? { inlineEditRefresh: meta.inlineEditRefresh }
      : {}),
    ...(meta.inlineEditRefresh === 'fields' &&
    Array.isArray(meta.inlineEditRefreshFields) &&
    meta.inlineEditRefreshFields.length
      ? { inlineEditRefreshFields: meta.inlineEditRefreshFields }
      : {}),
  }
}

async function reloadTableSettings(collection: string): Promise<void> {
  const viewId = activeViewId.value
  if (!viewId || !isPredefinedListViewId(viewId)) return

  const token = ++tableLoadToken
  tableLoading.value = true
  emit('status', null)
  emit('error', null)

  try {
    const resolved = await resolvePredefinedViewTableSettings(
      collection,
      viewId,
      undefined,
      layoutRoleId.value,
    )
    if (token !== tableLoadToken) return
    tableSettings.value = {
      ...resolved,
      relatedTransfer: null,
    }
  } catch (err) {
    if (token !== tableLoadToken) return

    emit(
      'error',
      err instanceof Error
        ? err.message
        : t('builder.loadTableSettingsError', 'Failed to load table settings.'),
    )
  } finally {
    if (token === tableLoadToken) {
      tableLoading.value = false
    }
  }
}

async function resetTableSettingsForCollection(collection: string): Promise<void> {
  const [defaults, meta] = await Promise.all([
    buildDefaultTableSettings(collection),
    loadCollectionTableMeta(collection),
  ])

  tableSettings.value = {
    ...defaults,
    relatedTransfer: meta.relatedTransfer,
    detailPanel: meta.detailPanel,
    actions: meta.actions,
    inlineEditRefresh: meta.inlineEditRefresh,
    inlineEditRefreshFields: meta.inlineEditRefreshFields,
    barcodeScan: meta.barcodeScan,
  }
}

function isSavedListView(
  view: SavedListView | SavedListFilter,
): view is SavedListView {
  return Array.isArray((view as SavedListView).columns)
}

function handleFilterConditions(conditions: SavedListFilter['conditions']): void {
  activeListViewConditions.value = conditions?.length
    ? conditions.map((condition) => ({ ...condition }))
    : null
}

async function handleViewSelected(view: SavedListView | SavedListFilter | null): Promise<void> {
  handleFilterConditions(view?.conditions ?? [])
  const meta = await loadCollectionTableMeta(props.collection)

  if (view && isSavedListView(view)) {
    tableSettings.value = {
      ...tableSettings.value,
      columns: view.columns,
      sort: view.sort ?? null,
      groupBy: view.groupBy ?? null,
      recordLinkField: view.recordLinkField ?? null,
      relatedTransfer: meta.relatedTransfer,
      detailPanel: meta.detailPanel,
      actions: meta.actions,
      inlineEditRefresh: meta.inlineEditRefresh,
      inlineEditRefreshFields: meta.inlineEditRefreshFields,
      barcodeScan: meta.barcodeScan,
    }
    return
  }

  if (
    view?.id === ALL_RECORDS_FILTER_ID ||
    view?.id === RECENTLY_VIEWED_FILTER_ID
  ) {
    const resolved = await resolvePredefinedViewTableSettings(
      props.collection,
      view.id,
      undefined,
      layoutRoleId.value,
    )
    tableSettings.value = {
      ...resolved,
      relatedTransfer: null,
    }
    return
  }

  await resetTableSettingsForCollection(props.collection)
}



async function handleViewSaved(): Promise<void> {

  emit('status', null)

  emit('error', null)

  try {

    const viewId = activeViewId.value
    if (
      props.setupMode &&
      viewId !== null &&
      isPredefinedListViewId(viewId) &&
      tableSettings.value.columns.length > 0
    ) {
      await savePredefinedViewTableSettings(
        props.collection,
        viewId,
        {
          columns: tableSettings.value.columns,
          sort: tableSettings.value.sort ?? null,
          groupBy: tableSettings.value.groupBy ?? null,
          recordLinkField: tableSettings.value.recordLinkField ?? null,
        },
        layoutRoleId.value,
      )
    }

    const barcodeScan = normalizeBarcodeScanSettings(tableSettings.value.barcodeScan)

    await saveListViewTableMeta(props.collection, {

      // Clear any legacy list-level Batch Insert; keep it on Block layout only.
      relatedTransfer: null,

      detailPanel: tableSettings.value.detailPanel ?? null,

      actions: tableSettings.value.actions ?? null,

      inlineEditRefresh: tableSettings.value.inlineEditRefresh ?? 'off',

      inlineEditRefreshFields: tableSettings.value.inlineEditRefreshFields ?? [],

      barcodeScan,

    }, layoutRoleId.value)

    // Barcode scan is collection-wide UX — also keep it on default meta so all roles see it.
    if (layoutRoleId.value !== null) {
      const defaultMeta = await loadListViewTableMeta(props.collection, null)
      await saveListViewTableMeta(
        props.collection,
        {
          ...defaultMeta,
          barcodeScan,
        },
        null,
      )
    }

    emit('status', t('builder.tableSettingsSaved', 'Table settings saved to Setting.'))

  } catch (err) {

    emit(

      'error',

      err instanceof Error

        ? err.message

        : t('builder.saveTableSettingsError', 'Failed to save table settings.'),

    )

  }

}



watch(
  () => [props.collection, props.initialViewId, props.createNew] as const,
  async ([collection, viewId, createNew]) => {
    if (!collection) return

    if (createNew) {
      tableLoadToken++
      const token = tableLoadToken
      tableLoading.value = true
      emit('status', null)
      emit('error', null)

      try {
        const [defaults, views, meta] = await Promise.all([
          buildDefaultTableSettings(collection),
          props.setupMode ? loadListViews(collection) : Promise.resolve([]),
          loadCollectionTableMeta(collection),
        ])
        if (token !== tableLoadToken) return

        tableSettings.value = {
          ...defaults,
          relatedTransfer: meta.relatedTransfer,
          detailPanel: meta.detailPanel,
          actions: meta.actions,
          inlineEditRefresh: meta.inlineEditRefresh,
          inlineEditRefreshFields: meta.inlineEditRefreshFields,
          barcodeScan: meta.barcodeScan,
        }

        if (props.setupMode) {
          layoutRoleId.value = pickUnusedRoleId(
            views.map((view) => ({
              id: view.id,
              name: view.name,
              roleId: view.roleId ?? null,
              roleName: view.roleName ?? null,
            })),
            roleOptions.value,
          )
        }
      } catch (err) {
        if (token !== tableLoadToken) return
        emit(
          'error',
          err instanceof Error
            ? err.message
            : t('builder.loadTableSettingsError', 'Failed to load table settings.'),
        )
      } finally {
        if (token === tableLoadToken) {
          tableLoading.value = false
        }
      }
      return
    }

    if (viewId && isPredefinedListViewId(viewId)) {
      await reloadTableSettings(collection)
      return
    }

    // Named saved views: DataTableFilter emits view-selected with columns.
    // Preload collection meta (actions / detailPanel) before view-selected emission.
    if (viewId || props.setupMode) {
      const token = ++tableLoadToken
      tableLoading.value = true
      try {
        const meta = await loadCollectionTableMeta(collection)
        if (token !== tableLoadToken) return
        tableSettings.value = {
          ...tableSettings.value,
          relatedTransfer: meta.relatedTransfer,
          detailPanel: meta.detailPanel,
          actions: meta.actions,
          inlineEditRefresh: meta.inlineEditRefresh,
          inlineEditRefreshFields: meta.inlineEditRefreshFields,
          barcodeScan: meta.barcodeScan,
        }
      } catch (err) {
        if (token !== tableLoadToken) return
        emit(
          'error',
          err instanceof Error
            ? err.message
            : t('builder.loadTableSettingsError', 'Failed to load table settings.'),
        )
      } finally {
        if (token === tableLoadToken) {
          tableLoading.value = false
        }
      }
      return
    }

    if (!viewId && !props.setupMode) {
      await resetTableSettingsForCollection(collection)
    }
  },
  { immediate: true },
)

watch(layoutRoleId, async () => {
  if (lockedPredefinedViewId.value) {
    await reloadTableSettings(props.collection)
  }
})

</script>



<template>

  <div class="table-builder-panel flex h-full min-h-0 flex-col gap-1">

    <RoleScopedLayoutSelector

      v-if="!setupMode"

      mode="multi"

      :layout-label="t('layoutRole.tableLayout', 'Table layout')"

      :role-id="layoutRoleId"

      :role-options="roleOptions"

      @update:role-id="layoutRoleId = $event"

    />

    <DataTableFilter
      :collection="collection"
      :selected-filter-id="activeViewId"
      :create-new="createNew"

      :view-table-settings="tableSettings"

      :role-id="layoutRoleId"

      :role-options="roleOptions"

      :setup-mode="setupMode"

      :lock-predefined-view="Boolean(lockedPredefinedViewId)"

      @update:role-id="layoutRoleId = $event"

      @view-selected="handleViewSelected"
      @filter-conditions="handleFilterConditions"
      @view-saved="handleViewSaved"

    />

    <Message
      v-if="showRecentlyViewedHint && setupMode"
      severity="secondary"
      :closable="false"
    >
      {{ t('setup.recentlyViewedColumnsHint', 'Last Viewed At column is added automatically at runtime and is not configured here.') }}
    </Message>

    <div

      v-if="tableLoading"

      class="page-loading"

    >

      <ProgressSpinner stroke-width="4" />

      <span>{{ t('builder.loadingTableSettings', 'Loading table settings...') }}</span>

    </div>

    <DataTableSettingsDesigner
      v-else
      v-model="tableSettings"
      :collection="collection"
      :list-view-conditions="activeListViewConditions"
      hide-batch-insert
      class="min-h-0 flex-1"
    />

  </div>

</template>

