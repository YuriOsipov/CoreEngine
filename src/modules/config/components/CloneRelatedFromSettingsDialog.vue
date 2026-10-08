<script lang="ts">
export default {
  name: 'CloneRelatedFromSettingsDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CloneRelatedChildPair, CloneRelatedFromSettings } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  getCachedCollectionFields,
  listParentRelatedCollections,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'

type FieldOption = { label: string; value: string }

const props = defineProps<{
  visible: boolean
  fieldLabel?: string
  sourceCollection?: string
  targetCollection: string
  settings: CloneRelatedFromSettings
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  save: [settings: CloneRelatedFromSettings]
}>()

const { t } = useTranslation()

const dialogVisible = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

const draft = ref<CloneRelatedFromSettings>({ children: [] })
const collectionOptions = ref<FieldOption[]>([])
const sourceChildOptions = ref<FieldOption[]>([])
/** Target options keyed by selected source collection (collections with M2O → source). */
const targetOptionsBySource = ref<Record<string, FieldOption[]>>({})
const parentRecordFieldOptions = ref<FieldOption[]>([])
const loading = ref(false)

const dialogHeader = computed(() => {
  const label = props.fieldLabel?.trim()
  if (label) {
    return t('formBuilder.cloneRelatedFromDialogTitle', 'Clone related · {label}', { label })
  }
  return t('formBuilder.cloneRelatedFromDialogTitleDefault', 'Clone related from this record')
})

function emptyPair(): CloneRelatedChildPair {
  return {
    sourceCollection: '',
    targetCollection: '',
    skipFields: [],
    fieldMap: {},
    children: [],
  }
}

function cloneSettings(settings: CloneRelatedFromSettings): CloneRelatedFromSettings {
  return JSON.parse(JSON.stringify(settings ?? { children: [] })) as CloneRelatedFromSettings
}

async function fieldOptionsFor(collection: string): Promise<FieldOption[]> {
  if (!collection) return []
  const fields = await getCachedCollectionFields(collection)
  return fields
    .map((f) => ({ label: f.field, value: f.field }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function toCollectionOption(
  apiName: string,
  labelByCollection: Map<string, string>,
): FieldOption {
  return {
    label: labelByCollection.get(apiName) || apiName,
    value: apiName,
  }
}

async function loadTargetOptionsForSource(
  sourceCollection: string,
  labelByCollection: Map<string, string>,
): Promise<FieldOption[]> {
  const key = sourceCollection.trim()
  if (!key) return []
  if (targetOptionsBySource.value[key]) return targetOptionsBySource.value[key]
  const related = await listParentRelatedCollections(key)
  const options = related
    .map((item) => toCollectionOption(item.relatedCollection, labelByCollection))
    .sort((a, b) => a.label.localeCompare(b.label))
  targetOptionsBySource.value = {
    ...targetOptionsBySource.value,
    [key]: options,
  }
  return options
}

function targetOptionsForPair(pair: CloneRelatedChildPair): FieldOption[] {
  const key = pair.sourceCollection?.trim() || ''
  if (!key) return []
  return targetOptionsBySource.value[key] ?? []
}

/** Nested source = collections with M2O → parent pair source (e.g. stage_item → pm_stage). */
function nestedSourceOptionsForParent(parentPair: CloneRelatedChildPair): FieldOption[] {
  return targetOptionsForPair(parentPair)
}

/**
 * Nested target = collections with M2O → parent pair target (e.g. visit_item → visit),
 * not M2O to nested source (stage_item usually has no reverse children used as line items).
 */
function nestedTargetOptionsForParent(parentPair: CloneRelatedChildPair): FieldOption[] {
  const key = parentPair.targetCollection?.trim() || ''
  if (!key) return []
  return targetOptionsBySource.value[key] ?? []
}

watch(
  () => props.visible,
  async (open) => {
    if (!open) return
    draft.value = cloneSettings(props.settings)
    if (!draft.value.children.length) draft.value.children.push(emptyPair())
    loading.value = true
    targetOptionsBySource.value = {}
    try {
      // Source list = children of the M2O source entity (field mode) or layout entity (action mode).
      // Target list (per pair) = collections with M2O → that pair's source.
      const sourceParentEntity =
        props.sourceCollection?.trim() || props.targetCollection?.trim() || ''
      const [collections, sourceRelated, parentFields] = await Promise.all([
        listUserCollections({ includeInternal: true }),
        sourceParentEntity
          ? listParentRelatedCollections(sourceParentEntity)
          : Promise.resolve([]),
        fieldOptionsFor(props.targetCollection),
      ])
      collectionOptions.value = collections
        .map((c) => ({ label: c.label, value: c.value }))
        .sort((a, b) => a.label.localeCompare(b.label))
      const labelByCollection = new Map(
        collectionOptions.value.map((opt) => [opt.value, opt.label]),
      )
      sourceChildOptions.value = sourceRelated
        .map((item) => toCollectionOption(item.relatedCollection, labelByCollection))
        .sort((a, b) => a.label.localeCompare(b.label))
      parentRecordFieldOptions.value = parentFields

      const relatedParentKeys = new Set<string>()
      for (const pair of draft.value.children) {
        if (pair.sourceCollection?.trim()) relatedParentKeys.add(pair.sourceCollection.trim())
        if (pair.targetCollection?.trim()) relatedParentKeys.add(pair.targetCollection.trim())
        for (const nested of pair.children ?? []) {
          if (nested.sourceCollection?.trim()) relatedParentKeys.add(nested.sourceCollection.trim())
        }
      }
      await Promise.all(
        [...relatedParentKeys].map((key) => loadTargetOptionsForSource(key, labelByCollection)),
      )
    } finally {
      loading.value = false
    }
  },
)

const pairFieldOptions = ref<
  Record<
    number,
    {
      source: FieldOption[]
      target: FieldOption[]
      nested: Record<number, { source: FieldOption[]; target: FieldOption[] }>
    }
  >
>({})

watch(
  () => draft.value.children,
  async (children) => {
    const next: typeof pairFieldOptions.value = {}
    const labelByCollection = new Map(
      collectionOptions.value.map((opt) => [opt.value, opt.label]),
    )
    await Promise.all(
      children.map(async (pair, index) => {
        const labelKeys = [pair.sourceCollection, pair.targetCollection]
          .map((value) => value?.trim())
          .filter(Boolean) as string[]
        await Promise.all(
          labelKeys.map((key) => loadTargetOptionsForSource(key, labelByCollection)),
        )
        const [source, target] = await Promise.all([
          fieldOptionsFor(pair.sourceCollection),
          fieldOptionsFor(pair.targetCollection),
        ])
        const nestedList = pair.children ?? []
        const nestedEntries = await Promise.all(
          nestedList.map(async (nested, nestedIndex) => {
            if (nested.sourceCollection?.trim()) {
              await loadTargetOptionsForSource(nested.sourceCollection, labelByCollection)
            }
            const [nestedSource, nestedTarget] = await Promise.all([
              fieldOptionsFor(nested.sourceCollection),
              fieldOptionsFor(nested.targetCollection),
            ])
            return [nestedIndex, { source: nestedSource, target: nestedTarget }] as const
          }),
        )
        next[index] = {
          source,
          target,
          nested: Object.fromEntries(nestedEntries),
        }
      }),
    )
    pairFieldOptions.value = next
  },
  { deep: true, immediate: true },
)

async function onSourceCollectionChange(pair: CloneRelatedChildPair, value: unknown): Promise<void> {
  const next = String(value ?? '').trim()
  pair.sourceCollection = next
  pair.targetCollection = ''
  const labelByCollection = new Map(
    collectionOptions.value.map((opt) => [opt.value, opt.label]),
  )
  if (next) await loadTargetOptionsForSource(next, labelByCollection)
}

/** Parent pair source changed: clear targets and nested selections that depend on it. */
async function onParentSourceCollectionChange(
  pair: CloneRelatedChildPair,
  value: unknown,
): Promise<void> {
  await onSourceCollectionChange(pair, value)
  for (const nested of pair.children ?? []) {
    nested.sourceCollection = ''
    nested.targetCollection = ''
  }
}

/** Parent pair target changed: nested targets hang off this collection. */
async function onParentTargetCollectionChange(
  pair: CloneRelatedChildPair,
  value: unknown,
): Promise<void> {
  const next = String(value ?? '').trim()
  pair.targetCollection = next
  for (const nested of pair.children ?? []) {
    nested.targetCollection = ''
  }
  const labelByCollection = new Map(
    collectionOptions.value.map((opt) => [opt.value, opt.label]),
  )
  if (next) await loadTargetOptionsForSource(next, labelByCollection)
}

function addPair(): void {
  draft.value.children.push(emptyPair())
}

function removePair(index: number): void {
  draft.value.children.splice(index, 1)
  if (!draft.value.children.length) draft.value.children.push(emptyPair())
}

function nestedChildren(pair: CloneRelatedChildPair): CloneRelatedChildPair[] {
  if (!pair.children) pair.children = []
  return pair.children
}

function addNestedPair(pair: CloneRelatedChildPair): void {
  nestedChildren(pair).push(emptyPair())
}

function removeNestedPair(pair: CloneRelatedChildPair, nestedIndex: number): void {
  nestedChildren(pair).splice(nestedIndex, 1)
}

function setSkipFields(pair: CloneRelatedChildPair, value: unknown): void {
  pair.skipFields = Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : []
}

function fieldMapEntries(pair: CloneRelatedChildPair): Array<{ target: string; source: string }> {
  return Object.entries(pair.fieldMap ?? {}).map(([target, source]) => ({
    target,
    source: String(source ?? ''),
  }))
}

function setFieldMapEntries(
  pair: CloneRelatedChildPair,
  entries: Array<{ target: string; source: string }>,
): void {
  const map: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.target.trim() || !entry.source.trim()) continue
    map[entry.target.trim()] = entry.source.trim()
  }
  pair.fieldMap = map
}

function addFieldMapRow(pair: CloneRelatedChildPair): void {
  const entries = fieldMapEntries(pair)
  entries.push({ target: '', source: '' })
  setFieldMapEntries(pair, entries)
  // keep empty row visible via transient key — store on pair via fieldMap with placeholder skipped on save
  if (!pair.fieldMap) pair.fieldMap = {}
  // Use a draft list on the pair object
  ;(pair as CloneRelatedChildPair & { _fieldMapDraft?: Array<{ target: string; source: string }> })._fieldMapDraft =
    entries
}

function fieldMapDraft(pair: CloneRelatedChildPair): Array<{ target: string; source: string }> {
  const extended = pair as CloneRelatedChildPair & {
    _fieldMapDraft?: Array<{ target: string; source: string }>
  }
  if (extended._fieldMapDraft) return extended._fieldMapDraft
  const entries = fieldMapEntries(pair)
  extended._fieldMapDraft = entries.length ? entries : []
  return extended._fieldMapDraft
}

function updateFieldMapDraft(
  pair: CloneRelatedChildPair,
  index: number,
  patch: Partial<{ target: string; source: string }>,
): void {
  const draftRows = fieldMapDraft(pair)
  draftRows[index] = { ...draftRows[index], ...patch }
  setFieldMapEntries(pair, draftRows)
}

function removeFieldMapRow(pair: CloneRelatedChildPair, index: number): void {
  const draftRows = fieldMapDraft(pair)
  draftRows.splice(index, 1)
  setFieldMapEntries(pair, draftRows)
}

function parentFieldMapEntries(
  pair: CloneRelatedChildPair,
): Array<{ target: string; source: string }> {
  return Object.entries(pair.parentFieldMap ?? {}).map(([target, source]) => ({
    target,
    source: String(source ?? ''),
  }))
}

function setParentFieldMapEntries(
  pair: CloneRelatedChildPair,
  entries: Array<{ target: string; source: string }>,
): void {
  const map: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.target.trim() || !entry.source.trim()) continue
    map[entry.target.trim()] = entry.source.trim()
  }
  pair.parentFieldMap = Object.keys(map).length ? map : undefined
}

