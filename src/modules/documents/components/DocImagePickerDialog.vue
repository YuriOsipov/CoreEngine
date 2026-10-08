<script lang="ts">
export default {
  name: 'DocImagePickerDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createEmptyImageValue,
  buildFileAssetUrl,
  type ImageValue,
} from '@/core/fileImageValue'
import { uploadFile } from '@/core/graphql/filesProxy'
import { useTranslation } from '@/core/translation'
import {
  closeDocImagePicker,
  useDocImagePicker,
} from '@/modules/documents/composables/useDocImagePicker'
import {
  loadRecordImageAttachments,
  type RecordImageAttachment,
} from '@/modules/documents/services/recordImageAttachments'

const { t } = useTranslation()
const pickerState = useDocImagePicker()

const activeTab = ref('0')
const caption = ref('')
const urlInput = ref('')
const previewUrl = ref('')
const selectedAttachmentId = ref<string | null>(null)
const attachments = ref<RecordImageAttachment[]>([])
const attachmentsLoading = ref(false)
const attachmentsError = ref<string | null>(null)
const uploadLoading = ref(false)
const uploadError = ref<string | null>(null)
const formError = ref<string | null>(null)

const dialogVisible = computed({
  get: () => pickerState.visible,
  set: (value: boolean) => {
    if (!value) cancel()
  },
})

const dialogTitle = computed(() => pickerState.request?.title ?? t('documents.imagePickerTitle', 'Image'))
const hasRecordContext = computed(
  () => Boolean(pickerState.request?.collection && pickerState.request?.recordId),
)

const groupedAttachments = computed(() => {
  const groups = new Map<string, { fieldLabel: string; items: RecordImageAttachment[] }>()

  for (const item of attachments.value) {
    const existing = groups.get(item.fieldKey)
    if (existing) {
      existing.items.push(item)
      continue
    }
    groups.set(item.fieldKey, {
      fieldLabel: item.fieldLabel,
      items: [item],
    })
  }

  return [...groups.values()]
})

function resetForm(): void {
  activeTab.value = '0'
  caption.value = ''
  urlInput.value = ''
  previewUrl.value = ''
  selectedAttachmentId.value = null
  attachments.value = []
  attachmentsLoading.value = false
  attachmentsError.value = null
  uploadLoading.value = false
  uploadError.value = null
  formError.value = null
}

function applyInitialValue(value: ImageValue): void {
  caption.value = value.caption?.trim() ?? ''
  previewUrl.value = value.url?.trim() ?? ''
  urlInput.value = value.url?.trim() ?? ''
}

async function loadAttachments(): Promise<void> {
  const request = pickerState.request
  if (!request?.collection || !request.recordId) {
    attachments.value = []
    return
  }

  attachmentsLoading.value = true
  attachmentsError.value = null

  try {
    attachments.value = await loadRecordImageAttachments(request.collection, request.recordId)
  } catch (err) {
    attachmentsError.value =
      err instanceof Error
        ? err.message
        : t('documents.imagePickerLoadAttachmentsError', 'Failed to load record attachments.')
    attachments.value = []
  } finally {
    attachmentsLoading.value = false
  }
}

watch(
  () => pickerState.visible,
  (visible) => {
    if (!visible) {
      resetForm()
      return
    }

    const request = pickerState.request
    if (!request) return

    applyInitialValue(request.value)
    activeTab.value = hasRecordContext.value ? '0' : '1'
    void loadAttachments()
  },
)

function selectAttachment(item: RecordImageAttachment): void {
  selectedAttachmentId.value = item.fileId
  previewUrl.value = item.assetUrl
  if (!caption.value.trim()) {
    caption.value = item.title
  }
  formError.value = null
}

function onUploadChange(event: Event): void {
  void handleUpload((event.target as HTMLInputElement).files)
}

async function handleUpload(fileList: FileList | null): Promise<void> {
  const file = fileList?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    uploadError.value = t('documents.imagePickerImagesOnly', 'Only image files are supported.')
    return
  }

  uploadLoading.value = true
  uploadError.value = null
  formError.value = null

  try {
    const uploaded = await uploadFile(file)
    previewUrl.value = buildFileAssetUrl(uploaded.id, { width: 1200 })
    selectedAttachmentId.value = null
    if (!caption.value.trim()) {
      caption.value = file.name
    }
  } catch (err) {
    uploadError.value =
      err instanceof Error
        ? err.message
        : t('documents.imagePickerUploadError', 'Failed to upload image.')
  } finally {
    uploadLoading.value = false
  }
}

function applyUrlInput(): void {
  const trimmed = urlInput.value.trim()
  if (!trimmed) return
  previewUrl.value = trimmed
  selectedAttachmentId.value = null
  formError.value = null
}

