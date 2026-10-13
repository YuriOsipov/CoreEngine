<script lang="ts">
export default {
  name: 'LayoutShowIfEditor',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  EntityRecordAutomationCondition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { nestedFieldOptions } from '@/core/fieldOptions'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'

const props = withDefaults(
  defineProps<{
    collection: string
    conditions: EntityRecordAutomationCondition[]
    logic: 'and' | 'or' | string
    /** Heading above the condition list. */
    title?: string
    /** Hint when there are no conditions. */
    emptyText?: string
  }>(),
  {
    title: '',
    emptyText: '',
  },
)

const emit = defineEmits<{
  'update:conditions': [value: EntityRecordAutomationCondition[]]
  'update:logic': [value: 'and' | 'or']
}>()

const { t } = useTranslation()

const titleLabel = computed(() =>
  props.title || t('formBuilder.showIf', 'Show when'),
)

const emptyLabel = computed(() =>
  props.emptyText ||
  t('formBuilder.showIfEmpty', 'No conditions — always visible.'),
)

const fieldOptions = ref<{ label: string; value: string }[]>([])
const fieldsLoading = ref(false)

const noValueOperators = new Set(['_null', '_nnull'])

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

const valueSourceOptions = computed(() => [
  { label: t('setup.automations.valueSourceLiteral', 'Fixed value'), value: 'literal' },
  { label: t('setup.automations.valueSourceField', 'Other field'), value: 'field' },
])

const logicModel = computed({
  get: () => (props.logic === 'or' ? 'or' : 'and'),
  set: (value: 'and' | 'or') => emit('update:logic', value),
})

async function loadFields(collection: string): Promise<void> {
  const slug = collection.trim()
  if (!slug) {
    fieldOptions.value = []
    return
  }
  fieldsLoading.value = true
  try {
    const [schemaFieldsRaw, relationsRaw] = await Promise.all([
      getCachedCollectionFields(slug),
      getCachedRelations(),
    ])
    const schemaFields = schemaFieldsRaw as unknown as FieldDefinition[]
    const relations = relationsRaw as unknown as RelationDefinition[]

    const relatedCollections = schemaFields
      .map(
        (field) =>
          relatedCollectionForCollectionField(relations, slug, field.field) ||
          field.schema?.foreign_key_table ||
          '',
      )
      .filter((related): related is string => Boolean(related))

    const nestedEntries = await Promise.all(
      Array.from(new Set(relatedCollections)).map(
        async (relatedCollection) =>
          [
            relatedCollection,
            (await getCachedCollectionFields(
              relatedCollection,
            )) as unknown as FieldDefinition[],
          ] as const,
      ),
    )
    const nestedFieldsByCollection = Object.fromEntries(nestedEntries)

    fieldOptions.value = nestedFieldOptions(
      schemaFields,
      nestedFieldsByCollection,
      (field) =>
        relatedCollectionForCollectionField(relations, slug, field.field) ||
        field.schema?.foreign_key_table ||
        '',
    )
  } catch {
    fieldOptions.value = []
  } finally {
    fieldsLoading.value = false
  }
}

watch(
  () => props.collection,
  (collection) => {
    void loadFields(collection)
  },
  { immediate: true },
)

function emitConditions(next: EntityRecordAutomationCondition[]): void {
  emit('update:conditions', next)
}

function addCondition(): void {
  emitConditions([
    ...props.conditions,
    {
      field: fieldOptions.value[0]?.value ?? '',
      operator: '_eq',
      value: '',
      valueSource: 'literal',
      compareField: null,
    },
  ])
}

function removeCondition(index: number): void {
  emitConditions(props.conditions.filter((_, i) => i !== index))
}

function patchCondition(
  index: number,
  patch: Partial<EntityRecordAutomationCondition>,
): void {
  emitConditions(
    props.conditions.map((condition, i) =>
      i === index ? { ...condition, ...patch } : condition,
    ),
  )
}

function onFieldChange(index: number, field: string): void {
  const condition = props.conditions[index]
  if (!condition) return
  patchCondition(index, {
    field,
    value: condition.valueSource === 'field' ? undefined : '',
    compareField: condition.valueSource === 'field' ? condition.compareField : null,
  })
}

function onOperatorChange(index: number, operator: string): void {
  const patch: Partial<EntityRecordAutomationCondition> = { operator }
  if (noValueOperators.has(operator)) {
    patch.value = undefined
    patch.compareField = null
  }
  patchCondition(index, patch)
}

function onValueSourceChange(index: number, source: string): void {
  const valueSource = source === 'field' ? 'field' : 'literal'
  patchCondition(index, {
    valueSource,
    value: valueSource === 'literal' ? '' : undefined,
    compareField: valueSource === 'field' ? (props.conditions[index]?.compareField ?? null) : null,
  })
}

function conditionValueText(condition: EntityRecordAutomationCondition): string {
  if (condition.value == null) return ''
  if (typeof condition.value === 'string') return condition.value
  if (typeof condition.value === 'number' || typeof condition.value === 'boolean') {
    return String(condition.value)
  }
  try {
    return JSON.stringify(condition.value)
  } catch {
    return String(condition.value)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2 min-w-0">
      <label class="text-[0.85rem] font-medium m-0">
        {{ titleLabel }}
      </label>
      <button
        type="button"
        class="show-if-hint"
        :aria-label="t('common.hint', 'Hint')"
        v-tooltip.bottom="{
          value: t(
            'formBuilder.showIfHint',
            'Optional. Empty list = always show this tab. Conditions are evaluated against the current record values. Related fields use paths like Item / Result type.',
          ),
          class: 'property-hint-tooltip',
        }"
      />
      <Button
        :label="t('formBuilder.addShowIfCondition', 'Add condition')"
        icon="pi pi-plus"
        size="small"
        severity="secondary"
        text
        class="ml-auto"
        :disabled="fieldsLoading"
        @click="addCondition"
      />
    </div>

    <div v-if="conditions.length > 0" class="flex flex-col gap-[0.35rem]">
      <label class="text-[0.85rem] font-medium">
        {{ t('formBuilder.showIfLogic', 'Condition logic') }}
      </label>
      <Select
        v-model="logicModel"
        :options="logicOptions"
        option-label="label"
        option-value="value"
        fluid
      />
    </div>

    <p
      v-if="conditions.length === 0"
      class="m-0 text-[0.8rem] text-muted-color"
    >
      {{ emptyLabel }}
    </p>

    <div
      v-for="(condition, index) in conditions"
      :key="`show-if-${index}-${condition.field}`"
      class="show-if-row"
    >
      <Select
        :model-value="condition.field"
        :options="fieldOptions"
        option-label="label"
        option-value="value"
        filter
        :placeholder="t('setup.automations.field', 'Field')"
        class="show-if-row__field"
        @update:model-value="onFieldChange(index, String($event ?? ''))"
      />
      <Select
        :model-value="condition.operator"
        :options="operatorOptions"
        option-label="label"
        option-value="value"
        class="show-if-row__op"
        @update:model-value="onOperatorChange(index, String($event ?? '_eq'))"
      />
      <template v-if="!noValueOperators.has(condition.operator)">
        <Select
          :model-value="condition.valueSource === 'field' ? 'field' : 'literal'"
          :options="valueSourceOptions"
          option-label="label"
          option-value="value"
          class="show-if-row__source"
          @update:model-value="onValueSourceChange(index, String($event ?? 'literal'))"
        />
        <Select
          v-if="condition.valueSource === 'field'"
          :model-value="condition.compareField"
          :options="fieldOptions"
          option-label="label"
          option-value="value"
          filter
          class="show-if-row__value"
          :placeholder="t('setup.automations.compareField', 'Compare to field')"
          @update:model-value="
            patchCondition(index, { compareField: String($event ?? '') || null })
          "
        />
        <InputText
          v-else
          :model-value="conditionValueText(condition)"
          class="show-if-row__value"
          :placeholder="t('setup.automations.value', 'Value')"
          @update:model-value="patchCondition(index, { value: $event })"
        />
      </template>
      <span v-else class="show-if-row__value show-if-row__value--empty" />
      <Button
        icon="pi pi-times"
        severity="secondary"
        text
        rounded
        class="show-if-row__remove"
        :aria-label="t('common.remove', 'Remove')"
        @click="removeCondition(index)"
      />
    </div>
  </div>
</template>

<style scoped>
.show-if-hint {
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

.show-if-hint::before {
  content: 'i';
}

.show-if-row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 0.85fr) minmax(0, 1.2fr) auto;
  gap: 0.35rem;
  align-items: center;
}

.show-if-row__field,
.show-if-row__op,
.show-if-row__source,
.show-if-row__value {
  min-width: 0;
  width: 100%;
}

.show-if-row__value--empty {
  min-height: 2.25rem;
}

.show-if-row__remove {
  flex-shrink: 0;
}

@media (max-width: 1100px) {
  .show-if-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .show-if-row__field,
  .show-if-row__op,
  .show-if-row__source,
  .show-if-row__value {
    grid-column: 1 / 2;
  }

  .show-if-row__remove {
    grid-column: 2 / 3;
    grid-row: 1 / 2;
  }
}
</style>
