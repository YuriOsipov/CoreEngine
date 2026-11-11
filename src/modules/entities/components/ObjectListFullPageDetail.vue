<script lang="ts">
export default {
  name: 'ObjectListFullPageDetail',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import RecordPageRenderer from '@/modules/entities/components/RecordPageRenderer.vue'
import RecordEditDialog from '@/modules/entities/components/RecordEditDialog.vue'
import DocTemplatePickerDialog from '@/modules/documents/components/DocTemplatePickerDialog.vue'
import DocValueListDialog from '@/modules/documents/components/DocValueListDialog.vue'
import DocFillDialog from '@/modules/documents/components/DocFillDialog.vue'
import DocViewDialog from '@/modules/documents/components/DocViewDialog.vue'
import ActionNumberPromptDialog from '@/core/ui-kit/ActionNumberPromptDialog.vue'
import { useEntityRecordActions } from '@/modules/entities/composables/useEntityRecordActions'
import type {
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'
import { loadEntityLayoutById } from '@/modules/config/services/layoutSettings'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import { useEntityPermissions } from '@/core/entityPermissions'
import { useTranslation } from '@/core/translation'
import {
  archiveObjectRecord,
  fetchObjectRecordForEdit,
  isRecordArchived,
  restoreObjectRecord,
  updateObjectRecord,
} from '@/modules/entities/services/recordDetails'
import { collectPathLayoutExtraFields } from '@/core/recordPagePath'

const props = defineProps<{
  collection: string
  parentId?: string | number | null
}>()

const emit = defineEmits<{
  'record-updated': [record: Record<string, unknown>]
  'record-deleted': [id: string | number]
}>()

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()
const {
  canRead: canReadRecord,
  canUpdate: canUpdateRecord,
  canDelete: canDeleteRecord,
  ready: permissionsReady,
} = useEntityPermissions(() => props.collection)

const loading = ref(false)
const loadError = ref<string | null>(null)
const pageLayoutSchema = ref<RecordPageLayoutSchema | null>(null)
const layoutSchema = ref<EntityLayoutSchema | null>(null)
const recordData = ref<Record<string, unknown>>({})
const detailActions = ref<EntityAction[]>([])
const pathSaving = ref(false)
const deleting = ref(false)
const restoring = ref(false)
const editDialogVisible = ref(false)
let loadToken = 0

const hasParent = computed(
  () => props.parentId !== undefined && props.parentId !== null && props.parentId !== '',
)
const recordId = computed(() => String(props.parentId ?? ''))
const isArchivedRecord = computed(() => isRecordArchived(recordData.value))
const showRenderer = computed(
  () =>
    hasParent.value
    && Boolean(pageLayoutSchema.value)
    && Boolean(layoutSchema.value)
    && Object.keys(recordData.value).length > 0,
)

const {
  actionRunning,
  actionMessage,
  actionError,
  templatePickerVisible,
  templatePickerLoading,
  publishedTemplates,
  docValueListVisible,
  docValueListLoading,
  docValueListItems,
  fillDialogVisible,
  fillTemplateId,
  fillDocValueId,
  fillExportMode,
  fillAttachFile,
  viewDialogVisible,
  viewTemplateId,
  viewDocValueId,
  viewMode,
  viewAutoSave,
  viewAttachFile,
  numberPromptVisible,
  numberPromptLabel,
  numberPromptHeader,
  runEntityAction,
  onNumberPromptConfirm,
  onExistingDocumentSelected,
  onNewDocumentFromList,
  onRuntimeTemplateSelected,
} = useEntityRecordActions({
  collection: () => props.collection,
  recordId: () => recordId.value,
  record: () => recordData.value,
  onRefresh: () => refreshRecord(),
})

watch(
  () => [props.collection, props.parentId, permissionsReady.value, canReadRecord.value] as const,
  ([collection, parentId, ready, canRead]) => {
    if (!collection || parentId === undefined || parentId === null || parentId === '') {
      resetState()
      return
    }
    if (!ready) return
    if (!canRead) {
      resetState()
      loadError.value = t(
        'objectList.detailNoReadPermission',
        'You do not have permission to view this record.',
      )
      return
    }
    void loadFullPageDetail(collection, String(parentId))
  },
  { immediate: true },
)

function resetState(): void {
  loadToken += 1
  loading.value = false
  loadError.value = null
  pageLayoutSchema.value = null
  layoutSchema.value = null
  recordData.value = {}
  detailActions.value = []
  editDialogVisible.value = false
  actionMessage.value = null
  actionError.value = null
}

function walkPageComponents(
  components: RecordPageComponent[],
  visit: (component: RecordPageComponent) => boolean | void,
): boolean {
  for (const component of components) {
    if (visit(component) === true) return true
    if (component.type === 'fieldGroup' && component.components) {
      if (walkPageComponents(component.components, visit)) return true
    }
    if (component.tabs) {
      for (const tab of component.tabs) {
        if (walkPageComponents(tab.components, visit)) return true
      }
    }
  }
  return false
}

async function resolveDetailActions(
  pageLayout: RecordPageLayoutSchema | null,
  fallback: EntityLayoutSchema | null,
): Promise<EntityAction[]> {
  let explicitActionLayoutId: string | null = null
  let foundHighlights = false

  if (pageLayout) {
    for (const region of pageLayout.regions) {
      walkPageComponents(region.components, (component) => {
        if (component.type === 'highlights') {
          foundHighlights = true
          explicitActionLayoutId = component.actionLayoutId?.trim() || null
          return true
        }
      })
      if (foundHighlights) break
    }

    if (!foundHighlights) {
      for (const region of pageLayout.regions) {
        walkPageComponents(region.components, (component) => {
          if (component.type === 'actions') {
            explicitActionLayoutId = component.actionLayoutId?.trim() || null
            return true
          }
        })
        if (explicitActionLayoutId) break
      }
    }
  }

  if (explicitActionLayoutId) {
    const layout = await loadEntityLayoutById(
      pageLayout?.entity ?? fallback?.entity ?? '',
      explicitActionLayoutId,
    )
    if (layout?.actions?.length) return layout.actions
  }

  return fallback?.actions ?? []
}

function pathLayoutExtraFields(): LayoutFieldMetadata[] {
  return collectPathLayoutExtraFields(pageLayoutSchema.value)
}

async function loadFullPageDetail(collection: string, id: string): Promise<void> {
  const token = ++loadToken
  loading.value = true
  loadError.value = null
  pageLayoutSchema.value = null
  layoutSchema.value = null
  recordData.value = {}
  detailActions.value = []
  editDialogVisible.value = false

  try {
    const { pageLayout, blockLayout: schema } = await resolvePreferredBlockLayoutForCurrentUser(
      collection,
    )
    if (token !== loadToken) return

    if (!pageLayout) {
      loadError.value = t(
        'objectList.detailNoPageLayout',
        'No Page Layout found for this object. Configure a Page Layout for the detail panel.',
      )
      return
    }
    if (!schema) {
      loadError.value = t(
        'objectList.detailNoBlockLayout',
        'Page Layout is configured, but no Block Layout was found for this object.',
      )
      return
    }

    const record = await fetchObjectRecordForEdit(
      collection,
      id,
      schema,
      collectPathLayoutExtraFields(pageLayout),
    )
    if (token !== loadToken) return

    pageLayoutSchema.value = pageLayout
    layoutSchema.value = schema
    recordData.value = record
    detailActions.value = await resolveDetailActions(pageLayout, schema)
  } catch (err) {
    if (token !== loadToken) return
    loadError.value =
      err instanceof Error
        ? err.message
        : t('objectList.detailLoadRecordError', 'Failed to load record details.')
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function refreshRecord(): Promise<void> {
  if (!layoutSchema.value || !hasParent.value) return
  try {
    const record = await fetchObjectRecordForEdit(
      props.collection,
      recordId.value,
      layoutSchema.value,
      pathLayoutExtraFields(),
    )
    recordData.value = record
    emit('record-updated', record)
  } catch {
    // Keep current record if silent refresh fails.
  }
}

function handleBlocksSaved(payload: { field: string; value: unknown }): void {
  recordData.value = {
    ...recordData.value,
    [payload.field]: payload.value,
  }
  emit('record-updated', recordData.value)
}

async function handlePathChange(payload: { updates: Record<string, unknown> }): Promise<void> {
  if (
    pathSaving.value
    || loading.value
    || deleting.value
    || restoring.value
    || isArchivedRecord.value
    || !canUpdateRecord.value
    || !hasParent.value
  ) {
    return
  }

  const updates = payload.updates
  if (!updates || typeof updates !== 'object') return

  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(updates)) {
    const field = key.trim()
    if (!field) continue
    const current = recordData.value[field]
    const same =
      (current === null || current === undefined || current === '')
      && (value === null || value === undefined || value === '')
        ? true
        : String(current ?? '') === String(value ?? '')
    if (!same) changed[field] = value
  }
  if (Object.keys(changed).length === 0) return

  pathSaving.value = true
  try {
    await updateObjectRecord(props.collection, recordId.value, changed)
    if (layoutSchema.value) {
      const refreshed = await fetchObjectRecordForEdit(
        props.collection,
        recordId.value,
        layoutSchema.value,
        pathLayoutExtraFields(),
      )
      recordData.value = { ...refreshed, ...changed }
    } else {
      recordData.value = { ...recordData.value, ...changed }
    }
    emit('record-updated', recordData.value)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('recordPage.path.stageChanged', 'Stage changed successfully.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('recordPage.path.saveError', 'Failed to update stage.'),
      life: 5000,
    })
  } finally {
    pathSaving.value = false
  }
}

async function handleRelatedChanged(): Promise<void> {
  await refreshRecord()
}

function openEditDialog(): void {
  if (!canUpdateRecord.value || isArchivedRecord.value) return
  editDialogVisible.value = true
}

function onEditUpdated(record: Record<string, unknown>): void {
  recordData.value = { ...recordData.value, ...record }
  editDialogVisible.value = false
  emit('record-updated', recordData.value)
  void refreshRecord()
}

function onEditDeleted(id: string | number): void {
  editDialogVisible.value = false
  emit('record-deleted', id)
}

function deleteCurrentRecord(): void {
  if (!canDeleteRecord.value || !hasParent.value) return
  if (isArchivedRecord.value) {
    restoreCurrentRecord()
    return
  }
  setTimeout(() => {
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
        void archiveCurrentRecordConfirmed()
      },
    })
  }, 0)
}

