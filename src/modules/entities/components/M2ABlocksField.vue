<script lang="ts">
export default {
  name: 'M2ABlocksField',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { VueDraggableNext } from 'vue-draggable-next'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import type { LayoutFieldMetadata } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { useFieldLabels } from '@/core/useFieldLabels'
import { recordDetailRoute } from '@/core/compactRecordRoutes'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import { useM2ABlocksField } from '@/modules/entities/composables/useM2ABlocksField'
import {
  blockRowItemId,
  isM2ABlockRowHidden,
  m2aEditorRowsToFieldValue,
  type M2AJunctionRow,
} from '@/modules/entities/utils/m2aSchema'
import { scalarId } from '@/modules/entities/utils/recordDisplay'

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    entity: string
    parentId?: string | number
    modelValue?: unknown
    originalValue?: unknown
    editable?: boolean
  }>(),
  {
    editable: false,
  },
)

const emit = defineEmits<{
  saved: [payload: { field: string; value: unknown }]
}>()

const router = useRouter()
const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()
const fieldLabels = useFieldLabels(() => props.entity)
const createMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)
const linkMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)

const {
  metadata,
  localRows,
  collectionLabels,
  saving,
  error,
  isReady,
  displayRows,
  totalCount,
  hasMore,
  visibleRows,
  createMenuItems,
  linkMenuItems,
  pendingCreateCollection,
  createDialogVisible,
  pendingLinkCollection,
  linkDialogVisible,
  viewAllVisible,
  rowSummary,
  rowTypeLabel,
  reorderRows,
  removeRow,
  appendCreatedBlock,
  toggleHideRow,
  linkedIdsForCollection,
  closeCreateDialog,
  closeLinkDialog,
} = useM2ABlocksField({
  field: () => props.field,
  entity: () => props.entity,
  parentId: () => props.parentId,
  modelValue: () => props.modelValue,
  originalValue: () => props.originalValue ?? props.modelValue,
  editable: () => props.editable,
})

const canCreate = computed(
  () => props.editable && createMenuItems.value.length > 0,
)

const canLink = computed(
  () => props.editable && linkMenuItems.value.length > 0,
)

const canDragOnMain = computed(() => props.editable && !hasMore.value)

const dialogCreateMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)
const dialogLinkMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)

const dialogRows = ref<M2AJunctionRow[]>([])
const linkSelection = ref<{ label: string; value: string | number } | null>(null)

const linkDialogHeader = computed(() => {
  const collection = pendingLinkCollection.value
  const label = collection
    ? (collectionLabels.value[collection] ?? collection)
    : ''
  return t('m2aBuilder.linkTitle', 'Link existing {collection}', { collection: label })
})

const linkExcludeIds = computed(() =>
  pendingLinkCollection.value
    ? linkedIdsForCollection(pendingLinkCollection.value)
    : [],
)

function rowKey(row: M2AJunctionRow, index: number): string {
  return [row.id ?? 'new', row.collection, index].join(':')
}

function rowContentLabel(row: M2AJunctionRow): string {
  const summary = rowSummary(row)
  const typeLabel = rowTypeLabel(row)
  if (summary.startsWith(`${typeLabel}:`)) {
    return summary.slice(typeLabel.length + 1).trim() || typeLabel
  }
  return summary
}

function emitSaved(): void {
  emit('saved', {
    field: props.field.field,
    value: metadata.value
      ? m2aEditorRowsToFieldValue(localRows.value, metadata.value)
      : localRows.value,
  })
}

function openCreateMenu(event: Event): void {
  createMenuRef.value?.toggle(event)
}

function openLinkMenu(event: Event): void {
  linkMenuRef.value?.toggle(event)
}

function openDialogCreateMenu(event: Event): void {
  dialogCreateMenuRef.value?.toggle(event)
}

function openDialogLinkMenu(event: Event): void {
  dialogLinkMenuRef.value?.toggle(event)
}

function openViewAll(): void {
  dialogRows.value = props.editable ? [...localRows.value] : [...displayRows.value]
  viewAllVisible.value = true
}

function confirmRemoveRow(row: M2AJunctionRow, inDialog = false): void {
  confirm.require({
    header: t('m2aBuilder.removeTitle', 'Remove block'),
    message: t(
      'm2aBuilder.removeConfirm',
      'Remove this {collection} block?',
      { collection: rowTypeLabel(row) },
    ),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.remove', 'Remove'),
    rejectLabel: t('common.cancel', 'Cancel'),
    acceptProps: { severity: 'danger' },
    accept: async () => {
      const rowIndex = localRows.value.findIndex(
        (item) => item.id === row.id && item.collection === row.collection,
      )
      if (rowIndex < 0) return
      await removeRow(rowIndex)
      if (inDialog) {
        dialogRows.value = props.editable
          ? [...localRows.value]
          : [...displayRows.value]
      }
      emitSaved()
    },
  })
}

