<script lang="ts">
export default {
  name: 'FilterPairEditor',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { FilterPair, FilterValueKind } from '@/core/relatedTransferFilterPairs'
import { isNoValueFilterOperator } from '@/core/relatedTransferFilterPairs'
import { useTranslation } from '@/core/translation'

type FieldOption = {
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    pairs: FilterPair[]
    sourceOptions: FieldOption[]
    filterOptions: FieldOption[]
    sourcePlaceholder: string
    filterPlaceholder: string
    addLabel: string
    sourceLoading?: boolean
    filterLoading?: boolean
    /** When true, show operator + value-kind (parent / source / literal). */
    rich?: boolean
    sourceTokenOptions?: FieldOption[]
    sourceTokenPlaceholder?: string
  }>(),
  {
    rich: false,
    sourceTokenOptions: () => [],
  },
)

const emit = defineEmits<{
  add: []
  'update-pair': [index: number, patch: Partial<FilterPair>]
  remove: [index: number]
}>()

const { t } = useTranslation()

const operatorOptions = computed(() => [
  { label: t('filter.equals', 'Equals'), value: '_eq' },
  { label: t('filter.notEquals', 'Not equals'), value: '_neq' },
  { label: t('filter.contains', 'Contains'), value: '_contains' },
  { label: t('filter.greaterThan', 'Greater than'), value: '_gt' },
  { label: t('filter.greaterOrEqual', 'Greater or equal'), value: '_gte' },
  { label: t('filter.lessThan', 'Less than'), value: '_lt' },
  { label: t('filter.lessOrEqual', 'Less or equal'), value: '_lte' },
  { label: t('filter.isEmpty', 'Is empty'), value: '_null' },
  { label: t('filter.isNotEmpty', 'Is not empty'), value: '_nnull' },
])

const valueKindOptions = computed(() => [
  { label: t('formBuilder.filterValueParent', 'Parent field'), value: 'parent' as FilterValueKind },
  { label: t('formBuilder.filterValueSource', 'Current / source field'), value: 'source' as FilterValueKind },
  { label: t('formBuilder.filterValueLiteral', 'Fixed value'), value: 'literal' as FilterValueKind },
])

function pairOperator(pair: FilterPair): string {
  return pair.operator || '_eq'
}

function pairValueKind(pair: FilterPair): FilterValueKind {
  return pair.valueKind || 'parent'
}

function needsValue(pair: FilterPair): boolean {
  return !isNoValueFilterOperator(pairOperator(pair))
}

function tokenOptionsFor(pair: FilterPair): FieldOption[] {
  return pairValueKind(pair) === 'source' && props.sourceTokenOptions.length > 0
    ? props.sourceTokenOptions
    : props.filterOptions
}

function tokenPlaceholderFor(pair: FilterPair): string {
  if (pairValueKind(pair) === 'source') {
    return props.sourceTokenPlaceholder
      || t('formBuilder.childLookupSourceTokenField', 'Current / source field')
  }
  return props.filterPlaceholder
}

function onOperatorChange(index: number, operator: string): void {
  const patch: Partial<FilterPair> = { operator }
  if (isNoValueFilterOperator(operator)) {
    patch.filterField = ''
    patch.literalValue = ''
  }
  emit('update-pair', index, patch)
}

function onValueKindChange(index: number, valueKind: FilterValueKind): void {
  emit('update-pair', index, {
    valueKind,
    filterField: '',
    literalValue: valueKind === 'literal' ? '' : undefined,
  })
}
</script>

<template>
  <div class="grid gap-2">
    <div
      v-for="(pair, pairIndex) in pairs"
      :key="pairIndex"
      class="grid gap-2 items-start"
      :class="rich
        ? 'grid-cols-1 sm:grid-cols-[minmax(120px,1.1fr)_minmax(110px,0.9fr)_minmax(110px,0.9fr)_minmax(120px,1.2fr)_auto]'
        : 'grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_auto]'"
    >
      <Select
        :model-value="pair.sourceField"
        :options="sourceOptions"
        option-label="label"
        option-value="value"
        :placeholder="sourcePlaceholder"
        :loading="sourceLoading"
        filter
        fluid
        @update:model-value="emit('update-pair', pairIndex, { sourceField: String($event ?? '') })"
      />

      <template v-if="rich">
        <Select
          :model-value="pairOperator(pair)"
          :options="operatorOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="onOperatorChange(pairIndex, String($event ?? '_eq'))"
        />
        <Select
          v-if="needsValue(pair)"
          :model-value="pairValueKind(pair)"
          :options="valueKindOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="onValueKindChange(pairIndex, ($event as FilterValueKind) || 'parent')"
        />
        <div
          v-else
          class="hidden sm:block"
        />
        <InputText
          v-if="needsValue(pair) && pairValueKind(pair) === 'literal'"
          :model-value="pair.literalValue ?? ''"
          :placeholder="t('formBuilder.filterLiteralPlaceholder', 'Value')"
          fluid
          @update:model-value="emit('update-pair', pairIndex, { literalValue: String($event ?? '') })"
        />
        <Select
          v-else-if="needsValue(pair)"
          :model-value="pair.filterField"
          :options="tokenOptionsFor(pair)"
          option-label="label"
          option-value="value"
          :placeholder="tokenPlaceholderFor(pair)"
          :loading="filterLoading"
          filter
          fluid
          @update:model-value="emit('update-pair', pairIndex, { filterField: String($event ?? '') })"
        />
        <div
          v-else
          class="hidden sm:block"
        />
      </template>

      <Select
        v-else
        :model-value="pair.filterField"
        :options="filterOptions"
        option-label="label"
        option-value="value"
        :placeholder="filterPlaceholder"
        :loading="filterLoading"
        filter
        fluid
        @update:model-value="emit('update-pair', pairIndex, { filterField: String($event ?? '') })"
      />

      <Button
        icon="pi pi-trash"
        severity="danger"
        text
        rounded
        class="justify-self-end sm:justify-self-center"
        :aria-label="t('common.remove', 'Remove')"
        @click="emit('remove', pairIndex)"
      />
    </div>
    <Button
      :label="addLabel"
      icon="pi pi-plus"
      type="button"
      size="small"
      outlined
      class="justify-self-start"
      @click="emit('add')"
    />
  </div>
</template>
