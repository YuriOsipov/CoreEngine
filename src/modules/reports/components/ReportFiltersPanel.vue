<script lang="ts">
export default {
  name: 'ReportFiltersPanel',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
} from '@/modules/entities/services/collectionSchema'
import ReportFieldSelector from './ReportFieldSelector.vue'
import {
  listReportFieldTreeNodes,
  resolveReportFieldLeafContext,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportFieldTreeNode,
  type ReportFilterCondition,
} from '../services/reportSettings'

const { t } = useTranslation()
const report = defineModel<ReportDefinition>({ required: true })

const fields = ref<ReportFieldOption[]>([])
const loadingFields = ref(false)
const error = ref<string | null>(null)
const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
const autoCompleteSelections = reactive<Record<string, SelectOption | null>>({})
const autoCompleteTemplates = reactive<Record<string, string | undefined>>({})

interface SelectOption {
  label: string
  value: string | number
}

const logicOptions = [
  { label: t('reports.allConditions', 'All conditions (AND)'), value: 'and' },
  { label: t('reports.anyCondition', 'Any condition (OR)'), value: 'or' },
]

const baseConditionOptions = [
  { label: t('reports.equals', 'Equals'), value: '_eq' },
  { label: t('reports.notEquals', 'Not equals'), value: '_neq' },
  { label: t('reports.contains', 'Contains'), value: '_contains' },
  { label: t('reports.greaterThan', 'Greater than'), value: '_gt' },
  { label: t('reports.greaterOrEqual', 'Greater or equal'), value: '_gte' },
  { label: t('reports.lessThan', 'Less than'), value: '_lt' },
  { label: t('reports.lessOrEqual', 'Less or equal'), value: '_lte' },
  { label: t('reports.isEmpty', 'Is empty'), value: '_null' },
  { label: t('reports.isNotEmpty', 'Is not empty'), value: '_nnull' },
]

const dateToDateOption = computed(() => ({
  label: t('reports.dateToDate', 'Date to date'),
  value: '_between',
}))

watch(
  () => report.value.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
)

watch(
  () => report.value.conditions.map((item) => `${item.id}:${item.field}:${item.operator}`).join('|'),
  () => {
    void syncConditionEditors(report.value.conditions)
  },
)

onMounted(() => {
  void loadFields(report.value.collection)
})

async function loadFields(collection: string): Promise<void> {
  if (!collection) {
    fields.value = []
    return
  }
  loadingFields.value = true
  error.value = null
  try {
    const nodes = await listReportFieldTreeNodes(collection)
    fields.value = []
    registerTreeFields(nodes)
    await syncConditionEditors(report.value.conditions)
  } catch (err) {
    fields.value = []
    error.value =
      err instanceof Error
        ? err.message
        : t('reports.failedLoadFields', 'Failed to load report fields.')
  } finally {
    loadingFields.value = false
  }
}

function mergeLoadedFields(loadedFields: ReportFieldOption[]): void {
  const byField = new Map(fields.value.map((field) => [field.field, field]))
  for (const field of loadedFields) {
    byField.set(field.field, field)
  }
  fields.value = Array.from(byField.values()).sort((a, b) => a.label.localeCompare(b.label))
  void syncConditionEditors(report.value.conditions)
}

function registerTreeFields(nodes: ReportFieldTreeNode[]): void {
  mergeLoadedFields(nodes.map((node) => node.data))
}

function updateReport(patch: Partial<ReportDefinition>): void {
  report.value = { ...report.value, ...patch }
}

