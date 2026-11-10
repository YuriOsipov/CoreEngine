<script lang="ts">
export default {
  name: 'AttachedDataTableField',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import FilePreview from './FilePreview.vue'
import CrmFilePickerDialog, {
  type PickedFileAsset,
} from '@/core/ui-kit/CrmFilePickerDialog.vue'
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
  resolvedFileObj,
} from '@/core/useFiles'
import { fileAssetUrl as proxyFileAssetUrl } from '@/core/graphql/filesProxy'
import {
  dataTransferHasCoreEngineFile,
  filesItemsToO2MPayload,
  imagePreviewPixelSize,
  isFilesAssetCollection,
  readCoreEngineFileDragData,
  resolveFilesUploadConstraints,
  resolveImagePreviewSize,
  singleFileM2OPayload,
  writeCoreEngineFileDragData,
} from '@/core/filesField'
import {
  filesSettings,
  isImageField,
  isSingleFileField,
} from '@/core/fieldHelpers'
import { useAttachedFileOps } from '@/core/useAttachedFileOps'
import {
  findParentFkField,
  getCachedCollectionFields,
  resolveAttachedFilesCollection,
} from '@/modules/entities/services/collectionSchema'
import { useTranslation } from '@/core/translation'
import type { FieldDefinition } from '@/interfaces'
import { keysEqual } from '@/core/utils/object'

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    modelValue: Record<string, unknown>
    parentId?: string | number
    parentName?: string
    /** View mode: show preview only; upload/replace/remove in edit form. */
    readonly?: boolean
  }>(),
  {
    readonly: false,
  },
)

const emit = defineEmits<{
  'files-changed': [payload: { field: string; value: Record<string, unknown>[] }]
}>()

const { t } = useTranslation()
const confirm = useConfirm()
const fileStore = useFiles()

const files = computed(() => fileStore.getFiles(props.field.field))
const hasFiles = computed(() => files.value.length > 0)
const isDraggingFiles = ref(false)
const pickerVisible = ref(false)
const singleMode = computed(() => isSingleFileField(props.field))
const imageMode = computed(() => isImageField(props.field))
const currentFile = computed(() => files.value[0] ?? null)
const currentFileId = computed(() =>
  currentFile.value ? fileItemId(currentFile.value) : undefined,
)
const fieldDefinition = ref<FieldDefinition | null>(null)
const uploadConstraints = ref<{
  allowedMimeTypes: string[]
  maxFileSizeMb: number | null
}>({ allowedMimeTypes: [], maxFileSizeMb: null })
const previewSize = computed(() => resolveImagePreviewSize(props.field))
const allowedMimeTypes = computed(() => uploadConstraints.value.allowedMimeTypes)
const imagePreviewUrl = computed(() => {
  if (!currentFileId.value) return ''
  const px = imagePreviewPixelSize(previewSize.value)
  return proxyFileAssetUrl(currentFileId.value, {
    width: px,
    height: px,
    fit: 'cover',
  })
})

watch(
  [() => props.parentName, () => props.field.field, () => props.field.files],
  () => {
    void (async () => {
      const entity = props.parentName?.trim()
      if (!entity) {
        fieldDefinition.value = null
      } else {
        try {
          const fields = (await getCachedCollectionFields(entity)) as FieldDefinition[]
          fieldDefinition.value =
            fields.find((item) => keysEqual(item.field, props.field.field)) ?? null
        } catch {
          fieldDefinition.value = null
        }
      }
      uploadConstraints.value = await resolveFilesUploadConstraints(
        props.field,
        fieldDefinition.value,
      )
    })()
  },
  { immediate: true },
)

function openExistingPicker(): void {
  if (props.readonly) return
  pickerVisible.value = true
}

function handleExistingSelected(selected: PickedFileAsset[]): void {
  void fileOps.linkExistingFiles(selected)
}

function currentFilesPayload(): Record<string, unknown>[] {
  if (isSingleFileField(props.field)) {
    return files.value
      .map((item) => {
        const id = fileItemId(item)
        if (!id) return null
        return { id, ...resolvedFileObj(item) } as Record<string, unknown>
      })
      .filter(Boolean) as Record<string, unknown>[]
  }
  return filesItemsToO2MPayload(files.value as Array<Record<string, unknown>>)
}

