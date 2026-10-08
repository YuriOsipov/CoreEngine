<script lang="ts">
export default {
  name: 'SetupRecordAutomationEditorDialog',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import type {
  EntityRecordAutomationActionDto,
  EntityRecordAutomationConditionDto,
  EntityRecordAutomationDto,
} from '@/core/graphql/recordAutomationsApi'
import {
  listFilterableFields,
  type FilterableField,
} from '@/modules/config/services/listFilterSettings'
import {
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
  searchRelatedCollectionOptions,
} from '@/modules/entities/services/collectionSchema'
import {
  filterConditionComponentProps,
  isAutoCompleteFilterComponent,
} from '@/core/listFilterUtils'
import { resolvePrimeVueComponent } from '@/core/primevue'
import type { PrimeVueComponentType } from '@/interfaces'

export type AutomationSetFieldRow = { field: string; value: string }

export type AutomationFieldOption = { label: string; value: string }

interface SelectOption {
  label: string
  value: string | number
}

interface ConditionFieldMeta {
  field: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
}

const props = defineProps<{
  visible: boolean
  rule: EntityRecordAutomationDto | null
  setFieldRows: AutomationSetFieldRow[]
  fieldOptions: AutomationFieldOption[]
  collection: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  apply: [
    payload: {
      rule: EntityRecordAutomationDto
      setFieldRows: AutomationSetFieldRow[]
    },
  ]
}>()

const { t } = useTranslation()

const draft = ref<EntityRecordAutomationDto | null>(null)
const draftSetRows = ref<AutomationSetFieldRow[]>([])
const fieldMetaByName = ref<Map<string, ConditionFieldMeta>>(new Map())
const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
const autoCompleteTemplates = reactive<Record<string, string | undefined>>({})
const autoCompleteSuggestions = reactive<Record<number, SelectOption[]>>({})
const autoCompleteSelections = reactive<Record<number, SelectOption | null>>({})

const operatorOptions = computed(() => [
  { label: t('setup.automations.opEq', 'Equals'), value: '_eq' },
  { label: t('setup.automations.opNeq', 'Not equals'), value: '_neq' },
  { label: t('setup.automations.opContains', 'Contains'), value: '_contains' },
  { label: t('setup.automations.opGt', 'Greater than'), value: '_gt' },
  { label: t('setup.automations.opGte', 'Greater or equal'), value: '_gte' },
  { label: t('setup.automations.opLt', 'Less than'), value: '_lt' },
  { label: t('setup.automations.opLte', 'Less or equal'), value: '_lte' },
  { label: t('setup.automations.opNull', 'Is empty'), value: '_null' },
  { label: t('setup.automations.opNnull', 'Is not empty'), value: '_nnull' },
])

const logicOptions = computed(() => [
  { label: t('setup.automations.logicAnd', 'Match all (AND)'), value: 'and' },
  { label: t('setup.automations.logicOr', 'Match any (OR)'), value: 'or' },
])

const triggerOptions = computed(() => [
  { label: t('setup.automations.triggerCreate', 'On create'), value: 'create' },
  { label: t('setup.automations.triggerUpdate', 'On update'), value: 'update' },
  { label: t('setup.automations.triggerDelete', 'On delete'), value: 'delete' },
])

const notifySeverityOptions = computed(() => [
  { label: t('setup.automations.notifyInfo', 'Info'), value: 'info' },
  { label: t('setup.automations.notifyWarn', 'Alarm'), value: 'warn' },
])

const valueSourceOptions = computed(() => [
  { label: t('setup.automations.valueSourceLiteral', 'Fixed value'), value: 'literal' },
  { label: t('setup.automations.valueSourceField', 'Other field'), value: 'field' },
])

const noValueOperators = new Set(['_null', '_nnull'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const dialogHeader = computed(() => {
  const name = draft.value?.name?.trim()
  if (name) {
    return t('setup.automations.configureRuleNamed', 'Configure: {name}', {
      name,
    })
  }
  return t('setup.automations.configureRule', 'Configure rule')
})

function cloneRule(rule: EntityRecordAutomationDto): EntityRecordAutomationDto {
  return {
    ...rule,
    sort:
      typeof rule.sort === 'number' && Number.isFinite(rule.sort)
        ? Math.trunc(rule.sort)
        : 10,
    triggers: [...(rule.triggers ?? [])],
    requireChanged: [...(rule.requireChanged ?? [])],
    conditions: (rule.conditions ?? []).map((condition) => ({
      ...condition,
      valueSource: condition.valueSource === 'field' ? 'field' : 'literal',
      compareField: condition.compareField ?? null,
    })),
    setFields: { ...(rule.setFields ?? {}) },
    actions: cloneActions(rule.actions),
  }
}

function cloneActions(
  actions: EntityRecordAutomationActionDto[] | undefined,
): EntityRecordAutomationActionDto[] {
  return (actions ?? []).map((action) =>
    action.type === 'break'
      ? { type: 'break' }
      : {
          type: 'notify',
          severity: action.severity === 'warn' ? 'warn' : 'info',
          message: action.message,
        },
  )
}

function cloneSetRows(rows: AutomationSetFieldRow[]): AutomationSetFieldRow[] {
  const next = rows.map((row) => ({ field: row.field, value: row.value }))
  return next.length ? next : [{ field: '', value: '' }]
}

function conditionValueText(condition: { value?: unknown }): string {
  if (condition.value === null || condition.value === undefined) return ''
  return String(condition.value)
}

function ensureConditionDefaults(condition: EntityRecordAutomationConditionDto): void {
  if (condition.valueSource !== 'field') {
    condition.valueSource = 'literal'
  }
}

function conditionFieldMeta(field: string): ConditionFieldMeta | undefined {
  return fieldMetaByName.value.get(field)
}

function conditionValueComponent(field: string) {
  const meta = conditionFieldMeta(field)
  if (!meta?.component) return null
  return resolvePrimeVueComponent(meta.component)
}

function conditionValueProps(field: string): Record<string, unknown> {
  const meta = conditionFieldMeta(field)
  if (!meta) return { fluid: true }
  return filterConditionComponentProps(meta, runtimeFieldProps)
}

function isAutoCompleteConditionField(field: string): boolean {
  const meta = conditionFieldMeta(field)
  return Boolean(meta && isAutoCompleteFilterComponent(meta.component))
}

function onConditionFieldChange(
  condition: EntityRecordAutomationConditionDto,
  field: string,
): void {
  condition.field = field
  condition.value = null
  condition.compareField = null
}

async function loadConditionFieldMetadata(): Promise<void> {
  const collection = props.collection
  const conditions = draft.value?.conditions ?? []
  if (!collection || !conditions.length) {
    fieldMetaByName.value = new Map()
    return
  }

  const needed = new Set(
    conditions
      .filter((condition) => condition.valueSource !== 'field')
      .map((condition) => condition.field)
      .filter(Boolean),
  )
  if (!needed.size) {
    fieldMetaByName.value = new Map()
    return
  }

  let fields: FilterableField[] = []
  try {
    fields = await listFilterableFields(collection)
  } catch {
    fieldMetaByName.value = new Map()
    return
  }

  const nextMeta = new Map<string, ConditionFieldMeta>()
  for (const field of fields) {
    if (!needed.has(field.field)) continue
    nextMeta.set(field.field, {
      field: field.field,
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
  await syncAutoCompleteSelections()
}

async function searchConditionRelatedOptions(
  index: number,
  condition: EntityRecordAutomationConditionDto,
  event: { query?: string },
): Promise<void> {
  const meta = conditionFieldMeta(condition.field)
  if (!meta?.relatedCollection) {
    autoCompleteSuggestions[index] = []
    return
  }
  autoCompleteSuggestions[index] = await searchRelatedCollectionOptions(
    meta.relatedCollection,
    event.query ?? '',
    autoCompleteTemplates[condition.field],
  )
}

function updateAutoCompleteConditionValue(
  index: number,
  condition: EntityRecordAutomationConditionDto,
  value: SelectOption | null,
): void {
  autoCompleteSelections[index] = value
  condition.value = value?.value ?? null
}

async function syncAutoCompleteSelections(): Promise<void> {
  const conditions = draft.value?.conditions ?? []
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index]
    if (
      !condition ||
      condition.valueSource === 'field' ||
      noValueOperators.has(condition.operator) ||
      !isAutoCompleteConditionField(condition.field)
    ) {
      autoCompleteSelections[index] = null
      continue
    }

    const meta = conditionFieldMeta(condition.field)
    const value = condition.value
    if (
      !meta?.relatedCollection ||
      (typeof value !== 'string' && typeof value !== 'number')
    ) {
      autoCompleteSelections[index] = null
      continue
    }

    autoCompleteSelections[index] = await fetchRelatedCollectionOptionById(
      meta.relatedCollection,
      value,
      autoCompleteTemplates[condition.field],
    )
  }
}

function addCondition(): void {
  if (!draft.value) return
  draft.value.conditions.push({
    field: props.fieldOptions[0]?.value ?? '',
    operator: '_nnull',
    value: null,
    valueSource: 'literal',
    compareField: null,
  })
}

function removeCondition(index: number): void {
  draft.value?.conditions.splice(index, 1)
  for (const key of Object.keys(autoCompleteSelections)) {
    delete autoCompleteSelections[Number(key)]
  }
  for (const key of Object.keys(autoCompleteSuggestions)) {
    delete autoCompleteSuggestions[Number(key)]
  }
  void syncAutoCompleteSelections()
}

function addSetFieldRow(): void {
  draftSetRows.value.push({ field: '', value: '' })
}

function removeSetFieldRow(index: number): void {
  draftSetRows.value.splice(index, 1)
  if (!draftSetRows.value.length) {
    draftSetRows.value = [{ field: '', value: '' }]
  }
}

function addNotifyAction(): void {
  if (!draft.value) return
  if (!draft.value.actions) draft.value.actions = []
  draft.value.actions.push({
    type: 'notify',
    severity: 'info',
    message: '',
  })
}

function addBreakAction(): void {
  if (!draft.value) return
  if (!draft.value.actions) draft.value.actions = []
  if (draft.value.actions.some((action) => action.type === 'break')) return
  draft.value.actions.push({ type: 'break' })
}

function removeAction(index: number): void {
  draft.value?.actions.splice(index, 1)
}

function close(): void {
  dialogVisible.value = false
}

function apply(): void {
  if (!draft.value) return
  emit('apply', {
    rule: cloneRule(draft.value),
    setFieldRows: cloneSetRows(draftSetRows.value),
  })
  close()
}

function hintTooltip(value: string) {
  return { value, class: 'setup-automation-hint-tooltip' }
}

watch(
  () => [props.visible, props.rule] as const,
  ([visible, rule]) => {
    if (!visible || !rule) {
      draft.value = null
      draftSetRows.value = []
      fieldMetaByName.value = new Map()
      return
    }
    draft.value = cloneRule(rule)
    draftSetRows.value = cloneSetRows(props.setFieldRows)
  },
  { immediate: true },
)

watch(
  () =>
    [
      props.visible,
      props.collection,
      draft.value?.conditions?.map(
        (condition) =>
          `${condition.field}:${condition.valueSource ?? 'literal'}:${condition.operator}`,
      ),
    ] as const,
  ([visible]) => {
    if (!visible || !draft.value) return
    void loadConditionFieldMetadata()
  },
  { immediate: true },
)
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogHeader"
    class="setup-automation-editor-dialog"
    :style="{ width: 'min(48rem, 96vw)' }"
    :dismissable-mask="true"
  >
    <div
      v-if="draft"
      class="setup-automation-editor"
    >
      <section class="setup-automation-panel">
        <div class="setup-automation-panel__grid">
          <label class="setup-automation-field">
            {{ t('setup.automations.ruleName', 'Rule name') }}
            <InputText
              v-model="draft.name"
              fluid
              :placeholder="t('setup.automations.ruleName', 'Rule name')"
            />
          </label>
          <label class="setup-automation-field">
            <span class="setup-automation-field__label">
              {{ t('setup.automations.sort', 'Sort') }}
              <button
                type="button"
                class="setup-automation-hint"
                :aria-label="t('common.hint', 'Hint')"
                v-tooltip.bottom="hintTooltip(t(
                  'setup.automations.sortHint',
                  'Lower number runs first. Same sort → by name.',
                ))"
              />
            </span>
            <InputNumber
              v-model="draft.sort"
              fluid
              :use-grouping="false"
              :min="0"
              :step="10"
              show-buttons
            />
          </label>
        </div>
        <label class="setup-automation-check">
          <ToggleSwitch v-model="draft.enabled" />
          <span>{{ t('setup.automations.enabled', 'Enabled') }}</span>
        </label>
      </section>

      <section class="setup-automation-panel">
        <h3 class="setup-automation-panel__title m-0">
          {{ t('setup.automations.triggers', 'Triggers') }}
        </h3>
        <div class="setup-automation-panel__grid">
          <label class="setup-automation-field">
            {{ t('setup.automations.triggers', 'Triggers') }}
            <MultiSelect
              v-model="draft.triggers"
              :options="triggerOptions"
              option-label="label"
              option-value="value"
              display="chip"
              fluid
              :placeholder="t('setup.automations.triggersPlaceholder', 'Select triggers')"
            />
          </label>
          <label class="setup-automation-field">
            {{ t('setup.automations.requireChanged', 'Require field changed') }}
            <MultiSelect
              v-model="draft.requireChanged"
              :options="fieldOptions"
              option-label="label"
              option-value="value"
              display="chip"
              filter
              fluid
              :placeholder="
                t(
                  'setup.automations.requireChangedPlaceholder',
                  'Optional — only run when these fields change',
                )
              "
            />
          </label>
        </div>
        <label class="setup-automation-field">
          {{ t('setup.automations.logic', 'Condition logic') }}
          <Select
            v-model="draft.logic"
            :options="logicOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </label>
      </section>

      <section class="setup-automation-panel">
        <div class="setup-automation-panel__heading">
          <h3 class="setup-automation-panel__title m-0">
            {{ t('setup.automations.conditions', 'Conditions') }}
          </h3>
          <button
            type="button"
            class="setup-automation-hint"
            :aria-label="t('common.hint', 'Hint')"
            v-tooltip.bottom="hintTooltip(t(
              'setup.automations.conditionsHint',
              'Optional. Empty list = always match (still respects triggers and require-changed). Compare to a fixed value or another field (e.g. fulfilled_qty ≥ quantity).',
            ))"
          />
          <Button
            :label="t('setup.automations.addCondition', 'Add condition')"
            icon="pi pi-plus"
            size="small"
            severity="secondary"
            text
            class="ml-auto"
            @click="addCondition"
          />
        </div>

        <div
          v-for="(condition, cIndex) in draft.conditions"
          :key="`${draft.id}-c-${cIndex}`"
          class="setup-automation-row"
        >
          <Select
            :model-value="condition.field"
            :options="fieldOptions"
            option-label="label"
            option-value="value"
            filter
            class="setup-automation-row__field"
            :placeholder="t('setup.automations.field', 'Field')"
            @update:model-value="onConditionFieldChange(condition, String($event ?? ''))"
          />
          <Select
            v-model="condition.operator"
            :options="operatorOptions"
            option-label="label"
            option-value="value"
            class="setup-automation-row__op"
          />
          <template v-if="!noValueOperators.has(condition.operator)">
            <Select
              :model-value="condition.valueSource === 'field' ? 'field' : 'literal'"
              :options="valueSourceOptions"
              option-label="label"
              option-value="value"
              class="setup-automation-row__source"
              @update:model-value="
                condition.valueSource = $event === 'field' ? 'field' : 'literal';
                ensureConditionDefaults(condition)
              "
            />
            <Select
              v-if="condition.valueSource === 'field'"
              v-model="condition.compareField"
              :options="fieldOptions"
              option-label="label"
              option-value="value"
              filter
              class="setup-automation-row__value"
              :placeholder="t('setup.automations.compareField', 'Compare to field')"
            />
            <component
              :is="conditionValueComponent(condition.field)"
              v-else-if="
                conditionValueComponent(condition.field) &&
                !isAutoCompleteConditionField(condition.field)
              "
              :model-value="condition.value"
              v-bind="conditionValueProps(condition.field)"
              class="setup-automation-row__value"
              @update:model-value="condition.value = $event"
            />
            <component
              :is="conditionValueComponent(condition.field)"
              v-else-if="conditionValueComponent(condition.field)"
              :model-value="autoCompleteSelections[cIndex]"
              :suggestions="autoCompleteSuggestions[cIndex] ?? []"
              v-bind="conditionValueProps(condition.field)"
              class="setup-automation-row__value"
              @update:model-value="
                updateAutoCompleteConditionValue(cIndex, condition, $event)
              "
              @complete="searchConditionRelatedOptions(cIndex, condition, $event)"
            />
            <InputText
              v-else
              :model-value="conditionValueText(condition)"
              class="setup-automation-row__value"
              :placeholder="t('setup.automations.value', 'Value')"
              @update:model-value="condition.value = $event"
            />
          </template>
          <span
            v-else
            class="setup-automation-row__value setup-automation-row__value--empty"
          />
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            rounded
            class="setup-automation-row__remove"
            :aria-label="t('common.remove', 'Remove')"
            @click="removeCondition(cIndex)"
          />
        </div>
      </section>

      <section class="setup-automation-panel">
        <div class="setup-automation-panel__heading">
          <h3 class="setup-automation-panel__title m-0">
            {{ t('setup.automations.setFields', 'Set fields') }}
          </h3>
          <Button
            :label="t('setup.automations.addSetField', 'Add field to set')"
            icon="pi pi-plus"
            size="small"
            severity="secondary"
            text
            class="ml-auto"
            @click="addSetFieldRow"
          />
        </div>
        <div
          v-for="(row, sIndex) in draftSetRows"
          :key="`${draft.id}-s-${sIndex}`"
          class="setup-automation-row"
        >
          <Select
            v-model="row.field"
            :options="fieldOptions"
            option-label="label"
            option-value="value"
            filter
            class="setup-automation-row__field"
            :placeholder="t('setup.automations.field', 'Field')"
          />
          <InputText
            v-model="row.value"
            class="setup-automation-row__value"
            :placeholder="
              t('setup.automations.setValuePlaceholder', 'Value, $NOW / $NULL, or {{DATE_ADD_DAYS(project.date_start, offset_days)}}')
            "
          />
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            rounded
            class="setup-automation-row__remove"
            :aria-label="t('common.remove', 'Remove')"
            @click="removeSetFieldRow(sIndex)"
          />
        </div>
      </section>

      <section class="setup-automation-panel">
        <div class="setup-automation-panel__heading">
          <h3 class="setup-automation-panel__title m-0">
            {{ t('setup.automations.actions', 'Actions') }}
          </h3>
          <button
            type="button"
            class="setup-automation-hint"
            :aria-label="t('common.hint', 'Hint')"
            v-tooltip.bottom="hintTooltip(t(
              'setup.automations.actionsHint',
              'Optional. Notify shows a toast to the current user. Break stops later rules.',
            ))"
          />
          <div class="ml-auto flex flex-wrap gap-1">
            <Button
              :label="t('setup.automations.addNotify', 'Add notification')"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              text
              @click="addNotifyAction"
            />
            <Button
              :label="t('setup.automations.addBreak', 'Add break')"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              text
              :disabled="draft.actions.some((action) => action.type === 'break')"
              @click="addBreakAction"
            />
          </div>
        </div>
        <div
          v-for="(action, aIndex) in draft.actions"
          :key="`${draft.id}-a-${aIndex}`"
          class="setup-automation-row"
        >
          <template v-if="action.type === 'notify'">
            <Tag
              :value="t('setup.automations.actionNotify', 'Notify')"
              severity="info"
            />
            <Select
              v-model="action.severity"
              :options="notifySeverityOptions"
              option-label="label"
              option-value="value"
              class="setup-automation-row__op"
            />
            <InputText
              v-model="action.message"
              class="setup-automation-row__value"
              :placeholder="
                t('setup.automations.notifyMessagePlaceholder', 'Toast message')
              "
            />
          </template>
          <template v-else>
            <Tag
              :value="t('setup.automations.actionBreak', 'Break')"
              severity="warn"
            />
            <span class="setup-automation-muted">
              {{
                t(
                  'setup.automations.breakHint',
                  'Stop processing later automation rules',
                )
              }}
            </span>
          </template>
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            rounded
            class="setup-automation-row__remove"
            :aria-label="t('common.remove', 'Remove')"
            @click="removeAction(aIndex)"
          />
        </div>
      </section>
    </div>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="close"
      />
      <Button
        :label="t('common.apply', 'Apply')"
        :disabled="!draft"
        @click="apply"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.setup-automation-editor {
  --auto-wash: #edf3f4;
  --auto-ink: #37352f;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-family: Inter, system-ui, sans-serif;
  color: var(--auto-ink);
}

