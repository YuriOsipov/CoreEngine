<script lang="ts">
export default {
  name: 'RelatedRecordsPage',
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useToast } from 'openvue/usetoast'
import CrmDataTable from '@/core/ui-kit/CrmDataTable.vue'
import ActionNumberPromptDialog from '@/core/ui-kit/ActionNumberPromptDialog.vue'
import BatchInsertDialog from '../components/BatchInsertDialog.vue'
import ObjectListDetailPanel from '../components/ObjectListDetailPanel.vue'
import CrmNotFoundState from '@/core/ui-kit/CrmNotFoundState.vue'
import { isRecordNotFoundError } from '../utils/isRecordNotFoundError'
import DataTableSettingsDesigner from '@/modules/config/components/DataTableSettingsDesigner.vue'
import DocListReportDialog from '@/modules/documents/components/DocListReportDialog.vue'
import { DOC_LIST_REPORT_MAX_RECORDS } from '@/modules/documents/services/docPopulation'
import { useDataTableLazy } from '../composables/useDataTableLazy'
import { fetchDataTableRuntimeMetadata } from '../services/collectionSchema'
import {
  buildDefaultTableSettings,
  loadTableSettings,
  normalizeTableSettings,
  saveTableSettings,
} from '../services/tableSettings'
import { resolveRecordPageLayoutForCurrentUser } from '@/modules/config/services/recordPageSettings'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import {
  resolveRecordPageListDetailContent,
  resolveRelatedListDataTableField,
} from '@/modules/config/utils/recordPageRelatedList'
import { fetchObjectRecord } from '../services/recordDetails'
import { useEntityRecordActions } from '../composables/useEntityRecordActions'
import { keysEqual } from '@/core/utils/object'
import type {
  DataTableSettings,
  EntityAction,
  LayoutFieldMetadata,
  ListViewAction,
  ListViewDetailPanel,
  RecordPageListDetailPanel,
  RelatedTransferSettings,
} from '@/interfaces'
import {
  listDetailSplitterStateKey,
  loadListDetailCollapsed,
  saveListDetailCollapsed,
} from '@/core/listDetailPanelState'
import {
  useTranslation,
  useTranslatedCollection,
} from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'
import { renderTemplateLabel } from '../utils/recordDisplay'
import { fetchCollectionDisplayTemplate } from '../services/collectionSchema'
import { useFavoriteContext } from '@/core/navigation/useFavoriteContext'

const route = useRoute()
const router = useRouter()
const { t } = useTranslation()
const toast = useToast()
const collectionName = computed(() => String(route.params.collection ?? ''))
const collectionLabel = useTranslatedCollection(() => collectionName.value)
const recordId = computed(() => String(route.params.id ?? ''))
const relatedCollectionName = computed(() =>
  String(route.params.related_collection ?? ''),
)
const relatedCollectionLabel = useTranslatedCollection(() => relatedCollectionName.value)
const {
  ready: permissionsReady,
  canRead: canReadRelated,
} = useEntityPermissions(() => relatedCollectionName.value)
const tableSettings = ref<DataTableSettings | null>(null)
const hasParentEntityConfig = ref(false)
const showTableSettings = ref(false)
const tableSettingsSaving = ref(false)
const batchInsertVisible = ref(false)
const batchInsertSettings = ref<RelatedTransferSettings | null>(null)
const batchInsertLabel = ref('')
const parentRecord = ref<Record<string, unknown>>({})
const parentDisplayLabel = ref('')

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
const listReportViewLabel = ref<string | null>(null)
const listToolbarActions = computed(
  () => tableSettings.value?.actions?.filter((action) => action.document?.templateId) ?? [],
)
const parentBulkActions = ref<EntityAction[]>([])
const parentBulkToolbarActions = computed(() =>
  parentBulkActions.value.filter((action) =>
    action.behavior === 'bulkUpdateRelated'
    && keysEqual(
      action.bulkUpdateRelated?.relatedCollection ?? '',
      relatedCollectionName.value,
    ),
  ),
)

