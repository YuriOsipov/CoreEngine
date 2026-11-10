<script lang="ts">
export default {
  name: 'RelatedDataTableField',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CrmDataTable from '@/core/ui-kit/CrmDataTable.vue'
import CrmBarcodeScanToolbar from '@/core/ui-kit/CrmBarcodeScanToolbar.vue'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import BatchInsertDialog from '@/modules/entities/components/BatchInsertDialog.vue'
import { useDataTableLazy } from '../composables/useDataTableLazy'
import {
  fetchCollectionIcon,
  fetchCollectionLabel,
  fetchDataTableRuntimeMetadata,
  fetchTranslatedFieldLabel,
  findParentFkField,
  resolveRelatedCreateTarget,
  type RelatedCreateTarget,
} from '../services/collectionSchema'
import { createObjectRecord } from '../services/recordDetails'
import { extractRelationFieldId } from '../utils/recordDisplay'
import type {
  DataTableSettings,
  LayoutFieldMetadata,
  ListViewAction,
  RelatedTransferSettings,
} from '@/interfaces'
import {
  barcodeScanNeedsUpdate,
  isBarcodeScanEnabled,
  lookupRecordsByBarcode,
  normalizeBarcodeScanSettings,
  updateRecordFromBarcodeScan,
} from '@/core/barcodeScan'
import { useTranslation } from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'
import {
  normalizeTableSettings,
  resolveRelatedRowLimit,
} from '../services/tableSettings'
import DocListReportDialog from '@/modules/documents/components/DocListReportDialog.vue'
import { DOC_LIST_REPORT_MAX_RECORDS } from '@/modules/documents/services/docPopulation'
import { useToast } from 'openvue/usetoast'
import { useConfirm } from 'openvue/useconfirm'
import {
  dataTransferHasCoreEngineFile,
  readCoreEngineFileDragData,
} from '@/core/filesField'
import { linkFileToRecord } from '@/core/graphql/filesProxy'

interface SelectOption {
  label: string
  value: string | number
}

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    entity?: string
    parentName?: string
    parentId?: string | number
    parentRecord?: Record<string, unknown>
    showCreate?: boolean
    showActions?: boolean
    defaultSortField?: string | null
    defaultSortOrder?: 1 | -1 | null
    refreshKey?: string | number
    emptyMessage?: string
    active?: boolean
  }>(),
  {
    showCreate: false,
    showActions: false,
    defaultSortField: null,
    defaultSortOrder: null,
    active: true,
  },
)

const emit = defineEmits<{
  'view-record': [row: Record<string, unknown>]
  'related-changed': []
}>()

const translatedLabel = ref('')
const collectionIcon = ref<string | null>(null)
const relatedCollectionLabel = ref('')
const headerLabel = computed(
  () =>
    relatedCollectionLabel.value ||
    translatedLabel.value ||
    props.field.label,
)
const isPrimeCollectionIcon = computed(() => {
  const icon = collectionIcon.value?.trim() ?? ''
  if (!icon) return false
  return icon.startsWith('pi ') || icon.startsWith('pi-') || /(^|\s)pi-/.test(icon)
})
const tableRef = ref<InstanceType<typeof CrmDataTable> | null>(null)
const batchInsertVisible = ref(false)
const resolvedRelatedTransfer = ref<RelatedTransferSettings | null>(null)
const linkDialogVisible = ref(false)
const linkSelection = ref<SelectOption | null>(null)
const linkSaving = ref(false)
const relatedCreateTarget = ref<RelatedCreateTarget | null>(null)
const listReportVisible = ref(false)
const listReportLoading = ref(false)
const listReportTemplateId = ref('')
const listReportRecordIds = ref<string[]>([])
const listReportViewMode = ref<'html' | 'pdf'>('pdf')
const listReportViewLabel = ref<string | null>(null)
const listToolbarActions = computed(
  () =>
    props.field.dataTable?.actions?.filter((action) => action.document?.templateId) ??
    [],
)
const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()
const isDraggingCoreEngineFile = ref(false)
const linkingCoreEngineFile = ref(false)

