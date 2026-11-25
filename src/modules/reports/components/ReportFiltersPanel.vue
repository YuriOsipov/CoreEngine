<script lang="ts">
export default {
  name: 'ReportFiltersPanel',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
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
import { REPORT_FIELD_DND_GROUP } from '../services/reportFieldDnD'
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
/** Mix of conditions + palette field clones while dragging. */
const dndConditions = ref<Array<ReportFilterCondition | ReportFieldOption>>([])
const dropGroup = {
  name: REPORT_FIELD_DND_GROUP,
  pull: true,
  put: true,
}

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
    dndConditions.value = [...report.value.conditions]
    void syncConditionEditors(report.value.conditions)
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

function createConditionId(): string {
  return `rpt_condition_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function isFilterCondition(item: unknown): item is ReportFilterCondition {
  return Boolean(
    item &&
      typeof item === 'object' &&
      'id' in item &&
      'operator' in item &&
      'field' in item,
  )
}

function extractDroppedField(item: unknown): ReportFieldOption | null {
  if (!item || typeof item !== 'object') return null
  if (isFilterCondition(item)) return null
  const field = String((item as ReportFieldOption).field ?? '').trim()
  if (!field) return null
  const known = fields.value.find((entry) => entry.field === field)
  if (known) return known
  return item as ReportFieldOption
}

function createConditionFromField(field: ReportFieldOption): ReportFilterCondition {
  return {
    id: createConditionId(),
    field: field.field,
    operator: '_eq',
    value: defaultValueForField(field),
    visibleInRuntime: false,
  }
}

function addCondition(): void {
  const field = fields.value[0]
  if (!field) return
  updateReport({
    conditions: [...report.value.conditions, createConditionFromField(field)],
  })
}

function syncDroppedConditions(): void {
  const next: ReportFilterCondition[] = []
  const loaded: ReportFieldOption[] = []
  for (const item of dndConditions.value) {
    if (isFilterCondition(item)) {
      next.push(item)
      continue
    }
    const field = extractDroppedField(item)
    if (!field) continue
    loaded.push(field)
    next.push(createConditionFromField(field))
  }
  if (loaded.length > 0) mergeLoadedFields(loaded)
  updateReport({ conditions: next })
  dndConditions.value = [...next]
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
      <label class="text-surface-700 grid text-[0.8rem] font-semibold gap-[0.35rem]">
        {{ t('filter.logic', 'Logic') }}
        <Select
          :model-value="report.filterLogic"
          :options="logicOptions"
          option-label="label"
          option-value="value"
          size="small"
          fluid
          @update:model-value="updateReport({ filterLogic: $event === 'or' ? 'or' : 'and' })"
        />
      </label>

      <div class="relative min-h-[4.5rem] rounded-md border border-dashed border-line p-2 bg-panel">
        <p
          v-if="report.conditions.length === 0"
          class="absolute inset-0 flex items-center justify-center px-3 text-muted-color text-[0.8rem] m-0 pointer-events-none text-center"
        >
          {{ t('reports.dropFilterHint', 'Drop fields here to add filters.') }}
        </p>

        <VueDraggableNext
          :list="dndConditions"
          :group="dropGroup"
          tag="div"
          class="grid gap-[0.6rem] min-h-[3.5rem]"
          handle=".rsd-filter-drag-handle"
          ghost-class="opacity-[0.45]"
          chosen-class="bg-canvas"
          @add="syncDroppedConditions"
          @update="syncDroppedConditions"
        >
          <div
            v-for="(item, index) in dndConditions"
            :key="isFilterCondition(item) ? item.id : `drop_${index}_${item.field}`"
            class="grid gap-1.5 border border-line rounded-md p-2 bg-panel text-[0.8rem]"
          >
            <template v-if="isFilterCondition(item)">
              <div class="grid gap-1.5 grid-cols-[auto_minmax(0,1fr)_7.5rem_auto] items-center">
                <button
                  type="button"
                  class="rsd-filter-drag-handle inline-flex items-center justify-center bg-transparent border-0 text-muted-color cursor-grab text-sm p-0.5"
                  :aria-label="t('reports.reorderField', 'Drag to reorder')"
                >
                  ⠿
                </button>
                <ReportFieldSelector
                  :model-value="item.field"
                  :collection="report.collection"
                  size="small"
                  :placeholder="t('reports.selectField', 'Select field')"
                  @update:model-value="updateConditionField(item, $event)"
                  @fields-loaded="mergeLoadedFields"
                />
                <Select
                  :model-value="item.operator"
                  :options="conditionOptionsFor(item)"
                  option-label="label"
                  option-value="value"
                  size="small"
                  class="w-full"
                  @update:model-value="updateConditionOperator(item, String($event))"
                />
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  :aria-label="t('common.remove', 'Remove')"
                  @click="removeCondition(item)"
                />
              </div>

              <InputText
                v-if="isNoValueOperator(item)"
                model-value=""
                disabled
                size="small"
                class="w-full"
                :placeholder="t('reports.value', 'Value')"
              />
              <DatePicker
                v-else-if="isBetweenOperator(item)"
                :model-value="conditionBetweenValue(item)"
                selection-mode="range"
                manual-input
                size="small"
                class="w-full"
                v-bind="datePickerPropsFor(item)"
                :placeholder="t('reports.dateToDatePlaceholder', 'Select date range')"
                @update:model-value="updateConditionDate(item, $event as Date[] | null)"
              />
              <CrmAutoComplete
                v-else-if="isM2OCondition(item)"
                :model-value="autoCompleteSelections[item.id] ?? null"
                :collection="conditionField(item)?.relatedCollection"
                :template="autoCompleteTemplates[item.field]"
                :allow-create="false"
                :placeholder="t('reports.selectRelatedRecord', 'Select related record')"
                @update:model-value="updateConditionAutoComplete(item, $event)"
              />
              <Select
                v-else-if="isSelectCondition(item)"
                :model-value="item.value"
                size="small"
                class="w-full"
                v-bind="selectPropsFor(item)"
                :placeholder="t('reports.value', 'Value')"
                @update:model-value="updateCondition(item, { value: $event })"
              />
              <DatePicker
                v-else-if="isDateCondition(item)"
                :model-value="conditionDateValue(item)"
                manual-input
                size="small"
                class="w-full"
                v-bind="datePickerPropsFor(item)"
                :placeholder="t('reports.value', 'Value')"
                @update:model-value="updateConditionDate(item, $event as Date | null)"
              />
              <InputText
                v-else
                :model-value="item.value === null || item.value === undefined ? '' : String(item.value)"
                size="small"
                class="w-full"
                :placeholder="t('reports.value', 'Value')"
                @update:model-value="updateCondition(item, { value: String($event) })"
              />

              <label class="inline-flex items-center gap-2 text-[0.8rem] text-surface-700">
                <Checkbox
                  :model-value="Boolean(item.visibleInRuntime)"
                  binary
                  :input-id="`rpt-filter-runtime-${item.id}`"
                  @update:model-value="updateCondition(item, { visibleInRuntime: Boolean($event) })"
                />
                <span>{{ t('reports.visibleInRuntime', 'Visible in runtime') }}</span>
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-4 h-4 rounded-full border border-line text-[0.65rem] text-muted-color bg-transparent cursor-help"
                  v-tooltip.bottom="
                    t(
                      'reports.visibleInRuntimeHint',
                      'When enabled, end users can change this filter value when running the report without editing Setup.',
                    )
                  "
                  :aria-label="t('common.moreInfo', 'More information')"
                >
                  i
                </button>
              </label>
            </template>
            <p v-else class="text-muted-color text-[0.8rem] m-0 px-1">
              {{ item.label || item.field }}
            </p>
          </div>
        </VueDraggableNext>
      </div>
    </template>
  </section>
</template>