const {
  actionRunning,
  numberPromptVisible,
  numberPromptLabel,
  numberPromptHeader,
  runEntityAction,
  onNumberPromptConfirm,
} = useEntityRecordActions({
  collection: () => collectionName.value,
  recordId: () => recordId.value,
  record: () => parentRecord.value,
  onRefresh: async () => {
    const collection = collectionName.value
    const id = recordId.value
    const related = relatedCollectionName.value
    if (!collection || !id || !related) return
    await loadRelatedRecords(collection, id, related)
  },
})

const { setFavoriteContext, clearFavoriteContext } = useFavoriteContext()

watchEffect(() => {
  const collection = collectionName.value
  const id = recordId.value
  const related = relatedCollectionName.value
  const record = parentRecord.value
  if (!collection || !id || !Object.keys(record).length) {
    parentDisplayLabel.value = ''
    return
  }

  void fetchCollectionDisplayTemplate(collection).then((template) => {
    const parentName = template
      ? renderTemplateLabel(template, record)
      : String(record.id ?? id)
    parentDisplayLabel.value = parentName || String(id)

    if (!related) return
    setFavoriteContext({
      defaultLabel: `${collectionLabel.value} · ${parentDisplayLabel.value} · ${relatedCollectionLabel.value}`,
      target: {
        kind: 'url',
        href: `/object/${collection}/${id}/${related}`,
        external: false,
      },
    })
  })
})
onUnmounted(clearFavoriteContext)

const backLinkLabel = computed(() => {
  const label = parentDisplayLabel.value
  if (!label) return ''
  return t('relatedRecords.backToLabel', 'Back to {label}', { label })
})

const {
  runtime: relatedRuntime,
  loading,
  error,
  pageSize,
  crmDataTableProps,
  loadMore: loadMoreRelatedRecords,
  handlePageSizeChange,
  handleSortChange,
  syncSortFromSettings,
  updateRows,
  isStaleToken,
  nextLoadToken,
} = useDataTableLazy({
  settings: tableSettings,
  loadErrorMessage: t('relatedRecords.failedLoad', 'Failed to load related records.'),
  loadMoreErrorMessage: t('relatedRecords.failedLoadMore', 'Failed to load more related records.'),
  fetchFn: async ({ limit, offset, settings }) =>
    fetchDataTableRuntimeMetadata(
      relatedCollectionName.value,
      collectionName.value,
      recordId.value,
      limit,
      settings,
      offset,
    ),
})

const recordMissing = ref(false)
const listBackRoute = computed(
  () => `/object/${encodeURIComponent(collectionName.value)}`,
)

const legacyDetailPanelConfig = computed<ListViewDetailPanel | null>(() => {
  const panel = tableSettings.value?.detailPanel
  if (!panel?.enabled) return null
  if (panel.blockLayoutId?.trim()) return panel
  if (panel.relatedCollection?.trim()) return panel
  return null
})

const detailPanelEnabled = computed(
  () =>
    Boolean(pageListDetailPanel.value?.enabled) || legacyDetailPanelConfig.value !== null,
)

const showToolbarActions = computed(
  () =>
    listToolbarActions.value.length > 0 ||
    parentBulkToolbarActions.value.length > 0 ||
    Boolean(batchInsertSettings.value) ||
    detailPanelEnabled.value,
)

const usesPageListDetail = computed(() => Boolean(pageListDetailPanel.value?.enabled))

const isMasterDetailLayout = computed(
  () => detailPanelEnabled.value && !detailCollapsed.value,
)