const barcodeScanBusy = ref(false)
const barcodeScanModeOn = ref(false)
const barcodeListFilter = ref<Record<string, unknown> | null>(null)
const barcodeToolbarRef = ref<InstanceType<typeof CrmBarcodeScanToolbar> | null>(null)
const parentFkField = ref<string | null>(null)
const barcodeScanSettings = computed(() =>
  normalizeBarcodeScanSettings(props.field.dataTable?.barcodeScan),
)
const showBarcodeScan = computed(() => isBarcodeScanEnabled(barcodeScanSettings.value))

const {
  ready: relatedPermissionsReady,
  canRead: canReadRelated,
  canDelete: canDeleteRelated,
} = useEntityPermissions(() => props.field.relatedCollection)
/** Junction create for M2M link; related-entity create for plain O2M New. */
const permissionCollection = computed(() => {
  const target = relatedCreateTarget.value
  if (target?.junction) {
    return target.junction.collection || props.field.relatedCollection
  }
  return target?.createCollection || props.field.relatedCollection
})
const { canCreate: canCreateRelated } = useEntityPermissions(
  () => permissionCollection.value,
)

watch(
  () => [props.field.relatedCollection, props.entity] as const,
  ([related, parent]) => {
    if (!related) {
      relatedCreateTarget.value = null
      return
    }
    void resolveRelatedCreateTarget(related, parent).then((target) => {
      relatedCreateTarget.value = target
    })
  },
  { immediate: true },
)

const isM2MJunction = computed(() => Boolean(relatedCreateTarget.value?.junction))
const linkCollection = computed(
  () => relatedCreateTarget.value?.createCollection?.trim() || '',
)

const rowLimit = computed(() => resolveRelatedRowLimit(props.field.dataTable))

/** Column field for the sort indicator (e.g. `item`); API sort uses nested key. */
const uiSortField = ref<string | null>(null)
const uiSortOrder = ref<1 | -1 | null>(null)

const tableSettings = computed<DataTableSettings | null>(() => {
  if (!props.field.dataTable) return { columns: [] }
  return normalizeTableSettings(props.field.dataTable)
})

const tableSortField = computed(
  () =>
    uiSortField.value ??
    props.field.dataTable?.sort?.field ??
    props.defaultSortField ??
    null,
)
const tableSortOrder = computed<1 | -1 | null>(
  () =>
    uiSortOrder.value ??
    props.field.dataTable?.sort?.order ??
    props.defaultSortOrder ??
    null,
)

const {
  runtime,
  loading,
  hasMore,
  pageSize,
  reload,
  handleSortChange: reloadWithSort,
  resetSort,
  updateRows,
} = useDataTableLazy({
  settings: tableSettings,
  initialPageSize: rowLimit.value,
  fetchFn: async ({ limit, offset, settings }) => {
    if (!props.field.relatedCollection) {
      return {
        collection: '',
        columns: [],
        rows: [],
        totalCount: 0,
        primaryKey: 'id',
      }
    }
    return fetchDataTableRuntimeMetadata(
      props.field.relatedCollection,
      props.parentName,
      props.parentId,
      limit,
      settings,
      offset,
      barcodeListFilter.value,
    )
  },
})

function resolveRelatedRowFromDropTarget(
  target: EventTarget | null,
): Record<string, unknown> | null {
  const rows = runtime.value?.rows ?? []
  if (!rows.length || !(target instanceof Element)) return null
  const tr = target.closest('tr')
  if (!tr || !tr.parentElement) return null
  const bodyRows = Array.from(tr.parentElement.querySelectorAll(':scope > tr'))
  const index = bodyRows.indexOf(tr)
  if (index < 0 || index >= rows.length) return null
  return rows[index] ?? null
}

