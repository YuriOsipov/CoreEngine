<script lang="ts">
export default {
  name: 'SchedulerBuilderPanel',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RoleScopedLayoutSelector from './RoleScopedLayoutSelector.vue'
import SchedulerSettingsDesigner from '../SchedulerSettingsDesigner.vue'
import { useTranslation } from '@/core/translation'
import { useRoleScopedLayout } from '../../composables/useRoleScopedLayout'
import {
  deleteSchedulerLayout,
  loadSchedulerLayouts,
  loadSchedulerSettingsById,
  normalizeSchedulerSettings,
  saveSchedulerSettings,
} from '../../services/schedulerSettings'
import { DuplicateRoleScopedLayoutError, pickUnusedRoleId } from '@/core/settingRoleUtils'
import type { SchedulerSettings } from '@/interfaces'

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

function createDefaultLayout(collection: string): SchedulerSettings {
  return normalizeSchedulerSettings({
    event: {
      collection,
      primaryKey: 'id',
      titleField: 'name',
      startField: 'start',
      endField: 'end',
      resourceField: '',
      defaultTitle: t('scheduler.createDefaultTitle', 'New visit'),
    },
  })
}

const {
  layoutSchema: schedulerSettings,
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
} = useRoleScopedLayout({
  collection: computed(() => props.collection),
  enabled,
  loadLayouts: loadSchedulerLayouts,
  loadLayoutById: loadSchedulerSettingsById,
  createDefaultLayout,
})

async function saveLayout(): Promise<void> {
  layoutSaving.value = true
  emit('status', null)
  emit('error', null)
  try {
    const saved = await saveSchedulerSettings(schedulerSettings.value, getSaveOptions())
    const allLayouts = await loadSchedulerLayouts(props.collection)
    applySavedLayout(saved, allLayouts)
    emit('status', t('schedulerSettings.saved', 'Scheduler settings saved.'))
  } catch (err) {
    emit(
      'error',
      err instanceof DuplicateRoleScopedLayoutError
        ? t('layoutRole.duplicateRole', 'Another layout is already assigned to this role.')
        : err instanceof Error
          ? err.message
          : t('schedulerSettings.saveError', 'Failed to save scheduler settings.'),
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
    await deleteSchedulerLayout(props.collection, selectedLayoutId.value)
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
  <div class="scheduler-builder-panel flex min-h-0 w-full flex-1 flex-col gap-1">
    <RoleScopedLayoutSelector
      class="shrink-0"
      mode="single"
      :layout-label="t('layoutRole.schedulerLayout', 'Scheduler layout')"
      :layouts="layouts"
      :selected-layout-id="selectedLayoutId"
      v-model:layout-name="layoutName"
      v-model:role-id="layoutRoleId"
      :role-options="roleOptions"
      :loading="layoutLoading"
      :saving="layoutSaving"
      :deleting="layoutDeleting"
      :setup-mode="setupMode"
      @layout-selected="selectLayout"
      @new-layout="createLayoutDraft"
      @save-layout="saveLayout"
      @delete-layout="deleteLayout"
    />

    <SchedulerSettingsDesigner
      v-model="schedulerSettings"
      :collection="collection"
      builder-managed
      class="min-h-0 flex-1"
    />
  </div>
</template>