const selectedParentId = computed(() => {
  if (!selectedMasterRow.value) return null
  const id = selectedMasterRow.value.id
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
  listDetailSplitterStateKey(relatedCollectionName.value || 'unknown'),
)

const detailDefaultCollapsed = computed(
  () =>
    pageListDetailPanel.value?.defaultCollapsed === true
    || legacyDetailPanelConfig.value?.defaultCollapsed === true,
)

watch(
  relatedCollectionName,
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
    if (!relatedCollectionName.value) return
    detailCollapsed.value = loadListDetailCollapsed(
      relatedCollectionName.value,
      defaultCollapsed,
    )
  },
)

watch(
  () => relatedRuntime.value?.rows,
  (rows) => {
    const selected = selectedMasterRow.value
    if (!selected) return
    const selectedId = selected.id
    if (selectedId === null || selectedId === undefined) {
      selectedMasterRow.value = null
      return
    }
    const stillPresent = (rows ?? []).some((row) => row.id === selectedId)
    if (!stillPresent) {
      selectedMasterRow.value = null
    }
  },
)

watch(
  [collectionName, recordId, relatedCollectionName, permissionsReady, canReadRelated],
  ([collection, id, relatedCollection, ready, canRead]) => {
    if (!collection || !id || !relatedCollection || !ready) return
    if (!canRead) {
      relatedRuntime.value = null
      loading.value = false
      error.value = null
      recordMissing.value = false
      return
    }
    void loadRelatedRecords(collection, id, relatedCollection)
  },
  { immediate: true },
)

function setDetailCollapsed(collapsed: boolean): void {
  detailCollapsed.value = collapsed
  if (collapsed) {
    selectedMasterRow.value = null
  }
  saveListDetailCollapsed(relatedCollectionName.value, collapsed)
}

const showDetailPanel = computed({
  get: () => detailPanelEnabled.value && !detailCollapsed.value,
  set: (show: boolean) => {
    if (!detailPanelEnabled.value) return
    setDetailCollapsed(!show)
  },
})

