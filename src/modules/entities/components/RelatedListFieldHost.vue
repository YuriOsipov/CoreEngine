<script lang="ts">
export default {
  name: 'RelatedListFieldHost',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import RelatedDataTableField from '@/modules/entities/components/RelatedDataTableField.vue'
import AttachedDataTableField from '@/modules/entities/components/AttachedDataTableField.vue'
import M2ABlocksField from '@/modules/entities/components/M2ABlocksField.vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  isDataTableField,
  isFilesField,
  isM2ABuilderField,
} from '@/core/fieldHelpers'
import { relatedListFieldTabLabel } from '@/modules/config/utils/recordPageRelatedList'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    collection: string
    recordId?: string | number | null
    record?: Record<string, unknown> | null
    active?: boolean
    showCreate?: boolean
    showActions?: boolean
    m2aEditable?: boolean
    showViewAll?: boolean
  }>(),
  {
    active: true,
    showCreate: false,
    showActions: false,
    m2aEditable: false,
    showViewAll: true,
  },
)

const emit = defineEmits<{
  'view-record': [row: Record<string, unknown>, relatedCollection: string]
  'blocks-saved': [payload: { field: string; value: unknown }]
  'files-changed': [payload: { field: string; value: Record<string, unknown>[] }]
  'related-changed': []
}>()

const { t } = useTranslation()

const hasParent = computed(
  () => props.recordId !== undefined && props.recordId !== null && props.recordId !== '',
)

const relatedListPath = computed(() => {
  if (!props.field.relatedCollection || !hasParent.value) return '#'
  return `/object/${encodeURIComponent(props.collection)}/${encodeURIComponent(String(props.recordId))}/${encodeURIComponent(props.field.relatedCollection)}`
})

function onViewRecord(row: Record<string, unknown>): void {
  const relatedCollection = props.field.relatedCollection?.trim()
  if (!relatedCollection) return
  emit('view-record', row, relatedCollection)
}
</script>

<template>
  <div class="related-list-field-host h-full min-h-0">
    <RelatedDataTableField
      v-if="isDataTableField(field) && field.relatedCollection"
      :field="field"
      :entity="collection"
      :parent-id="recordId ?? undefined"
      :parent-name="collection"
      :parent-record="record ?? undefined"
      :active="active"
      :show-create="showCreate"
      :show-actions="showActions"
      :default-sort-field="field.dataTable?.sort?.field ?? null"
      :default-sort-order="field.dataTable?.sort?.order ?? null"
      @view-record="onViewRecord"
      @related-changed="emit('related-changed')"
    >
      <template v-if="showViewAll" #actions>
        <RouterLink
          v-if="field.relatedCollection && hasParent"
          class="text-sm font-semibold text-primary no-underline hover:underline"
          :to="relatedListPath"
        >
          {{ t('common.viewAll', 'View all') }}
        </RouterLink>
      </template>
    </RelatedDataTableField>

    <AttachedDataTableField
      v-else-if="isFilesField(field)"
      :field="field"
      :model-value="record ?? {}"
      :parent-id="recordId ?? undefined"
      :parent-name="collection"
      @files-changed="emit('files-changed', $event)"
    />

    <M2ABlocksField
      v-else-if="isM2ABuilderField(field)"
      :field="field"
      :entity="collection"
      :parent-id="recordId ?? undefined"
      :model-value="record?.[field.field]"
      :original-value="record?.[field.field]"
      :editable="m2aEditable"
      @saved="emit('blocks-saved', $event)"
    />

    <p
      v-else
      class="m-0 px-3 py-2 text-sm text-muted-color"
    >
      {{ relatedListFieldTabLabel(field) }}
    </p>
  </div>
</template>