function parentFieldMapDraft(
  pair: CloneRelatedChildPair,
): Array<{ target: string; source: string }> {
  const extended = pair as CloneRelatedChildPair & {
    _parentFieldMapDraft?: Array<{ target: string; source: string }>
  }
  if (extended._parentFieldMapDraft) return extended._parentFieldMapDraft
  const entries = parentFieldMapEntries(pair)
  extended._parentFieldMapDraft = entries.length ? entries : []
  return extended._parentFieldMapDraft
}

function addParentFieldMapRow(pair: CloneRelatedChildPair): void {
  const entries = parentFieldMapDraft(pair)
  entries.push({ target: '', source: '' })
  setParentFieldMapEntries(pair, entries)
  ;(pair as CloneRelatedChildPair & {
    _parentFieldMapDraft?: Array<{ target: string; source: string }>
  })._parentFieldMapDraft = entries
}

function updateParentFieldMapDraft(
  pair: CloneRelatedChildPair,
  index: number,
  patch: Partial<{ target: string; source: string }>,
): void {
  const draftRows = parentFieldMapDraft(pair)
  draftRows[index] = { ...draftRows[index], ...patch }
  setParentFieldMapEntries(pair, draftRows)
}

function removeParentFieldMapRow(pair: CloneRelatedChildPair, index: number): void {
  const draftRows = parentFieldMapDraft(pair)
  draftRows.splice(index, 1)
  setParentFieldMapEntries(pair, draftRows)
}

