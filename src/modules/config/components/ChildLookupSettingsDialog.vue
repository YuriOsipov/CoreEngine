<script lang="ts">
export default {
  name: 'ChildLookupSettingsDialog',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayoutFieldChildLookup } from '@/interfaces'
import type { FilterPair } from '@/core/relatedTransferFilterPairs'
import { useTranslation } from '@/core/translation'
import FilterPairEditor from './FilterPairEditor.vue'

type FieldOption = {
  label: string
  value: string
}

type ParentRelationOption = {
  label: string
  field: string
  collection: string
}

const props = defineProps<{
  visible: boolean
  fieldLabel?: string
  settings: LayoutFieldChildLookup
  isPicklist: boolean
  defaultMode: 'sourceField' | 'lookupQuery'
  defaultModeOptions: Array<{ label: string; value: 'sourceField' | 'lookupQuery' }>
  sourceFieldOptions: FieldOption[]
  collectionOptions: FieldOption[]
  childFieldOptions: FieldOption[]
  defaultFieldOptions: FieldOption[]
  parentRelationOptions: ParentRelationOption[]
  parentRelationField: string
  showParentCollectionSelector: boolean
  parentFilterFieldOptions: FieldOption[]
  sourceTokenFieldOptions: FieldOption[]
  filterPairs: FilterPair[]
  childFieldsLoading?: boolean
  sourceFieldsLoading?: boolean
  parentFieldsLoading?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'update:source-field': [value: string]
  'update:default-mode': [value: 'sourceField' | 'lookupQuery']
  'update:collection': [value: string]
  'update:settings': [patch: Partial<LayoutFieldChildLookup>]
  'update:parent-field': [value: string]
  'add-filter': []
  'update-filter': [index: number, patch: Partial<FilterPair>]
  'remove-filter': [index: number]
}>()

const { t } = useTranslation()

const dialogVisible = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

const dialogHeader = computed(() => {
  const label = props.fieldLabel?.trim()
  if (label) {
    return t('formBuilder.childLookupDialogTitle', 'Child value lookup · {label}', { label })
  }
  return t('formBuilder.childLookupDialogTitleDefault', 'Child value lookup')
})

const showLookupQuery = computed(
  () => props.isPicklist || props.defaultMode === 'lookupQuery',
)
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogHeader"
    :style="{ width: 'min(840px, 94vw)' }"
    :breakpoints="{ '960px': '94vw' }"
  >
    <div class="grid gap-4">
      <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
        {{ t('formBuilder.childLookupSourceField', 'Source field') }}
        <Select
          :model-value="settings.sourceField"
          :options="sourceFieldOptions"
          option-label="label"
          option-value="value"
          filter
          fluid
          @update:model-value="emit('update:source-field', String($event ?? ''))"
        />
      </label>

      <label
        v-if="!isPicklist"
        class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700"
      >
        {{ t('formBuilder.childLookupDefaultFrom', 'Default from') }}
        <Select
          :model-value="defaultMode"
          :options="defaultModeOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="emit('update:default-mode', ($event as 'sourceField' | 'lookupQuery') || 'sourceField')"
        />
      </label>

      <template v-if="showLookupQuery">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{ t('formBuilder.childLookupCollection', 'Child collection') }}
            <Select
              :model-value="settings.collection"
              :options="collectionOptions"
              option-label="label"
              option-value="value"
              filter
              fluid
              @update:model-value="emit('update:collection', String($event ?? ''))"
            />
          </label>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{ t('formBuilder.childLookupSourceRelationField', 'Child source field') }}
            <Select
              :model-value="settings.childSourceField"
              :options="childFieldOptions"
              option-label="label"
              option-value="value"
              :loading="childFieldsLoading"
              filter
              fluid
              @update:model-value="emit('update:settings', { childSourceField: String($event ?? '') })"
            />
          </label>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{ t('formBuilder.childLookupValueField', 'Value field') }}
            <Select
              :model-value="settings.valueField"
              :options="childFieldOptions"
              option-label="label"
              option-value="value"
              :loading="childFieldsLoading"
              filter
              fluid
              @update:model-value="emit('update:settings', { valueField: String($event ?? '') })"
            />
          </label>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <label
            v-if="showParentCollectionSelector"
            class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700"
          >
            {{ t('formBuilder.childLookupParentCollection', 'Parent collection') }}
            <Select
              :model-value="parentRelationField || null"
              :options="parentRelationOptions"
              option-label="label"
              option-value="field"
              :placeholder="t('formBuilder.childLookupParentCollectionNone', 'None')"
              show-clear
              filter
              fluid
              @update:model-value="emit('update:parent-field', String($event ?? ''))"
            />
          </label>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
            {{
              isPicklist
                ? t('formBuilder.childLookupDefaultValueField', 'Default value')
                : t('formBuilder.childLookupFallbackDefaultValue', 'Fallback from source field')
            }}
            <Select
              :model-value="settings.defaultValueField ?? ''"
              :options="defaultFieldOptions"
              option-label="label"
              option-value="value"
              :loading="sourceFieldsLoading"
              show-clear
              filter
              fluid
              @update:model-value="emit('update:settings', { defaultValueField: String($event ?? '') })"
            />
          </label>
        </div>

        <div class="grid gap-2 text-[0.8rem] font-semibold text-surface-700">
          {{ t('formBuilder.childLookupParentFilter', 'Lookup filter') }}
          <p class="m-0 text-[0.75rem] font-normal text-muted-color">
            {{
              t(
                'formBuilder.childLookupFilterHint',
                'Match rows in the child collection. Use parent/current fields or a fixed value; operators support equals, contains, and ranges.',
              )
            }}
          </p>
          <FilterPairEditor
            rich
            :pairs="filterPairs"
            :source-options="childFieldOptions"
            :filter-options="parentFilterFieldOptions"
            :source-token-options="sourceTokenFieldOptions"
            :source-placeholder="t('formBuilder.childLookupFilterField', 'Child collection field')"
            :filter-placeholder="t('formBuilder.childLookupParentFilterField', 'Parent field')"
            :source-token-placeholder="t('formBuilder.childLookupSourceTokenField', 'Current / source field')"
            :add-label="t('formBuilder.childLookupAddFilterPair', 'Add filter condition')"
            :source-loading="childFieldsLoading"
            :filter-loading="parentFieldsLoading"
            @add="emit('add-filter')"
            @update-pair="(pairIndex, patch) => emit('update-filter', pairIndex, patch)"
            @remove="emit('remove-filter', $event)"
          />
        </div>
      </template>

      <label
        v-else
        class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700"
      >
        {{ t('formBuilder.childLookupDefaultValueField', 'Default value') }}
        <Select
          :model-value="settings.defaultValueField ?? ''"
          :options="defaultFieldOptions"
          option-label="label"
          option-value="value"
          :loading="sourceFieldsLoading"
          show-clear
          filter
          fluid
          @update:model-value="emit('update:settings', { defaultValueField: String($event ?? '') })"
        />
      </label>
    </div>

    <template #footer>
      <Button
        :label="t('common.done', 'Done')"
        autofocus
        @click="dialogVisible = false"
      />
    </template>
  </Dialog>
</template>
