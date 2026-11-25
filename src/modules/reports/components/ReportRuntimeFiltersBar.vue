<script lang="ts">
export default {
  name: 'ReportRuntimeFiltersBar',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import { toDate } from '@/core/dateFormatting'
import {
  filterConditionComponentProps,
  isSelectFilterComponent,
  resolveFilterValueComponent,
} from '@/core/listFilterUtils'
import { useTranslation } from '@/core/translation'
import {
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  findRelationForField,
  mapFieldTypeToComponent,
} from '@/modules/entities/utils/fieldMapper'
import type { RelationDefinition } from '@/interfaces'
import {
  listReportFieldTreeNodes,
  listRuntimeVisibleFilters,
  reportFieldDisplayLabel,
  resolveReportFieldLeafContext,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportFilterCondition,
} from '../services/reportSettings'
import { resolveReportFieldDefinition } from '../services/reportCellDisplay'

const props = defineProps<{
  report: ReportDefinition
}>()

const valuesByConditionId = defineModel<Record<string, unknown>>('values', {
  required: true,
})

const emit = defineEmits<{
  apply: []
}>()

const { t } = useTranslation()
const fields = ref<ReportFieldOption[]>([])
const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
const autoCompleteSelections = reactive<Record<string, SelectOption | null>>({})
const autoCompleteTemplates = reactive<Record<string, string | undefined>>({})

interface SelectOption {
  label: string
  value: string | number
}

const visibleConditions = computed(() => listRuntimeVisibleFilters(props.report))

const operatorLabels: Record<string, string> = {
  _eq: t('reports.equals', 'Equals'),
  _neq: t('reports.notEquals', 'Not equals'),
  _contains: t('reports.contains', 'Contains'),
  _gt: t('reports.greaterThan', 'Greater than'),
  _gte: t('reports.greaterOrEqual', 'Greater or equal'),
  _lt: t('reports.lessThan', 'Less than'),
  _lte: t('reports.lessOrEqual', 'Less or equal'),
  _null: t('reports.isEmpty', 'Is empty'),
  _nnull: t('reports.isNotEmpty', 'Is not empty'),
  _between: t('reports.dateToDate', 'Date to date'),
}

watch(
  () => props.report.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
)

watch(
  visibleConditions,
  (conditions) => {
    const next: Record<string, unknown> = { ...valuesByConditionId.value }
    for (const condition of conditions) {
      if (!(condition.id in next)) {
        next[condition.id] = condition.value
      }
    }
    for (const key of Object.keys(next)) {
      if (!conditions.some((condition) => condition.id === key)) {
        delete next[key]
      }
    }
    valuesByConditionId.value = next
    void syncConditionEditors(conditions)
  },
  { immediate: true, deep: true },
)

async function loadFields(collection: string): Promise<void> {
  if (!collection) {
    fields.value = []
    return
  }
  try {
    const nodes = await listReportFieldTreeNodes(collection)
    const byField = new Map(fields.value.map((field) => [field.field, field]))
    for (const node of nodes) {
      byField.set(node.data.field, node.data)
    }
    for (const condition of visibleConditions.value) {
      const resolved = await resolveConditionFieldOption(collection, condition.field)
      if (resolved) byField.set(resolved.field, resolved)
    }
    fields.value = Array.from(byField.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    )
    await syncConditionEditors(visibleConditions.value)
  } catch {
    fields.value = []
  }
}

async function resolveConditionFieldOption(
  collection: string,
  fieldPath: string,
): Promise<ReportFieldOption | null> {
  const existing = fields.value.find((field) => field.field === fieldPath)
  if (existing?.component && existing.component !== 'InputText') return existing

  const definition = await resolveReportFieldDefinition(collection, fieldPath)
  if (!definition) {
    return {
      field: fieldPath,
      label: fieldPath,
      type: 'string',
      component: 'InputText',
    }
  }

  const relations = (await getCachedRelations()) as RelationDefinition[]
  const relation = findRelationForField(definition, relations)
  const component = mapFieldTypeToComponent(definition, relation) || 'InputText'
  const option: ReportFieldOption = {
    field: fieldPath,
    label: definition.meta?.note?.trim() || fieldPath,
    type: definition.type,
    component: component as ReportFieldOption['component'],
  }
  if (component === 'AutoComplete' && relation?.related_collection) {
    option.relatedCollection = relation.related_collection
  }
  return option
}

function conditionField(condition: ReportFilterCondition): ReportFieldOption | null {
  return fields.value.find((field) => field.field === condition.field) ?? null
}

function fieldLabel(condition: ReportFilterCondition): string {
  const option = conditionField(condition)
  if (option?.nestedField) return reportFieldDisplayLabel(condition.field)
  if (option?.label && !option.label.includes('>')) return option.label
  return reportFieldDisplayLabel(condition.field)
}

function operatorLabel(condition: ReportFilterCondition): string {
  return operatorLabels[condition.operator] || condition.operator
}

function isNoValueOperator(condition: ReportFilterCondition): boolean {
  return condition.operator === '_null' || condition.operator === '_nnull'
}

function isBetweenOperator(condition: ReportFilterCondition): boolean {
  return condition.operator === '_between'
}

function isDateField(field: ReportFieldOption | null): boolean {
  if (!field) return false
  if (field.component === 'DatePicker' || field.component === 'Calendar') return true
  const type = field.type.toLowerCase()
  return type === 'date' || type === 'datetime' || type === 'timestamp' || type === 'time'
}

function isM2OCondition(condition: ReportFilterCondition): boolean {
  const field = conditionField(condition)
  return Boolean(field?.relatedCollection) || field?.component === 'AutoComplete'
}

function isSelectCondition(condition: ReportFilterCondition): boolean {
  const field = conditionField(condition)
  if (!field) return false
  const resolved = resolveFilterValueComponent(
    field.component,
    runtimeFieldProps[condition.field],
  )
  return isSelectFilterComponent(resolved)
}

function isDateCondition(condition: ReportFilterCondition): boolean {
  return isDateField(conditionField(condition))
}

function selectPropsFor(condition: ReportFilterCondition): Record<string, unknown> {
  return filterConditionComponentProps(
    {
      field: condition.field,
      component: conditionField(condition)?.component ?? 'Select',
    },
    runtimeFieldProps,
  )
}

function datePickerPropsFor(condition: ReportFilterCondition): Record<string, unknown> {
  const runtime = runtimeFieldProps[condition.field] ?? {}
  return {
    ...runtime,
    showIcon: true,
    fluid: true,
    dateFormat: (runtime.dateFormat as string | undefined) ?? 'yy-mm-dd',
  }
}

function conditionValue(condition: ReportFilterCondition): unknown {
  return valuesByConditionId.value[condition.id]
}

function setConditionValue(condition: ReportFilterCondition, value: unknown): void {
  valuesByConditionId.value = {
    ...valuesByConditionId.value,
    [condition.id]: value,
  }
}

function conditionDateValue(condition: ReportFilterCondition): Date | null {
  return toDate(conditionValue(condition))
}

function conditionBetweenValue(condition: ReportFilterCondition): Date[] | null {
  const value = conditionValue(condition)
  if (!Array.isArray(value)) return null
  const from = toDate(value[0])
  const to = toDate(value[1])
  if (!from && !to) return null
  if (from && to) return [from, to]
  if (from) return [from]
  return to ? [to] : null
}

function updateConditionDate(
  condition: ReportFilterCondition,
  value: Date | Date[] | null | undefined,
): void {
  if (Array.isArray(value)) {
    setConditionValue(condition, [value[0] ?? null, value[1] ?? null])
    return
  }
  setConditionValue(condition, value ?? null)
}

function updateConditionAutoComplete(
  condition: ReportFilterCondition,
  value: SelectOption | null,
): void {
  autoCompleteSelections[condition.id] = value
  setConditionValue(condition, value?.value ?? null)
}

async function syncConditionEditors(
  conditions: ReportFilterCondition[],
): Promise<void> {
  for (const condition of conditions) {
    await ensureRuntimeProps(condition)
    if (isM2OCondition(condition)) {
      await syncAutoCompleteSelection(condition)
    }
  }
}

async function ensureRuntimeProps(condition: ReportFilterCondition): Promise<void> {
  const field = conditionField(condition)
  if (!field || !props.report.collection) return
  if (runtimeFieldProps[condition.field]) return

  try {
    const leaf = await resolveReportFieldLeafContext(
      props.report.collection,
      condition.field,
    )
    if (!leaf) {
      runtimeFieldProps[condition.field] = {}
      return
    }
    const metadata = await fetchFieldRuntimeMetadata(
      leaf.collection,
      leaf.field,
      field.component,
    )
    runtimeFieldProps[condition.field] = metadata.props
    autoCompleteTemplates[condition.field] = metadata.template
    // Enrich field option with related collection when resolved as M2O.
    if (metadata.props && field.component === 'AutoComplete' && !field.relatedCollection) {
      // Keep existing relatedCollection from tree when available.
    }
  } catch {
    runtimeFieldProps[condition.field] = {}
  }
}

async function syncAutoCompleteSelection(
  condition: ReportFilterCondition,
): Promise<void> {
  const field = conditionField(condition)
  const related = field?.relatedCollection
  const value = conditionValue(condition)
  if (
    !related ||
    (typeof value !== 'string' && typeof value !== 'number')
  ) {
    autoCompleteSelections[condition.id] = null
    return
  }
  const option = await fetchRelatedCollectionOptionById(
    related,
    value,
    autoCompleteTemplates[condition.field],
  )
  autoCompleteSelections[condition.id] = option
}

function resetToDefaults(): void {
  const next: Record<string, unknown> = {}
  for (const condition of visibleConditions.value) {
    next[condition.id] = condition.value
  }
  valuesByConditionId.value = next
  void syncConditionEditors(visibleConditions.value)
}
</script>

<template>
  <section
    v-if="visibleConditions.length > 0"
    class="bg-canvas border border-line rounded-lg px-3 py-2 flex items-end gap-3 flex-wrap"
  >
    <h3 class="m-0 text-[0.95rem] leading-8 shrink-0">
      {{ t('reports.runtimeFilters', 'Filters') }}
    </h3>

    <div
      v-for="condition in visibleConditions"
      :key="condition.id"
      class="grid gap-1 content-start w-full max-w-[14rem]"
    >
      <label class="text-[0.8rem] font-semibold text-surface-700">
        {{ fieldLabel(condition) }}
        <span class="text-muted-color font-normal">· {{ operatorLabel(condition) }}</span>
      </label>

      <InputText
        v-if="isNoValueOperator(condition)"
        model-value=""
        disabled
        class="w-full"
        :placeholder="operatorLabel(condition)"
      />
      <DatePicker
        v-else-if="isBetweenOperator(condition)"
        :model-value="conditionBetweenValue(condition)"
        selection-mode="range"
        manual-input
        class="w-full"
        v-bind="datePickerPropsFor(condition)"
        :placeholder="t('reports.dateToDatePlaceholder', 'Select date range')"
        @update:model-value="updateConditionDate(condition, $event as Date[] | null)"
      />
      <CrmAutoComplete
        v-else-if="isM2OCondition(condition)"
        :model-value="autoCompleteSelections[condition.id] ?? null"
        :collection="conditionField(condition)?.relatedCollection"
        :template="autoCompleteTemplates[condition.field]"
        :allow-create="false"
        :placeholder="t('reports.selectRelatedRecord', 'Select related record')"
        @update:model-value="updateConditionAutoComplete(condition, $event)"
      />
      <Select
        v-else-if="isSelectCondition(condition)"
        :model-value="conditionValue(condition)"
        class="w-full"
        v-bind="selectPropsFor(condition)"
        :placeholder="t('reports.value', 'Value')"
        show-clear
        @update:model-value="setConditionValue(condition, $event)"
      />
      <DatePicker
        v-else-if="isDateCondition(condition)"
        :model-value="conditionDateValue(condition)"
        manual-input
        class="w-full"
        v-bind="datePickerPropsFor(condition)"
        :placeholder="t('reports.value', 'Value')"
        show-button-bar
        @update:model-value="updateConditionDate(condition, $event as Date | null)"
      />
      <InputText
        v-else
        :model-value="
          conditionValue(condition) === null || conditionValue(condition) === undefined
            ? ''
            : String(conditionValue(condition))
        "
        class="w-full"
        :placeholder="t('reports.value', 'Value')"
        @update:model-value="setConditionValue(condition, String($event))"
      />
    </div>

    <div class="flex items-center gap-2 ml-auto shrink-0">
      <Button
        :label="t('reports.resetFilters', 'Reset')"
        size="small"
        text
        severity="secondary"
        @click="resetToDefaults"
      />
      <Button
        :label="t('reports.applyFilters', 'Apply')"
        size="small"
        @click="emit('apply')"
      />
    </div>
  </section>
</template>
