<script lang="ts">
export default {
  name: 'CrmDynamicPicklist',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DynamicPicklistOption, DynamicPicklistSource } from '@/core/dynamicPicklist'
import {
  isRelatedPicklistSource,
  loadDynamicPicklistOptions,
} from '@/core/dynamicPicklist'
import { normalizeMultiPicklistValue } from '@/core/picklistField'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    modelValue: unknown
    choiceSource: DynamicPicklistSource
    entityCollection: string
    sourceRecord: Record<string, unknown>
    disabled?: boolean
    inputId?: string
    fluid?: boolean
    inputClass?: string
    placeholder?: string
    size?: 'small' | 'large' | undefined
    appendTo?: string | HTMLElement | undefined
    multiple?: boolean
  }>(),
  {
    fluid: true,
    multiple: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  'overlay-show': []
  'overlay-hide': []
}>()

const { t } = useTranslation()
const loading = ref(false)
const selectOptions = ref<DynamicPicklistOption[]>([])
let requestId = 0

const singleValue = computed(() => {
  if (props.multiple) return null
  return props.modelValue
})

const multiValue = computed(() => {
  if (!props.multiple) return []
  return normalizeMultiPicklistValue(props.modelValue)
})

watch(
  () => {
    const source = props.choiceSource
    if (isRelatedPicklistSource(source)) {
      return [
        props.entityCollection,
        source.mode,
        source.relationField,
        source.jsonField,
      ] as const
    }
    return [
      props.entityCollection,
      source.mode,
      source.relationField,
      source.jsonField,
      source.valueColumn,
      extractRelationFieldId(props.sourceRecord?.id),
      extractRelationFieldId(props.sourceRecord?.[source.relationField]),
      embeddedJsonToken(),
    ] as const
  },
  () => {
    void refresh()
  },
  { immediate: true },
)

function embeddedJsonToken(): string {
  if (isRelatedPicklistSource(props.choiceSource)) return ''
  const raw = props.sourceRecord?.[props.choiceSource.relationField]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const related = raw as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(related, props.choiceSource.jsonField)) return ''
  try {
    return JSON.stringify(related[props.choiceSource.jsonField])
  } catch {
    return ''
  }
}

async function refresh(): Promise<void> {
  const current = ++requestId
  loading.value = true
  try {
    const next = await loadDynamicPicklistOptions(
      props.entityCollection,
      props.choiceSource,
      props.sourceRecord ?? {},
    )
    if (current !== requestId) return
    selectOptions.value = next
    if (props.multiple) {
      const selected = normalizeMultiPicklistValue(props.modelValue)
      if (selected.length === 0) return
      const allowed = new Set(next.map((option) => String(option.value)))
      const filtered = selected.filter((item) => allowed.has(String(item)))
      if (filtered.length !== selected.length) {
        emit('update:modelValue', filtered.length > 0 ? filtered : null)
      }
      return
    }
    const value = props.modelValue
    if (
      next.length > 0 &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !next.some((option) => option.value === value || option.value === String(value))
    ) {
      emit('update:modelValue', null)
    }
  } finally {
    if (current === requestId) loading.value = false
  }
}

function updateValue(value: unknown): void {
  if (props.multiple) {
    const selected = normalizeMultiPicklistValue(value)
    emit('update:modelValue', selected.length > 0 ? selected : null)
    return
  }
  emit('update:modelValue', value)
}
</script>

<template>
  <InputText
    v-if="!loading && selectOptions.length === 0"
    :id="inputId"
    :model-value="modelValue == null ? '' : String(modelValue)"
    :disabled="disabled"
    :placeholder="placeholder ?? t('setup.fields.picklistManualPlaceholder', 'Enter value')"
    :size="size"
    :fluid="fluid"
    :class="inputClass"
    autocomplete="off"
    @update:model-value="updateValue"
  />
  <MultiSelect
    v-else-if="multiple"
    :input-id="inputId"
    :model-value="multiValue"
    :options="selectOptions"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder ?? t('datatable.inlineSelectPlaceholder', 'Select…')"
    :size="size"
    :append-to="appendTo"
    option-label="label"
    option-value="value"
    display="chip"
    filter
    show-clear
    :fluid="fluid"
    :class="inputClass"
    @show="emit('overlay-show')"
    @hide="emit('overlay-hide')"
    @update:model-value="updateValue"
  />
  <Select
    v-else
    :input-id="inputId"
    :model-value="singleValue"
    :options="selectOptions"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder ?? t('datatable.inlineSelectPlaceholder', 'Select…')"
    :size="size"
    :append-to="appendTo"
    option-label="label"
    option-value="value"
    show-clear
    filter
    :fluid="fluid"
    :class="inputClass"
    @show="emit('overlay-show')"
    @hide="emit('overlay-hide')"
    @update:model-value="updateValue"
  />
</template>