function restoreCurrentRecord(): void {
  setTimeout(() => {
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
        void restoreCurrentRecordConfirmed()
      },
    })
  }, 0)
}

async function archiveCurrentRecordConfirmed(): Promise<void> {
  if (!hasParent.value) return
  deleting.value = true
  try {
    await archiveObjectRecord(props.collection, recordId.value)
    emit('record-deleted', props.parentId as string | number)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('datatable.deleteSuccess', 'Record deleted.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('datatable.deleteError', 'Failed to delete record.'),
      life: 5000,
    })
  } finally {
    deleting.value = false
  }
}

async function restoreCurrentRecordConfirmed(): Promise<void> {
  if (!hasParent.value) return
  restoring.value = true
  try {
    const restored = await restoreObjectRecord(props.collection, recordId.value)
    recordData.value = { ...recordData.value, ...restored, is_deleted: false }
    emit('record-updated', recordData.value)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('datatable.restoreSuccess', 'Record restored.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('datatable.restoreError', 'Failed to restore record.'),
      life: 5000,
    })
  } finally {
    restoring.value = false
  }
}

</script>

<template>
  <div class="object-list-full-page-detail flex h-full min-h-0 flex-col overflow-hidden">
    <p
      v-if="!hasParent"
      class="m-0 px-3 py-4 text-sm text-muted-color"
    >
      {{
        t(
          'objectList.detailSelectRecordFull',
          'Select a record to see its details.',
        )
      }}
    </p>

    <div
      v-else-if="loading"
      class="flex items-center gap-2 px-3 py-4 text-sm text-muted-color"
    >
      <ProgressSpinner style="width: 1.25rem; height: 1.25rem" stroke-width="6" />
      <span>{{ t('objectList.detailLoadingRecord', 'Loading record…') }}</span>
    </div>

    <Message
      v-else-if="loadError"
      severity="error"
      :closable="false"
      class="m-2"
    >
      {{ loadError }}
    </Message>

    <template v-else-if="showRenderer && pageLayoutSchema && layoutSchema">
      <Message
        v-if="actionError"
        severity="error"
        :closable="true"
        class="m-2 mb-0"
        @close="actionError = null"
      >
        {{ actionError }}
      </Message>
      <Message
        v-else-if="actionMessage"
        severity="success"
        :closable="true"
        class="m-2 mb-0"
        @close="actionMessage = null"
      >
        {{ actionMessage }}
      </Message>

      <div class="object-list-full-page-detail__scroll min-h-0 flex-1 overflow-auto">
        <RecordPageRenderer
          :page-layout="pageLayoutSchema"
          :default-block-layout="layoutSchema"
          :model-value="recordData"
          :collection="collection"
          :record-id="recordId"
          m2a-editable
          :actions="detailActions"
          :action-running="actionRunning"
          :actions-disabled="isArchivedRecord"
          :deleting="deleting || restoring"
          :record-archived="isArchivedRecord"
          :path-saving="pathSaving"
          @blocks-saved="handleBlocksSaved"
          @path-change="handlePathChange"
          @related-changed="handleRelatedChanged"
          @run-action="runEntityAction"
          @edit-record="openEditDialog"
          @delete-record="deleteCurrentRecord"
        />
      </div>
    </template>

    <RecordEditDialog
      v-model:visible="editDialogVisible"
      :collection="collection"
      :record-id="parentId ?? null"
      allow-delete
      @updated="onEditUpdated"
      @deleted="onEditDeleted"
    />

    <DocTemplatePickerDialog
      v-model:visible="templatePickerVisible"
      :templates="publishedTemplates"
      :loading="templatePickerLoading"
      @select="onRuntimeTemplateSelected"
    />

    <DocValueListDialog
      v-model:visible="docValueListVisible"
      :documents="docValueListItems"
      :loading="docValueListLoading"
      @select="onExistingDocumentSelected"
      @new-document="onNewDocumentFromList"
    />

    <DocFillDialog
      v-if="hasParent && fillTemplateId"
      v-model:visible="fillDialogVisible"
      :collection="collection"
      :record-id="recordId"
      :template-id="fillTemplateId"
      :doc-value-id="fillDocValueId"
      :export-mode="fillExportMode"
      :attach-file="fillAttachFile"
    />

    <DocViewDialog
      v-if="hasParent && viewTemplateId"
      v-model:visible="viewDialogVisible"
      :collection="collection"
      :record-id="recordId"
      :template-id="viewTemplateId"
      :doc-value-id="viewDocValueId"
      :view-mode="viewMode"
      :auto-save="viewAutoSave"
      :attach-file="viewAttachFile"
      @attached="() => void refreshRecord()"
    />

    <ActionNumberPromptDialog
      v-model:visible="numberPromptVisible"
      :header="numberPromptHeader"
      :label="numberPromptLabel"
      @confirm="onNumberPromptConfirm"
    />
  </div>
</template>