function handleCoreEngineFileDragOver(event: DragEvent): void {
  if (!dataTransferHasCoreEngineFile(event.dataTransfer)) return
  if (!props.field.relatedCollection || isM2MJunction.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  isDraggingCoreEngineFile.value = true
}

async function handleCoreEngineFileDrop(event: DragEvent): Promise<void> {
  isDraggingCoreEngineFile.value = false
  if (!props.field.relatedCollection || isM2MJunction.value) return
  const coreEngineFile = readCoreEngineFileDragData(event.dataTransfer)
  if (!coreEngineFile) return
  event.preventDefault()

  const row = resolveRelatedRowFromDropTarget(event.target)
  const recordId = row?.id == null ? '' : String(row.id)
  if (!recordId) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'filePreview.dropOnRelatedRow',
        'Drop the file onto a related record row to link it.',
      ),
      life: 4000,
    })
    return
  }

  if (linkingCoreEngineFile.value) return
  linkingCoreEngineFile.value = true
  try {
    await linkFileToRecord(coreEngineFile.id, {
      collection: props.field.relatedCollection,
      recordId,
    })
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t(
        'filePreview.linkSuccess',
        'File linked to this record.',
      ),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('filePreview.linkFailed', 'Link failed'),
      detail:
        err instanceof Error
          ? err.message
          : t('filePreview.linkFailedDetail', 'Could not link the selected file.'),
      life: 8000,
    })
  } finally {
    linkingCoreEngineFile.value = false
  }
}

async function refreshRuntime(): Promise<void> {
  await reload(true)
}

function handleSortChange(
  payload: Parameters<typeof reloadWithSort>[0],
): void {
  uiSortField.value = payload.field
  uiSortOrder.value = payload.order
  reloadWithSort(payload)
}

watch(
  rowLimit,
  (limit) => {
    if (pageSize.value === limit) return
    pageSize.value = limit
    if (runtime.value) void reload(true)
  },
)

watch(
  () =>
    [
      props.active,
      relatedPermissionsReady.value,
      canReadRelated.value,
      props.field.relatedCollection ?? '',
      props.parentName ?? '',
      String(props.parentId ?? ''),
      String(props.refreshKey ?? ''),
      JSON.stringify(barcodeListFilter.value ?? null),
    ] as const,
  ([active, ready, canRead, related]) => {
    if (!active || !ready || !canRead || !related) {
      runtime.value = null
      return
    }
    resetSort()
    uiSortField.value = null
    uiSortOrder.value = null
    pageSize.value = rowLimit.value
    void reload()
  },
  { immediate: true },
)

// Layout column config changes — reload but keep interactive sort if still valid.
watch(
  () => JSON.stringify(props.field.dataTable?.columns ?? null),
  (next, prev) => {
    if (prev === undefined || next === prev) return
    if (!props.active || !canReadRelated.value || !props.field.relatedCollection) {
      return
    }
    void reload(true)
  },
)

watch(
  () =>
    [props.field.relatedCollection ?? '', props.parentName ?? ''] as const,
  ([related, parent]) => {
    parentFkField.value = null
    if (!related || !parent) return
    void findParentFkField(related, parent).then((field) => {
      parentFkField.value = field
    })
  },
  { immediate: true },
)

const resolvedEmptyMessage = computed(() =>
  props.emptyMessage ?? t('relatedDataTable.noRecords', 'No related records found.'),
)

const canCreate = computed(() =>
  Boolean(
    props.showCreate &&
      canCreateRelated.value &&
      props.field.relatedCollection &&
      runtime.value?.parentName &&
      runtime.value?.parentId !== undefined &&
      runtime.value?.parentId !== null,
  ),
)
const canBatchInsert = computed(() =>
  Boolean(
    canCreate.value &&
      resolvedRelatedTransfer.value?.source?.itemCollection &&
      resolvedRelatedTransfer.value?.target?.collection &&
      runtime.value?.parentName &&
      resolvedRelatedTransfer.value?.target?.itemField,
  ),
)

watch(
  () =>
    [
      props.field.relatedCollection ?? '',
      props.field.dataTable?.relatedTransfer ?? null,
    ] as const,
  ([related, fromField]) => {
    void resolveBatchInsertSettings(related, fromField)
  },
  { immediate: true, deep: true },
)

async function resolveBatchInsertSettings(
  _related: string,
  fromField: RelatedTransferSettings | null | undefined,
): Promise<void> {
  // Batch Insert comes from the Block / entity DataTable field only.
  resolvedRelatedTransfer.value = isUsableRelatedTransfer(fromField) ? fromField : null
}

