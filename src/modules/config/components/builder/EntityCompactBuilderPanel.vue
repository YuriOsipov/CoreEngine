<script lang="ts">
export default {
  name: 'EntityCompactBuilderPanel',
}
</script>

<script setup lang="ts">
import RoleScopedLayoutSelector from './RoleScopedLayoutSelector.vue'
import FormBuilder from '../FormBuilder.vue'
import { useTranslation } from '@/core/translation'
import type { AppRoleOption, EntityLayoutSchema, SavedRoleScopedLayout } from '@/interfaces'

defineProps<{
  collection: string
  loading?: boolean
  saving?: boolean
  deleting?: boolean
  layouts: SavedRoleScopedLayout[]
  selectedLayoutId: string | null
  roleOptions: AppRoleOption[]
  layoutLabel: string
  setupMode?: boolean
}>()

const emit = defineEmits<{
  'layout-selected': [layoutId: string]
  'new-layout': []
  'save-layout': []
  'delete-layout': []
}>()

const schema = defineModel<EntityLayoutSchema>('schema', { required: true })
const layoutName = defineModel<string>('layoutName', { required: true })
const layoutRoleId = defineModel<string | null>('layoutRoleId', { required: true })
const { t } = useTranslation()
</script>

<template>
  <div class="entity-compact-builder-panel flex min-h-0 flex-col gap-2.5">
  <RoleScopedLayoutSelector
    class="shrink-0"
    mode="single"
    :layout-label="layoutLabel"
    :variant-label="t('layoutRole.layoutName', 'Layout name')"
    :layouts="layouts"
    :selected-layout-id="selectedLayoutId"
    :layout-name="layoutName"
    :role-id="layoutRoleId"
    :role-options="roleOptions"
    :loading="loading"
    :saving="saving"
    :deleting="deleting"
    :setup-mode="setupMode"
    :hint="t('builder.compactHint', 'Compact details are generated from fields and Block Layouts on the canvas. DataTable fields become related counters; other fields become compact fields.')"
    @update:layout-name="layoutName = $event"
    @update:role-id="layoutRoleId = $event"
    @layout-selected="emit('layout-selected', $event)"
    @new-layout="emit('new-layout')"
    @save-layout="emit('save-layout')"
    @delete-layout="emit('delete-layout')"
  />
  <div class="compact-designer min-h-0 flex-1">
    <FormBuilder
      v-model="schema"
      :collection="collection"
      :show-record-actions="false"
      :show-block-layouts-palette="true"
      class="min-h-0 flex-1"
    />
  </div>
  </div>
</template>

<style scoped>
.compact-designer {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
