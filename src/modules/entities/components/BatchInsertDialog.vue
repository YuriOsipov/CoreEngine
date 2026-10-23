<script lang="ts">
export default {
  name: 'BatchInsertDialog',
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { RelatedTransferSettings } from '@/interfaces'
import {
  loadBatchInsertDialogMaximized,
  saveBatchInsertDialogMaximized,
} from '@/core/batchInsertDialogState'
import { useTranslation } from '@/core/translation'
import RelatedTransferField from '@/modules/entities/components/RelatedTransferField.vue'

const props = defineProps<{
  visible: boolean
  settings: RelatedTransferSettings | null | undefined
  label?: string
  parentRecord: Record<string, unknown>
  parentCollection?: string
  parentId?: string | number
  targetParentField?: string
  currentTargetRows?: Record<string, unknown>[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  submitted: [targetCollection: string]
}>()

const { t } = useTranslation()

type BatchInsertDialogInstance = {
  maximized?: boolean
  maximize?: (event?: Event) => void
}

const dialogRef = ref<BatchInsertDialogInstance | null>(null)
const maximized = ref(loadBatchInsertDialogMaximized())

const header = computed(() =>
  t('relatedTransfer.batchInsertHeader', 'Batch insert {label}', {
    label: props.label || t('relatedTransfer.batchInsert', 'Batch insert'),
  }),
)

const dialogStyle = computed(() =>
  maximized.value
    ? { width: '100vw', height: '100vh', maxHeight: '100vh' }
    : { width: 'min(1500px, 98vw)', height: '96vh', maxHeight: '96vh' },
)

const contentStyle = computed(() => ({
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: '0',
  flex: '1 1 auto',
}))

watch(maximized, (value) => {
  saveBatchInsertDialogMaximized(value)
})

function onMaximize(): void {
  maximized.value = true
}

function onUnmaximize(): void {
  maximized.value = false
}

async function onShow(): Promise<void> {
  if (!maximized.value) return
  await nextTick()
  const dialog = dialogRef.value
  if (dialog && !dialog.maximized && typeof dialog.maximize === 'function') {
    dialog.maximize(new Event('restore-maximized'))
  }
}

function onSubmitted(targetCollection: string): void {
  emit('submitted', targetCollection)
}
</script>

<template>
  <Dialog
    v-if="settings"
    ref="dialogRef"
    :visible="visible"
    modal
    maximizable
    :header="header"
    :style="dialogStyle"
    :content-style="contentStyle"
    @update:visible="emit('update:visible', $event)"
    @show="onShow"
    @maximize="onMaximize"
    @unmaximize="onUnmaximize"
  >
    <RelatedTransferField
      :settings="settings"
      :label="label"
      :parent-record="parentRecord"
      :parent-collection="parentCollection"
      :parent-id="parentId"
      :target-parent-field="targetParentField"
      :current-target-rows="currentTargetRows"
      @submitted="onSubmitted"
    />
  </Dialog>
</template>
