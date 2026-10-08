<script lang="ts">
export default {
  name: 'EntityBuilderPanel',
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
  <div class="entity-builder-panel flex min-h-0 flex-col gap-2.5">
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
    :show-role="false"
    :allow-delete-default="true"
    @update:layout-name="layoutName = $event"
    @update:role-id="layoutRoleId = $event"
    @layout-selected="emit('layout-selected', $event)"
    @new-layout="emit('new-layout')"
    @save-layout="emit('save-layout')"
    @delete-layout="emit('delete-layout')"
    />
    <FormBuilder
      v-model="schema"
      :collection="collection"
      class="min-h-0 flex-1"
    />
  </div>
</template>
