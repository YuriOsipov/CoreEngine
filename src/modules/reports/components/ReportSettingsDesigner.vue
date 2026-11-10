<script lang="ts">
export default {
  name: 'ReportSettingsDesigner',
}
</script>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import ReportFieldSelector from './ReportFieldSelector.vue'
import { useTranslation } from '@/core/translation'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
import {
  listReportFieldTreeNodes,
  normalizePivotSort,
  normalizeReportName,
  type ReportAggregate,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportFieldTreeNode,
  type ReportFilterCondition,
  type ReportPivotDimension,
  type ReportPivotValue,
  type ReportSortDirection,
} from '../services/reportSettings'

const { t } = useTranslation()
const report = defineModel<ReportDefinition>({ required: true })

const collections = ref<Array<{ label: string; value: string }>>([])
const fields = ref<ReportFieldOption[]>([])
const loadingCollections = ref(false)
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
const aggregateOptions: Array<{ label: string; value: ReportAggregate }> = [
  { label: t('reports.count', 'Count'), value: 'count' },
  { label: t('reports.sum', 'Sum'), value: 'sum' },
  { label: t('reports.average', 'Average'), value: 'avg' },
  { label: t('reports.min', 'Min'), value: 'min' },
  { label: t('reports.max', 'Max'), value: 'max' },
]
const sortOptions: Array<{ label: string; value: ReportSortDirection }> = [
  { label: t('reports.sortAscShort', 'Asc'), value: 'asc' },
  { label: t('reports.sortDescShort', 'Desc'), value: 'desc' },
]

onMounted(() => {
  void loadCollections()
})

watch(
  () => report.value.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
)

async function loadCollections(): Promise<void> {
  loadingCollections.value = true
  error.value = null
  try {
    collections.value = await listUserCollections()
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('builder.loadCollectionsError', 'Failed to load collections.')
  } finally {
    loadingCollections.value = false
  }
}

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
  report.value = {
    ...report.value,
    ...patch,
  }
}

function updateTitle(value: string): void {
  updateReport({
    title: value,
    name: normalizeReportName(value),
  })
}

function updateCollection(collection: string): void {
  report.value = {
    ...report.value,
    collection,
    conditions: [],
    pivot: {
      rows: [{ field: 'id', sort: 'asc' }],
      columns: [],
      values: [{ field: 'id', aggregate: 'count' }],
    },
  }
}

function updatePivot(patch: Partial<ReportDefinition['pivot']>): void {
  report.value = {
    ...report.value,
    pivot: {
      ...report.value.pivot,
      ...patch,
    },
  }
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
    field: singleFieldValue(value),
    value: '',
  })
}

function replaceRowField(index: number, value: string | string[]): void {
  const field = singleFieldValue(value)
  if (!field) return
  updatePivot({
    rows: report.value.pivot.rows.map((item, itemIndex) =>
      itemIndex === index ? { ...item, field } : item,
    ),
  })
}

function updateRowSort(index: number, sort: unknown): void {
  updatePivot({
    rows: report.value.pivot.rows.map((item, itemIndex) =>
      itemIndex === index ? { ...item, sort: normalizePivotSort(sort) } : item,
    ),
  })
}

function addRowField(): void {
  const existing = new Set(report.value.pivot.rows.map((item) => item.field))
  const firstAvailable =
    fields.value.find((field) => !existing.has(field.field))?.field ??
    fields.value[0]?.field ??
    ''
  if (!firstAvailable) return
  updatePivot({
    rows: [...report.value.pivot.rows, { field: firstAvailable, sort: 'asc' }],
  })
}

function removeRowField(index: number): void {
  updatePivot({
    rows: report.value.pivot.rows.filter((_, itemIndex) => itemIndex !== index),
  })
}

function reorderRowFields(rows: ReportPivotDimension[]): void {
  updatePivot({ rows: [...rows] })
}

function replaceColumnField(index: number, value: string | string[]): void {
  const field = singleFieldValue(value)
  if (!field) return
  updatePivot({
    columns: report.value.pivot.columns.map((item, itemIndex) =>
      itemIndex === index ? { ...item, field } : item,
    ),
  })
}

function updateColumnSort(index: number, sort: unknown): void {
  updatePivot({
    columns: report.value.pivot.columns.map((item, itemIndex) =>
      itemIndex === index ? { ...item, sort: normalizePivotSort(sort) } : item,
    ),
  })
}

function addColumnField(): void {
  const existing = new Set(report.value.pivot.columns.map((item) => item.field))
  const firstAvailable =
    fields.value.find((field) => !existing.has(field.field))?.field ??
    fields.value[0]?.field ??
    ''
  if (!firstAvailable) return
  updatePivot({
    columns: [...report.value.pivot.columns, { field: firstAvailable, sort: 'asc' }],
  })
}

