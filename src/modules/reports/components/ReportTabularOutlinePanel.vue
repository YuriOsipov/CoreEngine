<script lang="ts">
export default {
  name: 'ReportTabularOutlinePanel',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import { isNumericFieldDefinition } from '@/core/fieldHelpers'
import { useTranslation } from '@/core/translation'
import ReportFieldSelector from './ReportFieldSelector.vue'
import { REPORT_FIELD_DND_GROUP } from '../services/reportFieldDnD'
import {
  isReportSummaryAggregate,
  listReportFieldTreeNodes,
  normalizePivotSort,
  normalizeSortRowsByTotal,
  reportColumnWidthKey,
  type ReportDateGrain,
  type ReportDefinition,
  type ReportFieldOption,
  type ReportFieldTreeNode,
  type ReportSortDirection,
  type ReportSummaryAggregate,
  type ReportTabularColumn,
  type ReportTabularGroup,
} from '../services/reportSettings'
import {
  defaultDateGrainForField,
  isReportDateFieldType,
  normalizePivotDateGrain,
} from '../services/reportDateGrain'
import { REPORT_DEFAULT_COL_WIDTH } from '../services/reportVTableAdapter'

const report = defineModel<ReportDefinition>({ required: true })

const { t } = useTranslation()
const fields = ref<ReportFieldOption[]>([])
const loadingFields = ref(false)
const error = ref<string | null>(null)
const summarizeIndex = ref<number | null>(null)
const summarizeDraft = ref<ReportSummaryAggregate[]>([])
const addGroupRowField = ref<string | null>(null)
const addGroupColumnField = ref<string | null>(null)
const addColumnFieldValue = ref<string | null>(null)

const summaryOptions: Array<{ label: string; value: ReportSummaryAggregate }> = [
  { label: t('reports.count', 'Count'), value: 'count' },
  { label: t('reports.sum', 'Sum'), value: 'sum' },
  { label: t('reports.average', 'Average'), value: 'avg' },
  { label: t('reports.max', 'Max'), value: 'max' },
  { label: t('reports.min', 'Min'), value: 'min' },
  { label: t('reports.median', 'Median'), value: 'median' },
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

const dropGroup = {
  name: REPORT_FIELD_DND_GROUP,
  pull: true,
  put: true,
}

const summarizeVisible = computed({
  get: () => summarizeIndex.value !== null,
  set: (value: boolean) => {
    if (!value) summarizeIndex.value = null
  },
})

watch(
  () => report.value.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
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
    error.value = err instanceof Error
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
}

function registerTreeFields(nodes: ReportFieldTreeNode[]): void {
  mergeLoadedFields(nodes.map((node) => node.data))
}

function updateTabular(patch: Partial<ReportDefinition['tabular']>): void {
  report.value = {
    ...report.value,
    tabular: {
      ...report.value.tabular,
      ...patch,
    },
  }
}

function singleFieldValue(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value
}

function fieldOption(field: string): ReportFieldOption | undefined {
  return fields.value.find((item) => item.field === field)
}

function fieldLabel(field: string): string {
  const option = fieldOption(field)
  if (option?.nestedField) {
    const leaf = field.split('.').filter(Boolean).pop() || field
    return leaf.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  if (option?.label && !option.label.includes('>')) return option.label
  const leaf = field.split('.').filter(Boolean).pop() || field
  return leaf.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function isNumericField(field: string): boolean {
  const option = fieldOption(field)
  return isNumericFieldDefinition({
    type: option?.type,
    component: option?.component,
  })
}

function extractFieldName(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  return String((item as { field?: unknown }).field ?? '').trim()
}

function toGroup(item: unknown): ReportTabularGroup | null {
  const field = extractFieldName(item)
  if (!field) return null
  const existing = item as ReportTabularGroup
  const sortRaw = existing.sort
  const dateGrain =
    normalizePivotDateGrain(existing.dateGrain) ?? dateGrainForField(field)
  return {
    field,
    sort: sortRaw === 'desc' ? 'desc' : 'asc',
    dateGrain,
  }
}

function isDateGroupField(field: string): boolean {
  const option = fieldOption(field)
  return isReportDateFieldType(option?.type, option?.component)
}

function showsDateGrain(group: ReportTabularGroup): boolean {
  return isDateGroupField(group.field) || Boolean(normalizePivotDateGrain(group.dateGrain))
}

function dateGrainForField(field: string): ReportDateGrain | null {
  const option = fieldOption(field)
  return defaultDateGrainForField(option?.type, option?.component)
}

function groupDateGrain(group: ReportTabularGroup): ReportDateGrain {
  return normalizePivotDateGrain(group.dateGrain) ?? 'month'
}

function updateGroupDateGrain(
  kind: 'groupRows' | 'groupColumns',
  index: number,
  grain: unknown,
): void {
  const next = [...report.value.tabular[kind]]
  const current = next[index]
  if (!current) return
  next[index] = {
    ...current,
    dateGrain: normalizePivotDateGrain(grain),
  }
  updateTabular({ [kind]: next })
}

function updateSortRowsByTotal(value: unknown): void {
  updateTabular({
    sortRowsByTotal:
      value === 'off' || value === null || value === undefined
        ? null
        : normalizeSortRowsByTotal(value),
  })
}

function toColumn(item: unknown): ReportTabularColumn | null {
  const field = extractFieldName(item)
  if (!field) return null
  const existing = item as ReportTabularColumn
  const sortRaw = existing.sort
  return {
    field,
    sort: sortRaw === 'asc' || sortRaw === 'desc' ? sortRaw : null,
    summaries: Array.isArray(existing.summaries)
      ? existing.summaries.filter(isReportSummaryAggregate)
      : [],
  }
}

function dedupeByField<T extends { field: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const next: T[] = []
  for (const item of items) {
    if (!item.field || seen.has(item.field)) continue
    seen.add(item.field)
    next.push(item)
  }
  return next
}

function removeFieldFromLists(
  field: string,
  keep: 'groupRows' | 'groupColumns' | 'columns',
): Pick<ReportDefinition['tabular'], 'groupRows' | 'groupColumns' | 'columns'> {
  return {
    groupRows:
      keep === 'groupRows'
        ? report.value.tabular.groupRows
        : report.value.tabular.groupRows.filter((item) => item.field !== field),
    groupColumns:
      keep === 'groupColumns'
        ? report.value.tabular.groupColumns
        : report.value.tabular.groupColumns.filter((item) => item.field !== field),
    columns:
      keep === 'columns'
        ? report.value.tabular.columns
        : report.value.tabular.columns.filter((item) => item.field !== field),
  }
}

function syncGroupRows(): void {
  const groups = dedupeByField(
    report.value.tabular.groupRows
      .map((item) => toGroup(item))
      .filter((item): item is ReportTabularGroup => Boolean(item)),
  )
  const used = new Set(groups.map((item) => item.field))
  updateTabular({
    groupRows: groups,
    groupColumns: report.value.tabular.groupColumns.filter((item) => !used.has(item.field)),
    columns: report.value.tabular.columns.filter((item) => !used.has(item.field)),
  })
}

function syncGroupColumns(): void {
  const groups = dedupeByField(
    report.value.tabular.groupColumns
      .map((item) => toGroup(item))
      .filter((item): item is ReportTabularGroup => Boolean(item)),
  )
  const used = new Set(groups.map((item) => item.field))
  updateTabular({
    groupColumns: groups,
    groupRows: report.value.tabular.groupRows.filter((item) => !used.has(item.field)),
    columns: report.value.tabular.columns.filter((item) => !used.has(item.field)),
  })
}

function syncColumns(): void {
  const columns = dedupeByField(
    report.value.tabular.columns
      .map((item) => toColumn(item))
      .filter((item): item is ReportTabularColumn => Boolean(item)),
  )
  const used = new Set(columns.map((item) => item.field))
  updateTabular({
    columns,
    groupRows: report.value.tabular.groupRows.filter((item) => !used.has(item.field)),
    groupColumns: report.value.tabular.groupColumns.filter((item) => !used.has(item.field)),
  })
}

const availableFieldOptions = computed(() => {
  const used = new Set([
    ...report.value.tabular.groupRows.map((item) => item.field),
    ...report.value.tabular.groupColumns.map((item) => item.field),
    ...report.value.tabular.columns.map((item) => item.field),
  ])
  return fields.value
    .filter((field) => !used.has(field.field))
    .map((field) => ({ label: field.label, value: field.field }))
})

function pickAvailableField(preferred?: string): string {
  const used = new Set([
    ...report.value.tabular.groupRows.map((item) => item.field),
    ...report.value.tabular.groupColumns.map((item) => item.field),
    ...report.value.tabular.columns.map((item) => item.field),
  ])
  if (preferred && !used.has(preferred)) return preferred
  return fields.value.find((item) => !used.has(item.field))?.field ?? ''
}

function seedDefaultColumnWidth(displayField: string): void {
  const key = reportColumnWidthKey('field', displayField)
  const existing = report.value.columnWidths ?? {}
  if (typeof existing[key] === 'number' && existing[key]! >= 40) return
  report.value = {
    ...report.value,
    columnWidths: {
      ...existing,
      [key]: REPORT_DEFAULT_COL_WIDTH,
    },
  }
}

function addGroupRow(field?: string | null): void {
  const nextField = pickAvailableField(field || undefined)
  if (!nextField) return
  updateTabular({
    ...removeFieldFromLists(nextField, 'groupRows'),
    groupRows: [
      ...report.value.tabular.groupRows.filter((item) => item.field !== nextField),
      { field: nextField, sort: 'asc' },
    ],
  })
  seedDefaultColumnWidth(`group:${nextField}`)
  addGroupRowField.value = null
}

function addGroupColumn(field?: string | null): void {
  const nextField = pickAvailableField(field || undefined)
  if (!nextField) return
  updateTabular({
    ...removeFieldFromLists(nextField, 'groupColumns'),
    groupColumns: [
      ...report.value.tabular.groupColumns.filter((item) => item.field !== nextField),
      { field: nextField, sort: 'asc' },
    ],
  })
  seedDefaultColumnWidth(nextField)
  addGroupColumnField.value = null
}

function addColumnField(field?: string | null): void {
  const nextField = pickAvailableField(field || undefined)
  if (!nextField) return
  updateTabular({
    ...removeFieldFromLists(nextField, 'columns'),
    columns: [
      ...report.value.tabular.columns.filter((item) => item.field !== nextField),
      { field: nextField, sort: null, summaries: [] },
    ],
  })
  seedDefaultColumnWidth(nextField)
  addColumnFieldValue.value = null
}

function addFieldFromPalette(field: string): void {
  addColumnField(field)
}

defineExpose({ addFieldFromPalette, mergeLoadedFields })

function replaceGroupField(
  kind: 'groupRows' | 'groupColumns',
  index: number,
  value: string | string[],
): void {
  const field = singleFieldValue(value)
  if (!field) return
  updateTabular({
    ...removeFieldFromLists(field, kind),
    [kind]: report.value.tabular[kind].map((item, itemIndex) =>
      itemIndex === index ? { ...item, field } : item,
    ),
  })
}

function updateGroupSort(
  kind: 'groupRows' | 'groupColumns',
  index: number,
  sort: unknown,
): void {
  updateTabular({
    [kind]: report.value.tabular[kind].map((item, itemIndex) =>
      itemIndex === index ? { ...item, sort: normalizePivotSort(sort) } : item,
    ),
  })
}

function groupSortDirection(group: ReportTabularGroup): ReportSortDirection {
  return normalizePivotSort(group.sort)
}

function groupSortIcon(group: ReportTabularGroup): string {
  return groupSortDirection(group) === 'desc'
    ? 'pi pi-sort-amount-down'
    : 'pi pi-sort-amount-up'
}

function groupSortLabel(group: ReportTabularGroup): string {
  return groupSortDirection(group) === 'desc'
    ? t('reports.sortDescShort', 'Desc')
    : t('reports.sortAscShort', 'Asc')
}

function toggleGroupSort(
  kind: 'groupRows' | 'groupColumns',
  index: number,
  group: ReportTabularGroup,
): void {
  updateGroupSort(
    kind,
    index,
    groupSortDirection(group) === 'desc' ? 'asc' : 'desc',
  )
}

function removeGroup(kind: 'groupRows' | 'groupColumns', index: number): void {
  updateTabular({
    [kind]: report.value.tabular[kind].filter((_, itemIndex) => itemIndex !== index),
  })
}

function replaceColumnField(index: number, value: string | string[]): void {
  const field = singleFieldValue(value)
  if (!field) return
  updateTabular({
    ...removeFieldFromLists(field, 'columns'),
    columns: report.value.tabular.columns.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            field,
            summaries: isNumericField(field) ? item.summaries : [],
          }
        : item,
    ),
  })
}

function columnSortIcon(column: ReportTabularColumn): string {
  if (column.sort === 'desc') return 'pi pi-sort-amount-down'
  if (column.sort === 'asc') return 'pi pi-sort-amount-up'
  return 'pi pi-sort-alt'
}

function columnSortLabel(column: ReportTabularColumn): string {
  if (column.sort === 'desc') return t('reports.sortDescShort', 'Desc')
  if (column.sort === 'asc') return t('reports.sortAscShort', 'Asc')
  return t('reports.sortOff', 'Sort off')
}

function toggleColumnSort(index: number, column: ReportTabularColumn): void {
  const next: ReportSortDirection | null =
    column.sort === 'asc' ? 'desc' : column.sort === 'desc' ? null : 'asc'
  updateTabular({
    columns: report.value.tabular.columns.map((item, itemIndex) =>
      itemIndex === index ? { ...item, sort: next } : item,
    ),
  })
}

function removeColumnField(index: number): void {
  updateTabular({
    columns: report.value.tabular.columns.filter((_, itemIndex) => itemIndex !== index),
  })
}

function swapRowsAndColumns(): void {
  const rows = [...report.value.tabular.groupRows]
  const columns = [...report.value.tabular.groupColumns]
  updateTabular({
    groupRows: columns,
    groupColumns: rows,
  })
}

function openSummarize(index: number): void {
  const column = report.value.tabular.columns[index]
  if (!column || !isNumericField(column.field)) return
  summarizeIndex.value = index
  summarizeDraft.value = [...(column.summaries ?? [])]
}

function toggleSummary(aggregate: ReportSummaryAggregate, checked: boolean): void {
  if (checked) {
    if (!summarizeDraft.value.includes(aggregate)) {
      summarizeDraft.value = [...summarizeDraft.value, aggregate]
    }
    return
  }
  summarizeDraft.value = summarizeDraft.value.filter((item) => item !== aggregate)
}

function applySummarize(): void {
  if (summarizeIndex.value === null) return
  const index = summarizeIndex.value
  const summaries = summarizeDraft.value.filter(isReportSummaryAggregate)
  updateTabular({
    columns: report.value.tabular.columns.map((item, itemIndex) =>
      itemIndex === index ? { ...item, summaries } : item,
    ),
    ...(summaries.length > 0 && report.value.tabular.groupRows.length > 0
      ? { showDetailRows: false }
      : {}),
  })
  summarizeIndex.value = null
}

function summaryBadge(column: ReportTabularColumn): string {
  const summaries = column.summaries ?? []
  if (summaries.length === 0) return ''
  return summaries.map((item) => item.toUpperCase()).join(', ')
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
        <div class="flex items-center justify-between gap-2">
          <h3 class="m-0">{{ t('reports.groups', 'Groups') }}</h3>
          <Button
            icon="pi pi-arrow-right-arrow-left"
            size="small"
            text
            :label="t('reports.swapRowsColumns', 'Swap Rows and Columns')"
            :aria-label="t('reports.swapRowsColumns', 'Swap Rows and Columns')"
            :title="t('reports.swapRowsColumns', 'Swap Rows and Columns')"
            @click="swapRowsAndColumns"
          />
        </div>

        <div class="grid gap-2">
          <h4 class="m-0 text-[0.85rem] uppercase text-muted-color tracking-wide">
            {{ t('reports.groupRows', 'Group Rows') }}
          </h4>
          <div class="relative min-h-[2.75rem] rounded-md border border-dashed border-line p-2 bg-panel">
            <p
              v-if="report.tabular.groupRows.length === 0"
              class="absolute inset-0 flex items-center px-3 text-muted-color text-[0.8rem] m-0 pointer-events-none"
            >
              {{ t('reports.dropGroupHint', 'Drop fields here') }}
            </p>
            <VueDraggableNext
              :list="report.tabular.groupRows"
              :group="dropGroup"
              tag="div"
              class="grid gap-[0.6rem] min-h-[2.25rem]"
              handle=".rsd-drag-handle"
              ghost-class="opacity-[0.45]"
              chosen-class="bg-canvas"
              @add="syncGroupRows"
              @update="syncGroupRows"
            >
              <div
                v-for="(group, index) in report.tabular.groupRows"
                :key="`row_${group.field}_${index}`"
                class="grid gap-1 text-[0.8rem]"
              >
                <div
                  class="grid items-center gap-1.5"
                  :class="showsDateGrain(group)
                    ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
                    : 'grid-cols-[auto_minmax(0,1fr)_auto_auto]'"
                >
                  <button
                    type="button"
                    class="rsd-drag-handle inline-flex items-center justify-center bg-transparent border-0 text-muted-color cursor-grab text-sm p-0.5"
                    :aria-label="t('reports.reorderField', 'Drag to reorder')"
                  >
                    ⠿
                  </button>
                  <div class="min-w-0">
                    <ReportFieldSelector
                      :model-value="group.field"
                      :collection="report.collection"
                      size="small"
                      :placeholder="t('reports.addGroup', 'Add group...')"
                      @update:model-value="replaceGroupField('groupRows', index, $event)"
                      @fields-loaded="mergeLoadedFields"
                    />
                  </div>
                  <Button
                    v-if="!showsDateGrain(group)"
                    :icon="groupSortIcon(group)"
                    text
                    rounded
                    size="small"
                    severity="secondary"
                    :aria-label="groupSortLabel(group)"
                    :title="groupSortLabel(group)"
                    @click="toggleGroupSort('groupRows', index, group)"
                  />
                  <Button
                    icon="pi pi-times"
                    text
                    rounded
                    size="small"
                    severity="danger"
                    :aria-label="t('common.remove', 'Remove')"
                    @click="removeGroup('groupRows', index)"
                  />
                </div>
                <div
                  v-if="showsDateGrain(group)"
                  class="grid items-center gap-1.5 pl-6 grid-cols-[minmax(7rem,1fr)_auto]"
                >
                  <Select
                    :model-value="groupDateGrain(group)"
                    :options="dateGrainOptions"
                    option-label="label"
                    option-value="value"
                    size="small"
                    class="w-full min-w-[7rem]"
                    :aria-label="t('reports.dateFunction', 'Date function')"
                    @update:model-value="updateGroupDateGrain('groupRows', index, $event)"
                  />
                  <Button
                    :icon="groupSortIcon(group)"
                    text
                    rounded
                    size="small"
                    severity="secondary"
                    :aria-label="groupSortLabel(group)"
                    :title="groupSortLabel(group)"
                    @click="toggleGroupSort('groupRows', index, group)"
                  />
                </div>
              </div>
            </VueDraggableNext>
          </div>
          <Select
            :model-value="addGroupRowField"
            :options="availableFieldOptions"
            option-label="label"
            option-value="value"
            size="small"
            filter
            show-clear
            fluid
            :placeholder="t('reports.addGroup', 'Add group...')"
            @update:model-value="addGroupRow($event == null ? null : String($event))"
          />
        </div>

        <div class="flex justify-center">
          <Button
            icon="pi pi-arrow-right-arrow-left"
            size="small"
            text
            rounded
            :aria-label="t('reports.swapRowsColumns', 'Swap Rows and Columns')"
            :title="t('reports.swapRowsColumns', 'Swap Rows and Columns')"
            @click="swapRowsAndColumns"
          />
        </div>

        <div class="grid gap-2">
          <h4 class="m-0 text-[0.85rem] uppercase text-muted-color tracking-wide">
            {{ t('reports.groupColumns', 'Group Columns') }}
          </h4>
          <div class="relative min-h-[2.75rem] rounded-md border border-dashed border-line p-2 bg-panel">
            <p
              v-if="report.tabular.groupColumns.length === 0"
              class="absolute inset-0 flex items-center px-3 text-muted-color text-[0.8rem] m-0 pointer-events-none"
            >
              {{ t('reports.dropGroupHint', 'Drop fields here') }}
            </p>
            <VueDraggableNext
              :list="report.tabular.groupColumns"
              :group="dropGroup"
              tag="div"
              class="grid gap-[0.6rem] min-h-[2.25rem]"
              handle=".rsd-drag-handle"
              ghost-class="opacity-[0.45]"
              chosen-class="bg-canvas"
              @add="syncGroupColumns"
              @update="syncGroupColumns"
            >
              <div
                v-for="(group, index) in report.tabular.groupColumns"
                :key="`col_${group.field}_${index}`"
                class="grid gap-1 text-[0.8rem]"
              >
                <div
                  class="grid items-center gap-1.5"
                  :class="showsDateGrain(group)
                    ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
                    : 'grid-cols-[auto_minmax(0,1fr)_auto_auto]'"
                >
                  <button
                    type="button"
                    class="rsd-drag-handle inline-flex items-center justify-center bg-transparent border-0 text-muted-color cursor-grab text-sm p-0.5"
                    :aria-label="t('reports.reorderField', 'Drag to reorder')"
                  >
                    ⠿
                  </button>
                  <div class="min-w-0">
                    <ReportFieldSelector
                      :model-value="group.field"
                      :collection="report.collection"
                      size="small"
                      :placeholder="t('reports.addGroup', 'Add group...')"
                      @update:model-value="replaceGroupField('groupColumns', index, $event)"
                      @fields-loaded="mergeLoadedFields"
                    />
                  </div>
                  <Button
                    v-if="!showsDateGrain(group)"
                    :icon="groupSortIcon(group)"
                    text
                    rounded
                    size="small"
                    severity="secondary"
                    :aria-label="groupSortLabel(group)"
                    :title="groupSortLabel(group)"
                    @click="toggleGroupSort('groupColumns', index, group)"
                  />
                  <Button
                    icon="pi pi-times"
                    text
                    rounded
                    size="small"
                    severity="danger"
                    :aria-label="t('common.remove', 'Remove')"
                    @click="removeGroup('groupColumns', index)"
                  />
                </div>
                <div
                  v-if="showsDateGrain(group)"
                  class="grid items-center gap-1.5 pl-6 grid-cols-[minmax(7rem,1fr)_auto]"
                >
                  <Select
                    :model-value="groupDateGrain(group)"
                    :options="dateGrainOptions"
                    option-label="label"
                    option-value="value"
                    size="small"
                    class="w-full min-w-[7rem]"
                    :aria-label="t('reports.dateFunction', 'Date function')"
                    @update:model-value="updateGroupDateGrain('groupColumns', index, $event)"
                  />
                  <Button
                    :icon="groupSortIcon(group)"
                    text
                    rounded
                    size="small"
                    severity="secondary"
                    :aria-label="groupSortLabel(group)"
                    :title="groupSortLabel(group)"
                    @click="toggleGroupSort('groupColumns', index, group)"
                  />
                </div>
              </div>
            </VueDraggableNext>
          </div>
          <Select
            :model-value="addGroupColumnField"
            :options="availableFieldOptions"
            option-label="label"
            option-value="value"
            size="small"
            filter
            show-clear
            fluid
            :placeholder="t('reports.addGroup', 'Add group...')"
            @update:model-value="addGroupColumn($event == null ? null : String($event))"
          />
        </div>
      </section>

      <section class="grid gap-3">
        <h3 class="m-0">{{ t('reports.columns', 'Columns') }}</h3>
        <div class="relative min-h-[2.75rem] rounded-md border border-dashed border-line p-2 bg-panel">
          <p
            v-if="report.tabular.columns.length === 0"
            class="absolute inset-0 flex items-center px-3 text-muted-color text-[0.8rem] m-0 pointer-events-none"
          >
            {{ t('reports.dropColumnHint', 'Drop fields here') }}
          </p>
          <VueDraggableNext
            :list="report.tabular.columns"
            :group="dropGroup"
            tag="div"
            class="grid gap-[0.6rem] min-h-[2.25rem]"
            handle=".rsd-drag-handle"
            ghost-class="opacity-[0.45]"
            chosen-class="bg-canvas"
            @add="syncColumns"
            @update="syncColumns"
          >
            <div
              v-for="(column, index) in report.tabular.columns"
              :key="`${column.field}_${index}`"
              class="grid gap-0.5 text-[0.8rem]"
            >
              <div class="grid items-center gap-1.5 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]">
                <button
                  type="button"
                  class="rsd-drag-handle inline-flex items-center justify-center bg-transparent border-0 text-muted-color cursor-grab text-sm p-0.5"
                  :aria-label="t('reports.reorderField', 'Drag to reorder')"
                >
                  ⠿
                </button>
                <div class="min-w-0 flex items-center gap-1.5 w-full">
                  <i
                    v-if="isNumericField(column.field)"
                    class="pi pi-hashtag text-[0.65rem] text-muted-color shrink-0"
                  />
                  <div class="min-w-0 flex-1">
                    <ReportFieldSelector
                      :model-value="column.field"
                      :collection="report.collection"
                      size="small"
                      :placeholder="t('reports.addColumn', 'Add column...')"
                      @update:model-value="replaceColumnField(index, $event)"
                      @fields-loaded="mergeLoadedFields"
                    />
                  </div>
                </div>
                <Button
                  :icon="columnSortIcon(column)"
                  text
                  rounded
                  size="small"
                  :severity="column.sort ? 'info' : 'secondary'"
                  :aria-label="columnSortLabel(column)"
                  :title="columnSortLabel(column)"
                  @click="toggleColumnSort(index, column)"
                />
                <Button
                  icon="pi pi-calculator"
                  text
                  rounded
                  size="small"
                  :class="isNumericField(column.field)
                    ? ''
                    : 'invisible pointer-events-none'"
                  :severity="summaryBadge(column) ? 'info' : 'secondary'"
                  :aria-label="t('reports.summarize', 'Summarize')"
                  :title="t('reports.summarize', 'Summarize')"
                  :tabindex="isNumericField(column.field) ? undefined : -1"
                  :aria-hidden="!isNumericField(column.field)"
                  @click="openSummarize(index)"
                />
                <Button
                  icon="pi pi-times"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  :aria-label="t('common.remove', 'Remove')"
                  :title="fieldLabel(column.field)"
                  @click="removeColumnField(index)"
                />
              </div>
              <small
                v-if="summaryBadge(column)"
                class="text-muted-color text-[0.75rem] pl-7"
              >
                {{ t('reports.summarize', 'Summarize') }}: {{ summaryBadge(column) }}
              </small>
            </div>
          </VueDraggableNext>
        </div>
        <Select
          :model-value="addColumnFieldValue"
          :options="availableFieldOptions"
          option-label="label"
          option-value="value"
          size="small"
          filter
          show-clear
          fluid
          :placeholder="t('reports.addColumn', 'Add column...')"
          @update:model-value="addColumnField($event == null ? null : String($event))"
        />
      </section>

      <section class="grid gap-2 border-t border-line pt-3">
        <div class="grid gap-1">
          <label class="text-[0.85rem] m-0">
            {{ t('reports.sortRowsByTotal', 'Sort rows by total') }}
          </label>
          <Select
            :model-value="report.tabular.sortRowsByTotal ?? 'off'"
            :options="totalSortOptions"
            option-label="label"
            option-value="value"
            size="small"
            class="w-full"
            :aria-label="t('reports.sortRowsByTotal', 'Sort rows by total')"
            @update:model-value="updateSortRowsByTotal($event)"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <label class="text-[0.85rem] m-0">{{ t('reports.detailRows', 'Detail Rows') }}</label>
          <ToggleSwitch
            :model-value="report.tabular.showDetailRows === true"
            @update:model-value="updateTabular({ showDetailRows: Boolean($event) })"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <label class="text-[0.85rem] m-0">{{ t('reports.subtotals', 'Subtotals') }}</label>
          <ToggleSwitch
            :model-value="report.tabular.showSubtotals !== false"
            @update:model-value="updateTabular({ showSubtotals: Boolean($event) })"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <label class="text-[0.85rem] m-0">{{ t('reports.grandTotal', 'Grand Total') }}</label>
          <ToggleSwitch
            :model-value="report.tabular.showGrandTotal !== false"
            @update:model-value="updateTabular({ showGrandTotal: Boolean($event) })"
          />
        </div>
      </section>
    </template>

    <Dialog
      v-model:visible="summarizeVisible"
      modal
      :header="t('reports.summarize', 'Summarize')"
      :style="{ width: 'min(320px, 94vw)' }"
    >
      <div class="grid gap-3">
        <label
          v-for="option in summaryOptions"
          :key="option.value"
          class="flex items-center gap-2 cursor-pointer"
        >
          <Checkbox
            :model-value="summarizeDraft.includes(option.value)"
            binary
            @update:model-value="toggleSummary(option.value, Boolean($event))"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          text
          severity="secondary"
          @click="summarizeVisible = false"
        />
        <Button
          :label="t('common.apply', 'Apply')"
          @click="applySummarize"
        />
      </template>
    </Dialog>
  </section>
</template>
