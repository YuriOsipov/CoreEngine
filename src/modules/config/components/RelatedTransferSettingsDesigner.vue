<script lang="ts">
export default {
  name: 'RelatedTransferSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FilterPairEditor from './FilterPairEditor.vue'
import type {
  FieldDefinition,
  RelationDefinition,
  RelatedTransferSettings,
} from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  getCachedCollectionFields,
  getCachedRelations,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import {
  keysEqual,
  relatedCollectionForCollectionField,
} from '@/core/relationHelpers'
import {
  filterFromPairs,
  filterPairsFromFilter,
  stripFilterPairs,
  type FilterPair,
} from '@/core/relatedTransferFilterPairs'
import {
  fieldSelectOptions,
  nestedFieldOptions,
} from '@/core/fieldOptions'

const props = defineProps<{
  modelValue: RelatedTransferSettings
}>()

const emit = defineEmits<{
  'update:modelValue': [settings: RelatedTransferSettings]
}>()

const { t } = useTranslation()
const VISIT_ITEMS_EXAMPLE: RelatedTransferSettings = {
  source: {
    mode: 'tree',
    groupCollection: 'item_group',
    itemCollection: 'item',
    groupPrimaryKey: 'id',
    groupParentField: 'parent',
    groupLabelField: 'name',
    itemPrimaryKey: 'id',
    itemGroupField: 'Group',
    itemLabelFields: ['name'],
    fields: ['base_price', 'item_type', 'Group'],
    filter: {
      status: { _neq: 'archived' },
    },
  },
  target: {
    collection: 'visit_item',
    parentField: 'visit',
    itemField: 'Client',
    duplicateKey: 'Client',
    columns: [
      { field: 'Client', header: 'Item' },
      { field: 'Quantity', header: 'Qty' },
      { field: 'Price', header: 'Price' },
    ],
    editableFields: ['Quantity'],
    defaultValues: { Quantity: 1 },
  },
  mapping: {
    defaults: {
      Quantity: 1,
    },
    copyFromSource: {
      Price: 'base_price',
    },
    values: {
      visit: '$parent.id',
    },
  },
}
const jsonDraft = ref(formatSettings(props.modelValue))
const error = ref<string | null>(null)
const dirty = ref(false)
const collectionOptions = ref<Array<{ label: string; value: string }>>([])
const sourceFields = ref<FieldDefinition[]>([])
const targetFields = ref<FieldDefinition[]>([])
const parentFields = ref<FieldDefinition[]>([])
const parentNestedFieldsByCollection = ref<Record<string, FieldDefinition[]>>({})
const relationDefinitions = ref<RelationDefinition[]>([])
const sourceFilterPairDrafts = ref<FilterPair[] | null>(null)
const defaultValuePairDrafts = ref<Array<{ field: string; value: string }> | null>(null)
const collectionsLoading = ref(false)
const sourceFieldsLoading = ref(false)
const parentFieldsLoading = ref(false)

const sourceItemCollection = computed({
  get: () => draftSettings()?.source?.itemCollection ?? '',
  set: (value: string) => updateDraftPath(['source', 'itemCollection'], value),
})
const sourceGroupCollection = computed({
  get: () => draftSettings()?.source?.groupCollection ?? '',
  set: (value: string) => updateDraftPath(['source', 'groupCollection'], value || undefined),
})
const targetCollection = computed(
  () => draftSettings()?.target?.collection ?? '',
)
const targetParentField = computed(
  () => draftSettings()?.target?.parentField ?? '',
)

watch(
  () => props.modelValue,
  (settings) => {
    if (dirty.value) return
    jsonDraft.value = formatSettings(settings)
  },
  { deep: true },
)

watch(
  () => true,
  () => {
    void loadCollections()
    void loadRelations()
  },
  { immediate: true },
)

watch(
  sourceItemCollection,
  (collection) => {
    void loadSourceFields(collection)
  },
  { immediate: true },
)

watch(
  targetCollection,
  async (collection) => {
    await loadTargetFields(collection)
    await loadParentFields()
  },
  { immediate: true },
)

watch(
  () => [
    targetParentField.value,
    relationDefinitions.value.length,
    targetFields.value.length,
  ],
  () => {
    void loadParentFields()
  },
  { immediate: true },
)

function applyJson(): void {
  error.value = null

  try {
    const parsed = JSON.parse(jsonDraft.value) as RelatedTransferSettings
    const validationError = validateSettings(parsed)
    if (validationError) {
      error.value = validationError
      return
    }

    if (parsed.target?.itemField) {
      parsed.target.duplicateKey = parsed.target.itemField
    }

    dirty.value = false
    emit('update:modelValue', parsed)
    jsonDraft.value = formatSettings(parsed)
    sourceFilterPairDrafts.value = null
    defaultValuePairDrafts.value = null
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('relatedTransferSettings.invalidJson', 'Invalid JSON.')
  }
}

function resetJson(): void {
  dirty.value = false
  error.value = null
  jsonDraft.value = formatSettings(props.modelValue)
  sourceFilterPairDrafts.value = null
  defaultValuePairDrafts.value = null
}

function loadVisitItemsExample(): void {
  jsonDraft.value = formatSettings(VISIT_ITEMS_EXAMPLE)
  dirty.value = true
  error.value = null
  sourceFilterPairDrafts.value = null
  defaultValuePairDrafts.value = null
}

async function loadCollections(): Promise<void> {
  collectionsLoading.value = true

  try {
    collectionOptions.value = await listUserCollections()
  } catch {
    collectionOptions.value = []
  } finally {
    collectionsLoading.value = false
  }
}

async function loadRelations(): Promise<void> {
  try {
    relationDefinitions.value = await getCachedRelations() as RelationDefinition[]
  } catch {
    relationDefinitions.value = []
  }
}

async function loadSourceFields(collection: string): Promise<void> {
  if (!collection) {
    sourceFields.value = []
    return
  }

  sourceFieldsLoading.value = true
  try {
    sourceFields.value = await getCachedCollectionFields(collection)
  } catch {
    sourceFields.value = []
  } finally {
    sourceFieldsLoading.value = false
  }
}

async function loadTargetFields(collection: string): Promise<void> {
  if (!collection) {
    targetFields.value = []
    return
  }

  try {
    targetFields.value = await getCachedCollectionFields(collection)
  } catch {
    targetFields.value = []
  }
}

async function loadParentFields(): Promise<void> {
  const collection = parentCollection()
  if (!collection) {
    parentFields.value = []
    parentNestedFieldsByCollection.value = {}
    return
  }

  parentFieldsLoading.value = true
  try {
    parentFields.value = await getCachedCollectionFields(collection)
    const relationCollections = parentFields.value
      .map((field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          collection,
          field.field,
        ) ||
          field.schema?.foreign_key_table ||
          '',
      )
      .filter((related): related is string => Boolean(related))
    const nestedEntries = await Promise.all(
      Array.from(new Set(relationCollections)).map(async (relatedCollection) => [
        relatedCollection,
        await getCachedCollectionFields(relatedCollection),
      ] as const),
    )
    parentNestedFieldsByCollection.value = Object.fromEntries(nestedEntries)
  } catch {
    parentFields.value = []
    parentNestedFieldsByCollection.value = {}
  } finally {
    parentFieldsLoading.value = false
  }
}

function markDirty(value: string | undefined): void {
  jsonDraft.value = value ?? ''
  dirty.value = true
  sourceFilterPairDrafts.value = null
  defaultValuePairDrafts.value = null
}

function draftSettings(): RelatedTransferSettings | null {
  try {
    return JSON.parse(jsonDraft.value) as RelatedTransferSettings
  } catch {
    return null
  }
}

function updateDraftPath(path: string[], value: unknown): void {
  const draft = draftSettings() ?? props.modelValue
  const next = structuredClone(draft) as unknown as Record<string, unknown>
  let cursor = next

  for (const key of path.slice(0, -1)) {
    const current = cursor[key]
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }

  const finalKey = path[path.length - 1]
  if (value === undefined || value === '') {
    delete cursor[finalKey]
  } else {
    cursor[finalKey] = value
  }

  jsonDraft.value = formatSettings(next as unknown as RelatedTransferSettings)
  dirty.value = true
  error.value = null
}

function sourceFilterPairs(): FilterPair[] {
  if (sourceFilterPairDrafts.value) return sourceFilterPairDrafts.value
  return filterPairsFromFilter(draftSettings()?.source?.filter ?? null)
}

function addSourceFilterPair(): void {
  updateSourceFilterPairs([
    ...sourceFilterPairs(),
    { sourceField: '', filterField: '' },
  ])
}

function updateSourceFilterPair(index: number, patch: Partial<FilterPair>): void {
  const pairs = sourceFilterPairs()
  pairs[index] = {
    ...(pairs[index] ?? { sourceField: '', filterField: '' }),
    ...patch,
  }
  updateSourceFilterPairs(pairs)
}

function removeSourceFilterPair(index: number): void {
  updateSourceFilterPairs(
    sourceFilterPairs().filter((_, pairIndex) => pairIndex !== index),
  )
}

function updateSourceFilterPairs(pairs: FilterPair[]): void {
  sourceFilterPairDrafts.value = pairs
  updateDraftPath(['source', 'filter'], mergeSourceFilterPairs(pairs))
}

function mergeSourceFilterPairs(pairs: FilterPair[]): Record<string, unknown> | null {
  const extraFilter = stripFilterPairs(draftSettings()?.source?.filter ?? null)
  const pairFilter = filterFromPairs(pairs)
  const merged = {
    ...(extraFilter ?? {}),
    ...(pairFilter ?? {}),
  }
  return Object.keys(merged).length > 0 ? merged : null
}

function sourceFilterFieldOptions(): Array<{ label: string; value: string }> {
  // Fields of the selected Source collection only (not the target object).
  if (!sourceItemCollection.value) return []
  return fieldSelectOptions(sourceFields.value)
}

function parentFilterFieldOptions(): Array<{ label: string; value: string }> {
  return nestedFieldOptions(
    parentFields.value,
    parentNestedFieldsByCollection.value,
    (field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          parentCollection(),
          field.field,
        ) ||
        field.schema?.foreign_key_table ||
        '',
  )
}

function parentCollection(): string {
  const field = targetFields.value.find((item) =>
    keysEqual(item.field, targetParentField.value),
  )
  return relatedCollectionForCollectionField(
    relationDefinitions.value,
    targetCollection.value,
    targetParentField.value,
  ) ||
    field?.schema?.foreign_key_table ||
    ''
}

function targetFieldOptions(): Array<{ label: string; value: string }> {
  return fieldSelectOptions(targetFields.value)
}

function defaultValuePairs(): Array<{ field: string; value: string }> {
  if (defaultValuePairDrafts.value) return defaultValuePairDrafts.value
  const defaults = draftSettings()?.target?.defaultValues ?? {}
  return Object.entries(defaults).map(([field, value]) => ({
    field,
    value: String(value ?? ''),
  }))
}

function addDefaultValuePair(): void {
  updateDefaultValuePairs([...defaultValuePairs(), { field: '', value: '' }])
}

function updateDefaultValuePair(
  index: number,
  patch: Partial<{ field: string; value: string }>,
): void {
  const pairs = defaultValuePairs()
  pairs[index] = { ...(pairs[index] ?? { field: '', value: '' }), ...patch }
  updateDefaultValuePairs(pairs)
}

function removeDefaultValuePair(index: number): void {
  updateDefaultValuePairs(defaultValuePairs().filter((_, i) => i !== index))
}

function updateDefaultValuePairs(pairs: Array<{ field: string; value: string }>): void {
  defaultValuePairDrafts.value = pairs
  const valid = pairs.filter((p) => p.field.trim())
  const defaults: Record<string, unknown> = Object.fromEntries(
    valid.map((p) => {
      const num = Number(p.value)
      return [p.field, p.value !== '' && isFinite(num) ? num : p.value]
    }),
  )
  updateDraftPath(
    ['target', 'defaultValues'],
    Object.keys(defaults).length > 0 ? defaults : undefined,
  )
}

function formatSettings(settings: RelatedTransferSettings): string {
  return JSON.stringify(settings, null, 2)
}

function validateSettings(settings: RelatedTransferSettings): string | null {
  if (!settings || typeof settings !== 'object') {
    return t('relatedTransferSettings.invalidShape', 'Settings must be a JSON object.')
  }
  if (!settings.source?.itemCollection) {
    return t('relatedTransferSettings.sourceRequired', 'source.itemCollection is required.')
  }
  if (!settings.target?.collection) {
    return t('relatedTransferSettings.targetRequired', 'target.collection is required.')
  }
  if (!settings.target?.parentField) {
    return t('relatedTransferSettings.parentFieldRequired', 'target.parentField is required.')
  }
  if (!settings.target?.itemField) {
    return t('relatedTransferSettings.itemFieldRequired', 'target.itemField is required.')
  }
  return null
}
</script>

<template>
  <div class="grid gap-3">
    <Message
      severity="info"
      :closable="false"
    >
      {{ t('relatedTransferSettings.hint', 'Configure source, target, filters, and mappings as JSON. Use exact collection keys, not translated labels. Tokens such as $parent.id and $source.id are resolved at runtime.') }}
    </Message>

    <section class="grid gap-2">
      <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
        {{ t('relatedTransferSettings.sourceItemCollection', 'Source item collection') }}
        <Select
          v-model="sourceItemCollection"
          :options="collectionOptions"
          option-label="label"
          option-value="value"
          :loading="collectionsLoading"
          filter
          fluid
        />
      </label>

      <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold text-surface-700">
        {{ t('relatedTransferSettings.sourceGroupCollection', 'Source group collection') }}
        <Select
          v-model="sourceGroupCollection"
          :options="collectionOptions"
          option-label="label"
          option-value="value"
          :loading="collectionsLoading"
          show-clear
          filter
          fluid
        />
      </label>
    </section>

    <section class="border border-surface-200 rounded-lg grid gap-2 p-3">
      <h3 class="text-[0.9rem] m-0">{{ t('relatedTransferSettings.sourceFilter', 'Source filter') }}</h3>
      <FilterPairEditor
        :pairs="sourceFilterPairs()"
        :source-options="sourceFilterFieldOptions()"
        :filter-options="parentFilterFieldOptions()"
        :source-placeholder="t('relatedTransferSettings.sourceCollectionField', 'Source collection field')"
        :filter-placeholder="t('bulkInsertBuilder.filterField', 'Filter field')"
        :add-label="t('relatedTransferSettings.addFilterCondition', 'Add filter condition')"
        :source-loading="sourceFieldsLoading"
        :filter-loading="parentFieldsLoading"
        @add="addSourceFilterPair"
        @update-pair="updateSourceFilterPair"
        @remove="removeSourceFilterPair"
      />
    </section>

    <section class="border border-surface-200 rounded-lg grid gap-2 p-3">
      <h3 class="text-[0.9rem] m-0">
        {{ t('relatedTransferSettings.destinationDefaults', 'Destination default values') }}
      </h3>
      <p class="m-0 text-[0.78rem] text-surface-500">
        {{ t('relatedTransferSettings.destinationDefaultsHint', 'Pre-fill editable fields when a source item is added. Numeric strings are stored as numbers.') }}
      </p>

      <div
        v-for="(pair, index) in defaultValuePairs()"
        :key="index"
        class="flex gap-2 items-center"
      >
        <AutoComplete
          :model-value="pair.field"
          :suggestions="targetFieldOptions().map(o => o.value).filter(v => v.toLowerCase().includes(pair.field.toLowerCase()))"
          :placeholder="t('relatedTransferSettings.destinationField', 'Destination field')"
          fluid
          force-selection
          @update:model-value="updateDefaultValuePair(index, { field: String($event ?? '') })"
          @item-select="updateDefaultValuePair(index, { field: String($event.value ?? '') })"
        />
        <InputText
          :model-value="pair.value"
          :placeholder="t('relatedTransferSettings.defaultValue', 'Default value')"
          class="w-28"
          @update:model-value="updateDefaultValuePair(index, { value: String($event ?? '') })"
        />
        <Button
          icon="pi pi-times"
          severity="danger"
          text
          size="small"
          @click="removeDefaultValuePair(index)"
        />
      </div>

      <Button
        :label="t('relatedTransferSettings.addDefaultValue', 'Add default value')"
        size="small"
        text
        icon="pi pi-plus"
        @click="addDefaultValuePair"
      />
    </section>

    <Textarea
      :model-value="jsonDraft"
      rows="18"
      auto-resize
      class="font-mono text-[0.78rem]"
      @update:model-value="markDirty(String($event ?? ''))"
    />

    <Message
      v-if="error"
      severity="error"
      :closable="false"
    >
      {{ error }}
    </Message>

    <div class="flex justify-end gap-2">
      <Button
        :label="t('relatedTransferSettings.visitItemsExample', 'Load Visit Items example')"
        size="small"
        severity="secondary"
        text
        @click="loadVisitItemsExample"
      />
      <Button
        :label="t('common.reset', 'Reset')"
        size="small"
        text
        @click="resetJson"
      />
      <Button
        :label="t('common.apply', 'Apply')"
        size="small"
        @click="applyJson"
      />
    </div>
  </div>
</template>
