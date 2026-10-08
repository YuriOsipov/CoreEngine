<script lang="ts">
export default {
  name: 'TreeTableSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TreeTableSettings } from '@/interfaces'
import type { FieldDefinition } from '@/interfaces'
import {
  getCachedCollectionFields,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import {
  loadTreeTableSettings,
  normalizeTreeTableSettings,
  saveTreeTableSettings,
} from '@/modules/entities/services/treeTableSettings'
import { useTranslation } from '@/core/translation'
import { fieldSelectOptions } from '@/core/fieldOptions'

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
  () => settings.value.main.collection,
  async (collection) => {
    await loadCollectionFields(collection, itemFields)
    if (collection && !props.builderManaged) {
      await syncSavedSettings(collection)
    }
  },
  { immediate: true },
)

void loadCollections()

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
          {{ t('treeSettings.mainGroupField', 'Main group FK field') }}
          <Select
            :model-value="settings.main.groupField"
            :options="itemFieldOptions"
            option-label="label"
            option-value="value"
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
</style>
