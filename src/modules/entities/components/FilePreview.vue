<script lang="ts">
export default {
  name: 'FilePreview',
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { getAccessToken } from '@/core/auth/session'
import { updateFileMetadata } from '@/core/graphql/filesProxy'
import { buildFileAssetUrl } from '@/core/fileImageValue'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'
import { fileUserLabel, type FilePreviewData } from '@/core/useFiles'
import { FILES_ASSET_COLLECTION } from '@/core/filesField'
import type { EntityLayoutSchema, LayoutFieldMetadata } from '@/interfaces'
import FormRenderer from './FormRenderer.vue'
import { prepareHtmlAttachmentSrcdoc } from '../utils/htmlAttachmentPreview'

const props = defineProps<{
  visible: boolean
  file: FilePreviewData | null
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
  'file-updated': [file: FilePreviewData]
}>()

const { t } = useTranslation()

const editing = ref(false)
const fullscreen = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)

const textPreviewContent = ref('')
const textPreviewLoading = ref(false)
const textPreviewError = ref<string | null>(null)
const htmlFrameEl = ref<HTMLIFrameElement | null>(null)
const previewDetailsForm = ref<Record<string, unknown>>({})
const editPreviewForm = ref<Record<string, unknown>>({})

let textPreviewRequestId = 0

const FILE_PREVIEW_ENTITY = FILES_ASSET_COLLECTION
const READONLY_PREVIEW_FIELDS = [
  'filename_download',
  'type',
  'filesize',
  'created_on',
  'uploaded_by',
  'width',
  'height',
]

const dialogStyle = computed(() => fullscreen.value
  ? {
      width: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      margin: '0',
    }
  : {
      width: 'min(1120px, 96vw)',
      height: '100vh',
      maxHeight: '100vh',
    },
)

const previewSchema = computed<EntityLayoutSchema>(() => ({
  entity: FILE_PREVIEW_ENTITY,
  version: 1,
  actions: [],
  sections: [
    {
      id: 'file-preview',
      title: '',
      groups: [
        {
          id: 'file-preview-parameters',
          title: t('filePreview.parametersGroup', 'Preview parameters'),
          collapsed: !editing.value,
          fields: [
            previewField(
              'filename_download',
              t('filePreview.field.filename', 'Filename'),
              'InputText',
              6,
            ),
            previewField('title', t('filePreview.field.title', 'Title'), 'InputText', 6),
            previewField(
              'description',
              t('filePreview.field.description', 'Description'),
              'Textarea',
              12,
            ),
            previewField('type', t('filePreview.field.type', 'Type'), 'InputText', 6),
            previewField('filesize', t('filePreview.field.size', 'Size'), 'InputText', 6),
            previewField(
              'created_on',
              t('filePreview.field.uploaded', 'Uploaded'),
              'InputText',
              6,
            ),
            previewField(
              'uploaded_by',
              t('filePreview.field.uploadedBy', 'Uploaded By'),
              'InputText',
              6,
            ),
            previewField('width', t('filePreview.field.width', 'Width'), 'InputText', 3),
            previewField('height', t('filePreview.field.height', 'Height'), 'InputText', 3),
            previewField('tags', t('filePreview.field.tags', 'Tags'), 'InputText', 6),
            previewField('location', t('filePreview.field.location', 'Location'), 'InputText', 6),
            previewField(
              'focal_point_x',
              t('filePreview.field.focalPointX', 'Focal Point X'),
              'InputNumber',
              6,
            ),
            previewField(
              'focal_point_y',
              t('filePreview.field.focalPointY', 'Focal Point Y'),
              'InputNumber',
              6,
            ),
          ],
        },
      ],
    },
  ],
}))

watch(
  () => props.visible,
  (val) => {
    if (!val) {
      editing.value = false
      fullscreen.value = false
      saveError.value = null
    }
  },
)

