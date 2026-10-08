<script lang="ts">
export default {
  name: 'RecordPageBuilderPanel',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RoleScopedLayoutSelector from './RoleScopedLayoutSelector.vue'
import RecordPageBuilder from './RecordPageBuilder.vue'
import { useTranslation } from '@/core/translation'
import { useRoleScopedLayout } from '../../composables/useRoleScopedLayout'
import {
  createDefaultRecordPageLayout,
  deleteRecordPageLayout,
  loadRecordPageLayoutById,
  loadRecordPageLayouts,
  saveRecordPageLayout,
} from '../../services/recordPageSettings'
import { DuplicateRoleScopedLayoutError, pickUnusedRoleId } from '@/core/settingRoleUtils'
import type { RecordPageLayoutSchema } from '@/interfaces'

const props = withDefaults(
  defineProps<{
    collection: string
    initialLayoutId?: string | null
    createNew?: boolean
    setupMode?: boolean
  }>(),
  {
    initialLayoutId: null,
    createNew: false,
    setupMode: false,
  },
)

const emit = defineEmits<{
  status: [message: string | null]
  error: [message: string | null]
}>()

const { t } = useTranslation()
const enabled = computed(() => Boolean(props.collection))
const layoutSaving = ref(false)

const {
  layoutSchema: recordPageSchema,
  layoutLoading,
  layoutDeleting,
  layouts,
  roleOptions,
  selectedLayoutId,
  layoutName,
  layoutRoleId,
  loadForCollection,
  selectLayout,
  createLayoutDraft,
  getSaveOptions,
  applySavedLayout,
} = useRoleScopedLayout<RecordPageLayoutSchema>({
  collection: computed(() => props.collection),
  enabled,
  loadLayouts: loadRecordPageLayouts,
  loadLayoutById: loadRecordPageLayoutById,
  createDefaultLayout: createDefaultRecordPageLayout,
})

async function saveLayout(): Promise<void> {
  layoutSaving.value = true
  emit('status', null)
  emit('error', null)
  try {
    const saved = await saveRecordPageLayout(
      props.collection,
      recordPageSchema.value,
      getSaveOptions(),
    )
    const allLayouts = await loadRecordPageLayouts(props.collection)
    applySavedLayout(saved, allLayouts)
    emit('status', t('recordPage.saved', 'Page layout saved.'))
  } catch (err) {
    emit(
      'error',
      err instanceof DuplicateRoleScopedLayoutError
        ? t('layoutRole.duplicateRole', 'Another layout is already assigned to this role.')
        : err instanceof Error
          ? err.message
          : t('recordPage.saveError', 'Failed to save page layout.'),
    )
  } finally {
    layoutSaving.value = false
  }
}

async function deleteLayout(): Promise<void> {
  if (!selectedLayoutId.value) return

  layoutDeleting.value = true
  emit('status', null)
  emit('error', null)
  try {
    await deleteRecordPageLayout(props.collection, selectedLayoutId.value)
    await loadForCollection(props.collection)
    emit('status', t('layoutRole.deleted', 'Layout deleted.'))
  } catch (err) {
    emit(
      'error',
      err instanceof Error
        ? err.message
        : t('layoutRole.deleteError', 'Failed to delete layout.'),
    )
  } finally {
    layoutDeleting.value = false
  }
}

watch(
  () => [props.collection, props.initialLayoutId, props.createNew] as const,
  async ([collection, layoutId, createNew]) => {
    await loadForCollection(collection)
    if (layoutId) {
      await selectLayout(layoutId)
    } else if (createNew) {
      createLayoutDraft()
      if (props.setupMode) {
        layoutRoleId.value = pickUnusedRoleId(layouts.value, roleOptions.value)
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="record-page-builder-panel flex h-full min-h-0 flex-col gap-2.5">
    <RoleScopedLayoutSelector
      class="shrink-0"
      mode="single"
      :layout-label="t('layoutRole.recordPageLayout', 'Page layout')"
      :layouts="layouts"
      :selected-layout-id="selectedLayoutId"
      v-model:layout-name="layoutName"
      v-model:role-id="layoutRoleId"
      :role-options="roleOptions"
      :loading="layoutLoading"
      :saving="layoutSaving"
      :deleting="layoutDeleting"
      :setup-mode="setupMode"
      allow-delete-default
      @layout-selected="selectLayout"
      @new-layout="createLayoutDraft"
      @save-layout="saveLayout"
      @delete-layout="deleteLayout"
    />
    <RecordPageBuilder
      v-model="recordPageSchema"
      :collection="collection"
      class="min-h-0 flex-1 overflow-hidden"
    />
  </div>
</template>
