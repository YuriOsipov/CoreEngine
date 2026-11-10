<script lang="ts">
export default {
  name: 'FilesSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import type {
  FilesDisplay,
  FilesSettings,
  FileDisplayColumn,
  ImagePreviewSize,
} from '@/interfaces'
import { AVAILABLE_FILE_COLUMNS, IMAGE_PREVIEW_SIZE_OPTIONS } from '@/interfaces'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  modelValue: FilesSettings
  /** Image Setup fields: lock to single image, hide gallery options. */
  imageMode?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [FilesSettings]
}>()

const { t } = useTranslation()

const DISPLAY_OPTIONS = computed<Array<{ label: string; value: FilesDisplay }>>(() => {
  if (props.imageMode) {
    return [
      { label: t('filesSettings.imagePreview', 'Image preview'), value: 'thumbnail' },
    ]
  }
  return [
    { label: t('filesSettings.thumbnail', 'Thumbnail grid'), value: 'thumbnail' },
    { label: t('filesSettings.list', 'File list'), value: 'list' },
    { label: t('filesSettings.gallery', 'Full gallery'), value: 'gallery' },
  ]
})

const COMMON_MIME_HINTS = [
  { label: t('filesSettings.imagesOnly', 'Images only'), value: 'image/' },
  { label: t('filesSettings.pdfOnly', 'PDF only'), value: 'application/pdf' },
  { label: t('filesSettings.docsOnly', 'Documents'), value: 'application/' },
]

const PREVIEW_SIZE_OPTIONS = computed(() =>
  IMAGE_PREVIEW_SIZE_OPTIONS.map((option) => ({
    value: option.value,
    label:
      option.value === 'sm'
        ? t('filesSettings.previewSizeSm', 'Small')
        : option.value === 'md'
          ? t('filesSettings.previewSizeMd', 'Medium')
          : option.value === 'lg'
            ? t('filesSettings.previewSizeLg', 'Large')
            : t('filesSettings.previewSizeFill', 'Fill width'),
  })),
)

const displayMode = computed<FilesDisplay>({
  get: () => props.modelValue.display,
  set: (display) => emit('update:modelValue', { ...props.modelValue, display }),
})

const mimeInput = computed({
  get: () => props.modelValue.allowedMimeTypes.join(', '),
  set: (raw: string) => {
    const allowedMimeTypes = raw.split(',').map((s) => s.trim()).filter(Boolean)
    emit('update:modelValue', { ...props.modelValue, allowedMimeTypes })
  },
})

const previewSize = computed<ImagePreviewSize>({
  get: () => {
    const value = props.modelValue.previewSize
    return value === 'sm' || value === 'md' || value === 'lg' || value === 'fill'
      ? value
      : 'md'
  },
  set: (value: ImagePreviewSize) =>
    emit('update:modelValue', { ...props.modelValue, previewSize: value }),
})

const multiple = computed({
  get: () => props.modelValue.multiple,
  set: (value: boolean) => emit('update:modelValue', { ...props.modelValue, multiple: value }),
})

const columns = computed({
  get: () => props.modelValue.columns,
  set: (value: FileDisplayColumn[]) =>
    emit('update:modelValue', { ...props.modelValue, columns: value }),
})

const availableColumns = computed(() =>
  AVAILABLE_FILE_COLUMNS.filter(
    (column) => !columns.value.some((entry) => entry.field === column.field),
  ),
)

function addColumn(column: FileDisplayColumn): void {
  columns.value = [...columns.value, { ...column }]
}

function removeColumn(field: string): void {
  columns.value = columns.value.filter((column) => column.field !== field)
}

function onAddColumn(event: { value?: FileDisplayColumn | null }): void {
  if (event.value) addColumn(event.value)
}
</script>

<template>
  <div class="grid gap-3">
    <div
      v-if="!imageMode"
      class="grid gap-2"
    >
      <label class="text-[0.85rem] font-medium">{{ t('filesSettings.display', 'Display') }}</label>
      <Select
        v-model="displayMode"
        :options="DISPLAY_OPTIONS"
        option-label="label"
        option-value="value"
        class="w-full"
      />
    </div>
    <small
      v-else
      class="text-muted-color"
    >
      {{
        t(
          'filesSettings.imageModeHint',
          'Shows a single image preview with upload / replace. Format and max size are set in Setup → General.',
        )
      }}
    </small>

    <div
      v-if="imageMode"
      class="grid gap-2"
    >
      <label class="text-[0.85rem] font-medium">
        {{ t('filesSettings.previewSize', 'Preview size') }}
      </label>
      <Select
        v-model="previewSize"
        :options="PREVIEW_SIZE_OPTIONS"
        option-label="label"
        option-value="value"
        class="w-full"
      />
      <small class="text-muted-color">
        {{
          t(
            'filesSettings.previewSizeHint',
            'Controls how large the image preview appears on the form and detail view.',
          )
        }}
      </small>
    </div>

    <div
      v-if="!imageMode"
      class="flex items-center gap-2"
    >
      <Checkbox v-model="multiple" binary input-id="files-multiple" />
      <label for="files-multiple" class="text-[0.85rem]">
        {{ t('filesSettings.multiple', 'Allow multiple files') }}
      </label>
    </div>

    <div
      v-if="!imageMode"
      class="grid gap-2"
    >
      <label class="text-[0.85rem] font-medium">
        {{ t('filesSettings.mimeTypes', 'Allowed MIME types') }}
      </label>
      <InputText v-model="mimeInput" class="w-full" placeholder="image/, application/pdf" />
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="hint in COMMON_MIME_HINTS"
          :key="hint.value"
          size="small"
          severity="secondary"
          text
          :label="hint.label"
          @click="mimeInput = hint.value"
        />
      </div>
    </div>

    <div
      v-if="!imageMode"
      class="grid gap-2"
    >
      <label class="text-[0.85rem] font-medium">
        {{ t('filesSettings.columns', 'Metadata columns') }}
      </label>
      <VueDraggableNext v-model="columns" item-key="field" handle=".drag-handle" class="grid gap-2">
        <div
          v-for="column in columns"
          :key="column.field"
          class="flex items-center gap-2 border border-surface-200 rounded-md px-2 py-1"
        >
          <i class="pi pi-bars drag-handle cursor-move text-muted-color" />
          <span class="flex-1 text-[0.85rem]">{{ column.header }}</span>
          <Button
            icon="pi pi-times"
            size="small"
            severity="danger"
            text
            rounded
            @click="removeColumn(column.field)"
          />
        </div>
      </VueDraggableNext>
      <Select
        v-if="availableColumns.length"
        :options="availableColumns"
        option-label="header"
        placeholder="Add column"
        class="w-full"
        @change="onAddColumn"
      />
    </div>
  </div>
</template>
