<script lang="ts">
export default {
  name: 'ListFilterValuePanel',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  listFilterableFields,
  type ListFilterCondition,
} from '@/modules/config/services/listFilterSettings'
import {
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
  searchRelatedCollectionOptions,
} from '@/modules/entities/services/collectionSchema'
import {
  filterOperatorLabel,
  conditionFieldSpanStyle,
  filterConditionComponentProps,
  isAutoCompleteFilterComponent,
  isSelectFilterComponent,
  resolveFilterConditionValue,
  resolveFilterValueComponent,
} from '@/core/listFilterUtils'
import { resolvePrimeVueComponent } from '@/core/primevue'
import { useTranslation } from '@/core/translation'
import type { PrimeVueComponentType } from '@/interfaces'

interface SelectOption {
  label: string
  value: string | number
}

interface ValueConditionDraft extends ListFilterCondition {
  label: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
}

const props = defineProps<{
  collection: string
  conditions: ListFilterCondition[]
}>()

const modelValue = defineModel<Record<string, unknown>>({ required: true })

const emit = defineEmits<{
  /** Fired when the user (or a mounted input) changes any condition value. */
  'values-change': []
}>()

const { t } = useTranslation()
const loading = ref(false)
const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
const autoCompleteSuggestions = reactive<Record<string, SelectOption[]>>({})
const autoCompleteSelections = reactive<Record<string, SelectOption | null>>({})
const autoCompleteTemplates = reactive<Record<string, string | undefined>>({})
const fieldMetaByName = ref<Map<string, ValueConditionDraft>>(new Map())

const displayConditions = computed<ValueConditionDraft[]>(() =>
  props.conditions.map((condition) => {
    const meta = fieldMetaByName.value.get(condition.field)
    return {
      ...condition,
      label: meta?.label ?? condition.field,
      type: meta?.type ?? 'string',
      component: meta?.component ?? 'InputText',
      relatedCollection: meta?.relatedCollection,
      value: resolveFilterConditionValue(
        modelValue.value,
        condition.id,
        condition.value,
      ),
    }
  }),
)

watch(
  () => [props.collection, props.conditions] as const,
  ([collection, conditions]) => {
    if (!collection || conditions.length === 0) {
      fieldMetaByName.value = new Map()
      return
    }
    void loadFieldMetadata(collection, conditions)
  },
  { immediate: true, deep: true },
)

watch(
  displayConditions,
  (conditions) => {
    void syncAutoCompleteSelections(conditions)
  },
  { deep: true },
)

async function loadFieldMetadata(
  collection: string,
  conditions: ListFilterCondition[],
): Promise<void> {
  loading.value = true
  try {
    const fields = await listFilterableFields(collection)
    const needed = new Set(conditions.map((condition) => condition.field))
    const nextMeta = new Map<string, ValueConditionDraft>()

    for (const field of fields) {
      if (!needed.has(field.field)) continue
      nextMeta.set(field.field, {
        id: '',
        field: field.field,
        operator: '_eq',
        value: null,
        label: field.label,
        type: field.type,
        component: field.component,
        relatedCollection: field.relatedCollection,
      })
      try {
        const metadata = await fetchFieldRuntimeMetadata(
          collection,
          field.field,
          field.component,
        )
        runtimeFieldProps[field.field] = metadata.props
        autoCompleteTemplates[field.field] = metadata.template
      } catch {
        runtimeFieldProps[field.field] = {}
      }
    }

    fieldMetaByName.value = nextMeta
    coerceEmptySelectValues()
  } finally {
    loading.value = false
  }
}

/**
 * Empty Select/FK values were historically saved as 0 via Number(null).
 * Coerce those back to null so they are omitted from the list query.
 */
function coerceEmptySelectValues(): void {
  let changed = false
  const next = { ...modelValue.value }

  for (const condition of props.conditions) {
    const meta = fieldMetaByName.value.get(condition.field)
    if (!meta) continue
    if (
      !isSelectFilterComponent(meta.component) &&
      !isAutoCompleteFilterComponent(meta.component)
    ) {
      continue
    }

    const current = resolveFilterConditionValue(
      next,
      condition.id,
      condition.value,
    )
    if (current === 0 || current === '0' || current === '') {
      next[condition.id] = null
      changed = true
    }
  }

  if (!changed) return
  modelValue.value = next
  emit('values-change')
}

function updateConditionValue(conditionId: string, value: unknown): void {
  // Clone Date so parents watching filter JSON / draft identity always see a change.
  const nextValue =
    value instanceof Date ? new Date(value.getTime()) : value
  modelValue.value = {
    ...modelValue.value,
    [conditionId]: nextValue,
  }
  emit('values-change')
}

function isTextFilterComponent(condition: ValueConditionDraft): boolean {
  return condition.component === 'InputText' || condition.component === 'Textarea'
}

