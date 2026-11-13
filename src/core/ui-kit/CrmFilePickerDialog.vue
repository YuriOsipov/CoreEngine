<script lang="ts">
export default {
  name: 'CrmFilePickerDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { bridgeReadItemsPage } from '@/core/graphql/itemsBridge'
import { fileAssetUrl, readRecordFiles } from '@/core/graphql/filesProxy'
import {
  FILES_ASSET_COLLECTION,
  FILES_ASSET_FIELDS,
} from '@/core/filesField'
import { useTranslation } from '@/core/translation'

export type PickedFileAsset = {
  id: string
  filename_download?: string
  type?: string
  filesize?: number | null
  title?: string | null
  created_on?: string | null
  width?: number | null
  height?: number | null
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    /** Restrict to these MIME types / prefixes (e.g. `image/`). */
    allowedMimeTypes?: string[]
    header?: string
    /** Allow selecting more than one file. */
    multiple?: boolean
    /**
     * When set, list files linked to this parent (record attachments) via
     * parent ACL — does not require global `files` entity read.
     */
    parentCollection?: string | null
    parentRecordId?: string | number | null
  }>(),
  {
    allowedMimeTypes: () => [],
    multiple: false,
    parentCollection: null,
    parentRecordId: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  select: [files: PickedFileAsset[]]
}>()

const { t } = useTranslation()

const search = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<PickedFileAsset[]>([])
const selectedIds = ref<string[]>([])
const loadToken = ref(0)

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const dialogHeader = computed(
  () =>
    props.header ||
    (props.allowedMimeTypes.some(
      (mime) => mime === 'image' || mime.startsWith('image/'),
    )
      ? t('filePreview.chooseExistingImage', 'Choose existing image')
      : t('filePreview.chooseExistingFile', 'Choose existing file')),
)

const selectedRows = computed(() =>
  rows.value.filter((row) => selectedIds.value.includes(row.id)),
)

function mimeFilter(): Record<string, unknown> | null {
  const allowed = props.allowedMimeTypes.filter(Boolean)
  if (!allowed.length) return null

  const clauses = allowed.map((mime) => {
    const normalized = mime === 'image' ? 'image/' : mime
    if (normalized.endsWith('/')) {
      return { type: { _starts_with: normalized } }
    }
    return { type: { _eq: normalized } }
  })

  return clauses.length === 1 ? clauses[0]! : { _or: clauses }
}

function parentScope(): { collection: string; recordId: string } | null {
  const collection = String(props.parentCollection || '').trim()
  const recordId =
    props.parentRecordId == null ? '' : String(props.parentRecordId).trim()
  if (!collection || !recordId) return null
  return { collection, recordId }
}

function matchesAllowedMime(type: string | undefined): boolean {
  const allowed = props.allowedMimeTypes.filter(Boolean)
  if (!allowed.length) return true
  const mime = String(type || '')
  return allowed.some((entry) => {
    const normalized = entry === 'image' ? 'image/' : entry
    if (normalized.endsWith('/')) return mime.startsWith(normalized)
    return mime === normalized
  })
}

function matchesSearch(row: PickedFileAsset, needle: string): boolean {
  if (!needle) return true
  const hay = `${row.title || ''} ${row.filename_download || ''}`.toLowerCase()
  return hay.includes(needle)
}

function toAsset(row: Record<string, unknown>): PickedFileAsset | null {
  const id = row.id == null ? '' : String(row.id)
  if (!id) return null
  return {
    id,
    filename_download:
      typeof row.filename_download === 'string' ? row.filename_download : undefined,
    type: typeof row.type === 'string' ? row.type : undefined,
    filesize:
      typeof row.filesize === 'number'
        ? row.filesize
        : row.filesize == null
          ? null
          : Number(row.filesize),
    title: typeof row.title === 'string' ? row.title : null,
    created_on: typeof row.created_on === 'string' ? row.created_on : null,
    width:
      typeof row.width === 'number'
        ? row.width
        : row.width == null
          ? null
          : Number(row.width),
    height:
      typeof row.height === 'number'
        ? row.height
        : row.height == null
          ? null
          : Number(row.height),
  }
}

function fileLabel(row: PickedFileAsset): string {
  return (
    row.title?.trim() ||
    row.filename_download?.trim() ||
    t('filePreview.attachment', 'Attachment')
  )
}

function isImageRow(row: PickedFileAsset): boolean {
  return String(row.type || '').startsWith('image/')
}

function thumbUrl(row: PickedFileAsset): string {
  return fileAssetUrl(row.id, { width: 160, height: 160, fit: 'cover' })
}

async function loadFiles(): Promise<void> {
  const token = ++loadToken.value
  loading.value = true
  error.value = null

  try {
    const parent = parentScope()
    const needle = search.value.trim().toLowerCase()

    if (parent) {
      // Short list: attachments already on this record (parent ACL).
      const linked = await readRecordFiles(parent.collection, parent.recordId, [
        ...FILES_ASSET_FIELDS,
      ])
      if (token !== loadToken.value) return
      rows.value = linked
        .map((row) => toAsset(row))
        .filter((row): row is PickedFileAsset => Boolean(row))
        .filter((row) => matchesAllowedMime(row.type))
        .filter((row) => matchesSearch(row, needle))
        .slice(0, 48)
      return
    }

    const filterParts: Record<string, unknown>[] = []
    const mime = mimeFilter()
    if (mime) filterParts.push(mime)

    const page = await bridgeReadItemsPage(FILES_ASSET_COLLECTION, {
      fields: [...FILES_ASSET_FIELDS],
      filter: filterParts.length
        ? filterParts.length === 1
          ? filterParts[0]
          : { _and: filterParts }
        : null,
      search: search.value.trim() || undefined,
      sort: ['-created_on'],
      limit: 48,
      offset: 0,
    })

    if (token !== loadToken.value) return

    rows.value = page.nodes
      .map((row) => toAsset(row))
      .filter((row): row is PickedFileAsset => Boolean(row))
  } catch (err) {
    if (token !== loadToken.value) return
    rows.value = []
    error.value =
      err instanceof Error
        ? err.message
        : t('filePreview.chooseExistingLoadFailed', 'Failed to load files.')
  } finally {
    if (token === loadToken.value) loading.value = false
  }
}

function toggleSelect(row: PickedFileAsset): void {
  if (props.multiple) {
    if (selectedIds.value.includes(row.id)) {
      selectedIds.value = selectedIds.value.filter((id) => id !== row.id)
    } else {
      selectedIds.value = [...selectedIds.value, row.id]
    }
    return
  }
  selectedIds.value = [row.id]
}

function isSelected(row: PickedFileAsset): boolean {
  return selectedIds.value.includes(row.id)
}

function confirmSelection(): void {
  if (!selectedRows.value.length) return
  emit('select', selectedRows.value)
  dialogVisible.value = false
}

function close(): void {
  dialogVisible.value = false
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      search.value = ''
      selectedIds.value = []
      rows.value = []
      error.value = null
      return
    }
    void loadFiles()
  },
)