watch(
  () => props.file,
  () => {
    syncPreviewDetailsForm()
    if (!editing.value) {
      syncEditPreviewForm()
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => [props.visible, props.file?.id, props.file?.type, props.file?.filename_download],
  () => {
    void loadTextPreview()
  },
  { immediate: true },
)

function isImage(): boolean {
  return props.file?.type?.startsWith('image/') ?? false
}

function isPdf(): boolean {
  return props.file?.type === 'application/pdf'
}

function isHtml(): boolean {
  const type = (props.file?.type ?? '').toLowerCase()
  const filename = props.file?.filename_download?.toLowerCase() ?? ''
  return (
    type.startsWith('text/html') ||
    type === 'application/xhtml+xml' ||
    filename.endsWith('.html') ||
    filename.endsWith('.htm')
  )
}

function isText(): boolean {
  if (isHtml()) return false
  const type = props.file?.type ?? ''
  const filename = props.file?.filename_download?.toLowerCase() ?? ''
  return type.startsWith('text/') || filename.endsWith('.txt')
}

function assetUrl(params = ''): string {
  if (!props.file?.id) return ''
  const search = params.startsWith('?') ? params.slice(1) : params
  if (!search) return buildFileAssetUrl(props.file.id)
  const entries = Object.fromEntries(new URLSearchParams(search).entries())
  return buildFileAssetUrl(props.file.id, entries)
}

async function loadTextPreview(): Promise<void> {
  const requestId = ++textPreviewRequestId
  textPreviewContent.value = ''
  textPreviewError.value = null

  if (!props.visible || !props.file?.id || (!isText() && !isHtml())) {
    textPreviewLoading.value = false
    return
  }

  textPreviewLoading.value = true

  try {
    const token = await getAccessToken()
    const response = await fetch(assetUrl(), {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const content = await response.text()
    if (requestId === textPreviewRequestId) {
      textPreviewContent.value = isHtml()
        ? prepareHtmlAttachmentSrcdoc(content)
        : content
    }
  } catch {
    if (requestId === textPreviewRequestId) {
      textPreviewError.value = t('filePreview.textLoadFailed', 'Failed to load text preview.')
    }
  } finally {
    if (requestId === textPreviewRequestId) {
      textPreviewLoading.value = false
      if (isHtml()) {
        nextTick(() => {
          fitHtmlFrame()
        })
      }
    }
  }
}

function fitHtmlFrame(): void {
  // Standalone HTML already includes A4 page chrome and scrolls inside the iframe.
  const iframe = htmlFrameEl.value
  if (!iframe) return
  iframe.style.height = '100%'
}

function fileSizeLabel(bytes?: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function previewField(
  field: string,
  label: string,
  component: LayoutFieldMetadata['component'],
  span = 12,
): LayoutFieldMetadata {
  return {
    id: `file-preview-${field}`,
    field,
    label,
    component,
    span,
  }
}

function tagsArray(file = props.file): string[] {
  return Array.isArray(file?.tags) ? file.tags : []
}

function syncPreviewDetailsForm(file = props.file): void {
  previewDetailsForm.value = {
    filename_download: file?.filename_download ?? '—',
    title: file?.title ?? '—',
    description: file?.description ?? '—',
    type: file?.type ?? '—',
    filesize: fileSizeLabel(file?.filesize),
    created_on: file?.created_on
      ? formatLocalizedDateTime(file.created_on)
      : '—',
    uploaded_by: fileUserLabel(file?.uploaded_by) || '—',
    width: file?.width != null ? String(file.width) : '—',
    height: file?.height != null ? String(file.height) : '—',
    tags: tagsArray(file).join(', ') || '—',
    location: file?.location ?? '—',
    focal_point_x: file?.focal_point_x ?? null,
    focal_point_y: file?.focal_point_y ?? null,
  }
}

function syncEditPreviewForm(): void {
  const file = props.file
  editPreviewForm.value = {
    filename_download: file?.filename_download ?? '—',
    title: file?.title ?? '',
    type: file?.type ?? '—',
    filesize: fileSizeLabel(file?.filesize),
    created_on: file?.created_on
      ? formatLocalizedDateTime(file.created_on)
      : '—',
    uploaded_by: fileUserLabel(file?.uploaded_by) || '—',
    width: file?.width != null ? String(file.width) : '—',
    height: file?.height != null ? String(file.height) : '—',
    description: file?.description ?? '',
    tags: tagsArray(file).join(', '),
    location: file?.location ?? '',
    focal_point_x: file?.focal_point_x ?? null,
    focal_point_y: file?.focal_point_y ?? null,
  }
}

function startEdit(): void {
  if (!props.file) return
  syncEditPreviewForm()
  saveError.value = null
  editing.value = true
}

function cancelEdit(): void {
  syncEditPreviewForm()
  editing.value = false
  saveError.value = null
}

function toggleFullscreen(): void {
  fullscreen.value = !fullscreen.value
}

async function saveEdit(): Promise<void> {
  if (!props.file) return
  saving.value = true
  saveError.value = null
  try {
    const parsedTags = stringPreviewValue('tags')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const payload = {
      title: stringPreviewValue('title') || null,
      description: stringPreviewValue('description') || null,
      tags: parsedTags.length ? parsedTags : null,
      location: stringPreviewValue('location') || null,
      focal_point_x: numberPreviewValue('focal_point_x'),
      focal_point_y: numberPreviewValue('focal_point_y'),
    }

    await updateFileMetadata(props.file.id, payload)
    const updatedFile = { ...props.file, ...payload }
    emit('file-updated', updatedFile)
    syncPreviewDetailsForm(updatedFile)
    editing.value = false
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : t('filePreview.saveFailed', 'Failed to save file metadata.')
  } finally {
    saving.value = false
  }
}

function stringPreviewValue(field: string): string {
  const value = editPreviewForm.value[field]
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function numberPreviewValue(field: string): number | null {
  const value = editPreviewForm.value[field]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}
</script>

<template>
  <Dialog
    :visible="visible"
    :style="dialogStyle"
    :content-style="{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0.75rem' }"
    :modal="true"
    :closable="true"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold truncate">
          {{ file?.title || file?.filename_download || t('filePreview.title', 'File Preview') }}
        </span>
        <Button
          :icon="fullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
          :label="fullscreen
            ? t('filePreview.exitFullscreen', 'Exit full screen')
            : t('filePreview.fullscreen', 'Full screen')"
          :aria-label="fullscreen
            ? t('filePreview.exitFullscreen', 'Exit full screen')
            : t('filePreview.fullscreen', 'Full screen')"
          severity="secondary"
          text
          size="small"
          @click="toggleFullscreen"
        />
      </div>
    </template>

    <div class="file-preview-layout">
    <!-- Preview area -->
    <div
      class="file-preview-media"
      :class="isHtml() ? 'file-preview-media--html' : 'file-preview-media--default'"
    >
      <img
        v-if="isImage()"
        :src="assetUrl()"
        :alt="file?.filename_download"
        class="max-w-full max-h-full object-contain"
      />
      <iframe
        v-else-if="isPdf()"
        :src="assetUrl()"
        class="w-full h-full border-0"
        :title="file?.filename_download"
      />
      <div
        v-else-if="isHtml()"
        class="file-preview-html-stage"
      >
        <div v-if="textPreviewLoading" class="flex items-center justify-center min-h-[12rem] w-full">
          <ProgressSpinner style="width: 2rem; height: 2rem" stroke-width="4" />
        </div>
        <Message v-else-if="textPreviewError" severity="error" :closable="false">
          {{ textPreviewError }}
        </Message>
        <iframe
          v-else
          ref="htmlFrameEl"
          :srcdoc="textPreviewContent"
          class="file-preview-html-frame"
          sandbox="allow-same-origin allow-popups allow-downloads"
          :title="file?.filename_download"
          @load="fitHtmlFrame"
        />
      </div>
      <div
        v-else-if="isText()"
        class="w-full h-full overflow-auto bg-surface-0 text-surface-900 p-2"
      >
        <div v-if="textPreviewLoading" class="flex items-center justify-center h-full">
          <ProgressSpinner style="width: 2rem; height: 2rem" stroke-width="4" />
        </div>
        <Message v-else-if="textPreviewError" severity="error" :closable="false">
          {{ textPreviewError }}
        </Message>
        <pre v-else class="m-0 whitespace-pre-wrap break-words text-[0.82rem] leading-relaxed font-mono">{{ textPreviewContent }}</pre>
      </div>
      <div v-else class="flex flex-col items-center gap-2 p-6">
        <i class="pi pi-file" style="font-size: 4rem; color: var(--p-surface-400)" />
        <p class="m-0 text-surface-400 text-[0.85rem]">{{ t('filePreview.noPreview', 'No preview available') }}</p>
      </div>
    </div>

    <div class="file-preview-bottom">
      <!-- Metadata section -->
      <Divider class="!my-1" />

      <div class="flex items-center justify-between mb-1">
        <Button
          :href="assetUrl('download')"
          icon="pi pi-download"
          :label="t('common.download', 'Download')"
          severity="secondary"
          size="small"
          as="a"
          target="_blank"
          :download="file?.filename_download"
        />
        <div class="flex gap-2">
          <template v-if="editing">
            <Button :label="t('common.cancel', 'Cancel')" severity="secondary" size="small" :disabled="saving" @click="cancelEdit" />
            <Button :label="t('common.save', 'Save')" size="small" :loading="saving" @click="saveEdit" />
          </template>
          <Button v-else icon="pi pi-pencil" :label="t('common.edit', 'Edit')" severity="secondary" size="small" @click="startEdit" />
        </div>
      </div>

      <Message v-if="saveError" severity="error" :closable="false" class="mt-2">
        {{ saveError }}
      </Message>

      <FormRenderer
        v-if="file && !editing"
        key="file-preview-view"
        v-model="previewDetailsForm"
        :schema="previewSchema"
        class="file-preview-form"
        readonly
      />

      <FormRenderer
        v-else-if="file"
        key="file-preview-edit"
        v-model="editPreviewForm"
        :schema="previewSchema"
        :readonly-fields="READONLY_PREVIEW_FIELDS"
        class="file-preview-form"
      />
    </div>
    </div>
  </Dialog>
</template>

<style scoped>
.file-preview-layout {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
}

.file-preview-media {
  flex: 1;
  min-height: 240px;
  overflow: hidden;
  border-radius: var(--p-border-radius-md);
}

.file-preview-media--default {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-surface-900);
}

.file-preview-media--html {
  display: flex;
  background: transparent;
}

.file-preview-html-stage {
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  background: #f1f5f9;
}

.file-preview-html-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 24rem;
  border: 0;
  background: #f1f5f9;
}

.file-preview-bottom {
  flex-shrink: 0;
}

.file-preview-form :deep(.layout-tabs) {
  gap: 0.25rem;
}

.file-preview-form :deep(.p-tabpanels > .p-tabpanel > .grid) {
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.file-preview-form :deep(.layout-group-panel) {
  margin-top: 0.25rem;
}

.file-preview-form :deep(.layout-group-panel .p-panel-header) {
  min-height: 2.5rem;
  padding: 0.45rem 0.75rem;
}

.file-preview-form :deep(.layout-group-panel .p-panel-content) {
  padding: 0.6rem 0.75rem;
}

.file-preview-form :deep(.layout-group-panel .grid-cols-12) {
  row-gap: 0.5rem;
  column-gap: 0.65rem;
}

.file-preview-form :deep(.layout-group-panel label) {
  font-size: 0.78rem;
  line-height: 1.1;
}

.file-preview-form :deep(.p-inputtext),
.file-preview-form :deep(.p-inputnumber-input),
.file-preview-form :deep(.p-textarea) {
  padding-block: 0.3rem;
  font-size: 0.82rem;
}
</style>