async function toggleRowHidden(row: M2AJunctionRow, inDialog = false): Promise<void> {
  const rowIndex = localRows.value.findIndex(
    (item) => item.id === row.id && item.collection === row.collection,
  )
  if (rowIndex < 0) return
  await toggleHideRow(rowIndex)
  if (inDialog) {
    dialogRows.value = props.editable
      ? [...localRows.value]
      : [...displayRows.value]
  }
  emitSaved()
}

function openBlockRecord(row: M2AJunctionRow): void {
  const itemId = blockRowItemId(row)
  if (itemId === null || !row.collection) return
  void router.push(recordDetailRoute(row.collection, itemId))
}

async function handleBlockCreated(record: Record<string, unknown>): Promise<void> {
  const collection = pendingCreateCollection.value
  const itemId = scalarId(record.id)
  if (!collection || itemId === null) {
    closeCreateDialog()
    return
  }

  try {
    await appendCreatedBlock(collection, itemId)
    if (viewAllVisible.value) {
      dialogRows.value = [...localRows.value]
    }
    emitSaved()
  } finally {
    closeCreateDialog()
  }
}

async function handleLinkSelected(
  option: { label: string; value: string | number } | null,
): Promise<void> {
  linkSelection.value = option
  const collection = pendingLinkCollection.value
  const itemId = option ? scalarId(option.value) : null
  if (!collection || itemId === null) return

  try {
    const linked = await appendCreatedBlock(collection, itemId)
    if (!linked) {
      toast.add({
        severity: 'info',
        summary: t('m2aBuilder.alreadyLinked', 'Already linked'),
        detail: t(
          'm2aBuilder.alreadyLinkedDetail',
          'This record is already linked as a block.',
        ),
        life: 3000,
      })
      return
    }
    if (viewAllVisible.value) {
      dialogRows.value = [...localRows.value]
    }
    emitSaved()
  } finally {
    linkSelection.value = null
    closeLinkDialog()
  }
}

function onLinkDialogVisible(visible: boolean): void {
  if (!visible) {
    linkSelection.value = null
    closeLinkDialog()
  }
}

async function onDragEndMain(): Promise<void> {
  try {
    await reorderRows(localRows.value)
    emitSaved()
  } catch {
    // error surfaced via error ref
  }
}

async function onDragEndDialog(): Promise<void> {
  localRows.value = dialogRows.value.map((row, index) => ({ ...row, sort: index }))
  try {
    await reorderRows(localRows.value)
    dialogRows.value = [...localRows.value]
    emitSaved()
  } catch {
    // error surfaced via error ref
  }
}
</script>

