<script lang="ts">
export default {
  name: 'AttachedDataTableField',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import FilePreview from './FilePreview.vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  useFiles,
  fileItemId,
  fileItemName,
  fileItemMime,
  fileIsImage,
  fileIsUnavailable,
  fileAssetUrl,
  fileColumnValue,
  fileColumnHeader,
  fileColumns,
} from '@/core/useFiles'
import { filesItemsToO2MPayload, isFilesAssetCollection } from '@/core/filesField'
import { filesSettings } from '@/core/fieldHelpers'
import { useAttachedFileOps } from '@/core/useAttachedFileOps'
import {
  findParentFkField,
  resolveAttachedFilesCollection,
} from '@/modules/entities/services/collectionSchema'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  field: LayoutFieldMetadata
  modelValue: Record<string, unknown>
  parentId?: string | number
  parentName?: string
}>()

const emit = defineEmits<{
  'files-changed': [payload: { field: string; value: Record<string, unknown>[] }]
}>()

const { t } = useTranslation()
const confirm = useConfirm()
const fileStore = useFiles()

const files = computed(() => fileStore.getFiles(props.field.field))
const hasFiles = computed(() => files.value.length > 0)
const isDraggingFiles = ref(false)

function emitFilesChanged(): void {
  emit('files-changed', {
    field: props.field.field,
    value: filesItemsToO2MPayload(files.value as Array<Record<string, unknown>>),
  })
}

watch(
  files,
  () => {
    emitFilesChanged()
  },
  { deep: true },
)

watch(
  [
    () => props.field.field,
    () => props.field.relatedCollection,
    () => props.modelValue,
    () => props.parentName,
    () => props.parentId,
  ],
  () => {
    void (async () => {
      const relatedCollection = await resolveAttachedFilesCollection(
        props.parentName,
        props.field,
      )

      if (!relatedCollection) {
        fileStore.setFiles(props.field.field, [])
        return
      }

      const parent = props.parentName?.trim() ?? ''
      const parentId = props.parentId
      const hasParent =
        parentId !== undefined && parentId !== null && parentId !== ''
      if (hasParent && parent && isFilesAssetCollection(relatedCollection)) {
        await fileStore.loadForRecord(props.field.field, parent, parentId)
        return
      }
      if (hasParent && parent && !isFilesAssetCollection(relatedCollection)) {
        const parentFk = await findParentFkField(relatedCollection, parent)
        if (parentFk) {
          await fileStore.loadByParent(
            props.field.field,
            relatedCollection,
            parentFk,
            parentId,
          )
          return
        }
      }

      await fileStore.load(
        props.field.field,
        relatedCollection,
        props.modelValue[props.field.field],
      )
    })()
  },
  { immediate: true, deep: false },
)

const fileActionMenu = ref<{ toggle: (event: Event) => void } | null>(null)

const fileOps = reactive(useAttachedFileOps({
  field: () => props.field,
  files: () => files.value,
  parentName: () => props.parentName,
  parentId: () => props.parentId,
  filesStore: fileStore,
  t,
  confirm,
  toggleMenu: (e) => fileActionMenu.value?.toggle(e),
}))

function handleDrop(event: DragEvent): void {
  isDraggingFiles.value = false
  const droppedFiles = event.dataTransfer?.files
  if (!droppedFiles?.length) return
  void fileOps.uploadFilesFromList(droppedFiles)
}
</script>

