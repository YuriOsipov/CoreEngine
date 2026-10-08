<script lang="ts">
export default {
  name: 'RelatedDataTableField',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CrmDataTable from '@/core/ui-kit/CrmDataTable.vue'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import RelatedTransferField from '@/modules/entities/components/RelatedTransferField.vue'
import { useDataTableCompact } from '../composables/useDataTableCompact'
import {
  fetchCollectionIcon,
  fetchCollectionLabel,
  fetchDataTableRuntimeMetadata,
  fetchTranslatedFieldLabel,
  resolveRelatedCreateTarget,
  type RelatedCreateTarget,
} from '../services/collectionSchema'
import { createObjectRecord } from '../services/recordDetails'
import { extractRelationFieldId } from '../utils/recordDisplay'
import type {
  LayoutFieldMetadata,
  ListViewAction,
  RelatedTransferSettings,
} from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'
import { resolveRelatedRowLimit } from '../services/tableSettings'
import DocListReportDialog from '@/modules/documents/components/DocListReportDialog.vue'
import { DOC_LIST_REPORT_MAX_RECORDS } from '@/modules/documents/services/docPopulation'
import { useToast } from 'primevue/usetoast'

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

const { canRead: canReadRelated, canDelete: canDeleteRelated } =
  useEntityPermissions(() => props.field.relatedCollection)
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

const watchKey = computed(() => {
  if (!props.field.relatedCollection) return ''
  return [
    props.field.field,
    props.field.relatedCollection,
    props.parentName ?? '',
    props.parentId ?? '',
    props.refreshKey ?? '',
    JSON.stringify(props.field.dataTable ?? {}),
  ].join('.')
})

const {
  runtime,
  loading,
  hasMore,
  refreshRuntime,
  updateRows,
} = useDataTableCompact({
  maxRows: rowLimit,
  enabled: () => props.active && canReadRelated.value,
  watchKey,
  fetchFn: async () =>
    fetchDataTableRuntimeMetadata(
      props.field.relatedCollection!,
      props.parentName,
      props.parentId,
      rowLimit.value,
      props.field.dataTable,
    ),
})

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
  <div class="border border-surface-200 rounded-lg overflow-x-auto overflow-y-hidden">
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
      <div class="flex items-center gap-[0.6rem]">
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

    <p
      v-if="!canReadRelated"
      class="text-muted-color text-[0.9rem] m-0 px-3 py-2"
    >
      {{
        t(
          'permissions.noReadAccess',
          'You do not have permission to view {collection}.',
          {
            collection:
              translatedLabel || field.label || field.relatedCollection || '',
          },
        )
      }}
    </p>

    <p v-else-if="loading && !runtime" class="text-muted-color text-[0.9rem] m-0 px-3 py-2">
      {{ t('relatedDataTable.loadingMetadata', 'Loading related table metadata...') }}
    </p>

    <p v-else-if="(runtime?.columns ?? []).length === 0" class="text-muted-color text-[0.9rem] m-0 px-3 py-2">
      {{ t('relatedDataTable.loadingMetadata', 'Loading related table metadata...') }}
    </p>

    <template v-else>
      <CrmDataTable
        ref="tableRef"
        :rows="runtime?.rows ?? []"
        :columns="runtime?.columns ?? []"
        :collection="field.relatedCollection"
        primary-key="id"
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
        :default-sort-field="field.dataTable?.sort?.field ?? null"
        :default-sort-order="field.dataTable?.sort?.order ?? null"
        :group-by="field.dataTable?.groupBy ?? null"
        :record-link-field="field.dataTable?.recordLinkField ?? null"
        :inline-edit-refresh="field.dataTable?.inlineEditRefresh ?? 'off'"
        :inline-edit-refresh-fields="field.dataTable?.inlineEditRefreshFields ?? []"
        :empty-message="resolvedEmptyMessage"
        @view-record="emit('view-record', $event)"
        @update:rows="updateRows"
        @record-created="handleRelatedMutated"
        @record-updated="handleRelatedMutated"
        @record-deleted="handleRelatedMutated"
      />
    </template>

    <Dialog
      v-model:visible="batchInsertVisible"
      modal
      :header="t('relatedTransfer.batchInsertHeader', 'Batch insert {label}', { label: headerLabel })"
      :style="{ width: 'min(1500px, 98vw)', maxHeight: '96vh' }"
      :content-style="{ maxHeight: 'calc(96vh - 5rem)', overflow: 'hidden' }"
    >
      <RelatedTransferField
        :settings="resolvedRelatedTransfer"
        :label="translatedLabel || field.label"
        :parent-record="parentRecord ?? {}"
        :parent-collection="entity"
        :parent-id="runtime?.parentId"
        :target-parent-field="runtime?.parentName"
        :current-target-rows="runtime?.rows ?? []"
        @submitted="handleBatchSubmitted"
      />
    </Dialog>

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
