<script lang="ts">
export default {
  name: 'CrmInlineCellEditor',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { LayoutFieldChildLookup } from '@/interfaces'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import CrmChildLookupField from '@/core/ui-kit/CrmChildLookupField.vue'
import CrmDynamicPicklist from '@/core/ui-kit/CrmDynamicPicklist.vue'
import {
  isDynamicPicklistSource,
  type DynamicPicklistSource,
} from '@/core/dynamicPicklist'
import {
  serializeInlineCellValue,
  type InlineCellEditorKind,
  type InlineLookupOption,
} from '@/core/inlineCellEdit'
import { fetchFieldRuntimeMetadata } from '@/modules/entities/services/collectionSchema'
import { useTranslation } from '@/core/translation'

interface ChoiceOption {
  label: string
  value: unknown
}

const props = withDefaults(
  defineProps<{
    kind: InlineCellEditorKind
    modelValue: unknown
    collection: string
    field: string
    relatedCollection?: string | null
    template?: string | null
    format?: string | null
    saving?: boolean
    childLookup?: LayoutFieldChildLookup | null
    sourceRecord?: Record<string, unknown> | null
    parentCollection?: string | null
    parentId?: string | number | null
    parentName?: string | null
    parentRecord?: Record<string, unknown> | null
  }>(),
  {
    relatedCollection: null,
    template: null,
    format: null,
    saving: false,
    childLookup: null,
    sourceRecord: null,
    parentCollection: null,
    parentId: null,
    parentName: null,
    parentRecord: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  commit: [serialized: unknown]
  cancel: []
}>()

const { t } = useTranslation()
const rootEl = ref<HTMLElement | null>(null)
const ignoreBlur = ref(false)
const selectOptions = ref<ChoiceOption[]>([])
const selectLoading = ref(false)
const activeChoiceSource = ref<DynamicPicklistSource | null>(null)
const dateShowTime = ref(props.kind === 'datetime')
const dateFormat = ref('yy-mm-dd')
let blurTimer: number | null = null

const effectiveKind = computed<InlineCellEditorKind>(() => {
  if (props.kind === 'date' && dateShowTime.value) return 'datetime'
  if (props.kind === 'datetime' && !dateShowTime.value) return 'date'
  return props.kind
})

const lookupValue = computed<InlineLookupOption | null>(() => {
  if (!props.modelValue || typeof props.modelValue !== 'object') return null
  const option = props.modelValue as Partial<InlineLookupOption>
  if (
    typeof option.label === 'string' &&
    (typeof option.value === 'string' || typeof option.value === 'number')
  ) {
    return { label: option.label, value: option.value }
  }
  return null
})

onMounted(() => {
  void loadFieldMetadata()
  void nextTick(() => focusEditor())
})

onBeforeUnmount(() => {
  clearBlurTimer()
})

watch(
  () => [props.collection, props.field, props.kind] as const,
  () => {
    void loadFieldMetadata()
  },
)

async function loadFieldMetadata(): Promise<void> {
  if (!props.collection || !props.field) return

  if (props.kind === 'select') {
    selectLoading.value = true
    activeChoiceSource.value = null
    try {
      const metadata = await fetchFieldRuntimeMetadata(
        props.collection,
        props.field,
        'Select',
      )
      if (isDynamicPicklistSource(metadata.props.choiceSource)) {
        activeChoiceSource.value = metadata.props.choiceSource
        selectOptions.value = []
        return
      }
      const options = metadata.props.options
      selectOptions.value = Array.isArray(options)
        ? (options as ChoiceOption[]).filter(
            (option) =>
              option &&
              typeof option === 'object' &&
              typeof option.label === 'string',
          )
        : []
    } catch {
      selectOptions.value = []
    } finally {
      selectLoading.value = false
    }
    return
  }

  if (props.kind === 'date' || props.kind === 'datetime') {
    try {
      const metadata = await fetchFieldRuntimeMetadata(
        props.collection,
        props.field,
        'DatePicker',
      )
      dateShowTime.value = Boolean(metadata.props.showTime) || props.kind === 'datetime'
      if (typeof metadata.props.dateFormat === 'string' && metadata.props.dateFormat) {
        dateFormat.value = metadata.props.dateFormat
      }
    } catch {
      dateShowTime.value = props.kind === 'datetime'
    }
  }
}

function focusEditor(): void {
  const root = rootEl.value
  if (!root) return
  const input = root.querySelector<HTMLInputElement>(
    'input.p-autocomplete-input, input.p-inputtext, input, textarea',
  )
  if (!input) return
  input.focus()
}

function updateValue(value: unknown): void {
  emit('update:modelValue', value)
}

function commit(): void {
  clearBlurTimer()
  if (props.saving) return
  emit('commit', serializeInlineCellValue(effectiveKind.value, props.modelValue))
}

function cancel(): void {
  clearBlurTimer()
  emit('cancel')
}

function handleLookupUpdate(value: InlineLookupOption | null): void {
  updateValue(value)
}

function handleCheckboxUpdate(value: boolean | undefined): void {
  updateValue(Boolean(value))
}

function handleKeydown(event: KeyboardEvent): void {
  event.stopPropagation()

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }

  if (event.key !== 'Enter' || event.shiftKey) return
  // Overlay lives in a body portal (Select filter / Autocomplete). Let PrimeVue
  // apply the highlighted option; commit runs from handleOverlayHide.
  if (isPrimeOverlayOpen()) return
  event.preventDefault()
  commit()
}

function handleBlur(event: FocusEvent): void {
  if (props.saving || ignoreBlur.value) return
  const related = event.relatedTarget
  if (related instanceof Node && rootEl.value?.contains(related)) return

  clearBlurTimer()
  blurTimer = window.setTimeout(() => {
    blurTimer = null
    if (ignoreBlur.value || props.saving) return
    if (rootEl.value?.contains(document.activeElement)) return
    if (isPrimeOverlayOpen()) return
    commit()
  }, 180)
}

function handleOverlayShow(): void {
  ignoreBlur.value = true
  clearBlurTimer()
}

function handleOverlayHide(): void {
  clearBlurTimer()
  // Select/Autocomplete overlays append to body, so Enter while open never
  // reaches this root. Commit once the overlay closes (Enter or click).
  ignoreBlur.value = true
  void nextTick(() => {
    if (props.saving) {
      ignoreBlur.value = false
      return
    }
    commit()
    ignoreBlur.value = false
  })
}

function isPrimeOverlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '.p-datepicker-panel, .p-select-overlay, .p-autocomplete-overlay, .p-overlay-popover',
    ),
  )
}