function isUsableRelatedTransfer(
  value: RelatedTransferSettings | null | undefined,
): value is RelatedTransferSettings {
  return Boolean(
    value?.source?.itemCollection &&
      value?.target?.collection &&
      value?.target?.itemField,
  )
}
const canShowDelete = computed(
  () => props.showActions && canDeleteRelated.value,
)

const linkExcludeIds = computed(() => {
  const junction = relatedCreateTarget.value?.junction
  if (!junction) return [] as Array<string | number>
  const ids: Array<string | number> = []
  const parentId = runtime.value?.parentId ?? props.parentId
  if (parentId != null && parentId !== '') {
    ids.push(parentId)
  }
  for (const row of runtime.value?.rows ?? []) {
    const relatedId = extractRelationFieldId(row[junction.relatedField])
    if (relatedId != null) ids.push(relatedId)
  }
  return ids
})

watch(
  () => [props.field.field, props.field.label, props.entity ?? ''],
  () => {
    void syncLabel()
  },
  { immediate: true },
)

watch(
  () => props.field.relatedCollection ?? '',
  () => {
    void syncCollectionHeader()
  },
  { immediate: true },
)

async function syncLabel(): Promise<void> {
  translatedLabel.value = props.entity
    ? await fetchTranslatedFieldLabel(props.entity, props.field.field, props.field.label)
    : props.field.label
}

async function syncCollectionHeader(): Promise<void> {
  const related = props.field.relatedCollection?.trim()
  if (!related) {
    collectionIcon.value = null
    relatedCollectionLabel.value = ''
    return
  }
  const [icon, label] = await Promise.all([
    fetchCollectionIcon(related),
    fetchCollectionLabel(related),
  ])
  collectionIcon.value = icon
  relatedCollectionLabel.value = label
}

async function handleBatchSubmitted(): Promise<void> {
  batchInsertVisible.value = false
  await refreshRuntime()
  emit('related-changed')
}

function handleRelatedMutated(): void {
  void refreshRuntime()
  emit('related-changed')
}

/**
 * Inline / dialog edit already patches the edited row via `@update:rows`
 * (and optional single-row `inlineEditRefresh`). Do not reload the whole
 * related list — that discards the row patch and re-fetches every record.
 */
function handleRelatedUpdated(_row: Record<string, unknown>): void {
  emit('related-changed')
}

function openLinkDialog(): void {
  linkSelection.value = null
  linkDialogVisible.value = true
}

function closeLinkDialog(): void {
  linkDialogVisible.value = false
  linkSelection.value = null
}

function handleCreateClick(): void {
  if (isM2MJunction.value) {
    openLinkDialog()
    return
  }
  tableRef.value?.handleNewRecord()
}

async function resolveListActionRecordIds(action: ListViewAction): Promise<string[]> {
  const pk = runtime.value?.primaryKey ?? 'id'
  if (action.recordScope === 'visible') {
    return (runtime.value?.rows ?? [])
      .map((row) => row[pk])
      .filter((id) => id !== null && id !== undefined && id !== '')
      .map(String)
  }

  if (
    !props.field.relatedCollection ||
    props.parentId === undefined ||
    props.parentId === null ||
    props.parentId === ''
  ) {
    return []
  }

  const result = await fetchDataTableRuntimeMetadata(
    props.field.relatedCollection,
    props.entity || props.parentName,
    props.parentId,
    DOC_LIST_REPORT_MAX_RECORDS,
    props.field.dataTable ?? null,
    0,
  )
  return result.rows
    .map((row) => row[result.primaryKey ?? pk])
    .filter((id) => id !== null && id !== undefined && id !== '')
    .map(String)
}

