<script lang="ts">

export default {

  name: 'TreeBuilderPanel',

}

</script>



<script setup lang="ts">

import { computed, ref, watch } from 'vue'

import RoleScopedLayoutSelector from './RoleScopedLayoutSelector.vue'

import TreeTableSettingsDesigner from '../TreeTableSettingsDesigner.vue'

import { useTranslation } from '@/core/translation'

import { useRoleScopedLayout } from '../../composables/useRoleScopedLayout'

import {

  deleteTreeTableLayout,

  loadTreeTableLayouts,

  loadTreeTableSettingsById,

  normalizeTreeTableSettings,

  saveTreeTableSettings,

} from '@/modules/entities/services/treeTableSettings'

import { DuplicateRoleScopedLayoutError, pickUnusedRoleId } from '@/core/settingRoleUtils'

import type { TreeTableSettings } from '@/interfaces'



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



function createDefaultLayout(collection: string): TreeTableSettings {

  return normalizeTreeTableSettings({

    main: {

      collection,

      groupField: '',

      primaryKey: 'id',

      labelField: 'name',

      labelFields: ['name'],

    },

    destination: {

      collection: '',

      key: `${collection}_items`,

    },

  })

}



const {

  layoutSchema: treeSettings,

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

  loadLayouts: loadTreeTableLayouts,

  loadLayoutById: loadTreeTableSettingsById,

  createDefaultLayout,

})



async function saveLayout(): Promise<void> {

  layoutSaving.value = true

  emit('status', null)

  emit('error', null)

  try {

    const saved = await saveTreeTableSettings(treeSettings.value, getSaveOptions())

    const allLayouts = await loadTreeTableLayouts(props.collection)

    applySavedLayout(saved, allLayouts)

    emit('status', t('treeSettings.saved', 'Tree settings saved.'))

  } catch (err) {

    emit(

      'error',

      err instanceof DuplicateRoleScopedLayoutError

        ? t('layoutRole.duplicateRole', 'Another layout is already assigned to this role.')

        : err instanceof Error

          ? err.message

          : t('treeSettings.saveError', 'Failed to save tree settings.'),

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

    await deleteTreeTableLayout(props.collection, selectedLayoutId.value)

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

  <div class="tree-builder-panel flex w-full flex-col gap-1">

    <RoleScopedLayoutSelector

      class="shrink-0"

      mode="single"

      :layout-label="t('layoutRole.treeLayout', 'Tree layout')"

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

    <TreeTableSettingsDesigner

      v-model="treeSettings"

      :collection="collection"

      builder-managed

      class="shrink-0"

    />

  </div>

</template>