function removeColumnField(index: number): void {
  updatePivot({
    columns: report.value.pivot.columns.filter((_, itemIndex) => itemIndex !== index),
  })
}

function reorderColumnFields(columns: ReportPivotDimension[]): void {
  updatePivot({ columns: [...columns] })
}

function updatePivotValueField(
  value: ReportPivotValue,
  field: string | string[],
): void {
  updateValue(value, { field: singleFieldValue(field) || '*' })
}

function removeCondition(condition: ReportFilterCondition): void {
  updateReport({
    conditions: report.value.conditions.filter((item) => item.id !== condition.id),
  })
}

function addValue(): void {
  updatePivot({
    values: [
      ...report.value.pivot.values,
      { field: fields.value[0]?.field ?? '*', aggregate: 'count' },
    ],
  })
}

function updateValue(value: ReportPivotValue, patch: Partial<ReportPivotValue>): void {
  updatePivot({
    values: report.value.pivot.values.map((item) =>
      item === value ? { ...item, ...patch } : item,
    ),
  })
}

function updateValueAggregate(value: ReportPivotValue, aggregate: unknown): void {
  const nextAggregate = ['count', 'sum', 'avg', 'min', 'max'].includes(String(aggregate))
    ? aggregate as ReportAggregate
    : 'count'
  updateValue(value, { aggregate: nextAggregate })
}