.setup-automation-panel {
  width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 0.55rem;
  border-radius: 8px;
  background: var(--auto-wash);
  padding: 0.55rem 0.5rem 0.65rem;
}

.setup-automation-panel__heading {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.setup-automation-panel__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.setup-automation-panel__grid {
  display: grid;
  gap: 0.5rem 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.setup-automation-field {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.setup-automation-field__label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.setup-automation-check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.7);
  cursor: pointer;
}

.setup-automation-muted {
  flex: 1;
  min-width: 0;
  font-size: 0.75rem;
  color: rgba(55, 53, 47, 0.5);
}

.setup-automation-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.45rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.65);
}

.setup-automation-row__field {
  flex: 1.2;
  min-width: 0;
}

.setup-automation-row__op {
  flex: 0.85;
  min-width: 7.5rem;
}

.setup-automation-row__source {
  flex: 0.75;
  min-width: 7rem;
}

.setup-automation-row__value {
  flex: 1;
  min-width: 0;
}

.setup-automation-row__value--empty {
  flex: 1;
}

.setup-automation-row__remove {
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
}

.setup-automation-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.setup-automation-hint:focus-visible {
  outline: 2px solid rgba(55, 53, 47, 0.35);
  outline-offset: 2px;
}

.setup-automation-hint::before {
  content: 'i';
}

@media (max-width: 768px) {
  .setup-automation-panel__grid {
    grid-template-columns: 1fr;
  }

  .setup-automation-row {
    flex-wrap: wrap;
  }
}
</style>

<style>
.setup-automation-editor-dialog .p-dialog-header {
  padding: 0.55rem 0.75rem;
}

.setup-automation-editor-dialog .p-dialog-content {
  padding: 0.35rem 0.65rem 0.65rem !important;
}

.setup-automation-editor-dialog .p-dialog-footer {
  padding: 0.45rem 0.75rem 0.65rem;
}

.setup-automation-hint-tooltip,
.setup-automation-hint-tooltip .p-tooltip-text {
  max-width: 18rem;
  font-size: 0.75rem;
  line-height: 1.35;
}
</style>
