<script lang="ts">
export default {
  name: 'CrmM2MMultiSelect',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  searchRelatedCollectionOptions,
} from '@/modules/entities/services/collectionSchema'
import { useTranslation } from '@/core/translation'
import {
  m2mValueToOptions,
  type M2MSelectOption,
} from '@/modules/entities/utils/m2mSchema'

const props = defineProps<{
  modelValue: unknown
  collection?: string
  template?: string
  disabled?: boolean
  placeholder?: string
  junctionField?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: M2MSelectOption[]]
}>()

const { t } = useTranslation()
const suggestions = ref<M2MSelectOption[]>([])
const selected = ref<M2MSelectOption[]>([])

const placeholderText = computed(
  () =>
    props.placeholder ||
    t('m2mMultiSelect.placeholder', 'Search and select…'),
)

watch(
  () => [props.modelValue, props.junctionField] as const,
  () => {
    selected.value = m2mValueToOptions(
      props.modelValue,
      props.junctionField ?? null,
    )
  },
  { immediate: true, deep: true },
)

async function searchOptions(event: { query?: string }): Promise<void> {
  if (!props.collection) {
    suggestions.value = []
    return
  }
  try {
    const excludeIds = selected.value.map((opt) => opt.value)
    suggestions.value = await searchRelatedCollectionOptions(
      props.collection,
      event.query ?? '',
      props.template,
      excludeIds,
    )
  } catch (error) {
    console.warn('[CrmM2MMultiSelect] Failed to search options', error)
    suggestions.value = []
  }
}

function handleDropdownClick(): void {
  void searchOptions({ query: '' })
}

function updateSelected(value: M2MSelectOption[] | null): void {
  const next = Array.isArray(value) ? value : []
  selected.value = next
  emit('update:modelValue', next)
}
</script>

<template>
  <AutoComplete
    class="w-full"
    :model-value="selected"
    :suggestions="suggestions"
    option-label="label"
    :placeholder="placeholderText"
    :disabled="disabled"
    multiple
    append-to="body"
    :complete-on-focus="true"
    :force-selection="true"
    :show-empty-message="true"
    @update:model-value="updateSelected"
    @complete="searchOptions"
    @dropdown-click="handleDropdownClick"
  >
    <template #empty>
      <span class="text-muted-color block p-2">
        {{ t('autoComplete.noResults', 'No results found') }}
      </span>
    </template>
  </AutoComplete>
</template>