watch(search, () => {
  if (!props.visible) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void loadFiles()
  }, 250)
})
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogHeader"
    :style="{ width: '40rem' }"
    :draggable="false"
  >
    <div class="flex flex-col gap-3">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="search"
          fluid
          :placeholder="t('filePreview.chooseExistingSearch', 'Search files…')"
        />
      </IconField>

      <div
        v-if="loading"
        class="flex items-center justify-center gap-2 py-8 text-muted-color"
      >
        <ProgressSpinner
          style="width: 2rem; height: 2rem"
          stroke-width="4"
        />
        <span>{{ t('filePreview.chooseExistingLoading', 'Loading files…') }}</span>
      </div>

      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
      >
        {{ error }}
      </Message>

      <p
        v-else-if="rows.length === 0"
        class="m-0 py-6 text-center text-muted-color"
      >
        {{ t('filePreview.chooseExistingEmpty', 'No files found.') }}
      </p>

      <div
        v-else
        class="crm-file-picker__grid max-h-[22rem] overflow-y-auto"
      >
        <button
          v-for="row in rows"
          :key="row.id"
          type="button"
          class="crm-file-picker__item"
          :class="{ 'crm-file-picker__item--selected': isSelected(row) }"
          @click="toggleSelect(row)"
          @dblclick="toggleSelect(row); confirmSelection()"
        >
          <img
            v-if="isImageRow(row)"
            :src="thumbUrl(row)"
            :alt="fileLabel(row)"
            class="crm-file-picker__thumb"
          >
          <div
            v-else
            class="crm-file-picker__icon"
            aria-hidden="true"
          >
            <i class="pi pi-file" />
          </div>
          <span class="crm-file-picker__label">{{ fileLabel(row) }}</span>
        </button>
      </div>
    </div>

    <template #footer>
      <Button
        type="button"
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="close"
      />
      <Button
        type="button"
        :label="t('filePreview.linkSelected', 'Link')"
        :disabled="!selectedRows.length"
        @click="confirmSelection"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.crm-file-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: 0.65rem;
}

.crm-file-picker__item {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.5rem;
  background: var(--p-surface-0);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.crm-file-picker__item:hover {
  border-color: var(--p-primary-200);
}

.crm-file-picker__item--selected {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.crm-file-picker__thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 0.35rem;
  background: var(--p-surface-100);
}

.crm-file-picker__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 0.35rem;
  background: var(--p-surface-100);
  color: var(--p-text-muted-color);
  font-size: 1.5rem;
}

.crm-file-picker__label {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.75rem;
  line-height: 1.25;
  color: var(--p-surface-800);
}
</style>
