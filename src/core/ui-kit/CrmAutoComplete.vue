<script lang="ts">
export default {
  name: 'CrmAutoComplete',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import {
  fetchRelatedCollectionOptionById,
  searchRelatedCollectionOptions,
} from '@/modules/entities/services/collectionSchema'
import {
  useTranslatedCollection,
  useTranslation,
} from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'

const CREATE_OPTION_VALUE = '__crm_create_new__' as const

interface SelectOption {
  label: string
  value: string | number
}

interface CreateOption {
  label: string
  value: typeof CREATE_OPTION_VALUE
  createNew: true
}

type CrmAutoCompleteOption = SelectOption | CreateOption

const props = withDefaults(
  defineProps<{
    modelValue: SelectOption | null
    collection?: string
    template?: string
    disabled?: boolean
    placeholder?: string
    optionLabel?: string
    /** When false, hide the inline “create new” option (pick-existing only). */
    allowCreate?: boolean
    /** Omit these record ids from search suggestions. */
    excludeIds?: Array<string | number>
    /** Show an X to clear the selected lookup. */
    showClear?: boolean
  }>(),
  {
    allowCreate: true,
    showClear: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: SelectOption | null]
  created: [record: Record<string, unknown>]
  show: []
  hide: []
}>()

const { t } = useTranslation()
const collectionLabel = useTranslatedCollection(() => props.collection ?? '')
const attrs = useAttrs()
const suggestions = ref<CrmAutoCompleteOption[]>([])
const createDialogVisible = ref(false)
const { canCreate: canCreateRecords } = useEntityPermissions(() => props.collection)

const optionLabel = computed(() => props.optionLabel ?? 'label')
const createOption = computed<CreateOption | null>(() => {
  if (
    !props.collection?.trim() ||
    props.disabled ||
    props.allowCreate === false ||
    !canCreateRecords.value
  ) {
    return null
  }

  return {
    label: t('autoComplete.createNew', 'New {collection}', {
      collection: collectionLabel.value || props.collection,
    }),
    value: CREATE_OPTION_VALUE,
    createNew: true,
  }
})

/** Drop props that fight create-new / search behavior when passed via field metadata. */
const autoCompleteAttrs = computed(() => {
  const {
    forceSelection: _forceSelection,
    'force-selection': _forceSelectionKebab,
    suggestions: _suggestions,
    optionValue: _optionValue,
    'option-value': _optionValueKebab,
    allowCreate: _allowCreate,
    'allow-create': _allowCreateKebab,
    showClear: _showClear,
    'show-clear': _showClearKebab,
    ...rest
  } = attrs as Record<string, unknown>
  return rest
})

function withCreateOption(records: SelectOption[]): CrmAutoCompleteOption[] {
  const create = createOption.value
  return create ? [...records, create] : records
}

async function searchOptions(event: { query?: string }): Promise<void> {
  if (!props.collection) {
    suggestions.value = []
    return
  }

  // Open the overlay immediately so “create new” is visible even if search is slow.
  suggestions.value = withCreateOption([])

  try {
    const records = await searchRelatedCollectionOptions(
      props.collection,
      event.query ?? '',
      props.template,
      props.excludeIds,
    )
    suggestions.value = withCreateOption(records)
  } catch (error) {
    console.warn('[CrmAutoComplete] Failed to search options', error)
    suggestions.value = withCreateOption([])
  }
}

function handleDropdownClick(): void {
  void searchOptions({ query: '' })
}

function openCreateDialog(event?: Event): void {
  event?.preventDefault()
  event?.stopPropagation()
  if (!createOption.value) return
  createDialogVisible.value = true
  emit('update:modelValue', props.modelValue)
}

function updateModelValue(value: CrmAutoCompleteOption | string | null): void {
  if (isCreateOption(value)) {
    openCreateDialog()
    return
  }

  if (isSelectOption(value)) {
    emit('update:modelValue', value)
    return
  }

  // PrimeVue emits the typed query string while searching. Keep the current
  // selection so the input is not cleared on every keystroke.
  if (typeof value === 'string') return

  emit('update:modelValue', null)
}

function handleOverlayShow(): void {
  emit('show')
}

function handleOverlayHide(): void {
  emit('hide')
}

function clearValue(event?: Event): void {
  event?.preventDefault()
  event?.stopPropagation()
  if (props.disabled) return
  emit('update:modelValue', null)
}

async function handleRecordCreated(record: Record<string, unknown>): Promise<void> {
  emit('created', record)

  const id = record.id
  if (!props.collection || (typeof id !== 'string' && typeof id !== 'number')) {
    emit('update:modelValue', null)
    return
  }

  const option =
    (await fetchRelatedCollectionOptionById(
      props.collection,
      id,
      props.template,
    )) ?? {
      label: String(id),
      value: id,
    }

  emit('update:modelValue', option)
}

function isCreateOption(value: unknown): value is CreateOption {
  if (value === CREATE_OPTION_VALUE) return true
  if (typeof value !== 'object' || value === null) return false
  const option = value as Partial<CreateOption>
  return option.createNew === true || option.value === CREATE_OPTION_VALUE
}

function isSelectOption(value: unknown): value is SelectOption {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    !isCreateOption(value) &&
    ((typeof (value as SelectOption).value === 'string' &&
      (value as SelectOption).value !== CREATE_OPTION_VALUE) ||
      typeof (value as SelectOption).value === 'number')
  )
}
</script>

<template>
  <div class="crm-autocomplete relative w-full min-w-0">
    <AutoComplete
      v-bind="autoCompleteAttrs"
      class="min-w-0 w-full"
      :class="{ 'crm-autocomplete__field--clearable': showClear && modelValue }"
      :model-value="modelValue"
      :suggestions="suggestions"
      :option-label="optionLabel"
      :placeholder="placeholder"
      :disabled="disabled"
      append-to="body"
      :complete-on-focus="true"
      :force-selection="true"
      :show-empty-message="true"
      :show-clear="false"
      @update:model-value="updateModelValue"
      @complete="searchOptions"
      @dropdown-click="handleDropdownClick"
      @show="handleOverlayShow"
      @hide="handleOverlayHide"
      @clear="clearValue"
    >
      <template #option="{ option }">
        <span
          v-if="isCreateOption(option)"
          class="font-bold text-teal-700"
          @mousedown.prevent="openCreateDialog"
        >
          {{ option.label }}
        </span>
        <span v-else>{{ option.label }}</span>
      </template>
      <template #empty>
        <span class="text-muted-color block p-2">
          {{ t('autoComplete.noResults', 'No results found') }}
        </span>
      </template>
    </AutoComplete>
    <Button
      v-if="showClear && modelValue"
      type="button"
      icon="pi pi-times"
      text
      rounded
      severity="secondary"
      size="small"
      class="crm-autocomplete__clear"
      :disabled="disabled"
      :aria-label="t('autoComplete.clear', 'Clear')"
      :title="t('autoComplete.clear', 'Clear')"
      @mousedown.prevent.stop="clearValue"
      @click.stop="clearValue"
    />

    <RecordCreateDialog
      v-if="collection"
      :visible="createDialogVisible"
      :collection="collection"
      @update:visible="createDialogVisible = $event"
      @created="handleRecordCreated"
    />
  </div>
</template>

<style scoped>
.crm-autocomplete__clear {
  height: 1.5rem;
  inset-inline-end: 2.15rem;
  padding: 0;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 1.5rem;
  z-index: 1;
}

.crm-autocomplete__field--clearable :deep(.p-autocomplete-input) {
  padding-inline-end: 4rem;
}
</style>

