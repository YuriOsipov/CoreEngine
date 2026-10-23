<script lang="ts">
export default {
  name: 'TreeTableSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TreeTableSettings } from '@/interfaces'
import type { FieldDefinition, RelationDefinition } from '@/interfaces'
import {
  getCachedCollectionFields,
  getCachedRelations,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import {
  loadTreeTableSettings,
  normalizeTreeTableSettings,
  saveTreeTableSettings,
} from '@/modules/entities/services/treeTableSettings'
import { useTranslation } from '@/core/translation'
import { fieldSelectOptions, type FieldOption } from '@/core/fieldOptions'
import {
  keysEqual,
  relatedCollectionForCollectionField,
} from '@/core/relationHelpers'
import {
  isFieldM2O,
  resolveCollectionKey,
} from '@/modules/entities/utils/relatedTransferSchema'

const props = defineProps<{
  modelValue: TreeTableSettings
  collection?: string
  builderManaged?: boolean
}>()
const { t } = useTranslation()

const emit = defineEmits<{
  'update:modelValue': [settings: TreeTableSettings]
}>()

const collections = ref<Array<{ label: string; value: string }>>([])
const groupFields = ref<FieldDefinition[]>([])
const itemFields = ref<FieldDefinition[]>([])
const itemNestedFieldsByCollection = ref<Record<string, FieldDefinition[]>>({})
const relationDefinitions = ref<RelationDefinition[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const status = ref<string | null>(null)

const settings = computed(() => {
  const normalized = normalizeTreeTableSettings(props.modelValue)
  if (!props.collection) return normalized

  return normalizeTreeTableSettings({
    ...normalized,
    main: {
      ...normalized.main,
      collection: props.collection,
    },
  })
})
const groupFieldOptions = computed(() => fieldSelectOptions(groupFields.value))
const itemFieldOptions = computed(() => fieldSelectOptions(itemFields.value))
/** Direct + one-hop M2O paths that point at the configured group collection. */
const mainGroupFieldOptions = computed(() =>
  m2oFieldOptionsForCollection(
    settings.value.main.collection,
    itemFields.value,
    settings.value.group.collection,
    itemNestedFieldsByCollection.value,
  ),
)
const optionalGroupParentOptions = computed(() => [
  { label: t('treeSettings.noHierarchy', 'No hierarchy'), value: '' },
  ...groupFieldOptions.value,
])

watch(
  () => settings.value.group.collection,
  (collection) => {
    void loadCollectionFields(collection, groupFields)
  },
  { immediate: true },
)

watch(
  () => [
    settings.value.main.collection,
    relationDefinitions.value.length,
  ],
  async ([collection]) => {
    await loadMainFieldsWithNested(String(collection ?? ''))
    if (collection && !props.builderManaged) {
      await syncSavedSettings(String(collection))
    }
  },
  { immediate: true },
)

void loadCollections()
void loadRelations()

async function loadCollections(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    collections.value = await listUserCollections()
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('treeSettings.loadCollectionsError', 'Failed to load collections.')
  } finally {
    loading.value = false
  }
}

async function loadRelations(): Promise<void> {
  try {
    relationDefinitions.value = await getCachedRelations() as RelationDefinition[]
  } catch {
    relationDefinitions.value = []
  }
}

async function syncSavedSettings(collection: string): Promise<void> {
  const saved = await loadTreeTableSettings(collection)
  if (!saved) return

  const current = settings.value
  if (current.main.collection === collection && !current.group.collection) {
    emit('update:modelValue', saved)
  }
}

async function loadCollectionFields(
  collection: string,
  target: typeof groupFields,
): Promise<void> {
  if (!collection) {
    target.value = []
    return
  }

  try {
    target.value = await getCachedCollectionFields(collection)
  } catch {
    target.value = []
  }
}

async function loadMainFieldsWithNested(collection: string): Promise<void> {
  if (!collection) {
    itemFields.value = []
    itemNestedFieldsByCollection.value = {}
    return
  }

  try {
    const resolved = await resolveCollectionKey(collection)
    itemFields.value = await getCachedCollectionFields(resolved)
    const relatedCollections = itemFields.value
      .map((field) => relatedCollectionOf(resolved, field))
      .filter(Boolean)
    const nestedEntries = await Promise.all(
      Array.from(new Set(relatedCollections)).map(async (relatedCollection) => [
        relatedCollection,
        await getCachedCollectionFields(await resolveCollectionKey(relatedCollection)),
      ] as const),
    )
    itemNestedFieldsByCollection.value = Object.fromEntries(nestedEntries)
  } catch {
    itemFields.value = []
    itemNestedFieldsByCollection.value = {}
  }
}

function relatedCollectionOf(collection: string, field: FieldDefinition): string {
  return relatedCollectionForCollectionField(
    relationDefinitions.value,
    collection,
    field.field,
  ) || field.schema?.foreign_key_table || ''
}

function m2oFieldsPointingAt(
  collection: string,
  fields: FieldDefinition[],
  targetCollection: string,
): FieldDefinition[] {
  if (!collection || !targetCollection) return []
  return fields.filter((field) => {
    if (!isFieldM2O(collection, field.field, fields, relationDefinitions.value)) {
      return false
    }
    return keysEqual(relatedCollectionOf(collection, field), targetCollection)
  })
}

/** Direct and one-hop M2O fields whose related collection is `targetCollection`. */
function m2oFieldOptionsForCollection(
  collection: string,
  fields: FieldDefinition[],
  targetCollection: string,
  nestedFieldsByCollection: Record<string, FieldDefinition[]> = {},
): FieldOption[] {
  if (!collection || !targetCollection) return []

  const direct = fieldSelectOptions(m2oFieldsPointingAt(collection, fields, targetCollection))
  const nested = fields.flatMap((field) => {
    if (!isFieldM2O(collection, field.field, fields, relationDefinitions.value)) {
      return []
    }
    const relatedCollection = relatedCollectionOf(collection, field)
    if (!relatedCollection || keysEqual(relatedCollection, targetCollection)) {
      return []
    }
    const [base] = fieldSelectOptions([field])
    if (!base) return []
    const nestedFields = nestedFieldsByCollection[relatedCollection] ?? []
    return fieldSelectOptions(
      m2oFieldsPointingAt(relatedCollection, nestedFields, targetCollection),
    ).map((nestedField) => ({
      label: `${base.label} / ${nestedField.label}`,
      value: `${field.field}.${nestedField.value}`,
    }))
  })

  return [...direct, ...nested]
}

function hintTooltip(value: string) {
  return { value, class: 'tree-settings-hint-tooltip' }
}

function updateSettings(patch: Partial<TreeTableSettings>): void {
  emit('update:modelValue', normalizeTreeTableSettings({
    ...settings.value,
    ...patch,
  }))
  status.value = null
}

function updateGroupSettings(
  patch: Partial<TreeTableSettings['group']>,
): void {
  updateSettings({
    group: {
      ...settings.value.group,
      ...patch,
    },
  })
}

function updateMainSettings(
  patch: Partial<TreeTableSettings['main']>,
): void {
  updateSettings({
    main: {
      ...settings.value.main,
      ...patch,
    },
  })
}

function updateMainDisplayFields(fields: unknown): void {
  const labelFields = Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === 'string')
    : []

  updateMainSettings({
    labelField: labelFields[0] ?? 'name',
    labelFields,
  })
}

const sortFieldOptions = computed(() => [
  { label: t('treeSettings.noSort', 'No sort'), value: '' },
  ...itemFieldOptions.value,
])

const sortOrderOptions = computed(() => [
  { label: t('tableSettings.ascending', 'Ascending'), value: 1 },
  { label: t('tableSettings.descending', 'Descending'), value: -1 },
])

const mainSortField = computed({
  get: () => settings.value.main.sort?.field ?? '',
  set: (field: string) => {
    const next = String(field ?? '').trim()
    if (!next) {
      updateMainSettings({ sort: null })
      return
    }
    updateMainSettings({
      sort: {
        field: next,
        order: settings.value.main.sort?.order === -1 ? -1 : 1,
      },
    })
  },
})

const mainSortOrder = computed({
  get: () => settings.value.main.sort?.order ?? 1,
  set: (order: 1 | -1) => {
    const field = settings.value.main.sort?.field?.trim()
    if (!field) return
    updateMainSettings({
      sort: { field, order: order === -1 ? -1 : 1 },
    })
  },
})

async function saveSettings(): Promise<void> {
  saving.value = true
  error.value = null
  status.value = null
  try {
    await saveTreeTableSettings(settings.value)
    status.value = t('treeSettings.saved', 'Tree settings saved.')
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('treeSettings.saveError', 'Failed to save tree settings.')
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <div class="tree-settings-designer flex min-h-0 w-full flex-col gap-1">
    <div
      v-if="loading"
      class="tree-settings-designer__loading flex items-center gap-3 text-muted-color"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('treeSettings.loadingCollections', 'Loading collections...') }}</span>
    </div>

    <Message
      v-if="error"
      severity="error"
      :closable="false"
    >
      {{ error }}
    </Message>
    <Message
      v-if="status"
      severity="success"
      :closable="false"
    >
      {{ status }}
    </Message>

    <section class="tree-settings-panel">
      <h3 class="tree-settings-panel__title m-0">{{ t('treeSettings.group', 'Group') }}</h3>
      <div class="tree-settings-panel__grid">
        <label class="tree-settings-field">
          {{ t('treeSettings.groupCollection', 'Group collection') }}
          <Select
            :model-value="settings.group.collection"
            :options="collections"
            option-label="label"
            option-value="value"
            :placeholder="t('common.selectCollection', 'Select collection')"
            fluid
            @update:model-value="updateGroupSettings({ collection: String($event) })"
          />
        </label>

        <label class="tree-settings-field">
          {{ t('treeSettings.groupPrimaryKey', 'Group primary key') }}
          <Select
            :model-value="settings.group.primaryKey"
            :options="groupFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateGroupSettings({ primaryKey: String($event) })"
          />
        </label>

        <label class="tree-settings-field">
          {{ t('treeSettings.groupLabelField', 'Group label field') }}
          <Select
            :model-value="settings.group.labelField"
            :options="groupFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateGroupSettings({ labelField: String($event) })"
          />
        </label>

        <label class="tree-settings-field">
          {{ t('treeSettings.groupParentField', 'Group parent field') }}
          <Select
            :model-value="settings.group.parentField ?? ''"
            :options="optionalGroupParentOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="
              updateGroupSettings({ parentField: $event ? String($event) : null })
            "
          />
        </label>
      </div>
    </section>

    <section class="tree-settings-panel">
      <h3 class="tree-settings-panel__title m-0">{{ t('treeSettings.main', 'Main') }}</h3>
      <div class="tree-settings-panel__grid">
        <label
          v-if="!collection"
          class="tree-settings-field"
        >
          {{ t('treeSettings.mainCollection', 'Main collection') }}
          <Select
            :model-value="settings.main.collection"
            :options="collections"
            option-label="label"
            option-value="value"
            :placeholder="t('common.selectCollection', 'Select collection')"
            fluid
            @update:model-value="updateMainSettings({ collection: String($event) })"
          />
        </label>

        <label class="tree-settings-field">
          <span class="inline-flex items-center gap-1">
            {{ t('treeSettings.mainGroupField', 'Main group FK field') }}
            <button
              type="button"
              class="tree-settings-hint"
              v-tooltip.bottom="hintTooltip(t(
                'treeSettings.mainGroupFieldHint',
                'Field on the main object that points at the group collection. Use a nested path when the link goes through another M2O (e.g. Item / Item group → item.item_group).',
              ))"
              :aria-label="t('common.moreInfo', 'More information')"
            />
          </span>
          <Select
            :model-value="settings.main.groupField"
            :options="mainGroupFieldOptions"
            option-label="label"
            option-value="value"
            filter
            fluid
            @update:model-value="updateMainSettings({ groupField: String($event) })"
          />
        </label>

        <label class="tree-settings-field">
          {{ t('treeSettings.mainPrimaryKey', 'Main primary key') }}
          <Select
            :model-value="settings.main.primaryKey"
            :options="itemFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateMainSettings({ primaryKey: String($event) })"
          />
        </label>

        <label class="tree-settings-field tree-settings-field--wide">
          {{ t('treeSettings.mainDisplayFields', 'Main display fields') }}
          <MultiSelect
            :model-value="settings.main.labelFields"
            :options="itemFieldOptions"
            option-label="label"
            option-value="value"
            display="chip"
            fluid
            @update:model-value="updateMainDisplayFields"
          />
        </label>

        <label class="tree-settings-field tree-settings-field--wide">
          {{ t('treeSettings.mainDefaultSort', 'Default item sort') }}
          <div class="flex items-center gap-2 min-w-0">
            <Select
              v-model="mainSortField"
              class="flex-1 min-w-0"
              :options="sortFieldOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('tableSettings.sortField', 'Sort field')"
              fluid
            />
            <Select
              v-model="mainSortOrder"
              class="w-[8.5rem] flex-shrink-0"
              :options="sortOrderOptions"
              option-label="label"
              option-value="value"
              :disabled="!mainSortField"
            />
          </div>
        </label>
      </div>
    </section>

    <div
      v-if="!builderManaged"
      class="flex items-center gap-3"
    >
      <Button
        :label="t('treeSettings.saveSettings', 'Save tree settings')"
        size="small"
        severity="secondary"
        text
        :loading="saving"
        :disabled="!settings.main.collection || !settings.group.collection"
        @click="saveSettings"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-settings-designer {
  --tree-wash: #edf3f4;
  --tree-ink: #37352f;
  font-family: Inter, system-ui, sans-serif;
  color: var(--tree-ink);
}

.tree-settings-designer__loading :deep(.p-progressspinner) {
  height: 1.5rem;
  width: 1.5rem;
}

.tree-settings-panel {
  width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 0.65rem;
  border-radius: 8px;
  background: var(--tree-wash);
  padding: 0.55rem 0.5rem 0.65rem;
}

.tree-settings-panel__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.tree-settings-panel__grid {
  display: grid;
  gap: 0.5rem 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.tree-settings-field {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.tree-settings-field--wide {
  grid-column: 1 / -1;
}

.tree-settings-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.28);
  border-radius: 999px;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.tree-settings-hint::before {
  content: 'i';
}

.tree-settings-hint:focus-visible {
  outline: 2px solid var(--p-primary-color, #3b82f6);
  outline-offset: 1px;
}
</style>

<style>
.tree-settings-hint-tooltip,
.tree-settings-hint-tooltip .p-tooltip-text {
  max-width: 22rem;
}
</style>
