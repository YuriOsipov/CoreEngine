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
} from '@/interfaces'
import { AVAILABLE_FILE_COLUMNS } from '@/interfaces'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  modelValue: FilesSettings
}>()

const emit = defineEmits<{
  'update:modelValue': [FilesSettings]
}>()

const { t } = useTranslation()

const DISPLAY_OPTIONS = computed<Array<{ label: string; value: FilesDisplay }>>(() => [
  { label: t('filesSettings.thumbnail', 'Thumbnail grid'), value: 'thumbnail' },
  { label: t('filesSettings.list', 'File list'), value: 'list' },
  { label: t('filesSettings.gallery', 'Full gallery'), value: 'gallery' },
])

const COMMON_MIME_HINTS = [
  { label: t('filesSettings.imagesOnly', 'Images only'), value: 'image/' },
  { label: t('filesSettings.pdfOnly', 'PDF only'), value: 'application/pdf' },
  { label: t('filesSettings.docsOnly', 'Documents'), value: 'application/' },
]

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
    <div class="grid gap-2">
      <label class="text-[0.85rem] font-medium">{{ t('filesSettings.display', 'Display') }}</label>
      <Select
        v-model="displayMode"
        :options="DISPLAY_OPTIONS"
        option-label="label"
        option-value="value"
        class="w-full"
      />
    </div>

    <div class="flex items-center gap-2">
      <Checkbox v-model="multiple" binary input-id="files-multiple" />
      <label for="files-multiple" class="text-[0.85rem]">
        {{ t('filesSettings.multiple', 'Allow multiple files') }}
      </label>
    </div>

    <div class="grid gap-2">
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

    <div class="grid gap-2">
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