<template>
  <div class="border border-surface-200 rounded-lg overflow-hidden">
    <div class="flex items-center justify-between bg-surface-100 border-b border-surface-200 px-3 py-2 gap-3">
      <span class="flex items-center gap-[0.35rem] text-surface-700 text-[0.9rem] font-semibold min-w-0">
        {{ fieldLabels.getLabel(field) }}
        <span class="text-muted-color font-medium">({{ totalCount }})</span>
      </span>
      <div v-if="canCreate || canLink" class="flex items-center gap-2 shrink-0">
        <Button
          v-if="canLink"
          :label="t('m2aBuilder.linkExisting', 'Link Existing')"
          icon="pi pi-chevron-down"
          icon-pos="right"
          size="small"
          text
          :loading="saving"
          :disabled="!isReady"
          @click="openLinkMenu"
        />
        <Menu ref="linkMenuRef" :model="linkMenuItems" popup />
        <Button
          v-if="canCreate"
          :label="t('m2aBuilder.createNew', 'Create New')"
          icon="pi pi-chevron-down"
          icon-pos="right"
          size="small"
          outlined
          :loading="saving"
          :disabled="!isReady"
          @click="openCreateMenu"
        />
        <Menu ref="createMenuRef" :model="createMenuItems" popup />
      </div>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="m-2">
      {{ error }}
    </Message>

    <p v-if="!isReady" class="text-muted-color text-[0.9rem] m-0 px-3 py-2">
      {{ t('m2aBuilder.loading', 'Loading block builder…') }}
    </p>

    <p v-else-if="displayRows.length === 0" class="text-muted-color text-[0.9rem] m-0 px-3 py-2">
      {{ t('m2aBuilder.empty', 'No blocks yet.') }}
    </p>

    <template v-else>
      <VueDraggableNext
        v-if="canDragOnMain"
        :list="localRows"
        tag="div"
        class="flex flex-col"
        handle=".m2a-blocks__drag-handle"
        :disabled="saving"
        @end="onDragEndMain"
      >
        <div
          v-for="(element, index) in localRows"
          :key="rowKey(element, index)"
          class="flex items-center gap-2 px-3 py-2 border-b border-surface-100 last:border-b-0 hover:bg-surface-50"
        >
          <button
            type="button"
            class="m2a-blocks__drag-handle cursor-grab border-0 bg-transparent text-muted-color px-1 shrink-0"
            :aria-label="t('m2aBuilder.drag', 'Drag to reorder')"
          >
            <i class="pi pi-bars" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="flex-1 min-w-0 text-left border-0 bg-transparent text-[0.9rem] truncate"
            @click="openBlockRecord(element)"
          >
            <span class="text-primary font-medium">{{ rowTypeLabel(element) }}</span>
            <span class="text-surface-700">: {{ rowContentLabel(element) }}</span>
          </button>
          <Tag
            v-if="isM2ABlockRowHidden(element)"
            :value="t('m2aBuilder.hiddenBlock', 'Hidden')"
            severity="warn"
            class="shrink-0"
          />
          <Button
            :icon="isM2ABlockRowHidden(element) ? 'pi pi-eye' : 'pi pi-eye-slash'"
            text
            rounded
            size="small"
            :disabled="saving"
            :aria-label="
              isM2ABlockRowHidden(element)
                ? t('m2aBuilder.showBlock', 'Show block')
                : t('m2aBuilder.hideBlock', 'Hide block')
            "
            :title="
              isM2ABlockRowHidden(element)
                ? t('m2aBuilder.showBlock', 'Show block')
                : t('m2aBuilder.hideBlock', 'Hide block')
            "
            @click="toggleRowHidden(element)"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            size="small"
            :disabled="saving"
            :aria-label="t('m2aBuilder.removeBlock', 'Remove block')"
            @click="confirmRemoveRow(element)"
          />
        </div>
      </VueDraggableNext>

      <ul v-else class="m-0 p-0 list-none">
        <li
          v-for="(element, index) in visibleRows"
          :key="rowKey(element, index)"
          class="flex items-center gap-2 px-3 py-2 border-b border-surface-100 last:border-b-0 hover:bg-surface-50"
        >
          <button
            type="button"
            class="flex-1 min-w-0 text-left border-0 bg-transparent text-[0.9rem] truncate cursor-pointer"
            @click="openBlockRecord(element)"
          >
            <span class="text-primary font-medium">{{ rowTypeLabel(element) }}</span>
            <span class="text-surface-700">: {{ rowContentLabel(element) }}</span>
          </button>
          <Tag
            v-if="editable && isM2ABlockRowHidden(element)"
            :value="t('m2aBuilder.hiddenBlock', 'Hidden')"
            severity="warn"
            class="shrink-0"
          />
          <Button
            v-if="editable"
            :icon="isM2ABlockRowHidden(element) ? 'pi pi-eye' : 'pi pi-eye-slash'"
            text
            rounded
            size="small"
            :disabled="saving"
            :aria-label="
              isM2ABlockRowHidden(element)
                ? t('m2aBuilder.showBlock', 'Show block')
                : t('m2aBuilder.hideBlock', 'Hide block')
            "
            :title="
              isM2ABlockRowHidden(element)
                ? t('m2aBuilder.showBlock', 'Show block')
                : t('m2aBuilder.hideBlock', 'Hide block')
            "
            @click="toggleRowHidden(element)"
          />
          <Button
            v-if="editable"
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            size="small"
            :disabled="saving"
            :aria-label="t('m2aBuilder.removeBlock', 'Remove block')"
            @click="confirmRemoveRow(element)"
          />
        </li>
      </ul>

      <div v-if="hasMore" class="flex justify-end px-3 py-2 border-t border-surface-100">
        <button
          type="button"
          class="border-0 bg-transparent text-primary text-sm font-medium cursor-pointer hover:underline"
          @click="openViewAll"
        >
          {{ t('common.viewAll', 'View all') }}
        </button>
      </div>
    </template>

    <Dialog
      v-model:visible="viewAllVisible"
      modal
      :header="t('m2aBuilder.manageBlocks', 'Manage blocks')"
      :style="{ width: 'min(720px, 95vw)' }"
    >
      <div class="flex flex-col gap-3">
        <div v-if="canCreate || canLink" class="flex justify-end gap-2">
          <Button
            v-if="canLink"
            :label="t('m2aBuilder.linkExisting', 'Link Existing')"
            icon="pi pi-chevron-down"
            icon-pos="right"
            size="small"
            text
            :loading="saving"
            :disabled="!isReady"
            @click="openDialogLinkMenu"
          />
          <Menu ref="dialogLinkMenuRef" :model="linkMenuItems" popup />
          <Button
            v-if="canCreate"
            :label="t('m2aBuilder.createNew', 'Create New')"
            icon="pi pi-chevron-down"
            icon-pos="right"
            size="small"
            outlined
            :loading="saving"
            :disabled="!isReady"
            @click="openDialogCreateMenu"
          />
          <Menu ref="dialogCreateMenuRef" :model="createMenuItems" popup />
        </div>

        <VueDraggableNext
          v-if="editable"
          :list="dialogRows"
          tag="div"
          class="flex flex-col max-h-[60vh] overflow-y-auto"
          handle=".m2a-blocks__drag-handle"
          :disabled="saving"
          @end="onDragEndDialog"
        >
          <div
            v-for="(element, index) in dialogRows"
            :key="rowKey(element, index)"
            class="flex items-center gap-2 px-2 py-2 border-b border-surface-100 last:border-b-0"
          >
            <button
              type="button"
              class="m2a-blocks__drag-handle cursor-grab border-0 bg-transparent text-muted-color px-1 shrink-0"
              :aria-label="t('m2aBuilder.drag', 'Drag to reorder')"
            >
              <i class="pi pi-bars" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="flex-1 min-w-0 text-left border-0 bg-transparent text-[0.9rem] truncate"
              @click="openBlockRecord(element)"
            >
              <span class="text-primary font-medium">{{ rowTypeLabel(element) }}</span>
              <span class="text-surface-700">: {{ rowContentLabel(element) }}</span>
            </button>
            <Tag
              v-if="isM2ABlockRowHidden(element)"
              :value="t('m2aBuilder.hiddenBlock', 'Hidden')"
              severity="warn"
              class="shrink-0"
            />
            <Button
              :icon="isM2ABlockRowHidden(element) ? 'pi pi-eye' : 'pi pi-eye-slash'"
              text
              rounded
              size="small"
              :disabled="saving"
              :aria-label="
                isM2ABlockRowHidden(element)
                  ? t('m2aBuilder.showBlock', 'Show block')
                  : t('m2aBuilder.hideBlock', 'Hide block')
              "
              :title="
                isM2ABlockRowHidden(element)
                  ? t('m2aBuilder.showBlock', 'Show block')
                  : t('m2aBuilder.hideBlock', 'Hide block')
              "
              @click="toggleRowHidden(element, true)"
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              size="small"
              :disabled="saving"
              @click="confirmRemoveRow(element, true)"
            />
          </div>
        </VueDraggableNext>

        <ul v-else class="m-0 p-0 list-none max-h-[60vh] overflow-y-auto">
          <li
            v-for="(element, index) in displayRows"
            :key="rowKey(element, index)"
            class="flex items-center gap-2 px-2 py-2 border-b border-surface-100 last:border-b-0"
          >
            <button
              type="button"
              class="flex-1 min-w-0 text-left border-0 bg-transparent text-[0.9rem] truncate cursor-pointer"
              @click="openBlockRecord(element)"
            >
              <span class="text-primary font-medium">{{ rowTypeLabel(element) }}</span>
              <span class="text-surface-700">: {{ rowContentLabel(element) }}</span>
            </button>
          </li>
        </ul>

        <p
          v-if="editable && dialogRows.length === 0"
          class="m-0 text-muted-color text-[0.9rem]"
        >
          {{ t('m2aBuilder.empty', 'No blocks yet.') }}
        </p>
      </div>
    </Dialog>

    <RecordCreateDialog
      :visible="createDialogVisible"
      :collection="pendingCreateCollection ?? ''"
      @update:visible="(visible) => { if (!visible) closeCreateDialog() }"
      @created="handleBlockCreated"
    />

    <Dialog
      :visible="linkDialogVisible"
      modal
      :header="linkDialogHeader"
      :style="{ width: 'min(480px, 95vw)' }"
      @update:visible="onLinkDialogVisible"
    >
      <CrmAutoComplete
        v-if="pendingLinkCollection"
        :model-value="linkSelection"
        :collection="pendingLinkCollection"
        :placeholder="t('m2aBuilder.linkPlaceholder', 'Search and select a record…')"
        :allow-create="false"
        :exclude-ids="linkExcludeIds"
        :disabled="saving"
        class="w-full"
        @update:model-value="handleLinkSelected"
      />
    </Dialog>
  </div>
</template>