/** Text inputs may emit native input while typing more reliably than update:modelValue. */
function onNativeInput(conditionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return
  }
  updateConditionValue(conditionId, target.value)
}

function conditionComponent(condition: ValueConditionDraft) {
  return resolvePrimeVueComponent(
    resolveFilterValueComponent(
      condition.component,
      runtimeFieldProps[condition.field],
    ),
  )
}

function conditionComponentProps(
  condition: ValueConditionDraft,
): Record<string, unknown> {
  return filterConditionComponentProps(condition, runtimeFieldProps)
}

function isNoValueOperator(condition: ValueConditionDraft): boolean {
  return condition.operator === '_null' || condition.operator === '_nnull'
}

function isAutoCompleteCondition(condition: ValueConditionDraft): boolean {
  return isAutoCompleteFilterComponent(condition.component)
}

function conditionStringValue(condition: ValueConditionDraft): string {
  const value = resolveFilterConditionValue(
    modelValue.value,
    condition.id,
    condition.value,
  )
  if (value === null || value === undefined) return ''
  return String(value)
}

function operatorLabel(operator: string): string {
  return t(`filter.${operatorKey(operator)}`, filterOperatorLabel(operator))
}

function operatorKey(operator: string): string {
  const map: Record<string, string> = {
    _eq: 'equals',
    _neq: 'notEquals',
    _contains: 'contains',
    _gt: 'greaterThan',
    _gte: 'greaterOrEqual',
    _lt: 'lessThan',
    _lte: 'lessOrEqual',
    _null: 'isEmpty',
    _nnull: 'isNotEmpty',
  }
  return map[operator] ?? operator
}

async function searchAutoCompleteOptions(
  condition: ValueConditionDraft,
  event: { query?: string },
): Promise<void> {
  if (!condition.relatedCollection) {
    autoCompleteSuggestions[condition.id] = []
    return
  }

  autoCompleteSuggestions[condition.id] = await searchRelatedCollectionOptions(
    condition.relatedCollection,
    event.query ?? '',
    autoCompleteTemplates[condition.field],
  )
}

function updateAutoCompleteValue(
  condition: ValueConditionDraft,
  value: SelectOption | null,
): void {
  autoCompleteSelections[condition.id] = value
  updateConditionValue(condition.id, value?.value ?? null)
}

async function syncAutoCompleteSelections(
  items: ValueConditionDraft[],
): Promise<void> {
  for (const condition of items.filter(isAutoCompleteCondition)) {
    const value = resolveFilterConditionValue(
      modelValue.value,
      condition.id,
      condition.value,
    )
    if (
      !condition.relatedCollection ||
      (typeof value !== 'string' && typeof value !== 'number')
    ) {
      autoCompleteSelections[condition.id] = null
      continue
    }

    const option = await fetchRelatedCollectionOptionById(
      condition.relatedCollection,
      value,
      autoCompleteTemplates[condition.field],
    )
    autoCompleteSelections[condition.id] = option
  }
}
</script>

<template>
  <section class="border border-surface-200 rounded-lg bg-surface-0 px-[0.75rem] py-[0.65rem]">
    <div class="grid grid-cols-12 gap-3">
      <div
        v-for="condition in displayConditions"
        :key="condition.id"
        class="flex flex-col gap-[0.35rem] min-w-0"
        :style="conditionFieldSpanStyle(condition)"
      >
        <label class="text-surface-700 text-[0.8rem] font-semibold leading-tight">
          {{ condition.label }}
          <span class="text-muted-color font-normal">({{ operatorLabel(condition.operator) }})</span>
        </label>
        <InputText
          v-if="isNoValueOperator(condition)"
          model-value=""
          disabled
          :placeholder="t('filter.value', 'Value')"
        />
        <component
          :is="conditionComponent(condition)"
          v-else-if="
            conditionComponent(condition) &&
            !isAutoCompleteCondition(condition)
          "
          :model-value="resolveFilterConditionValue(modelValue, condition.id, condition.value)"
          v-bind="conditionComponentProps(condition)"
          @update:model-value="updateConditionValue(condition.id, $event)"
          @input="
            isTextFilterComponent(condition)
              ? onNativeInput(condition.id, $event)
              : undefined
          "
        />
        <component
          :is="conditionComponent(condition)"
          v-else-if="conditionComponent(condition)"
          :model-value="autoCompleteSelections[condition.id]"
          :suggestions="autoCompleteSuggestions[condition.id] ?? []"
          v-bind="conditionComponentProps(condition)"
          @update:model-value="updateAutoCompleteValue(condition, $event)"
          @complete="searchAutoCompleteOptions(condition, $event)"
        />
        <InputText
          v-else
          :model-value="conditionStringValue(condition)"
          :placeholder="t('filter.value', 'Value')"
          @update:model-value="updateConditionValue(condition.id, $event)"
          @input="onNativeInput(condition.id, $event)"
        />
      </div>  
    </div>    
  </section>
</template>