function buildResult(): ImageValue | null {
  const url = previewUrl.value.trim()
  if (!url) {
    formError.value = t('documents.imagePickerUrlRequired', 'Choose an image or enter a URL.')
    return null
  }

  return {
    url,
    caption: caption.value.trim(),
  }
}

function finish(value: ImageValue): void {
  const request = pickerState.request
  if (!request) return
  request.resolve(value)
  closeDocImagePicker()
}

function confirm(): void {
  if (activeTab.value === '2') {
    applyUrlInput()
  }

  const result = buildResult()
  if (!result) return
  finish(result)
}

function clearValue(): void {
  finish(createEmptyImageValue())
}

function cancel(): void {
  const request = pickerState.request
  if (request) {
    request.reject(new Error('cancelled'))
  }
  closeDocImagePicker()
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogTitle"
    :style="{ width: '36rem' }"
    :draggable="false"
  >
    <div class="flex flex-col gap-4">
      <div
        v-if="previewUrl"
        class="flex justify-center rounded-lg border border-surface-200 bg-surface-50 p-3"
      >
        <img
          :src="previewUrl"
          alt=""
          class="max-h-48 max-w-full object-contain"
        >
      </div>

      <Tabs v-model:value="activeTab">
        <TabList>
          <Tab
            v-if="hasRecordContext"
            value="0"
          >
            {{ t('documents.imagePickerTabAttachments', 'Attachments') }}
          </Tab>
          <Tab value="1">
            {{ t('documents.imagePickerTabUpload', 'Upload') }}
          </Tab>
          <Tab value="2">
            {{ t('documents.imagePickerTabUrl', 'URL') }}
          </Tab>
        </TabList>

        <TabPanels>
          <TabPanel
            v-if="hasRecordContext"
            value="0"
          >
            <div
              v-if="attachmentsLoading"
              class="page-loading py-6"
            >
              <ProgressSpinner stroke-width="4" />
              <span>{{ t('documents.imagePickerLoadingAttachments', 'Loading attachments...') }}</span>
            </div>

            <Message
              v-else-if="attachmentsError"
              severity="error"
              :closable="false"
            >
              {{ attachmentsError }}
            </Message>

            <p
              v-else-if="groupedAttachments.length === 0"
              class="m-0 text-muted-color"
            >
              {{ t('documents.imagePickerNoAttachments', 'No image attachments found on this record.') }}
            </p>

            <div
              v-else
              class="flex max-h-64 flex-col gap-4 overflow-y-auto"
            >
              <div
                v-for="group in groupedAttachments"
                :key="group.fieldLabel"
                class="flex flex-col gap-2"
              >
                <span class="text-sm font-medium text-muted-color">{{ group.fieldLabel }}</span>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    v-for="item in group.items"
                    :key="item.fileId"
                    type="button"
                    class="flex flex-col items-center gap-1 rounded-lg border p-2 text-left transition-colors"
                    :class="selectedAttachmentId === item.fileId
                      ? 'border-primary bg-primary-50'
                      : 'border-surface-200 hover:border-primary-200'"
                    @click="selectAttachment(item)"
                  >
                    <img
                      :src="item.thumbnailUrl"
                      :alt="item.title"
                      class="h-16 w-16 rounded object-cover"
                    >
                    <span class="line-clamp-2 w-full text-xs">{{ item.title }}</span>
                  </button>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="1">
            <div class="flex flex-col gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">
                  {{ t('documents.imagePickerUploadFile', 'Upload file') }}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  :disabled="uploadLoading"
                  @change="onUploadChange"
                >
              </label>
              <Message
                v-if="uploadError"
                severity="error"
                :closable="false"
              >
                {{ uploadError }}
              </Message>
              <p
                v-if="uploadLoading"
                class="m-0 text-sm text-muted-color"
              >
                {{ t('documents.imagePickerUploading', 'Uploading...') }}
              </p>
            </div>
          </TabPanel>

          <TabPanel value="2">
            <div class="flex flex-col gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">
                  {{ t('documents.imagePickerImageUrl', 'Image URL') }}
                </span>
                <InputText
                  v-model="urlInput"
                  fluid
                  placeholder="https://..."
                  @blur="applyUrlInput"
                />
              </label>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">
          {{ t('documents.imagePickerCaption', 'Caption') }}
        </span>
        <InputText
          v-model="caption"
          fluid
          :placeholder="t('documents.imagePickerCaptionPlaceholder', 'Optional caption')"
        />
      </label>

      <Message
        v-if="formError"
        severity="warn"
        :closable="false"
      >
        {{ formError }}
      </Message>
    </div>

    <template #footer>
      <Button
        type="button"
        :label="t('documents.imagePickerClear', 'Clear')"
        severity="secondary"
        text
        @click="clearValue"
      />
      <Button
        type="button"
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        @click="cancel"
      />
      <Button
        type="button"
        :label="t('common.ok', 'OK')"
        :loading="uploadLoading"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
