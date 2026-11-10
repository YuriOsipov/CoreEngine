<script lang="ts">
export default {
  name: 'ReportFiltersPanel',
}
</script>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import ReportFieldSelector from './ReportFieldSelector.vue'
import { useTranslation } from '@/core/translation'
import {
  listReportFieldTreeNodes,
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

interface SelectOption {
  label: string
  value: string | number
}

const logicOptions = [
  { label: t('reports.allConditions', 'All conditions (AND)'), value: 'and' },
  { label: t('reports.anyCondition', 'Any condition (OR)'), value: 'or' },
]
const conditionOptions = [
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

watch(
  () => report.value.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
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
  } catch (err) {
    fields.value = []
    error.value = err instanceof Error ? err.message : t('reports.failedLoadFields', 'Failed to load report fields.')
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
        value: '',
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
  updateCondition(condition, {
    field: Array.isArray(value) ? value[0] ?? '' : value,
    value: '',
  })
}

function removeCondition(condition: ReportFilterCondition): void {
  updateReport({
    conditions: report.value.conditions.filter((item) => item.id !== condition.id),
  })
}

function isNoValueOperator(condition: ReportFilterCondition): boolean {
  return condition.operator === '_null' || condition.operator === '_nnull'
}

function conditionField(condition: ReportFilterCondition): ReportFieldOption | null {
  return fields.value.find((field) => field.field === condition.field) ?? null
}

function isM2OCondition(condition: ReportFilterCondition): boolean {
  return Boolean(conditionField(condition)?.relatedCollection)
}

function conditionAutoCompleteValue(
  condition: ReportFilterCondition,
): SelectOption | null {
  const value = condition.value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  return { label: String(value), value }
}

function updateConditionAutoComplete(
  condition: ReportFilterCondition,
  value: SelectOption | null,
): void {
  updateCondition(condition, { value: value?.value ?? null })
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
          <div class="grid gap-2 grid-cols-[minmax(0,1fr)_7.5rem_auto] items-center">
            <ReportFieldSelector
              :model-value="condition.field"
              :collection="report.collection"
              :placeholder="t('reports.selectField', 'Select field')"
              @update:model-value="updateConditionField(condition, $event)"
              @fields-loaded="mergeLoadedFields"
            />
            <Select
              :model-value="condition.operator"
              :options="conditionOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="updateCondition(condition, { operator: String($event) })"
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
          <CrmAutoComplete
            v-else-if="isM2OCondition(condition)"
            :model-value="conditionAutoCompleteValue(condition)"
            :collection="conditionField(condition)?.relatedCollection"
            :placeholder="t('reports.selectRelatedRecord', 'Select related record')"
            @update:model-value="updateConditionAutoComplete(condition, $event)"
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