async function runListDocumentAction(action: ListViewAction): Promise<void> {
  const templateId = action.document.templateId?.trim()
  if (!templateId || !props.field.relatedCollection || listReportLoading.value) return

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

function clearBarcodeListFilter(): void {
  barcodeListFilter.value = null
  barcodeToolbarRef.value?.markFilterActive(false)
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
  const collection = props.field.relatedCollection?.trim()
  if (!settings || !collection || barcodeScanBusy.value) return

  const run = async (): Promise<void> => {
    barcodeScanBusy.value = true
    try {
      const fk = parentFkField.value ?? runtime.value?.parentName ?? null
      const parentId = runtime.value?.parentId ?? props.parentId
      const extraFilter =
        fk && parentId !== undefined && parentId !== null && parentId !== ''
          ? { [fk]: { _eq: parentId } }
          : null

      const lookup = await lookupRecordsByBarcode({
        collection,
        field: settings.field,
        code: payload.code,
        extraFilter,
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
        barcodeScanModeOn.value = false
        barcodeToolbarRef.value?.exitScanMode()
        emit('view-record', unique)
        await refreshRuntime()
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
      } else {
        await refreshRuntime()
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

async function handleLinkSelected(option: SelectOption | null): Promise<void> {
  linkSelection.value = option
  const junction = relatedCreateTarget.value?.junction
  const parentId = runtime.value?.parentId ?? props.parentId
  if (!option || !junction || parentId == null || parentId === '') return

  linkSaving.value = true
  try {
    await createObjectRecord(junction.collection, {
      [junction.parentField]: parentId,
      [junction.relatedField]: option.value,
    })
    closeLinkDialog()
    await refreshRuntime()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t(
              'relatedDataTable.linkExistingError',
              'Failed to link the selected record.',
            ),
      life: 5000,
    })
    linkSelection.value = null
  } finally {
    linkSaving.value = false
  }
}
</script>

<template>
  <!-- No related-collection Read: omit the related list entirely. -->
  <div
    v-if="relatedPermissionsReady && canReadRelated"
    class="border border-surface-200 rounded-lg overflow-x-auto overflow-y-hidden"
  >
    <div class="flex items-center justify-between bg-surface-100 border-b border-surface-200 px-3 py-2">
      <span class="flex items-center gap-[0.35rem] text-surface-700 text-[0.9rem] font-semibold">
        <i
          v-if="collectionIcon && isPrimeCollectionIcon"
          :class="collectionIcon"
          class="text-primary"
          aria-hidden="true"
        />
        <span
          v-else-if="collectionIcon"
          class="material-icons text-primary"
          style="font-size:1.5rem;line-height:1"
          aria-hidden="true"
        >{{ collectionIcon }}</span>
        {{ headerLabel }}
        <span class="text-muted-color font-medium">
          ({{ runtime?.totalCount ?? 0 }})
        </span>
      </span>
      <div class="flex flex-wrap items-center justify-end gap-[0.6rem]">
        <CrmBarcodeScanToolbar
          v-if="showBarcodeScan"
          v-model:scan-mode="barcodeScanModeOn"
          toggle-only
          :settings="barcodeScanSettings"
          :busy="barcodeScanBusy"
        />
        <slot name="actions" :has-more="hasMore" />
        <Button
          v-for="action in listToolbarActions"
          :key="action.id"
          :label="action.label"
          icon="pi pi-file"
          size="small"
          severity="secondary"
          outlined
          :loading="listReportLoading"
          @click="runListDocumentAction(action)"
        />
        <Button
          v-if="canBatchInsert"
          :label="t('relatedTransfer.batchInsert', 'Batch insert')"
          size="small"
          outlined
          @click="batchInsertVisible = true"
        />
        <Button
          v-if="canCreate"
          :label="
            isM2MJunction
              ? t('relatedDataTable.addExisting', 'Add')
              : t('common.new', 'New')
          "
          size="small"
          outlined
          @click="handleCreateClick"
        />
      </div>
    </div>

    <div
      v-if="showBarcodeScan && barcodeScanModeOn"
      class="flex flex-wrap items-end gap-2 px-3 py-2 border-b border-surface-200"
    >
      <CrmBarcodeScanToolbar
        ref="barcodeToolbarRef"
        v-model:scan-mode="barcodeScanModeOn"
        hide-toggle
        class="w-full"
        :settings="barcodeScanSettings"
        :busy="barcodeScanBusy"
        @submit="handleBarcodeScanSubmit"
        @clear-filter="clearBarcodeListFilter"
      />
    </div>

    <p v-if="loading && !runtime" class="text-muted-color text-[0.9rem] m-0 px-3 py-2">
      {{ t('relatedDataTable.loadingMetadata', 'Loading related table metadata...') }}
    </p>

    <p v-else-if="(runtime?.columns ?? []).length === 0" class="text-muted-color text-[0.9rem] m-0 px-3 py-2">
      {{ t('relatedDataTable.loadingMetadata', 'Loading related table metadata...') }}
    </p>

    <template v-else>
      <div
        class="related-file-drop-target rounded-md transition-colors"
        :class="
          isDraggingCoreEngineFile
            ? 'ring-2 ring-primary ring-offset-1 bg-primary-50/40'
            : ''
        "
        @dragenter.prevent="handleCoreEngineFileDragOver"
        @dragover="handleCoreEngineFileDragOver"
        @dragleave.prevent="isDraggingCoreEngineFile = false"
        @drop.prevent="handleCoreEngineFileDrop"
      >
        <CrmDataTable
          ref="tableRef"
          :rows="runtime?.rows ?? []"
          :columns="runtime?.columns ?? []"
          :collection="field.relatedCollection"
          primary-key="id"
          lazy
          :has-more="false"
          :loading="loading || linkingCoreEngineFile"
          :max-local-rows="rowLimit"
          :show-new-button="false"
          :show-delete-button="canShowDelete"
          :show-edit-record-action="!isM2MJunction"
          :show-view-record-action="!isM2MJunction"
          :record-links-enabled="!isM2MJunction"
          :parent-name="runtime?.parentName"
          :parent-id="runtime?.parentId"
          :parent-collection="entity"
          :parent-record="parentRecord"
          :default-sort-field="tableSortField"
          :default-sort-order="tableSortOrder"
          :group-by="field.dataTable?.groupBy ?? null"
          :record-link-field="field.dataTable?.recordLinkField ?? null"
          :inline-edit-refresh="field.dataTable?.inlineEditRefresh ?? 'off'"
          :inline-edit-refresh-fields="field.dataTable?.inlineEditRefreshFields ?? []"
          :empty-message="resolvedEmptyMessage"
          @sort-change="handleSortChange"
          @view-record="emit('view-record', $event)"
          @update:rows="updateRows"
          @record-created="handleRelatedMutated"
          @record-updated="handleRelatedUpdated"
          @record-deleted="handleRelatedMutated"
        />
      </div>
    </template>

    <BatchInsertDialog
      v-model:visible="batchInsertVisible"
      :settings="resolvedRelatedTransfer"
      :label="translatedLabel || field.label"
      :parent-record="parentRecord ?? {}"
      :parent-collection="entity"
      :parent-id="runtime?.parentId"
      :target-parent-field="runtime?.parentName"
      :current-target-rows="runtime?.rows ?? []"
      @submitted="handleBatchSubmitted"
    />

    <Dialog
      v-model:visible="linkDialogVisible"
      modal
      :header="
        t('relatedDataTable.linkExistingHeader', 'Add existing {label}', {
          label: headerLabel,
        })
      "
      :style="{ width: 'min(480px, 95vw)' }"
      @hide="closeLinkDialog"
    >
      <CrmAutoComplete
        v-if="linkCollection"
        :model-value="linkSelection"
        :collection="linkCollection"
        :placeholder="
          t('relatedDataTable.linkExistingPlaceholder', 'Search and select a record…')
        "
        :allow-create="false"
        :exclude-ids="linkExcludeIds"
        :disabled="linkSaving"
        class="w-full"
        @update:model-value="handleLinkSelected"
      />
    </Dialog>

    <DocListReportDialog
      v-if="field.relatedCollection"
      v-model:visible="listReportVisible"
      :collection="field.relatedCollection"
      :record-ids="listReportRecordIds"
      :template-id="listReportTemplateId"
      :view-mode="listReportViewMode"
      :parent="parentRecord ?? null"
      :view-label="listReportViewLabel"
    />
  </div>
</template>
