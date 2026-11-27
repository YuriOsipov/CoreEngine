<script lang="ts">
export default {
  name: 'FilterPairEditor',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  FilterPair,
  FilterValueKind,
} from '@/core/relatedTransferFilterPairs'
import { isNoValueFilterOperator } from '@/core/relatedTransferFilterPairs'
import {
  filterConditionComponentProps,
  isAutoCompleteFilterComponent,
  resolveFilterValueComponent,
} from '@/core/listFilterUtils'
import { resolvePrimeVueComponent } from '@/core/primevue'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { useTranslation } from '@/core/translation'
import {
  listFilterableFields,
  type FilterableField,
} from '@/modules/config/services/listFilterSettings'
import {
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
  getCachedRelations,
  searchRelatedCollectionOptions,
} from '@/modules/entities/services/collectionSchema'
import type { PrimeVueComponentType, RelationDefinition } from '@/interfaces'

type FieldOption = {
  label: string
  value: string
}

type SelectOption = {
  label: string
  value: string | number
}

type LiteralFieldMeta = {
  field: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
  hostCollection: string
  leafField: string
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
    /**
     * When true with {@link rich}, hide value-kind and always use a literal RHS
     * (e.g. rollup child filters: `status` equals `Draft`).
     */
    literalOnly?: boolean
    /**
     * Child/source collection for typed literal editors (picklist Select,
     * M2O AutoComplete). Supports dotted paths like `quote.status`.
     */
    literalValueCollection?: string | null
    sourceTokenOptions?: FieldOption[]
    sourceTokenPlaceholder?: string
  }>(),
  {
    rich: false,
    literalOnly: false,
    literalValueCollection: null,
    sourceTokenOptions: () => [],
  },
)

const emit = defineEmits<{
  add: []
  'update-pair': [index: number, patch: Partial<FilterPair>]
  remove: [index: number]
}>()

const { t } = useTranslation()

const relations = ref<RelationDefinition[]>([])
const filterableByCollection = ref<Record<string, FilterableField[]>>({})
const fieldMetaByPath = ref<Map<string, LiteralFieldMeta>>(new Map())
const runtimeFieldProps = reactive<Record<string, Record<string, unknown>>>({})
const autoCompleteTemplates = reactive<Record<string, string | undefined>>({})
const autoCompleteSuggestions = reactive<Record<number, SelectOption[]>>({})
const autoCompleteSelections = reactive<Record<number, SelectOption | null>>({})

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

const typedLiteralEnabled = computed(
  () => props.literalOnly && Boolean(props.literalValueCollection?.trim()),
)

function pairOperator(pair: FilterPair): string {
  return pair.operator || '_eq'
}

function pairValueKind(pair: FilterPair): FilterValueKind {
  if (props.literalOnly) return 'literal'
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
    autoCompleteSelections[index] = null
    autoCompleteSuggestions[index] = []
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

function onSourceFieldChange(index: number, sourceField: string): void {
  autoCompleteSelections[index] = null
  autoCompleteSuggestions[index] = []
  emit('update-pair', index, {
    sourceField,
    literalValue: '',
  })
}

function onLiteralValueChange(index: number, value: unknown): void {
  const normalized =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : String(value)
  emit('update-pair', index, {
    valueKind: 'literal',
    literalValue: normalized,
  })
}

async function ensureFilterableFields(collection: string): Promise<FilterableField[]> {
  const slug = collection.trim()
  if (!slug) return []
  const cached = filterableByCollection.value[slug]
  if (cached) return cached
  const fields = await listFilterableFields(slug)
  filterableByCollection.value = {
    ...filterableByCollection.value,
    [slug]: fields,
  }
  return fields
}

function resolveHostCollection(
  path: string,
): { hostCollection: string; leafField: string } | null {
  const root = props.literalValueCollection?.trim() || ''
  if (!root) return null
  const parts = String(path ?? '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) {
    return { hostCollection: root, leafField: parts[0]! }
  }

  let host = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    const related =
      relatedCollectionForCollectionField(relations.value, host, parts[i]!) || ''
    if (!related) return null
    host = related
  }
  return { hostCollection: host, leafField: parts[parts.length - 1]! }
}

async function loadLiteralFieldMetadata(): Promise<void> {
  const collection = props.literalValueCollection?.trim() || ''
  const needed = Array.from(
    new Set(
      props.pairs
        .filter((pair) => needsValue(pair) && pairValueKind(pair) === 'literal')
        .map((pair) => String(pair.sourceField ?? '').trim())
        .filter(Boolean),
    ),
  )
  if (!typedLiteralEnabled.value || !collection || needed.length === 0) {
    fieldMetaByPath.value = new Map()
    return
  }

  if (relations.value.length === 0) {
    try {
      relations.value = (await getCachedRelations()) as unknown as RelationDefinition[]
    } catch {
      relations.value = []
    }
  }

  const nextMeta = new Map<string, LiteralFieldMeta>()
  for (const path of needed) {
    const resolved = resolveHostCollection(path)
    if (!resolved) continue
    const fields = await ensureFilterableFields(resolved.hostCollection)
    const match = fields.find((field) => field.field === resolved.leafField)
    if (!match) continue

    nextMeta.set(path, {
      field: path,
      type: match.type,
      component: match.component,
      relatedCollection: match.relatedCollection,
      hostCollection: resolved.hostCollection,
      leafField: resolved.leafField,
    })

    try {
      const metadata = await fetchFieldRuntimeMetadata(
        resolved.hostCollection,
        resolved.leafField,
        match.component,
      )
      runtimeFieldProps[path] = metadata.props
      autoCompleteTemplates[path] = metadata.template
    } catch {
      runtimeFieldProps[path] = {}
    }
  }

  fieldMetaByPath.value = nextMeta
  await syncAutoCompleteSelections()
}