function filesPayloadSignature(value: unknown): string {
  if (isSingleFileField(props.field)) {
    return singleFileM2OPayload(value)?.id ?? ''
  }
  const rows = Array.isArray(value) ? value : []
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return ''
      const record = row as Record<string, unknown>
      const nested = record.file_id
      if (nested && typeof nested === 'object') {
        return String((nested as { id?: unknown }).id ?? '')
      }
      return String(record.id ?? nested ?? '')
    })
    .filter(Boolean)
    .sort()
    .join('|')
}

/** Push store changes to the form only when the file id set actually changes. */
function emitFilesChanged(): void {
  const value = currentFilesPayload()
  if (
    filesPayloadSignature(value) ===
    filesPayloadSignature(props.modelValue[props.field.field])
  ) {
    return
  }
  emit('files-changed', {
    field: props.field.field,
    value,
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
    () => props.modelValue[props.field.field],
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
      // Single-file Image M2O: always hydrate from the parent FK value.
      if (isSingleFileField(props.field)) {
        await fileStore.load(
          props.field.field,
          relatedCollection,
          props.modelValue[props.field.field],
        )
        return
      }
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

function handleDragOver(event: DragEvent): void {
  if (props.readonly) return
  const hasCoreEngineFile = dataTransferHasCoreEngineFile(event.dataTransfer)
  const hasOsFiles = Boolean(event.dataTransfer?.types?.includes('Files'))
  if (!hasCoreEngineFile && !hasOsFiles) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = hasCoreEngineFile ? 'copy' : 'copy'
  }
  isDraggingFiles.value = true
}

function handleDrop(event: DragEvent): void {
  if (props.readonly) return
  isDraggingFiles.value = false
  const coreEngineFile = readCoreEngineFileDragData(event.dataTransfer)
  if (coreEngineFile) {
    void fileOps.linkDraggedCoreEngineFiles([coreEngineFile])
    return
  }
  const droppedFiles = event.dataTransfer?.files
  if (!droppedFiles?.length) return
  void fileOps.uploadFilesFromList(droppedFiles)
}

function handleAttachedFileDragStart(event: DragEvent, item: (typeof files.value)[number]): void {
  if (props.readonly) return
  const id = fileItemId(item)
  if (!id) {
    event.preventDefault()
    return
  }
  const meta = resolvedFileObj(item)
  writeCoreEngineFileDragData(event.dataTransfer, {
    id,
    filename_download:
      typeof meta.filename_download === 'string' ? meta.filename_download : undefined,
    type: typeof meta.type === 'string' ? meta.type : undefined,
    filesize:
      typeof meta.filesize === 'number'
        ? meta.filesize
        : meta.filesize == null
          ? null
          : Number(meta.filesize),
    title: typeof meta.title === 'string' ? meta.title : null,
    created_on: typeof meta.created_on === 'string' ? meta.created_on : null,
    uploaded_by: meta.uploaded_by,
    width:
      typeof meta.width === 'number'
        ? meta.width
        : meta.width == null
          ? null
          : Number(meta.width),
    height:
      typeof meta.height === 'number'
        ? meta.height
        : meta.height == null
          ? null
          : Number(meta.height),
  })
}

function clearCurrentFile(): void {
  if (props.readonly || !currentFile.value) return
  fileOps.promptDeleteFile(currentFile.value)
}
</script>

<template>
  <!-- Single Image / single-file field -->
  <div
    v-if="singleMode"
    class="crm-single-file-field"
    :class="{
      'crm-single-file-field--image': imageMode,
      [`crm-image-field--${previewSize}`]: imageMode,
    }"
  >
    <div
      v-if="imageMode && currentFileId && !fileIsUnavailable(currentFile!)"
      class="crm-image-field__preview"
    >
      <button
        type="button"
        class="crm-image-field__thumb"
        :aria-label="t('filePreview.previewImage', 'Preview image')"
        @click="fileOps.openPreview(currentFile!)"
      >
        <img
          :src="imagePreviewUrl"
          :alt="fileItemName(currentFile!, t('filePreview.image', 'Image'))"
        />
      </button>
      <div
        v-if="!readonly"
        class="crm-image-field__actions"
      >
        <Button
          icon="pi pi-upload"
          :label="t('filePreview.replaceImage', 'Replace')"
          size="small"
          severity="secondary"
          outlined
          :loading="fileOps.uploadLoading"
          @click="fileOps.triggerUpload()"
        />
        <Button
          icon="pi pi-link"
          :label="t('filePreview.chooseExisting', 'Choose existing')"
          size="small"
          severity="secondary"
          outlined
          :loading="fileOps.uploadLoading"
          @click="openExistingPicker()"
        />
        <Button
          icon="pi pi-trash"
          :label="t('common.remove', 'Remove')"
          size="small"
          severity="danger"
          text
          :loading="!!fileOps.deleteLoading[currentFileId]"
          @click="clearCurrentFile()"
        />
      </div>
    </div>

    <div
      v-else-if="!imageMode && hasFiles && currentFile"
      class="crm-single-file-field__row"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <i
          v-if="fileIsUnavailable(currentFile)"
          class="pi pi-exclamation-triangle text-orange-500"
          aria-hidden="true"
        />
        <img
          v-else-if="fileIsImage(currentFile) && currentFileId"
          :src="fileAssetUrl(currentFileId)"
          :alt="fileItemName(currentFile)"
          class="crm-single-file-field__mini"
        />
        <i
          v-else
          class="pi pi-paperclip text-muted-color"
          aria-hidden="true"
        />
        <Button
          v-if="!fileIsUnavailable(currentFile)"
          :label="fileItemName(currentFile, t('filePreview.attachment', 'Attachment'))"
          link
          size="small"
          class="p-0 truncate"
          @click="fileOps.openPreview(currentFile)"
        />
        <Tag
          v-else
          severity="warn"
          :value="t('filePreview.unavailable', 'File unavailable')"
        />
      </div>
      <div
        v-if="!readonly"
        class="flex items-center gap-1 shrink-0"
      >
        <Button
          icon="pi pi-upload"
          size="small"
          severity="secondary"
          outlined
          :loading="fileOps.uploadLoading"
          :aria-label="t('common.upload', 'Upload')"
          @click="fileOps.triggerUpload()"
        />
        <Button
          icon="pi pi-link"
          size="small"
          severity="secondary"
          outlined
          :loading="fileOps.uploadLoading"
          :aria-label="t('filePreview.chooseExisting', 'Choose existing')"
          @click="openExistingPicker()"
        />
        <Button
          icon="pi pi-trash"
          size="small"
          severity="danger"
          text
          :aria-label="t('common.remove', 'Remove')"
          @click="clearCurrentFile()"
        />
      </div>
    </div>

    <div
      v-else-if="readonly"
      class="crm-image-field__empty crm-image-field__empty--readonly"
    >
      <i
        class="pi text-2xl"
        :class="imageMode ? 'pi-image' : 'pi-paperclip'"
        aria-hidden="true"
      />
      <span class="font-medium text-muted-color">
        {{
          imageMode
            ? t('filePreview.noImage', 'No image')
            : t('filePreview.noAttachment', 'No attachment yet')
        }}
      </span>
    </div>

    <div
      v-else
      class="crm-image-field__empty"
      :class="isDraggingFiles ? 'crm-image-field__empty--active' : ''"
      @dragenter.prevent="handleDragOver"
      @dragover="handleDragOver"
      @dragleave.prevent="isDraggingFiles = false"
      @drop.prevent="handleDrop"
    >
      <ProgressSpinner
        v-if="fileOps.uploadLoading"
        style="width: 2rem; height: 2rem"
        stroke-width="4"
      />
      <template v-else>
        <i
          class="pi text-2xl"
          :class="imageMode ? 'pi-image' : 'pi-upload'"
          aria-hidden="true"
        />
        <span class="font-medium">
          {{
            isDraggingFiles
              ? t('filePreview.releaseToUpload', 'Release to upload')
              : imageMode
                ? t('filePreview.dropImage', 'Drop an image here, or choose below')
                : t('filePreview.dropFilesSingleHint', 'Drop one file, or choose below')
          }}
        </span>
        <div class="crm-image-field__actions">
          <Button
            icon="pi pi-upload"
            :label="t('common.upload', 'Upload')"
            size="small"
            severity="secondary"
            outlined
            @click.stop="fileOps.triggerUpload()"
          />
          <Button
            icon="pi pi-link"
            :label="t('filePreview.chooseExisting', 'Choose existing')"
            size="small"
            severity="secondary"
            outlined
            @click.stop="openExistingPicker()"
          />
        </div>
      </template>
    </div>
  </div>

  <!-- Multi-file attachments -->
  <template v-else>
    <div class="flex items-center justify-between mb-2 w-full gap-2">
      <span class="text-surface-700 text-sm font-medium">{{ field.label }}</span>
      <div
        v-if="!readonly"
        class="flex items-center gap-1"
      >
        <Button
          icon="pi pi-upload"
          :label="t('common.upload', 'Upload')"
          size="small"
          severity="secondary"
          outlined
          :loading="fileOps.uploadLoading"
          @click="fileOps.triggerUpload()"
        />
        <Button
          icon="pi pi-link"
          :label="t('filePreview.chooseExisting', 'Choose existing')"
          size="small"
          severity="secondary"
          outlined
          :loading="fileOps.uploadLoading"
          @click="openExistingPicker()"
        />
      </div>
    </div>

    <Panel
      v-if="!readonly"
      class="mb-3"
    >
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
        @dragenter.prevent="handleDragOver"
        @dragover="handleDragOver"
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
        <div class="flex flex-col gap-1">
          <span class="font-medium">
            {{ isDraggingFiles
              ? t('filePreview.releaseToLinkOrUpload', 'Release to link or upload')
              : t('filePreview.dropFiles', 'Drop files here to upload') }}
          </span>
        </div>
      </div>
    </Panel>

    <DataTable
      v-if="hasFiles"
      :value="files"
      size="small"
      :show-gridlines="false"
      :empty-message="t('filePreview.noAttachments', 'No attachments yet')"
      row-hover
    >
      <Column header="" style="width: 4.5rem; text-align: center">
        <template #body="{ data: item }">
          <div class="inline-flex items-center gap-1">
            <i
              v-if="!readonly && !fileIsUnavailable(item)"
              class="pi pi-bars cursor-grab active:cursor-grabbing text-muted-color"
              draggable="true"
              :title="t('filePreview.dragToLink', 'Drag to link onto another record’s Files drop zone')"
              @dragstart="handleAttachedFileDragStart($event, item)"
            />
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
              draggable="false"
            />
            <i
              v-else
              :class="fileItemMime(item).includes('pdf') ? 'pi pi-file-pdf' : 'pi pi-paperclip'"
              style="font-size:1.2rem;color:var(--p-text-muted-color)"
            />
          </div>
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

      <Column
        v-if="!readonly"
        header=""
        style="width: 3.5rem; text-align: center"
      >
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
  </template>

  <Menu ref="fileActionMenu" :model="fileOps.fileActionMenuItems" :popup="true" />

  <FilePreview
    :visible="fileOps.previewVisible"
    :file="fileOps.previewFileData"
    @update:visible="fileOps.previewVisible = $event"
    @file-updated="fileOps.handleFileUpdated"
  />

  <CrmFilePickerDialog
    v-model:visible="pickerVisible"
    :allowed-mime-types="allowedMimeTypes"
    :multiple="!singleMode"
    @select="handleExistingSelected"
  />
</template>

<style scoped>
.crm-single-file-field {
  width: 100%;
}

.crm-image-field__preview {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}

.crm-image-field__thumb {
  display: block;
  padding: 0;
  border: 1px solid var(--p-content-border-color, var(--p-surface-200));
  border-radius: 0.5rem;
  background: var(--p-surface-50);
  overflow: hidden;
  cursor: pointer;
  max-width: 16rem;
  width: 100%;
}

.crm-image-field--sm .crm-image-field__thumb,
.crm-image-field--sm .crm-image-field__empty {
  max-width: 6rem;
}

.crm-image-field--md .crm-image-field__thumb,
.crm-image-field--md .crm-image-field__empty {
  max-width: 16rem;
}

.crm-image-field--lg .crm-image-field__thumb,
.crm-image-field--lg .crm-image-field__empty {
  max-width: 24rem;
}

.crm-image-field--fill .crm-image-field__thumb,
.crm-image-field--fill .crm-image-field__empty {
  max-width: 100%;
}

.crm-image-field--fill .crm-image-field__thumb img {
  aspect-ratio: 16 / 9;
}

.crm-image-field__thumb img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.crm-image-field__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.crm-image-field__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 8rem;
  max-width: 16rem;
  width: 100%;
  padding: 1rem;
  border: 2px dashed var(--p-surface-300);
  border-radius: 0.5rem;
  background: var(--p-surface-50);
  color: var(--p-text-muted-color);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.crm-image-field__empty--active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  color: var(--p-primary-color);
}

.crm-image-field__empty--readonly {
  cursor: default;
  border-style: solid;
  min-height: 5rem;
}

.crm-single-file-field__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.crm-single-file-field__mini {
  width: 2rem;
  height: 2rem;
  object-fit: cover;
  border-radius: 0.25rem;
  display: block;
  flex-shrink: 0;
}
</style>
