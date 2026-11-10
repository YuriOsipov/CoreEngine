<script lang="ts">
export default {
  name: 'CrmChildLookupField',
}
</script>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { LayoutFieldChildLookup, LayoutFieldMetadata } from '@/interfaces'
import {
  useChildLookupField,
  type ChildLookupFieldMode,
  type ChildLookupValueInput,
} from '@/core/useChildLookupField'

const props = withDefaults(defineProps<{
  modelValue: unknown
  settings?: LayoutFieldChildLookup
  sourceRecord: Record<string, unknown>
  mode?: ChildLookupFieldMode
  targetField?: string
  entityCollection?: string
  fields?: LayoutFieldMetadata[]
  sourceCollection?: string
  sourceIdField?: string
  parentCollection?: string
  parentId?: string | number
  parentName?: string
  parentRecord?: Record<string, unknown>
  preferPicklist?: boolean
  /** Force value-mode control; otherwise inferred from target field type. */
  valueInput?: ChildLookupValueInput
  /** When true (edit), keep stored scalar on first hydrate. Create should leave false. */
  preserveDraftOnHydrate?: boolean
  options?: Array<{ label: string; value: unknown }>
  disabled?: boolean
  inputId?: string
  fluid?: boolean
  inputClass?: string
  placeholder?: string
  size?: 'small' | 'large' | undefined
  appendTo?: string | HTMLElement | undefined
  min?: number
  max?: number
  minFractionDigits?: number
  maxFractionDigits?: number
  /** Currency / number adornments from field runtime props. */
  suffix?: string
  prefix?: string
}>(), {
  mode: 'auto',
  fluid: true,
  preserveDraftOnHydrate: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  'overlay-show': []
  'overlay-hide': []
}>()

const {
  loading,
  resolvedMode,
  resolvedValueInput,
  selectOptions,
  numericModelValue,
  textModelValue,
  updateValue,
} = useChildLookupField({
  modelValue: toRef(props, 'modelValue'),
  settings: computed(() => props.settings),
  sourceRecord: toRef(props, 'sourceRecord'),
  mode: toRef(props, 'mode'),
  targetField: toRef(props, 'targetField'),
  entityCollection: toRef(props, 'entityCollection'),
  fields: toRef(props, 'fields'),
  sourceCollection: toRef(props, 'sourceCollection'),
  sourceIdField: toRef(props, 'sourceIdField'),
  parentCollection: toRef(props, 'parentCollection'),
  parentId: toRef(props, 'parentId'),
  parentName: toRef(props, 'parentName'),
  parentRecord: toRef(props, 'parentRecord'),
  preferPicklist: toRef(props, 'preferPicklist'),
  valueInput: toRef(props, 'valueInput'),
  preserveDraftOnHydrate: toRef(props, 'preserveDraftOnHydrate'),
  preloadedOptions: toRef(props, 'options'),
  onUpdate: (value) => emit('update:modelValue', value),
})
</script>

<template>
  <Select
    v-if="resolvedMode === 'picklist'"
    :input-id="inputId"
    :model-value="modelValue"
    :options="selectOptions"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder"
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
  <InputText
    v-else-if="resolvedValueInput === 'text'"
    :id="inputId"
    :model-value="textModelValue"
    :disabled="disabled || loading"
    :placeholder="placeholder"
    :size="size"
    :fluid="fluid"
    :class="inputClass"
    autocomplete="off"
    @update:model-value="updateValue($event)"
  />
  <InputNumber
    v-else
    :input-id="inputId"
    :model-value="numericModelValue"
    :disabled="disabled || loading"
    :min="min"
    :max="max"
    :min-fraction-digits="minFractionDigits ?? 0"
    :max-fraction-digits="maxFractionDigits ?? 5"
    :prefix="prefix"
    :suffix="suffix"
    :input-class="inputClass"
    :size="size"
    :fluid="fluid"
    @update:model-value="updateValue($event)"
  />
</template>
