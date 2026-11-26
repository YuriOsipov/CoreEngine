<script lang="ts">
export default {
  name: 'CreateRecordMappingsDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EntityActionCreateRecordFieldMapping } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'

type FieldOption = { label: string; value: string }

const props = defineProps<{
  visible: boolean
  actionLabel?: string
  sourceCollection: string
  targetCollection: string
  mappings: EntityActionCreateRecordFieldMapping[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  save: [mappings: EntityActionCreateRecordFieldMapping[]]
}>()

const { t } = useTranslation()

const dialogVisible = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

const draft = ref<EntityActionCreateRecordFieldMapping[]>([])
const sourceFieldOptions = ref<FieldOption[]>([])
const targetFieldOptions = ref<FieldOption[]>([])
const loading = ref(false)

const SOURCE_OPTIONS = computed(() => [
  { label: t('formBuilder.createRecordSourceField', 'From source field'), value: 'field' },
  { label: t('formBuilder.createRecordSourceStatic', 'Static value'), value: 'static' },
])

const TRANSFORM_OPTIONS = computed(() => [
  { label: t('formBuilder.createRecordTransformNone', 'None'), value: 'none' },
  {
    label: t('formBuilder.createRecordTransformQuoteLines', 'Quote lines (> )'),
    value: 'quoteLines',
  },
  {
    label: t('formBuilder.createRecordTransformSubjectPrefix', 'Subject prefix'),
    value: 'subjectPrefix',
  },
])

const dialogHeader = computed(() => {
  const label = props.actionLabel?.trim()
  if (label) {
    return t('formBuilder.createRecordMappingsDialogTitle', 'Field mappings · {label}', {
      label,
    })
  }
  return t('formBuilder.createRecordMappingsDialogTitleDefault', 'Field mappings')
})

function emptyMapping(): EntityActionCreateRecordFieldMapping {
  return {
    targetField: '',
    source: 'field',
    sourceField: '',
    transform: 'none',
  }
}

function cloneMappings(
  mappings: EntityActionCreateRecordFieldMapping[],
): EntityActionCreateRecordFieldMapping[] {
  return mappings.map((row) => ({
    ...row,
    sourceFields: Array.isArray(row.sourceFields) ? [...row.sourceFields] : undefined,
  }))
}

async function loadFieldOptions(): Promise<void> {
  loading.value = true
  try {
    const sourceName = String(props.sourceCollection ?? '').trim()
    const targetName = String(props.targetCollection ?? '').trim()
    const [sourceFields, targetFields] = await Promise.all([
      sourceName
        ? getCachedCollectionFields(sourceName).catch(() => [])
        : Promise.resolve([]),
      targetName
        ? getCachedCollectionFields(targetName).catch(() => [])
        : Promise.resolve([]),
    ])
    sourceFieldOptions.value = sourceFields
      .map((field) => ({
        label: String(field.meta?.note || field.field),
        value: field.field,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    targetFieldOptions.value = targetFields
      .map((field) => ({
        label: String(field.meta?.note || field.field),
        value: field.field,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    draft.value = cloneMappings(props.mappings ?? [])
    void loadFieldOptions()
  },
)

watch(
  () => [props.sourceCollection, props.targetCollection] as const,
  () => {
    if (!props.visible) return
    void loadFieldOptions()
  },
)

function addMapping(): void {
  draft.value = [...draft.value, emptyMapping()]
}

function updateMapping(
  index: number,
  patch: Partial<EntityActionCreateRecordFieldMapping>,
): void {
  const next = [...draft.value]
  const current = next[index]
  if (!current) return
  next[index] = { ...current, ...patch }
  draft.value = next
}

function removeMapping(index: number): void {
  const next = [...draft.value]
  next.splice(index, 1)
  draft.value = next
}

function save(): void {
  emit('save', cloneMappings(draft.value))
  dialogVisible.value = false
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogHeader"
    class="create-record-mappings-dialog"
    :style="{ width: 'min(640px, 95vw)' }"
    :breakpoints="{ '960px': '95vw' }"
  >
    <p class="m-0 mb-3 text-[0.8rem] text-muted-color">
      {{
        t(
          'formBuilder.createRecordMappingsDialogHint',
          'Map target fields from the source record or set static values. Tokens: $ME, $ME_EMAIL, $NOW, $NULL.',
        )
      }}
    </p>

    <div v-if="loading" class="py-4 text-center text-muted-color text-sm">
      {{ t('common.loading', 'Loading…') }}
    </div>

    <div v-else class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pe-1">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[0.85rem] font-medium">
          {{ t('formBuilder.createRecordMappings', 'Field mappings') }}
        </span>
        <Button
          :label="t('formBuilder.createRecordAddMapping', '+ Mapping')"
          size="small"
          severity="secondary"
          text
          :disabled="!String(targetCollection || '').trim()"
          @click="addMapping"
        />
      </div>

      <p
        v-if="!String(targetCollection || '').trim()"
        class="m-0 text-muted-color text-[0.75rem]"
      >
        {{
          t(
            'formBuilder.createRecordMissingTarget',
            'Select a target object for this action.',
          )
        }}
      </p>

      <div
        v-for="(mapping, index) in draft"
        :key="`crmap-dialog-${index}`"
        class="flex flex-col gap-[0.35rem] rounded border border-line p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-[0.75rem] text-muted-color">
            {{ t('formBuilder.createRecordMappingN', 'Mapping {n}', { n: index + 1 }) }}
          </span>
          <Button
            icon="pi pi-trash"
            size="small"
            severity="danger"
            text
            rounded
            @click="removeMapping(index)"
          />
        </div>
        <Select
          overlay-class="property-select-overlay"
          :model-value="mapping.targetField"
          :options="targetFieldOptions"
          option-label="label"
          option-value="value"
          :placeholder="t('formBuilder.createRecordTargetField', 'Target field')"
          filter
          fluid
          @update:model-value="
            (value: string) => updateMapping(index, { targetField: value })
          "
        />
        <Select
          overlay-class="property-select-overlay"
          :model-value="mapping.source"
          :options="SOURCE_OPTIONS"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="
            (value: 'field' | 'static') => updateMapping(index, { source: value })
          "
        />
        <Select
          v-if="mapping.source === 'field'"
          overlay-class="property-select-overlay"
          :model-value="mapping.sourceField ?? mapping.sourceFields?.[0] ?? ''"
          :options="sourceFieldOptions"
          option-label="label"
          option-value="value"
          :placeholder="t('formBuilder.createRecordSourceFieldPick', 'Source field')"
          filter
          fluid
          @update:model-value="
            (value: string) =>
              updateMapping(index, { sourceField: value, sourceFields: undefined })
          "
        />
        <InputText
          v-if="mapping.source === 'field'"
          :model-value="(mapping.sourceFields ?? []).join(', ')"
          :placeholder="
            t('formBuilder.createRecordSourceFields', 'Fallback fields (comma-separated)')
          "
          fluid
          @update:model-value="
            (value: string | undefined) => {
              const parts = String(value ?? '')
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean)
              updateMapping(index, {
                sourceFields: parts.length ? parts : undefined,
              })
            }
          "
        />
        <InputText
          v-else
          :model-value="mapping.value == null ? '' : String(mapping.value)"
          :placeholder="
            t('formBuilder.createRecordStaticValue', 'Static value ($ME, $NULL, …)')
          "
          fluid
          @update:model-value="
            (value: string | undefined) => updateMapping(index, { value: value ?? '' })
          "
        />
        <Select
          overlay-class="property-select-overlay"
          :model-value="mapping.transform ?? 'none'"
          :options="TRANSFORM_OPTIONS"
          option-label="label"
          option-value="value"
          fluid
          @update:model-value="
            (value: 'none' | 'quoteLines' | 'subjectPrefix') =>
              updateMapping(index, { transform: value })
          "
        />
        <InputText
          v-if="mapping.transform === 'subjectPrefix'"
          :model-value="mapping.prefix ?? ''"
          :placeholder="t('formBuilder.createRecordPrefix', 'Prefix (Re: / Fwd:)')"
          fluid
          @update:model-value="
            (value: string | undefined) => updateMapping(index, { prefix: value ?? '' })
          "
        />
      </div>

      <p v-if="draft.length === 0" class="m-0 text-muted-color text-[0.75rem]">
        {{ t('formBuilder.createRecordNoMappings', 'No field mappings yet.') }}
      </p>
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
