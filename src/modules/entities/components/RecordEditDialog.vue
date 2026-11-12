<script lang="ts">
export default {
  name: 'RecordEditDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import FormRenderer from './FormRenderer.vue'
import type { EntityLayoutSchema } from '@/interfaces'
import {
  archiveObjectRecord,
  isRecordArchived,
  restoreObjectRecord,
  fetchObjectRecordForEdit,
  updateObjectRecord,
} from '../services/recordDetails'
import { createLayoutSchema } from '@/core/entityLayoutUtils'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import { buildChangedFormPayload } from '@/core/entityFormPayload'
import { prepareEntityFormDraft } from '@/core/entityFormValues'
import {
  useTranslatedCollection,
  useTranslation,
} from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'
import { useRecordEditAccess } from '@/core/useRecordEditAccess'

const props = defineProps<{
  visible: boolean
  collection: string
  recordId: string | number | null
  primaryKey?: string
  allowDelete?: boolean
  readonlyFields?: string[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  updated: [record: Record<string, unknown>]
  deleted: [id: string | number]
}>()

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()
const { canDelete: canDeleteRecord } = useEntityPermissions(() => props.collection)
const { canEdit: canUpdateRecord } = useRecordEditAccess(
  () => props.collection,
  () => (props.recordId == null ? null : String(props.recordId)),
)
const showDeleteAction = computed(
  () => Boolean(props.allowDelete) && canDeleteRecord.value,
)
const layoutSchema = ref<EntityLayoutSchema | null>(null)
const formDraft = ref<Record<string, unknown>>({})
const formRendererRef = ref<{ validateRequired: () => { valid: boolean; missingLabels: string[] } } | null>(
  null,
)
const originalRecord = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const restoring = ref(false)
const error = ref<string | null>(null)
let loadToken = 0
const collectionLabel = useTranslatedCollection(() => props.collection)

const isArchived = computed(() => isRecordArchived(originalRecord.value))

const editLayoutSchema = computed<EntityLayoutSchema | null>(() => {
  if (!layoutSchema.value) return null
  return createLayoutSchema(layoutSchema.value)
})

watch(
  () => [props.visible, props.recordId] as const,
  ([visible, recordId]) => {
    if (!visible || recordId === null) return
    void prepareDialog()
  },
  { immediate: true },
)

async function prepareDialog(): Promise<void> {
  const recordId = props.recordId
  if (recordId === null) return

  const token = ++loadToken
  loading.value = true
  saving.value = false
  deleting.value = false
  restoring.value = false
  error.value = null
  layoutSchema.value = null
  formDraft.value = {}
  originalRecord.value = null

  try {
    const { blockLayout: schema } = await resolvePreferredBlockLayoutForCurrentUser(
      props.collection,
    )
    if (token !== loadToken) return

    if (!schema) {
      error.value = t(
        'recordEdit.noSavedDetailLayout',
        'No saved detail layout found for "{collection}".',
        { collection: collectionLabel.value },
      )
      return
    }

    const editSchema = createLayoutSchema(schema)
    const record = await fetchObjectRecordForEdit(
      props.collection,
      String(recordId),
      editSchema,
    )
    if (token !== loadToken) return

    layoutSchema.value = schema
    originalRecord.value = structuredClone(record)
    formDraft.value = await prepareEntityFormDraft(
      props.collection,
      editSchema,
      structuredClone(record),
      record,
    )
  } catch (err) {
    if (token !== loadToken) return
    error.value =
      err instanceof Error
        ? err.message
        : t('recordEdit.failedLoad', 'Failed to load record for editing.')
  } finally {
    if (token === loadToken) {
      loading.value = false
    }
  }
}

function updateVisible(visible: boolean): void {
  if ((saving.value || deleting.value) && !visible) return
  emit('update:visible', visible)
  if (!visible) {
    error.value = null
    originalRecord.value = null
  }
}

async function saveRecord(): Promise<void> {
  const recordId = props.recordId
  if (!editLayoutSchema.value || !originalRecord.value || recordId === null) return

  const validation = formRendererRef.value?.validateRequired()
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

  saving.value = true
  error.value = null

  try {
    const payload = await buildChangedFormPayload(
      props.collection,
      editLayoutSchema.value,
      formDraft.value,
      originalRecord.value,
      props.primaryKey ? { primaryKey: props.primaryKey } : undefined,
    )

    if (Object.keys(payload).length === 0) {
      error.value = t('recordEdit.noChanges', 'No changes to save.')
      return
    }

    const updated = await updateObjectRecord(
      props.collection,
      String(recordId),
      payload,
    )
    emit('updated', {
      ...updated,
      ...payload,
      [props.primaryKey ?? 'id']: recordId,
    })
    emit('update:visible', false)
    originalRecord.value = null
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('recordEdit.failedSave', 'Failed to save record.')
  } finally {
    saving.value = false
  }
}

function deleteRecord(): void {
  const recordId = props.recordId
  if (recordId === null) return

  if (isArchived.value) {
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
        void restoreRecordConfirmed(recordId)
      },
    })
    return
  }

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
      void deleteRecordConfirmed(recordId)
    },
  })
}

async function deleteRecordConfirmed(recordId: string | number): Promise<void> {
  deleting.value = true
  error.value = null

  try {
    await archiveObjectRecord(props.collection, String(recordId))
    emit('deleted', recordId)
    emit('update:visible', false)
    originalRecord.value = null
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('datatable.deleteError', 'Failed to delete record.')
  } finally {
    deleting.value = false
  }
}

async function restoreRecordConfirmed(recordId: string | number): Promise<void> {
  restoring.value = true
  error.value = null

  try {
    const restored = await restoreObjectRecord(props.collection, String(recordId))
    originalRecord.value = { ...(originalRecord.value ?? {}), ...restored, is_deleted: false }
    formDraft.value = { ...formDraft.value, is_deleted: false }
    emit('updated', originalRecord.value)
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('datatable.restoreError', 'Failed to restore record.')
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('recordEdit.header', 'Edit {collection}', { collection: collectionLabel })"
    :style="{ width: 'min(960px, 95vw)' }"
    @update:visible="updateVisible"
  >
    <div v-if="loading" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('recordEdit.loading', 'Loading record...') }}</span>
    </div>

    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="collections-message"
    >
      {{ error }}
    </Message>

    <FormRenderer
      v-if="editLayoutSchema && !loading"
      ref="formRendererRef"
      v-model="formDraft"
      :schema="editLayoutSchema"
      :record-id="recordId ?? undefined"
      :parent-name="collection"
      :readonly-fields="readonlyFields"
    />

    <template #footer>
      <Button
        v-if="showDeleteAction"
        :label="isArchived ? t('common.restore', 'Restore') : t('common.delete', 'Delete')"
        :severity="isArchived ? undefined : 'danger'"
        text
        :loading="deleting || restoring"
        :disabled="loading || saving"
        class="mr-auto"
        @click="deleteRecord"
      />
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        :disabled="saving || deleting || restoring"
        @click="updateVisible(false)"
      />
      <Button
        v-if="canUpdateRecord"
        :label="t('common.save', 'Save')"
        :loading="saving"
        :disabled="loading || deleting || restoring || !editLayoutSchema"
        @click="saveRecord"
      />
    </template>
  </Dialog>
</template>