function ensureSplitBy(pair: CloneRelatedChildPair): NonNullable<CloneRelatedChildPair['splitBy']> {
  if (!pair.splitBy) pair.splitBy = { field: '' }
  return pair.splitBy
}

function setSplitIncludeValues(pair: CloneRelatedChildPair, value: string): void {
  const split = ensureSplitBy(pair)
  split.includeValues = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function splitIncludeValuesText(pair: CloneRelatedChildPair): string {
  return (pair.splitBy?.includeValues ?? []).join(', ')
}

function save(): void {
  const cleaned: CloneRelatedFromSettings = {
    children: draft.value.children
      .map((pair) => sanitizePair(pair))
      .filter((pair) => pair.sourceCollection && pair.targetCollection),
  }
  emit('save', cleaned)
  dialogVisible.value = false
}

function sanitizePair(pair: CloneRelatedChildPair): CloneRelatedChildPair {
  const nested = (pair.children ?? [])
    .map((child) => sanitizePair(child))
    .filter((child) => child.sourceCollection && child.targetCollection)
  const parentFieldMap = Object.fromEntries(
    Object.entries(pair.parentFieldMap ?? {}).filter(([k, v]) => k.trim() && String(v).trim()),
  )
  const splitField = pair.splitBy?.field?.trim()
  return {
    sourceCollection: pair.sourceCollection.trim(),
    targetCollection: pair.targetCollection.trim(),
    skipFields: (pair.skipFields ?? []).map((f) => f.trim()).filter(Boolean),
    fieldMap: Object.fromEntries(
      Object.entries(pair.fieldMap ?? {}).filter(([k, v]) => k.trim() && String(v).trim()),
    ),
    parentFieldMap: Object.keys(parentFieldMap).length ? parentFieldMap : undefined,
    splitBy: splitField
      ? {
          field: splitField,
          targetField: pair.splitBy?.targetField?.trim() || undefined,
          includeValues: (pair.splitBy?.includeValues ?? [])
            .map((value) => String(value).trim())
            .filter(Boolean),
        }
      : undefined,
    children: nested.length ? nested : undefined,
  }
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogHeader"
    :style="{ width: 'min(920px, 96vw)' }"
    :breakpoints="{ '960px': '96vw' }"
  >
    <div v-if="loading" class="flex justify-center p-4">
      <ProgressSpinner style="width: 2rem; height: 2rem" />
    </div>
    <div v-else class="grid gap-4">
      <p class="m-0 text-[0.85rem] text-muted-color">
        {{
          t(
            'formBuilder.cloneRelatedFromHint',
            'Source = children of this record. Target = objects with an M2O to the selected source. Nested source = M2O to parent source; nested target = M2O to parent target (e.g. stage_item → visit_item under Visit).',
          )
        }}
      </p>

      <div
        v-for="(pair, index) in draft.children"
        :key="`pair-${index}`"
        class="grid gap-3 rounded border border-surface-200 p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <h4 class="m-0 text-[0.9rem]">
            {{ t('formBuilder.cloneRelatedPair', 'Child pair {n}', { n: index + 1 }) }}
          </h4>
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            :aria-label="t('common.remove', 'Remove')"
            @click="removePair(index)"
          />
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold">
            {{ t('formBuilder.cloneRelatedSourceCollection', 'Source collection') }}
            <Select
              :model-value="pair.sourceCollection"
              :options="sourceChildOptions.length ? sourceChildOptions : collectionOptions"
              option-label="label"
              option-value="value"
              filter
              fluid
              @update:model-value="onParentSourceCollectionChange(pair, $event)"
            />
          </label>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold">
            {{ t('formBuilder.cloneRelatedTargetCollection', 'Target collection') }}
            <Select
              :model-value="pair.targetCollection"
              :options="targetOptionsForPair(pair)"
              option-label="label"
              option-value="value"
              filter
              fluid
              :disabled="!pair.sourceCollection"
              :placeholder="
                pair.sourceCollection
                  ? t('formBuilder.cloneRelatedTargetPlaceholder', 'Select target…')
                  : t('formBuilder.cloneRelatedPickSourceFirst', 'Pick source first')
              "
              @update:model-value="onParentTargetCollectionChange(pair, $event)"
            />
          </label>
          <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold md:col-span-2">
            {{ t('formBuilder.cloneRelatedSkipFields', 'Skip fields') }}
            <MultiSelect
              :model-value="pair.skipFields ?? []"
              :options="pairFieldOptions[index]?.target ?? []"
              option-label="label"
              option-value="value"
              filter
              display="chip"
              fluid
              :placeholder="t('formBuilder.cloneRelatedSkipFieldsPlaceholder', 'Select fields to skip')"
              @update:model-value="setSkipFields(pair, $event)"
            />
          </label>
        </div>

        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <span class="text-[0.8rem] font-semibold">
              {{ t('formBuilder.cloneRelatedFieldMap', 'Field map overrides (source → target)') }}
            </span>
            <Button
              :label="t('formBuilder.cloneRelatedAddFieldMap', 'Add override')"
              icon="pi pi-plus"
              text
              size="small"
              @click="addFieldMapRow(pair)"
            />
          </div>
          <div
            v-for="(row, rowIndex) in fieldMapDraft(pair)"
            :key="`map-${index}-${rowIndex}`"
            class="flex flex-wrap items-center gap-2"
          >
            <Select
              :model-value="row.source"
              :options="pairFieldOptions[index]?.source ?? []"
              option-label="label"
              option-value="value"
              filter
              editable
              class="min-w-[10rem] flex-1"
              :placeholder="t('formBuilder.cloneRelatedSourceField', 'Source field')"
              @update:model-value="updateFieldMapDraft(pair, rowIndex, { source: String($event ?? '') })"
            />
            <span class="text-muted-color">→</span>
            <Select
              :model-value="row.target"
              :options="pairFieldOptions[index]?.target ?? []"
              option-label="label"
              option-value="value"
              filter
              editable
              class="min-w-[10rem] flex-1"
              :placeholder="t('formBuilder.cloneRelatedTargetField', 'Target field')"
              @update:model-value="updateFieldMapDraft(pair, rowIndex, { target: String($event ?? '') })"
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              @click="removeFieldMapRow(pair, rowIndex)"
            />
          </div>
        </div>

        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <span class="text-[0.8rem] font-semibold">
              {{
                t(
                  'formBuilder.cloneRelatedParentFieldMap',
                  'Copy from parent record (parent → target)',
                )
              }}
            </span>
            <Button
              :label="t('formBuilder.cloneRelatedAddParentFieldMap', 'Add parent copy')"
              icon="pi pi-plus"
              text
              size="small"
              @click="addParentFieldMapRow(pair)"
            />
          </div>
          <div
            v-for="(row, rowIndex) in parentFieldMapDraft(pair)"
            :key="`parent-map-${index}-${rowIndex}`"
            class="flex flex-wrap items-center gap-2"
          >
            <Select
              :model-value="row.source"
              :options="parentRecordFieldOptions"
              option-label="label"
              option-value="value"
              filter
              editable
              class="min-w-[10rem] flex-1"
              :placeholder="t('formBuilder.cloneRelatedParentField', 'Parent field')"
              @update:model-value="
                updateParentFieldMapDraft(pair, rowIndex, { source: String($event ?? '') })
              "
            />
            <span class="text-muted-color">→</span>
            <Select
              :model-value="row.target"
              :options="pairFieldOptions[index]?.target ?? []"
              option-label="label"
              option-value="value"
              filter
              editable
              class="min-w-[10rem] flex-1"
              :placeholder="t('formBuilder.cloneRelatedTargetField', 'Target field')"
              @update:model-value="
                updateParentFieldMapDraft(pair, rowIndex, { target: String($event ?? '') })
              "
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              @click="removeParentFieldMapRow(pair, rowIndex)"
            />
          </div>
        </div>

        <details class="rounded border border-surface-100 p-2">
          <summary class="cursor-pointer text-[0.85rem] font-semibold">
            {{ t('formBuilder.cloneRelatedSplitBy', 'Split into multiple targets (optional)') }}
          </summary>
          <p class="mt-2 mb-3 text-[0.8rem] text-muted-color">
            {{
              t(
                'formBuilder.cloneRelatedSplitByHint',
                'Group the first nested pair’s source rows by a field (e.g. item.item_type) and create one target row per group.',
              )
            }}
          </p>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold">
              {{ t('formBuilder.cloneRelatedSplitField', 'Split field path') }}
              <InputText
                :model-value="pair.splitBy?.field ?? ''"
                fluid
                :placeholder="t('formBuilder.cloneRelatedSplitFieldPlaceholder', 'item.item_type')"
                @update:model-value="ensureSplitBy(pair).field = String($event ?? '')"
              />
            </label>
            <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold">
              {{ t('formBuilder.cloneRelatedSplitTargetField', 'Write group key to target field') }}
              <Select
                :model-value="pair.splitBy?.targetField ?? null"
                :options="pairFieldOptions[index]?.target ?? []"
                option-label="label"
                option-value="value"
                show-clear
                filter
                fluid
                :placeholder="t('formBuilder.cloneRelatedSplitTargetFieldPlaceholder', 'Optional')"
                @update:model-value="
                  ensureSplitBy(pair).targetField = $event ? String($event) : undefined
                "
              />
            </label>
            <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold md:col-span-2">
              {{ t('formBuilder.cloneRelatedSplitInclude', 'Include values only (comma-separated)') }}
              <InputText
                :model-value="splitIncludeValuesText(pair)"
                fluid
                :placeholder="t('formBuilder.cloneRelatedSplitIncludePlaceholder', '1, 3')"
                @update:model-value="setSplitIncludeValues(pair, String($event ?? ''))"
              />
            </label>
          </div>
        </details>

        <details class="rounded border border-surface-100 p-2">
          <summary class="cursor-pointer text-[0.85rem] font-semibold">
            {{ t('formBuilder.cloneRelatedNested', 'Nested child pairs (optional)') }}
          </summary>

          <div
            v-for="(nested, nestedIndex) in nestedChildren(pair)"
            :key="`nested-${index}-${nestedIndex}`"
            class="mt-3 grid gap-3 rounded border border-surface-200 p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <h5 class="m-0 text-[0.85rem]">
                {{
                  t('formBuilder.cloneRelatedNestedPair', 'Nested pair {n}', {
                    n: nestedIndex + 1,
                  })
                }}
              </h5>
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                :aria-label="t('common.remove', 'Remove')"
                @click="removeNestedPair(pair, nestedIndex)"
              />
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold">
                {{ t('formBuilder.cloneRelatedSourceCollection', 'Source collection') }}
                <Select
                  :model-value="nested.sourceCollection"
                  :options="nestedSourceOptionsForParent(pair)"
                  option-label="label"
                  option-value="value"
                  filter
                  fluid
                  :disabled="!pair.sourceCollection"
                  :placeholder="
                    pair.sourceCollection
                      ? t('formBuilder.cloneRelatedNestedSourcePlaceholder', 'Select nested source…')
                      : t('formBuilder.cloneRelatedPickSourceFirst', 'Pick source first')
                  "
                  @update:model-value="onSourceCollectionChange(nested, $event)"
                />
              </label>
              <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold">
                {{ t('formBuilder.cloneRelatedTargetCollection', 'Target collection') }}
                <Select
                  v-model="nested.targetCollection"
                  :options="nestedTargetOptionsForParent(pair)"
                  option-label="label"
                  option-value="value"
                  filter
                  fluid
                  :disabled="!pair.targetCollection"
                  :placeholder="
                    pair.targetCollection
                      ? t('formBuilder.cloneRelatedTargetPlaceholder', 'Select target…')
                      : t('formBuilder.cloneRelatedPickParentTargetFirst', 'Pick parent target first')
                  "
                />
              </label>
              <label class="grid gap-[0.35rem] text-[0.8rem] font-semibold md:col-span-2">
                {{ t('formBuilder.cloneRelatedSkipFields', 'Skip fields') }}
                <MultiSelect
                  :model-value="nested.skipFields ?? []"
                  :options="pairFieldOptions[index]?.nested?.[nestedIndex]?.target ?? []"
                  option-label="label"
                  option-value="value"
                  filter
                  display="chip"
                  fluid
                  :placeholder="
                    t('formBuilder.cloneRelatedSkipFieldsPlaceholder', 'Select fields to skip')
                  "
                  @update:model-value="setSkipFields(nested, $event)"
                />
              </label>
            </div>

            <div class="grid gap-2">
              <div class="flex items-center justify-between">
                <span class="text-[0.8rem] font-semibold">
                  {{
                    t('formBuilder.cloneRelatedFieldMap', 'Field map overrides (source → target)')
                  }}
                </span>
                <Button
                  :label="t('formBuilder.cloneRelatedAddFieldMap', 'Add override')"
                  icon="pi pi-plus"
                  text
                  size="small"
                  @click="addFieldMapRow(nested)"
                />
              </div>
              <div
                v-for="(row, rowIndex) in fieldMapDraft(nested)"
                :key="`nested-map-${index}-${nestedIndex}-${rowIndex}`"
                class="flex flex-wrap items-center gap-2"
              >
                <Select
                  :model-value="row.source"
                  :options="pairFieldOptions[index]?.nested?.[nestedIndex]?.source ?? []"
                  option-label="label"
                  option-value="value"
                  filter
                  editable
                  class="min-w-[10rem] flex-1"
                  :placeholder="t('formBuilder.cloneRelatedSourceField', 'Source field')"
                  @update:model-value="
                    updateFieldMapDraft(nested, rowIndex, { source: String($event ?? '') })
                  "
                />
                <span class="text-muted-color">→</span>
                <Select
                  :model-value="row.target"
                  :options="pairFieldOptions[index]?.nested?.[nestedIndex]?.target ?? []"
                  option-label="label"
                  option-value="value"
                  filter
                  editable
                  class="min-w-[10rem] flex-1"
                  :placeholder="t('formBuilder.cloneRelatedTargetField', 'Target field')"
                  @update:model-value="
                    updateFieldMapDraft(nested, rowIndex, { target: String($event ?? '') })
                  "
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  text
                  @click="removeFieldMapRow(nested, rowIndex)"
                />
              </div>
            </div>
          </div>

          <Button
            :label="t('formBuilder.cloneRelatedAddNestedPair', 'Add nested child pair')"
            icon="pi pi-plus"
            text
            size="small"
            class="mt-3 justify-self-start"
            @click="addNestedPair(pair)"
          />
        </details>
      </div>

      <Button
        :label="t('formBuilder.cloneRelatedAddPair', 'Add child pair')"
        icon="pi pi-plus"
        text
        size="small"
        class="justify-self-start"
        @click="addPair"
      />
    </div>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="dialogVisible = false"
      />
      <Button :label="t('common.save', 'Save')" @click="save" />
    </template>
  </Dialog>
</template>