function clearBlurTimer(): void {
  if (blurTimer == null) return
  window.clearTimeout(blurTimer)
  blurTimer = null
}
</script>

<template>
  <div
    ref="rootEl"
    class="crm-inline-cell-editor"
    @keydown="handleKeydown"
    @mousedown.stop
    @click.stop
    @blur.capture="handleBlur"
  >
    <InputNumber
      v-if="kind === 'number'"
      :model-value="typeof modelValue === 'number' ? modelValue : null"
      fluid
      size="small"
      :disabled="saving"
      class="w-full"
      @update:model-value="updateValue"
    />
    <CrmDynamicPicklist
      v-else-if="kind === 'select' && activeChoiceSource"
      :model-value="modelValue"
      :choice-source="activeChoiceSource"
      :entity-collection="collection"
      :source-record="sourceRecord ?? {}"
      :disabled="saving"
      size="small"
      append-to="body"
      fluid
      input-class="w-full"
      @overlay-show="handleOverlayShow"
      @overlay-hide="handleOverlayHide"
      @update:model-value="updateValue"
    />
    <Select
      v-else-if="kind === 'select'"
      :model-value="modelValue"
      :options="selectOptions"
      option-label="label"
      option-value="value"
      :loading="selectLoading"
      :disabled="saving"
      :placeholder="t('datatable.inlineSelectPlaceholder', 'Select…')"
      fluid
      size="small"
      show-clear
      append-to="body"
      class="w-full"
      @show="handleOverlayShow"
      @hide="handleOverlayHide"
      @update:model-value="updateValue"
    />
    <DatePicker
      v-else-if="kind === 'date' || kind === 'datetime'"
      :model-value="modelValue instanceof Date ? modelValue : null"
      :date-format="dateFormat"
      :show-time="dateShowTime"
      :disabled="saving"
      show-icon
      fluid
      size="small"
      append-to="body"
      class="w-full"
      @show="handleOverlayShow"
      @hide="handleOverlayHide"
      @update:model-value="updateValue"
    />
    <CrmAutoComplete
      v-else-if="kind === 'lookup'"
      :model-value="lookupValue"
      :collection="relatedCollection ?? undefined"
      :template="template ?? undefined"
      :allow-create="false"
      :show-clear="true"
      :disabled="saving"
      fluid
      size="small"
      dropdown
      class="w-full"
      @show="handleOverlayShow"
      @hide="handleOverlayHide"
      @update:model-value="handleLookupUpdate"
    />
    <CrmChildLookupField
      v-else-if="kind === 'childLookup' && childLookup"
      :model-value="modelValue"
      :settings="childLookup"
      :source-record="sourceRecord ?? {}"
      :target-field="field"
      :entity-collection="collection"
      :parent-collection="parentCollection ?? undefined"
      :parent-id="parentId ?? undefined"
      :parent-name="parentName ?? undefined"
      :parent-record="parentRecord ?? undefined"
      :prefer-picklist="Boolean(relatedCollection)"
      :disabled="saving"
      :placeholder="t('datatable.inlineSelectPlaceholder', 'Select…')"
      fluid
      size="small"
      append-to="body"
      input-class="w-full"
      @overlay-show="handleOverlayShow"
      @overlay-hide="handleOverlayHide"
      @update:model-value="updateValue"
    />
    <Checkbox
      v-else-if="kind === 'boolean'"
      :model-value="Boolean(modelValue)"
      binary
      :disabled="saving"
      @update:model-value="handleCheckboxUpdate"
    />
    <InputText
      v-else
      :model-value="modelValue == null ? '' : String(modelValue)"
      fluid
      size="small"
      :disabled="saving"
      class="w-full"
      @update:model-value="updateValue"
    />
  </div>
</template>

<style scoped>
.crm-inline-cell-editor {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}

.crm-inline-cell-editor :deep(.p-inputtext),
.crm-inline-cell-editor :deep(.p-select),
.crm-inline-cell-editor :deep(.p-datepicker),
.crm-inline-cell-editor :deep(.p-inputnumber),
.crm-inline-cell-editor :deep(.p-autocomplete),
.crm-inline-cell-editor :deep(.p-autocomplete-input),
.crm-inline-cell-editor :deep(.p-inputnumber-input) {
  max-width: 100%;
  min-width: 0 !important;
  width: 100%;
}
</style>