<template>
  <div class="flex items-center justify-between mb-2 w-full">
    <span class="text-surface-700 text-sm font-medium">{{ field.label }}</span>
    <Button
      icon="pi pi-upload"
      :label="t('common.upload', 'Upload')"
      size="small"
      severity="secondary"
      outlined
      :loading="fileOps.uploadLoading"
      @click="fileOps.triggerUpload()"
    />
  </div>

  <Panel class="mb-3">
    <template #header>
      <div class="flex items-center gap-2">
        <i class="pi pi-cloud-upload text-primary" aria-hidden="true" />
        <span class="font-semibold">{{ t('filePreview.uploadPanelTitle', 'Upload attachments') }}</span>
      </div>
    </template>
    <div
      class="flex flex-col items-center justify-center gap-2 min-h-[1.5rem] rounded-lg border-2 border-dashed p-4 text-center transition-colors"
      :class="isDraggingFiles ? 'border-primary bg-primary-50 text-primary' : 'border-surface-300 bg-surface-50 text-surface-600'"
      role="button"
      tabindex="0"
      :aria-label="t('filePreview.dropFiles', 'Drop files here to upload')"
      @dragenter.prevent="isDraggingFiles = true"
      @dragover.prevent="isDraggingFiles = true"
      @dragleave.prevent="isDraggingFiles = false"
      @drop.prevent="handleDrop"
      @keydown.enter.prevent="fileOps.triggerUpload()"
      @keydown.space.prevent="fileOps.triggerUpload()"
    >
      <ProgressSpinner
        v-if="fileOps.uploadLoading"
        style="width: 2rem; height: 2rem"
        stroke-width="4"
      />
      <!-- <i v-else class="pi pi-upload" style="font-size:2rem" aria-hidden="true" /> -->
      <div class="flex flex-col gap-1">
        <span class="font-medium">
          {{ isDraggingFiles
            ? t('filePreview.releaseToUpload', 'Release to upload')
            : t('filePreview.dropFiles', 'Drop files here to upload') }}
        </span>
        <!-- <span class="text-sm text-muted-color">
          {{ filesSettings(field)?.multiple
            ? t('filePreview.dropFilesMultipleHint', 'Drop one or more files, or use the upload button.')
            : t('filePreview.dropFilesSingleHint', 'Drop one file, or use the upload button.') }}
        </span> -->
      </div>
    </div>
  </Panel>

  <DataTable
    v-if="hasFiles"
    :value="files"
    size="small"
    :show-gridlines="false"
    :empty-message="filesSettings(field)?.multiple ? t('filePreview.noAttachments', 'No attachments yet') : t('filePreview.noAttachment', 'No attachment yet')"
  >
    <Column header="" style="width: 3rem; text-align: center">
      <template #body="{ data: item }">
        <i
          v-if="fileIsUnavailable(item)"
          class="pi pi-exclamation-triangle"
          style="font-size:1.2rem;color:var(--p-orange-500)"
          :title="t('filePreview.unavailable', 'File unavailable')"
        />
        <img
          v-else-if="fileIsImage(item) && fileItemId(item)"
          :src="fileAssetUrl(fileItemId(item) ?? '')"
          :alt="fileItemName(item, t('filePreview.attachment', 'Attachment'))"
          style="width:2rem;height:2rem;object-fit:cover;border-radius:4px;display:block"
        />
        <i
          v-else
          :class="fileItemMime(item).includes('pdf') ? 'pi pi-file-pdf' : 'pi pi-paperclip'"
          style="font-size:1.2rem;color:var(--p-text-muted-color)"
        />
      </template>
    </Column>

    <Column :header="t('filePreview.field.title', 'Title')">
      <template #body="{ data: item }">
        <Tag
          v-if="fileIsUnavailable(item)"
          severity="warn"
          :value="t('filePreview.unavailable', 'File unavailable')"
        />
        <Button
          v-else
          :label="fileItemName(item, t('filePreview.attachment', 'Attachment'))"
          link
          size="small"
          class="p-0"
          @click="fileOps.openPreview(item)"
        />
      </template>
    </Column>

    <Column
      v-for="col in fileColumns(props.field, t)"
      :key="col.field"
      :header="fileColumnHeader(col.field, col.header, t)"
    >
      <template #body="{ data: item }">
        {{ fileColumnValue(item, col.field) || '—' }}
      </template>
    </Column>

    <Column header="" style="width: 3.5rem; text-align: center">
      <template #body="{ data: item }">
        <Button
          icon="pi pi-ellipsis-v"
          severity="secondary"
          outlined
          size="small"
          :disabled="!!fileOps.deleteLoading[item.id]"
          @click="fileOps.openFileActionMenu($event, item)"
        />
      </template>
    </Column>
  </DataTable>

  <Menu ref="fileActionMenu" :model="fileOps.fileActionMenuItems" :popup="true" />

  <FilePreview
    :visible="fileOps.previewVisible"
    :file="fileOps.previewFileData"
    @update:visible="fileOps.previewVisible = $event"
    @file-updated="fileOps.handleFileUpdated"
  />
</template>