function addCondition(): void {
  const field = fields.value[0]
  if (!field) return
  updateReport({
    conditions: [
      ...report.value.conditions,
      {
        id: `rpt_condition_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        field: field.field,
        operator: '_eq',
        value: defaultValueForField(field),
      },
    ],
  })
}

function updateCondition(
  condition: ReportFilterCondition,
  patch: Partial<ReportFilterCondition>,
): void {
  updateReport({
    conditions: report.value.conditions.map((item) =>
      item.id === condition.id ? { ...item, ...patch } : item,
    ),
  })
}

function updateConditionField(
  condition: ReportFilterCondition,
  value: string | string[],
): void {
  const fieldPath = Array.isArray(value) ? value[0] ?? '' : value
  const field = fields.value.find((item) => item.field === fieldPath) ?? null
  const nextOperator =
    condition.operator === '_between' && !isDateField(field) ? '_eq' : condition.operator
  updateCondition(condition, {
    field: fieldPath,
    operator: nextOperator,
    value: defaultValueForField(field, nextOperator),
  })
}

function updateConditionOperator(
  condition: ReportFilterCondition,
  operator: string,
): void {
  const field = conditionField(condition)
  let nextValue = condition.value
  if (operator === '_null' || operator === '_nnull') {
    nextValue = ''
  } else if (operator === '_between') {
    nextValue = Array.isArray(condition.value) ? condition.value : [null, null]
  } else if (condition.operator === '_between') {
    nextValue = defaultValueForField(field, operator)
  }
  updateCondition(condition, { operator, value: nextValue })
}

function removeCondition(condition: ReportFilterCondition): void {
  updateReport({
    conditions: report.value.conditions.filter((item) => item.id !== condition.id),
  })
  delete autoCompleteSelections[condition.id]
}

function isNoValueOperator(condition: ReportFilterCondition): boolean {
  return condition.operator === '_null' || condition.operator === '_nnull'
}

function conditionField(condition: ReportFilterCondition): ReportFieldOption | null {
  return fields.value.find((field) => field.field === condition.field) ?? null
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

function isBetweenOperator(condition: ReportFilterCondition): boolean {
  return condition.operator === '_between'
}

function conditionOptionsFor(condition: ReportFilterCondition) {
  if (isDateField(conditionField(condition))) {
    return [...baseConditionOptions, dateToDateOption.value]
  }
  return baseConditionOptions
}

function defaultValueForField(
  field: ReportFieldOption | null,
  operator = '_eq',
): unknown {
  if (operator === '_between') return [null, null]
  if (!field) return ''
  if (field.component === 'AutoComplete' || field.relatedCollection) return null
  if (field.component === 'Select' || field.component === 'Dropdown') return null
  if (field.component === 'DatePicker' || field.component === 'Calendar') return null
  if (field.component === 'InputNumber') return null
  if (field.component === 'Checkbox' || field.component === 'ToggleSwitch') return false
  return ''
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

function conditionDateValue(condition: ReportFilterCondition): Date | null {
  return toDate(condition.value)
}

function updateConditionDate(
  condition: ReportFilterCondition,
  value: Date | Date[] | null | undefined,
): void {
  if (Array.isArray(value)) {
    updateCondition(condition, { value: [value[0] ?? null, value[1] ?? null] })
    return
  }
  updateCondition(condition, { value: value ?? null })
}

function conditionBetweenValue(condition: ReportFilterCondition): Date[] | null {
  if (!Array.isArray(condition.value)) return null
  const from = toDate(condition.value[0])
  const to = toDate(condition.value[1])
  if (!from && !to) return null
  if (from && to) return [from, to]
  if (from) return [from]
  return to ? [to] : null
}

function updateConditionAutoComplete(
  condition: ReportFilterCondition,
  value: SelectOption | null,
): void {
  autoCompleteSelections[condition.id] = value
  updateCondition(condition, { value: value?.value ?? null })
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
  if (!field || !report.value.collection) return
  if (runtimeFieldProps[condition.field]) return

  try {
    const leaf = await resolveReportFieldLeafContext(
      report.value.collection,
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
  } catch {
    runtimeFieldProps[condition.field] = {}
  }
}

async function syncAutoCompleteSelection(
  condition: ReportFilterCondition,
): Promise<void> {
  const field = conditionField(condition)
  const related = field?.relatedCollection
  const value = condition.value
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
</script>

<template>
  <section class="grid gap-3">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div class="flex items-center justify-between gap-2">
      <h3 class="m-0">{{ t('reports.filters', 'Filters') }}</h3>
      <Button
        icon="pi pi-plus"
        size="small"
        text
        :disabled="!report.collection || loadingFields"
        :aria-label="t('reports.addCondition', 'Add condition')"
        :title="t('reports.addCondition', 'Add condition')"
        @click="addCondition"
      />
    </div>

    <div v-if="loadingFields" class="page-loading min-h-[80px]">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('reports.loadingFields', 'Loading report fields...') }}</span>
    </div>

    <template v-else>
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
        {{ t('filter.logic', 'Logic') }}
        <Select
          :model-value="report.filterLogic"
          :options="logicOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="updateReport({ filterLogic: $event === 'or' ? 'or' : 'and' })"
        />
      </label>

      <p
        v-if="report.conditions.length === 0"
        class="text-muted-color text-[0.85rem] m-0"
      >
        {{ t('reports.noFilters', 'No filter conditions.') }}
      </p>

      <div class="grid gap-[0.6rem]">
        <div
          v-for="condition in report.conditions"
          :key="condition.id"
          class="grid gap-2 border border-surface-100 rounded-md p-2"
        >
          <div class="grid gap-2 grid-cols-[minmax(0,1fr)_8.5rem_auto] items-center">
            <ReportFieldSelector
              :model-value="condition.field"
              :collection="report.collection"
              :placeholder="t('reports.selectField', 'Select field')"
              @update:model-value="updateConditionField(condition, $event)"
              @fields-loaded="mergeLoadedFields"
            />
            <Select
              :model-value="condition.operator"
              :options="conditionOptionsFor(condition)"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="updateConditionOperator(condition, String($event))"
            />
            <Button
              icon="pi pi-trash"
              text
              severity="danger"
              :aria-label="t('common.remove', 'Remove')"
              @click="removeCondition(condition)"
            />
          </div>

          <InputText
            v-if="isNoValueOperator(condition)"
            model-value=""
            disabled
            class="w-full"
            :placeholder="t('reports.value', 'Value')"
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
            :model-value="condition.value"
            class="w-full"
            v-bind="selectPropsFor(condition)"
            :placeholder="t('reports.value', 'Value')"
            @update:model-value="updateCondition(condition, { value: $event })"
          />
          <DatePicker
            v-else-if="isDateCondition(condition)"
            :model-value="conditionDateValue(condition)"
            manual-input
            class="w-full"
            v-bind="datePickerPropsFor(condition)"
            :placeholder="t('reports.value', 'Value')"
            @update:model-value="updateConditionDate(condition, $event as Date | null)"
          />
          <InputText
            v-else
            :model-value="condition.value === null || condition.value === undefined ? '' : String(condition.value)"
            class="w-full"
            :placeholder="t('reports.value', 'Value')"
            @update:model-value="updateCondition(condition, { value: String($event) })"
          />
        </div>
      </div>
    </template>
  </section>
</template>
