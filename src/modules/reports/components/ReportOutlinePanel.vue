<script lang="ts">
export default {
  name: 'ReportOutlinePanel',
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import ReportFieldSelector from './ReportFieldSelector.vue'
import { useTranslation } from '@/core/translation'
import {
  listReportFieldTreeNodes,
  normalizePivotSort,
  normalizeSortRowsByTotal,
  type ReportAggregate,
  type ReportDateGrain,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportFieldTreeNode,
  type ReportPivotDimension,
  type ReportPivotValue,
  type ReportSortDirection,
} from '../services/reportSettings'
import {
  defaultDateGrainForField,
  isReportDateFieldType,
  normalizePivotDateGrain,
} from '../services/reportDateGrain'

const { t } = useTranslation()
const report = defineModel<ReportDefinition>({ required: true })

const fields = ref<ReportFieldOption[]>([])
const loadingFields = ref(false)
const error = ref<string | null>(null)

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
const totalSortOptions: Array<{ label: string; value: ReportSortDirection | 'off' }> = [
  { label: t('reports.sortTotalOff', 'Off'), value: 'off' },
  { label: t('reports.sortAscShort', 'Asc'), value: 'asc' },
  { label: t('reports.sortDescShort', 'Desc'), value: 'desc' },
]
const dateGrainOptions: Array<{ label: string; value: ReportDateGrain }> = [
  { label: t('reports.dateGrainDay', 'Day'), value: 'day' },
  { label: t('reports.dateGrainWeek', 'Week'), value: 'week' },
  { label: t('reports.dateGrainMonth', 'Month'), value: 'month' },
  { label: t('reports.dateGrainQuarter', 'Quarter'), value: 'quarter' },
  { label: t('reports.dateGrainYear', 'Year'), value: 'year' },
]

watch(
  () => report.value.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
)

watch(
  fields,
  () => {
    ensureDateGrains()
  },
)

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

function updatePivot(patch: Partial<ReportDefinition['pivot']>): void {
  report.value = {
    ...report.value,
    pivot: {
      ...report.value.pivot,
      ...patch,
    },
  }
}

function singleFieldValue(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value
}

function replaceRowField(index: number, value: string | string[]): void {
  const field = singleFieldValue(value)
  if (!field) return
  updatePivot({
    rows: report.value.pivot.rows.map((item, itemIndex) =>
      itemIndex === index
        ? { ...item, field, dateGrain: dateGrainForField(field) }
        : item,
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

function updateRowDateGrain(index: number, grain: unknown): void {
  updatePivot({
    rows: report.value.pivot.rows.map((item, itemIndex) =>
      itemIndex === index
        ? { ...item, dateGrain: normalizePivotDateGrain(grain) }
        : item,
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
    rows: [
      ...report.value.pivot.rows,
      { field: firstAvailable, sort: 'asc', dateGrain: dateGrainForField(firstAvailable) },
    ],
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
      itemIndex === index
        ? { ...item, field, dateGrain: dateGrainForField(field) }
        : item,
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

function updateColumnDateGrain(index: number, grain: unknown): void {
  updatePivot({
    columns: report.value.pivot.columns.map((item, itemIndex) =>
      itemIndex === index
        ? { ...item, dateGrain: normalizePivotDateGrain(grain) }
        : item,
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
    columns: [
      ...report.value.pivot.columns,
      { field: firstAvailable, sort: 'asc', dateGrain: dateGrainForField(firstAvailable) },
    ],
  })
}

function fieldOption(field: string): ReportFieldOption | undefined {
  return fields.value.find((item) => item.field === field)
}

function isDateDimension(field: string): boolean {
  const option = fieldOption(field)
  return isReportDateFieldType(option?.type, option?.component)
}

function showsDateGrain(dimension: ReportPivotDimension): boolean {
  return isDateDimension(dimension.field) || Boolean(normalizePivotDateGrain(dimension.dateGrain))
}

function dateGrainForField(field: string): ReportDateGrain | null {
  const option = fieldOption(field)
  return defaultDateGrainForField(option?.type, option?.component)
}

function dimensionDateGrain(dimension: ReportPivotDimension): ReportDateGrain {
  return normalizePivotDateGrain(dimension.dateGrain) ?? 'month'
}

/** Persist Month (etc.) on date dims that were saved before date functions existed. */
function ensureDateGrains(): void {
  if (fields.value.length === 0) return
  let changed = false
  const rows = report.value.pivot.rows.map((item) => {
    if (!isDateDimension(item.field) || normalizePivotDateGrain(item.dateGrain)) return item
    changed = true
    return { ...item, dateGrain: 'month' as ReportDateGrain }
  })
  const columns = report.value.pivot.columns.map((item) => {
    if (!isDateDimension(item.field) || normalizePivotDateGrain(item.dateGrain)) return item
    changed = true
    return { ...item, dateGrain: 'month' as ReportDateGrain }
  })
  if (!changed) return
  updatePivot({ rows, columns })
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

function updateSortRowsByTotal(value: unknown): void {
  updatePivot({
    sortRowsByTotal: value === 'off' || value === null || value === undefined
      ? null
      : normalizeSortRowsByTotal(value),
  })
}

function swapRowsAndColumns(): void {
  const rows = [...report.value.pivot.rows]
  const columns = [...report.value.pivot.columns]
  updatePivot({ rows: columns, columns: rows })
}
</script>

<template>
  <section class="grid gap-4">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div v-if="loadingFields" class="page-loading min-h-[80px]">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('reports.loadingFields', 'Loading report fields...') }}</span>
    </div>

    <template v-else>
      <section class="grid gap-3">
        <h3 class="m-0">{{ t('reports.pivot', 'Pivot') }}</h3>

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
        <p v-if="report.pivot.rows.length === 0" class="text-muted-color text-[0.85rem] m-0">
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
            class="grid items-center gap-2"
            :class="showsDateGrain(dimension)
              ? 'grid-cols-[auto_minmax(0,1fr)_7rem_5.5rem_auto]'
              : 'grid-cols-[auto_minmax(0,1fr)_5.5rem_auto]'"
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
              v-if="showsDateGrain(dimension)"
              :model-value="dimensionDateGrain(dimension)"
              :options="dateGrainOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              :aria-label="t('reports.dateFunction', 'Date function')"
              @update:model-value="updateRowDateGrain(index, $event)"
            />
            <Select
              :model-value="dimension.sort ?? 'asc'"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              class="w-full"
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

        <div class="flex justify-center">
          <Button
            icon="pi pi-arrow-right-arrow-left"
            size="small"
            text
            :label="t('reports.swapRowsColumns', 'Swap rows / columns')"
            :aria-label="t('reports.swapRowsColumns', 'Swap rows / columns')"
            :title="t('reports.swapRowsColumnsHint', 'Move row fields to columns and column fields to rows.')"
            @click="swapRowsAndColumns"
          />
        </div>

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
        <p v-if="report.pivot.columns.length === 0" class="text-muted-color text-[0.85rem] m-0">
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
            class="grid items-center gap-2"
            :class="showsDateGrain(dimension)
              ? 'grid-cols-[auto_minmax(0,1fr)_7rem_5.5rem_auto]'
              : 'grid-cols-[auto_minmax(0,1fr)_5.5rem_auto]'"
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
              v-if="showsDateGrain(dimension)"
              :model-value="dimensionDateGrain(dimension)"
              :options="dateGrainOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              :aria-label="t('reports.dateFunction', 'Date function')"
              @update:model-value="updateColumnDateGrain(index, $event)"
            />
            <Select
              :model-value="dimension.sort ?? 'asc'"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              class="w-full"
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

        <div class="grid items-center gap-2 grid-cols-[minmax(0,1fr)_6.5rem]">
          <label class="text-muted-color text-[0.85rem] m-0">
            {{ t('reports.sortRowsByTotal', 'Sort rows by total') }}
          </label>
          <Select
            :model-value="report.pivot.sortRowsByTotal ?? 'off'"
            :options="totalSortOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            :aria-label="t('reports.sortRowsByTotal', 'Sort rows by total')"
            @update:model-value="updateSortRowsByTotal"
          />
        </div>
      </section>
    </template>
  </section>
</template>