function fieldMeta(path: string): LiteralFieldMeta | undefined {
  return fieldMetaByPath.value.get(path)
}

function literalValueComponent(path: string) {
  const meta = fieldMeta(path)
  if (!meta?.component) return null
  return resolvePrimeVueComponent(
    resolveFilterValueComponent(meta.component, runtimeFieldProps[path]),
  )
}

function literalValueProps(path: string): Record<string, unknown> {
  const meta = fieldMeta(path)
  if (!meta) return { fluid: true }
  return filterConditionComponentProps(
    { field: path, component: meta.component },
    runtimeFieldProps,
  )
}

function isAutoCompleteLiteralField(path: string): boolean {
  const meta = fieldMeta(path)
  return Boolean(meta && isAutoCompleteFilterComponent(meta.component))
}

async function searchRelatedOptions(
  index: number,
  path: string,
  event: { query?: string },
): Promise<void> {
  const meta = fieldMeta(path)
  if (!meta?.relatedCollection) {
    autoCompleteSuggestions[index] = []
    return
  }
  autoCompleteSuggestions[index] = await searchRelatedCollectionOptions(
    meta.relatedCollection,
    event.query ?? '',
    autoCompleteTemplates[path],
  )
}

function updateAutoCompleteLiteral(
  index: number,
  value: SelectOption | null,
): void {
  autoCompleteSelections[index] = value
  onLiteralValueChange(index, value?.value ?? '')
}

async function syncAutoCompleteSelections(): Promise<void> {
  for (let index = 0; index < props.pairs.length; index += 1) {
    const pair = props.pairs[index]
    if (
      !pair ||
      !needsValue(pair) ||
      pairValueKind(pair) !== 'literal' ||
      !isAutoCompleteLiteralField(pair.sourceField)
    ) {
      autoCompleteSelections[index] = null
      continue
    }

    const meta = fieldMeta(pair.sourceField)
    const raw = pair.literalValue
    if (
      !meta?.relatedCollection ||
      raw === undefined ||
      raw === null ||
      raw === ''
    ) {
      autoCompleteSelections[index] = null
      continue
    }

    autoCompleteSelections[index] = await fetchRelatedCollectionOptionById(
      meta.relatedCollection,
      raw,
      autoCompleteTemplates[pair.sourceField],
    )
  }
}

watch(
  () => props.literalValueCollection,
  () => {
    filterableByCollection.value = {}
    relations.value = []
    void loadLiteralFieldMetadata()
  },
)

watch(
  () =>
    props.pairs
      .map((pair) => `${pair.sourceField}:${pair.operator}:${pair.literalValue ?? ''}`)
      .join('|'),
  () => {
    void loadLiteralFieldMetadata()
  },
  { immediate: true },
)
</script>

<template>
  <div class="grid gap-2">
    <div
      v-for="(pair, pairIndex) in pairs"
      :key="pairIndex"
      class="grid gap-2 items-start"
      :class="rich
        ? (literalOnly
          ? 'grid-cols-1 sm:grid-cols-[minmax(120px,1.1fr)_minmax(110px,0.9fr)_minmax(120px,1.2fr)_auto]'
          : 'grid-cols-1 sm:grid-cols-[minmax(120px,1.1fr)_minmax(110px,0.9fr)_minmax(110px,0.9fr)_minmax(120px,1.2fr)_auto]')
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
        @update:model-value="onSourceFieldChange(pairIndex, String($event ?? ''))"
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
          v-if="needsValue(pair) && !literalOnly"
          :model-value="pairValueKind(pair)"
          :options="valueKindOptions"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="onValueKindChange(pairIndex, ($event as FilterValueKind) || 'parent')"
        />
        <div
          v-else-if="!literalOnly"
          class="hidden sm:block"
        />

        <template v-if="needsValue(pair) && pairValueKind(pair) === 'literal'">
          <component
            :is="literalValueComponent(pair.sourceField)"
            v-if="
              typedLiteralEnabled &&
              literalValueComponent(pair.sourceField) &&
              !isAutoCompleteLiteralField(pair.sourceField)
            "
            :model-value="pair.literalValue ?? ''"
            v-bind="literalValueProps(pair.sourceField)"
            fluid
            @update:model-value="onLiteralValueChange(pairIndex, $event)"
          />
          <component
            :is="literalValueComponent(pair.sourceField)"
            v-else-if="
              typedLiteralEnabled &&
              literalValueComponent(pair.sourceField) &&
              isAutoCompleteLiteralField(pair.sourceField)
            "
            :model-value="autoCompleteSelections[pairIndex]"
            :suggestions="autoCompleteSuggestions[pairIndex] ?? []"
            v-bind="literalValueProps(pair.sourceField)"
            fluid
            @update:model-value="updateAutoCompleteLiteral(pairIndex, $event)"
            @complete="searchRelatedOptions(pairIndex, pair.sourceField, $event)"
          />
          <InputText
            v-else
            :model-value="pair.literalValue ?? ''"
            :placeholder="t('formBuilder.filterLiteralPlaceholder', 'Value')"
            fluid
            @update:model-value="onLiteralValueChange(pairIndex, $event)"
          />
        </template>
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