async function loadPageListDetail(relatedCollection: string): Promise<void> {
  listDetailLoading.value = true
  listDetailLoadError.value = null
  try {
    const pageLayout = await resolveRecordPageLayoutForCurrentUser(relatedCollection)
    const panel = pageLayout?.listDetailPanel ?? null
    if (panel?.enabled) {
      pageListDetailPanel.value = panel
      const content = await resolveRecordPageListDetailContent(relatedCollection, pageLayout)
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

async function loadRelatedRecords(
  collection: string,
  id: string,
  relatedCollection: string,
): Promise<void> {
  const token = nextLoadToken()
  loading.value = true
  error.value = null
  recordMissing.value = false
  relatedRuntime.value = null
  selectedMasterRow.value = null
  pageListDetailPanel.value = null
  listDetailRelatedFields.value = []
  listDetailActions.value = []
  listDetailLoadError.value = null
  parentBulkActions.value = []
  parentRecord.value = {}

  try {
    const [[dataTableField, record, preferredParentLayout]] = await Promise.all([
      Promise.all([
        resolveRelatedListDataTableField(collection, relatedCollection),
        fetchObjectRecord(collection, id),
        resolvePreferredBlockLayoutForCurrentUser(collection),
      ]),
      loadPageListDetail(relatedCollection),
    ])
    if (isStaleToken(token)) return
    parentRecord.value = record
    parentBulkActions.value = (preferredParentLayout.blockLayout?.actions ?? []).filter(
      (action) => action.behavior === 'bulkUpdateRelated',
    )

    const parentDataTable = dataTableField?.dataTable
      ? normalizeTableSettings(dataTableField.dataTable)
      : null
    // Batch Insert / List actions come from Block / Page Layout DataTable fields.
    const collectionSettings = parentDataTable
      ? null
      : await loadEffectiveTableSettings(relatedCollection)
    if (isStaleToken(token)) return

    const settings = parentDataTable ?? collectionSettings
    if (!settings) return
    tableSettings.value = settings
    hasParentEntityConfig.value = Boolean(parentDataTable)
    batchInsertSettings.value = parentDataTable?.relatedTransfer ?? null
    batchInsertLabel.value = dataTableField?.label ?? relatedCollectionLabel.value
    syncSortFromSettings(settings)

    const result = await fetchDataTableRuntimeMetadata(
      relatedCollection,
      collection,
      id,
      pageSize.value,
      settings,
      0,
    )
    if (isStaleToken(token)) return
    relatedRuntime.value = result
  } catch (err) {
    if (isStaleToken(token)) return
    if (isRecordNotFoundError(err)) {
      recordMissing.value = true
      error.value = null
      return
    }
    error.value =
      err instanceof Error
        ? err.message
        : t('relatedRecords.failedLoad', 'Failed to load related records.')
  } finally {
    if (!isStaleToken(token)) {
      loading.value = false
    }
  }
}

function openRelatedRecord(row: Record<string, unknown>): void {
  const id = row.id
  if (id === null || id === undefined || id === '') return

  void router.push({
    name: 'related-record-details',
    params: {
      collection: collectionName.value,
      id: recordId.value,
      related_collection: relatedCollectionName.value,
      related_id: String(id),
    },
  })
}

function openDetailRelatedRecord(
  row: Record<string, unknown>,
  childCollection: string,
): void {
  if (selectedParentId.value === null) return
  const relatedId = row.id
  if (relatedId === null || relatedId === undefined || relatedId === '') return
  const child = childCollection.trim()
  if (!child) return

  void router.push({
    name: 'related-record-details',
    params: {
      collection: relatedCollectionName.value,
      id: String(selectedParentId.value),
      related_collection: child,
      related_id: String(relatedId),
    },
  })
}

async function resolveListActionRecordIds(action: ListViewAction): Promise<string[]> {
  const pk = relatedRuntime.value?.primaryKey ?? 'id'
  if (action.recordScope === 'visible') {
    return (relatedRuntime.value?.rows ?? [])
      .map((row) => row[pk])
      .filter((id) => id !== null && id !== undefined && id !== '')
      .map(String)
  }

  const result = await fetchDataTableRuntimeMetadata(
    relatedCollectionName.value,
    collectionName.value,
    recordId.value,
    DOC_LIST_REPORT_MAX_RECORDS,
    tableSettings.value,
    0,
  )
  return result.rows
    .map((row) => row[result.primaryKey ?? pk])
    .filter((id) => id !== null && id !== undefined && id !== '')
    .map(String)
}

async function runListDocumentAction(action: ListViewAction): Promise<void> {
  const templateId = action.document.templateId?.trim()
  if (!templateId || !relatedCollectionName.value || listReportLoading.value) return

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

async function loadEffectiveTableSettings(
  collection: string,
): Promise<DataTableSettings> {
  return (
    (await loadTableSettings(collection)) ??
    (await buildDefaultTableSettings(collection))
  )
}

async function saveCurrentTableSettings(): Promise<void> {
  if (!relatedCollectionName.value || !tableSettings.value) return
  tableSettingsSaving.value = true
  error.value = null

  try {
    await saveTableSettings(relatedCollectionName.value, tableSettings.value)
    await loadRelatedRecords(
      collectionName.value,
      recordId.value,
      relatedCollectionName.value,
    )
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('relatedRecords.failedSaveTableSettings', 'Failed to save table settings.')
  } finally {
    tableSettingsSaving.value = false
  }
}

async function handleBatchSubmitted(): Promise<void> {
  batchInsertVisible.value = false
  await loadRelatedRecords(
    collectionName.value,
    recordId.value,
    relatedCollectionName.value,
  )
}
</script>

<template>
  <main
    class="app-shell"
    :class="{ 'app-shell--master-detail': isMasterDetailLayout }"
  >
    <header class="app-header" :class="{ 'app-header--master-detail': isMasterDetailLayout }">
      <div class="app-header__row">
        <div>
          <RouterLink
            v-if="backLinkLabel"
            :to="`/object/${collectionName}/${recordId}`"
            class="nav-link"
          >
            {{ backLinkLabel }}
          </RouterLink>
          <h1>{{ relatedCollectionLabel }}</h1>
        </div>
      </div>
    </header>

    <section
      v-if="!recordMissing && !hasParentEntityConfig"
      class="bg-surface-0 border border-surface-200 rounded-xl my-4 p-3"
      :class="{ 'related-records-toolbar--master-detail': isMasterDetailLayout }"
    >
      <div class="flex gap-3 justify-end items-center">
        <Button
          :label="showTableSettings
            ? t('relatedRecords.hideTableSettings', 'Hide table settings')
            : t('relatedRecords.tableSettings', 'Table settings')"
          size="small"
          text
          @click="showTableSettings = !showTableSettings"
        />
        <Button
          v-if="showTableSettings"
          :label="t('relatedRecords.saveTableSettings', 'Save table settings')"
          size="small"
          :loading="tableSettingsSaving"
          :disabled="!tableSettings"
          @click="saveCurrentTableSettings"
        />
      </div>

      <DataTableSettingsDesigner
        v-if="showTableSettings && tableSettings"
        v-model="tableSettings"
        :collection="relatedCollectionName"
        hide-batch-insert
      />
    </section>

    <section
      class="workspace-pane min-h-0 overflow-visible"
      :class="{ 'workspace-pane--master-detail': isMasterDetailLayout }"
    >
      <div v-if="!permissionsReady" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('permissions.checkingAccess', 'Checking access...') }}</span>
      </div>

      <Message
        v-else-if="!canReadRelated"
        severity="warn"
        :closable="false"
        class="collections-message"
      >
        {{
          t(
            'permissions.noReadAccess',
            'You do not have permission to view {collection}.',
            { collection: relatedCollectionLabel || relatedCollectionName },
          )
        }}
      </Message>

      <div v-else-if="loading" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('relatedRecords.loading', 'Loading related records...') }}</span>
      </div>

      <CrmNotFoundState
        v-else-if="recordMissing"
        :title="t('recordDetails.notFoundTitle', 'Record not found')"
        :detail="
          t(
            'recordDetails.notFoundDetail',
            'This {collection} record does not exist or is no longer available.',
            { collection: collectionLabel || collectionName },
          )
        "
        :back-label="
          t('recordDetails.backToList', 'Back to {collection}', {
            collection: collectionLabel || collectionName,
          })
        "
        :back-to="listBackRoute"
      />

      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
        class="collections-message"
      >
        {{ error }}
      </Message>

      <template v-else-if="relatedRuntime">
        <div
          v-if="isMasterDetailLayout"
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
                :collection="relatedCollectionName"
                primary-key="id"
                :empty-message="t('relatedRecords.noRecords', 'No related records found.')"
                :show-new-button="Boolean(relatedRuntime.parentName)"
                show-delete-button
                :parent-name="relatedRuntime.parentName"
                :parent-id="recordId"
                @view-record="openRelatedRecord"
                @update:rows="updateRows"
                @page-size-change="handlePageSizeChange"
                @load-more="loadMoreRelatedRecords"
                @sort-change="handleSortChange"
              >
                <template #toolbar-actions>
                  <Button
                    v-for="action in parentBulkToolbarActions"
                    :key="`bulk-${action.id}`"
                    :label="action.label"
                    size="small"
                    :loading="actionRunning[action.id]"
                    @click="runEntityAction(action)"
                  />
                  <Button
                    v-for="action in listToolbarActions"
                    :key="`doc-${action.id}`"
                    :label="action.label"
                    icon="pi pi-file"
                    size="small"
                    severity="secondary"
                    :loading="listReportLoading"
                    @click="runListDocumentAction(action)"
                  />
                  <Button
                    v-if="batchInsertSettings"
                    :label="t('relatedTransfer.batchInsert', 'Batch insert')"
                    size="small"
                    outlined
                    @click="batchInsertVisible = true"
                  />
                  <div class="flex items-center gap-2">
                    <ToggleSwitch
                      v-model="showDetailPanel"
                      input-id="related-list-show-detail-master"
                    />
                    <label for="related-list-show-detail-master" class="text-[0.85rem] whitespace-nowrap">
                      {{ t('objectList.showDetail', 'Show detail') }}
                    </label>
                  </div>
                </template>
              </CrmDataTable>
            </SplitterPanel>

            <SplitterPanel
              :size="detailPaneSize"
              :min-size="detailPaneMinSize"
              class="object-list-master-detail__detail"
            >
              <ObjectListDetailPanel
                :collection="relatedCollectionName"
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
          v-else
          v-bind="crmDataTableProps"
          :record-link-field="tableSettings?.recordLinkField ?? null"
          :collection="relatedCollectionName"
          primary-key="id"
          :empty-message="t('relatedRecords.noRecords', 'No related records found.')"
          :show-new-button="Boolean(relatedRuntime.parentName)"
          show-delete-button
          :parent-name="relatedRuntime.parentName"
          :parent-id="recordId"
          @view-record="openRelatedRecord"
          @update:rows="updateRows"
          @page-size-change="handlePageSizeChange"
          @load-more="loadMoreRelatedRecords"
          @sort-change="handleSortChange"
        >
          <template v-if="showToolbarActions" #toolbar-actions>
            <Button
              v-for="action in parentBulkToolbarActions"
              :key="`bulk-${action.id}`"
              :label="action.label"
              size="small"
              :loading="actionRunning[action.id]"
              @click="runEntityAction(action)"
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
              v-if="batchInsertSettings"
              :label="t('relatedTransfer.batchInsert', 'Batch insert')"
              size="small"
              outlined
              @click="batchInsertVisible = true"
            />
            <div
              v-if="detailPanelEnabled"
              class="flex items-center gap-2"
            >
              <ToggleSwitch
                v-model="showDetailPanel"
                input-id="related-list-show-detail"
              />
              <label for="related-list-show-detail" class="text-[0.85rem] whitespace-nowrap">
                {{ t('objectList.showDetail', 'Show detail') }}
              </label>
            </div>
          </template>
        </CrmDataTable>
        <p
          v-if="!isMasterDetailLayout && relatedRuntime.rows.length === 0"
          class="text-muted-color text-[0.9rem] m-0"
        >
          {{ t('relatedRecords.noRecords', 'No related records found.') }}
        </p>
      </template>
    </section>

    <BatchInsertDialog
      v-model:visible="batchInsertVisible"
      :settings="batchInsertSettings"
      :label="batchInsertLabel"
      :parent-record="parentRecord"
      :parent-collection="collectionName"
      :parent-id="recordId"
      :target-parent-field="relatedRuntime?.parentName ?? ''"
      :current-target-rows="relatedRuntime?.rows ?? []"
      @submitted="handleBatchSubmitted"
    />

    <DocListReportDialog
      v-model:visible="listReportVisible"
      :collection="relatedCollectionName"
      :record-ids="listReportRecordIds"
      :template-id="listReportTemplateId"
      :view-mode="listReportViewMode"
      :parent="parentRecord"
      :view-label="listReportViewLabel"
    />

    <ActionNumberPromptDialog
      v-model:visible="numberPromptVisible"
      :header="numberPromptHeader"
      :label="numberPromptLabel"
      @confirm="onNumberPromptConfirm"
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

.related-records-toolbar--master-detail {
  flex: 0 0 auto;
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

.workspace-pane--master-detail {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

.object-list-master-detail__detail {
  border: 1px solid var(--p-content-border-color, var(--p-surface-200));
  border-radius: 0.75rem;
  background: var(--p-surface-0);
}

.object-list-master-detail__detail :deep(.object-list-detail-panel) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
</style>
