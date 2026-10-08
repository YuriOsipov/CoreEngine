<script lang="ts">
export default {
  name: 'M2ASettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FieldDefinition, M2ABlockDisplayField, M2ASettings } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { humanizeFieldName } from '@/modules/entities/utils/recordDisplay'
import {
  collectionDisplayLabel,
  fetchM2AMetadata,
} from '@/modules/entities/utils/m2aSchema'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'
import {
  DEFAULT_RELATED_ROW_LIMIT,
  resolveConfiguredRowLimit,
} from '@/modules/entities/services/tableSettings'
import { keysEqual } from '@/core/relationHelpers'
import { mapFieldTypeToComponent, isFieldReadonly } from '@/modules/entities/utils/fieldMapper'
import { isRepeaterFieldDefinition } from '@/core/repeaterField'

const props = defineProps<{
  modelValue: M2ASettings
  parentCollection: string
  fieldName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [M2ASettings]
}>()

const { t } = useTranslation()

const loading = ref(false)
const error = ref<string | null>(null)
const allowedCollections = ref<string[]>([])
const collectionLabels = ref<Record<string, string>>({})
const fieldsByCollection = ref<Record<string, Array<{ label: string; value: string }>>>({})

function normalizeSettings(settings: M2ASettings): M2ASettings {
  const rowLimit = resolveConfiguredRowLimit(settings.rowLimit)
  const blockFields = (settings.blockFields ?? [])
    .filter(
      (entry): entry is M2ABlockDisplayField =>
        Boolean(entry?.collection) && Array.isArray(entry.fields) && entry.fields.length > 0,
    )
    .map((entry) => ({
      collection: entry.collection,
      fields: entry.fields.filter(Boolean),
    }))

  const next: M2ASettings = {}
  if (rowLimit !== DEFAULT_RELATED_ROW_LIMIT) {
    next.rowLimit = rowLimit
  }
  if (blockFields.length > 0) {
    next.blockFields = blockFields
  }
  return next
}

function emitSettings(patch: Partial<M2ASettings>): void {
  emit('update:modelValue', normalizeSettings({ ...props.modelValue, ...patch }))
}

const rowLimit = computed({
  get: () => resolveConfiguredRowLimit(props.modelValue.rowLimit),
  set: (value: number | null) => {
    emitSettings({ rowLimit: value ?? DEFAULT_RELATED_ROW_LIMIT })
  },
})

function fieldsForCollection(collection: string): string[] {
  const entry = props.modelValue.blockFields?.find((item) =>
    keysEqual(item.collection, collection),
  )
  return entry?.fields ?? []
}

function setFieldsForCollection(collection: string, fields: string[]): void {
  const others =
    props.modelValue.blockFields?.filter(
      (item) => !keysEqual(item.collection, collection),
    ) ?? []
  const nextBlockFields =
    fields.length > 0
      ? [...others, { collection, fields }]
      : others
  emitSettings({ blockFields: nextBlockFields })
}

function eligibleFieldOptions(fields: FieldDefinition[]): Array<{ label: string; value: string }> {
  return fields
    .filter((field) => {
      if (field.meta?.hidden) return false
      if (field.schema?.is_primary_key) return false
      if (isFieldReadonly(field)) return false
      if (isRepeaterFieldDefinition(field)) return false
      return mapFieldTypeToComponent(field) !== null
    })
    .map((field) => ({
      value: field.field,
      label: field.meta?.note?.trim() || humanizeFieldName(field.field),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

async function loadMetadata(): Promise<void> {
  if (!props.parentCollection || !props.fieldName) {
    allowedCollections.value = []
    fieldsByCollection.value = {}
    return
  }

  loading.value = true
  error.value = null
  try {
    const metadata = await fetchM2AMetadata(props.parentCollection, props.fieldName)
    const collections = metadata?.allowedCollections?.filter(Boolean) ?? []
    allowedCollections.value = collections

    const labels: Record<string, string> = {}
    const options: Record<string, Array<{ label: string; value: string }>> = {}

    await Promise.all(
      collections.map(async (collection) => {
        labels[collection] = await collectionDisplayLabel(collection)
        const fields = await getCachedCollectionFields(collection)
        options[collection] = eligibleFieldOptions(fields as FieldDefinition[])
      }),
    )

    collectionLabels.value = labels
    fieldsByCollection.value = options
  } catch (err) {
    allowedCollections.value = []
    fieldsByCollection.value = {}
    error.value =
      err instanceof Error
        ? err.message
        : t('m2aSettings.loadError', 'Failed to load M2A settings.')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.parentCollection, props.fieldName] as const,
  () => {
    void loadMetadata()
  },
  { immediate: true },
)
</script>

<template>
  <div class="grid gap-3">
    <p v-if="loading" class="m-0 text-[0.85rem] text-muted-color">
      {{ t('m2aSettings.loading', 'Loading block types…') }}
    </p>
    <Message v-else-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div class="grid gap-2">
      <label class="text-[0.85rem] font-medium" for="m2a-row-limit">
        {{ t('m2aSettings.rowLimit', 'Visible rows') }}
      </label>
      <InputNumber
        id="m2a-row-limit"
        v-model="rowLimit"
        :min="1"
        :max="100"
        show-buttons
        class="w-full"
      />
      <p class="m-0 text-[0.8rem] text-muted-color">
        {{
          t(
            'm2aSettings.rowLimitHint',
            'How many blocks show in the embedded list before “view all”. Default is {count}.',
            { count: DEFAULT_RELATED_ROW_LIMIT },
          )
        }}
      </p>
    </div>

    <div class="grid gap-2">
      <h4 class="text-[0.85rem] font-medium m-0">
        {{ t('m2aSettings.blockTypes', 'Block types') }}
      </h4>
      <p
        v-if="!loading && !error && allowedCollections.length === 0"
        class="m-0 text-[0.85rem] text-muted-color"
      >
        {{ t('m2aSettings.noCollections', 'No allowed block collections found for this field.') }}
      </p>
      <div
        v-for="collection in allowedCollections"
        :key="collection"
        class="grid gap-2 border border-surface-200 rounded-md p-3"
      >
        <label class="text-[0.85rem] font-medium">
          {{
            t('m2aSettings.fieldsFor', 'Editable fields · {collection}', {
              collection: collectionLabels[collection] || collection,
            })
          }}
        </label>
        <MultiSelect
          :model-value="fieldsForCollection(collection)"
          :options="fieldsByCollection[collection] ?? []"
          option-label="label"
          option-value="value"
          display="chip"
          filter
          class="w-full"
          :placeholder="t('m2aSettings.fieldsPlaceholder', 'Default fields (auto)')"
          @update:model-value="setFieldsForCollection(collection, ($event as string[]) ?? [])"
        />
      </div>
    </div>
  </div>
</template>
