<script lang="ts">
export default {
  name: 'CrmJsonCodeField',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  parseJsonCodeText,
  stringifyJsonCode,
} from '@/core/jsonField'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    modelValue?: unknown
    disabled?: boolean
    readonly?: boolean
    inputId?: string
    rows?: number
  }>(),
  {
    modelValue: null,
    disabled: false,
    readonly: false,
    inputId: undefined,
    rows: 8,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

const { t } = useTranslation()

const locked = computed(() => props.disabled || props.readonly)
const text = ref(stringifyJsonCode(props.modelValue))
const parseError = ref<string | null>(null)

watch(
  () => props.modelValue,
  (value) => {
    if (parseError.value) return
    const next = stringifyJsonCode(value)
    if (next !== text.value) {
      text.value = next
    }
  },
)

function applyText(next: string | undefined): void {
  if (locked.value) return
  const value = next ?? ''
  text.value = value
  const result = parseJsonCodeText(value)
  if (!result.ok) {
    parseError.value = result.error
    return
  }
  parseError.value = null
  emit('update:modelValue', result.value)
}

function onBlur(): void {
  if (locked.value || parseError.value) return
  text.value = stringifyJsonCode(props.modelValue)
}
</script>

<template>
  <div class="crm-json-code-field flex flex-col gap-1 w-full">
    <Textarea
      :id="inputId"
      :model-value="text"
      class="w-full font-mono text-sm"
      :rows="rows"
      :disabled="locked"
      :readonly="readonly"
      :invalid="Boolean(parseError)"
      autocomplete="off"
      spellcheck="false"
      @update:model-value="applyText"
      @blur="onBlur"
    />
    <small
      v-if="parseError"
      class="p-error"
    >
      {{ t('jsonField.invalidJson', 'Invalid JSON') }}: {{ parseError }}
    </small>
  </div>
</template>