function removeValue(value: ReportPivotValue): void {
  updatePivot({
    values: report.value.pivot.values.filter((item) => item !== value),
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
  return {
    label: String(value),
    value,
  }
}

function updateConditionAutoComplete(
  condition: ReportFilterCondition,
  value: SelectOption | null,
): void {
  updateCondition(condition, { value: value?.value ?? null })
}

function singleFieldValue(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value
}

</script>

<template>
  <section class="grid gap-4">
    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="collections-message"
    >
      {{ error }}
    </Message>

    <div class="grid gap-[0.85rem] grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
        {{ t('reports.reportTitle', 'Report title') }}
        <InputText
          :model-value="report.title"
          :placeholder="t('reports.reportTitlePlaceholder', 'Visits by Provider')"
          fluid
          @update:model-value="updateTitle(String($event))"
        />
      </label>

      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
        {{ t('reports.sourceCollection', 'Source collection') }}
        <Select
          :model-value="report.collection"
          :options="collections"
          option-label="label"
          option-value="value"
          :placeholder="t('common.selectCollection', 'Select collection')"
          fluid
          :loading="loadingCollections"
          @update:model-value="updateCollection(String($event))"
        />
      </label>

      <label class="text-surface-700 grid text-[0.85rem] font-semibold gap-[0.35rem]">
        {{ t('reports.limit', 'Limit') }}
        <InputNumber
          :model-value="report.limit ?? -1"
          fluid
          @update:model-value="updateReport({ limit: Number($event ?? -1) })"
        />
      </label>
    </div>

    <div v-if="loadingFields" class="page-loading min-h-[80px]">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('reports.loadingFields', 'Loading report fields...') }}</span>
    </div>

    <template v-else>
      <section class="border-t border-surface-200 grid gap-3 pt-4">
        <div class="flex items-center justify-between gap-2">
          <h3 class="m-0">{{ t('reports.filters', 'Filters') }}</h3>
          <Button
            icon="pi pi-plus"
            size="small"
            text
            :aria-label="t('reports.addCondition', 'Add condition')"
            :title="t('reports.addCondition', 'Add condition')"
            @click="addCondition"
          />
        </div>

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
      </section>

      <section class="border-t border-surface-200 grid gap-3 pt-4">
        <div class="flex items-center justify-between gap-4">
          <h3 class="m-0">{{ t('reports.pivot', 'Pivot') }}</h3>
        </div>

        <div class="flex items-center justify-between gap-2">
          <h4 class="m-0">{{ t('reports.rowFields', 'Row fields') }}</h4>
          <Button
            icon="pi pi-plus"
            size="small"
            text
            :aria-label="t('reports.addRowField', 'Add row field')"
            :title="t('reports.addRowField', 'Add row field')"
            @click="addRowField"
          />
        </div>

        <p
          v-if="report.pivot.rows.length === 0"
          class="text-muted-color text-[0.85rem] m-0"
        >
          {{ t('reports.noRowFieldsSelected', 'No row fields selected.') }}
        </p>
        <VueDraggableNext
          v-else
          :list="report.pivot.rows"
          tag="div"
          class="grid gap-[0.6rem]"
          handle=".rsd-drag-handle"
          ghost-class="opacity-[0.45]"
          chosen-class="bg-surface-50"
          @change="reorderRowFields(report.pivot.rows)"
        >
          <div
            v-for="(dimension, index) in report.pivot.rows"
            :key="`${dimension.field || 'empty'}_${index}`"
            class="grid items-center gap-2 grid-cols-[auto_minmax(0,1fr)_6rem_auto]"
          >
            <button
              type="button"
              class="rsd-drag-handle inline-flex items-center justify-center bg-transparent border-0 text-muted-color cursor-grab text-base p-1 active:cursor-grabbing"
              :aria-label="t('reports.reorderField', 'Drag to reorder')"
            >
              ⠿
            </button>
            <ReportFieldSelector
              :model-value="dimension.field"
              :collection="report.collection"
              :placeholder="t('reports.selectRowField', 'Select row field')"
              @update:model-value="replaceRowField(index, $event)"
              @fields-loaded="mergeLoadedFields"
            />
            <Select
              :model-value="dimension.sort ?? 'asc'"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              :placeholder="t('reports.sort', 'Sort')"
              :aria-label="t('reports.sort', 'Sort')"
              @update:model-value="updateRowSort(index, $event)"
            />
            <Button
              icon="pi pi-trash"
              text
              severity="danger"
              :aria-label="t('common.remove', 'Remove')"
              @click="removeRowField(index)"
            />
          </div>
        </VueDraggableNext>

        <div class="flex items-center justify-between gap-2">
          <h4 class="m-0">{{ t('reports.columnFields', 'Column fields') }}</h4>
          <Button
            icon="pi pi-plus"
            size="small"
            text
            :aria-label="t('reports.addColumnField', 'Add column field')"
            :title="t('reports.addColumnField', 'Add column field')"
            @click="addColumnField"
          />
        </div>

        <p
          v-if="report.pivot.columns.length === 0"
          class="text-muted-color text-[0.85rem] m-0"
        >
          {{ t('reports.noColumnFieldsSelected', 'No column fields selected.') }}
        </p>
        <VueDraggableNext
          v-else
          :list="report.pivot.columns"
          tag="div"
          class="grid gap-[0.6rem]"
          handle=".rsd-drag-handle"
          ghost-class="opacity-[0.45]"
          chosen-class="bg-surface-50"
          @change="reorderColumnFields(report.pivot.columns)"
        >
          <div
            v-for="(dimension, index) in report.pivot.columns"
            :key="`${dimension.field || 'empty'}_${index}`"
            class="grid items-center gap-2 grid-cols-[auto_minmax(0,1fr)_6rem_auto]"
          >
            <button
              type="button"
              class="rsd-drag-handle inline-flex items-center justify-center bg-transparent border-0 text-muted-color cursor-grab text-base p-1 active:cursor-grabbing"
              :aria-label="t('reports.reorderField', 'Drag to reorder')"
            >
              ⠿
            </button>
            <ReportFieldSelector
              :model-value="dimension.field"
              :collection="report.collection"
              :placeholder="t('reports.selectColumnField', 'Select column field')"
              @update:model-value="replaceColumnField(index, $event)"
              @fields-loaded="mergeLoadedFields"
            />
            <Select
              :model-value="dimension.sort ?? 'asc'"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              :placeholder="t('reports.sort', 'Sort')"
              :aria-label="t('reports.sort', 'Sort')"
              @update:model-value="updateColumnSort(index, $event)"
            />
            <Button
              icon="pi pi-trash"
              text
              severity="danger"
              :aria-label="t('common.remove', 'Remove')"
              @click="removeColumnField(index)"
            />
          </div>
        </VueDraggableNext>

        <div class="flex items-center justify-between gap-2">
          <h4 class="m-0">{{ t('reports.values', 'Values') }}</h4>
          <Button
            icon="pi pi-plus"
            size="small"
            text
            :aria-label="t('reports.addValue', 'Add value')"
            :title="t('reports.addValue', 'Add value')"
            @click="addValue"
          />
        </div>

        <div class="grid gap-[0.6rem]">
          <div
            v-for="value in report.pivot.values"
            :key="`${value.field}_${value.aggregate}`"
            class="grid items-center gap-2 grid-cols-[minmax(0,1fr)_6.5rem_auto]"
          >
            <ReportFieldSelector
              :model-value="value.field"
              :collection="report.collection"
              include-any
              :placeholder="t('reports.selectValueField', 'Select value field')"
              @update:model-value="updatePivotValueField(value, $event)"
              @fields-loaded="mergeLoadedFields"
            />
            <Select
              :model-value="value.aggregate"
              :options="aggregateOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="updateValueAggregate(value, $event)"
            />
            <Button
              icon="pi pi-trash"
              text
              severity="danger"
              :aria-label="t('common.remove', 'Remove')"
              @click="removeValue(value)"
            />
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

