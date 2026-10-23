<script lang="ts">
export default {
  name: 'FormRenderer',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { normalizeEntityFormDraft } from '@/core/entityFormValues'
import {
  collectFormulaDependencies,
} from '@/core/calculatedFields'
import {
  computeFormPreviewValues,
  hasPreviewValue,
  resolvePreviewFormulas,
} from '@/core/formPreviewValues'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import CrmM2MMultiSelect from '@/core/ui-kit/CrmM2MMultiSelect.vue'
import CrmChildLookupField from '@/core/ui-kit/CrmChildLookupField.vue'
import CrmScheduler from '@/core/ui-kit/CrmScheduler.vue'
import CrmTreeTable from '@/core/ui-kit/CrmTreeTable.vue'
import ScheduleTemplateEditor from '@/core/ui-kit/ScheduleTemplateEditor.vue'
import CrmAddressField from '@/core/ui-kit/CrmAddressField.vue'
import CrmJsonListField from '@/core/ui-kit/CrmJsonListField.vue'
import CrmJsonCodeField from '@/core/ui-kit/CrmJsonCodeField.vue'
import CrmSensitivityMatrixField from '@/core/ui-kit/CrmSensitivityMatrixField.vue'
import CrmDynamicPicklist from '@/core/ui-kit/CrmDynamicPicklist.vue'
import {
  isDynamicPicklistSource,
  type DynamicPicklistSource,
} from '@/core/dynamicPicklist'
import type { JsonListColumn } from '@/core/jsonField'
import {
  defaultSensitivitySource,
  parseSensitivitySource,
  type SensitivitySource,
} from '@/core/sensitivityField'
import RelatedDataTableField from '@/modules/entities/components/RelatedDataTableField.vue'
import M2ABlocksField from '@/modules/entities/components/M2ABlocksField.vue'
import AttachedDataTableField from '@/modules/entities/components/AttachedDataTableField.vue'
import type {
  EntityLayoutSchema,
  FieldDefinition,
  LayoutFieldChildLookup,
  LayoutFieldMetadata,
} from '@/interfaces'
import { resolvePrimeVueComponent } from '@/core/primevue'
import { defaultValueForField } from '@/modules/entities/utils/fieldDefaults'
import { useFieldLabels } from '@/core/useFieldLabels'
import { useRuntimeFieldMetadata } from '@/core/useRuntimeFieldMetadata'
import { useAutoComplete } from '@/core/useAutoComplete'
import { useTranslation } from '@/core/translation'
import { bridgeReadItem } from '@/core/graphql/itemsBridge'
import {
  defaultFromParentTargetsForRelation,
  resolveDefaultFromParentDefinitions,
} from '@/core/entityLayoutUtils'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import { loadChildLookupFieldSettings } from '@/modules/config/services/layoutSettings'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import {
  gridStyle,
  isAutoCompleteField,
  isAddressField,
  isCheckboxField,
  isDataTableField,
  isFilesField,
  isFullWidthLayoutField,
  isGroupInlineLabels,
  isJsonCodeField,
  isJsonListField,
  isSensitivityMatrixField,
  isM2ABuilderField,
  isM2MMultiSelectField,
  isRelationPickerField,
  isRepeaterField,
  isSchedulerField,
  isTreeTableField,
  sectionLabel,
  treeTableValue,
} from '@/core/fieldHelpers'
import { buildComponentProps } from '@/core/buildComponentProps'
import { isEditableFormLayoutField } from '@/core/layoutFieldRules'
import {
  isBlankFormValue,
  type FormRequiredValidationResult,
} from '@/core/formRequiredValidation'
import {
  collectShowIfRootFields,
  filterVisibleLayoutGroups,
  filterVisibleLayoutSections,
} from '@/core/recordConditionMatch'
import { useShowIfEvalRecord } from '@/core/useShowIfEvalRecord'
import { keysEqual } from '@/core/utils/object'

const props = defineProps<{
  schema: EntityLayoutSchema
  readonly?: boolean
  readonlyFields?: string[]
  /** Related-parent context (FK defaults / related tables) — not the edited record. */
  parentId?: string | number
  parentName?: string
  parentCollection?: string
  parentRecord?: Record<string, unknown>
  /** Id of the record being created/edited; enables M2A junction CRUD when set. */
  recordId?: string | number
}>()

const formState = defineModel<Record<string, unknown>>({ required: true })
const { t } = useTranslation()

const fieldLabels = useFieldLabels(() => props.schema.entity)
const runtimeMeta = useRuntimeFieldMetadata(() => props.schema.entity)
const autoComplete = useAutoComplete(formState)

const groupCollapsed = reactive<Record<string, boolean>>({})
const activeSectionId = ref<string | null>(null)

const { evalRecord: showIfEvalRecord } = useShowIfEvalRecord(
  () => props.schema,
  formState,
)

const visibleSections = computed(() =>
  filterVisibleLayoutSections(props.schema.sections, showIfEvalRecord.value),
)

const activeSectionIndex = computed({
  get: () => {
    const sections = visibleSections.value
    if (sections.length === 0) return 0
    const byId = activeSectionId.value
      ? sections.findIndex((section) => section.id === activeSectionId.value)
      : -1
    return byId >= 0 ? byId : 0
  },
  set: (index: number) => {
    activeSectionId.value = visibleSections.value[index]?.id ?? null
  },
})

const activeSection = computed(() => visibleSections.value[activeSectionIndex.value])

const visibleGroups = computed(() =>
  activeSection.value
    ? filterVisibleLayoutGroups(activeSection.value.groups, showIfEvalRecord.value)
    : [],
)

watch(
  visibleSections,
  (sections) => {
    if (sections.length === 0) {
      activeSectionId.value = null
      return
    }
    if (!activeSectionId.value || !sections.some((section) => section.id === activeSectionId.value)) {
      activeSectionId.value = sections[0]?.id ?? null
    }
  },
  { immediate: true },
)

watch(
  () => props.schema,
  (schema) => {
    for (const section of schema.sections) {
      for (const group of section.groups) {
        if (!(group.id in groupCollapsed)) {
          groupCollapsed[group.id] = group.collapsed ?? false
        }
      }
    }
  },
  { immediate: true, deep: false },
)

const visibleFields = computed(() =>
  props.schema.sections.reduce<LayoutFieldMetadata[]>(
    (fields, section) => [
      ...fields,
      ...section.groups.reduce<LayoutFieldMetadata[]>(
        (groupFields, group) => [
          ...groupFields,
          ...group.fields.filter(isEditableFormLayoutField),
        ],
        [],
      ),
    ],
    [],
  ),
)
const readonlyFieldNames = computed(() => new Set(props.readonlyFields ?? []))
const formStateTick = ref(0)
/** Canonical field-config child lookups (layout hydrate can miss some fields). */
const childLookupByField = ref<Record<string, LayoutFieldChildLookup>>({})
const childLookupM2OByField = ref<Record<string, boolean>>({})

watch(
  () =>
    [
      props.schema.entity,
      visibleFields.value.map((field) => field.field).join('\0'),
    ] as const,
  ([entity, fieldKey]) => {
    if (!entity || !fieldKey) {
      childLookupByField.value = {}
      return
    }
    void hydrateChildLookupSettings(entity)
  },
  { immediate: true },
)

async function hydrateChildLookupSettings(entity: string): Promise<void> {
  const fieldNames = visibleFields.value.map((field) => field.field)
  try {
    const [settings, definitions, relations] = await Promise.all([
      loadChildLookupFieldSettings(entity, fieldNames),
      getCachedCollectionFields(entity),
      getCachedRelations(),
    ])
    childLookupByField.value = settings
    const m2o: Record<string, boolean> = {}
    for (const name of Object.keys(settings)) {
      m2o[name] = isFieldM2O(entity, name, definitions, relations)
    }
    childLookupM2OByField.value = m2o
  } catch {
    childLookupByField.value = {}
    childLookupM2OByField.value = {}
  }
}

function childLookupFor(
  field: LayoutFieldMetadata,
): LayoutFieldChildLookup | undefined {
  if (field.childLookup) return field.childLookup
  if (childLookupByField.value[field.field]) {
    return childLookupByField.value[field.field]
  }
  return Object.entries(childLookupByField.value).find(([name]) =>
    keysEqual(name, field.field),
  )?.[1]
}

function isChildLookupValueField(field: LayoutFieldMetadata): boolean {
  const lookup = childLookupFor(field)
  if (!lookup) return false
  if (field.component === 'ChildLookup') return false
  if (childLookupM2OByField.value[field.field]) return false
  const m2oEntry = Object.entries(childLookupM2OByField.value).find(([name]) =>
    keysEqual(name, field.field),
  )
  if (m2oEntry?.[1]) return false
  return true
}

/** Clear scalar child-lookup fields (Price, Main price) when their source M2O is cleared. */
function clearChildLookupValuesForSource(sourceField: string): void {
  if (!sourceField) return
  let changed = false
  const next = { ...formState.value }
  for (const field of visibleFields.value) {
    if (!isChildLookupValueField(field)) continue
    const lookup = childLookupFor(field)
    if (!lookup?.sourceField || !keysEqual(lookup.sourceField, sourceField)) continue
    if (next[field.field] === null || next[field.field] === undefined) continue
    next[field.field] = null
    changed = true
  }
  if (!changed) return
  formState.value = next
  formStateTick.value += 1
}

const previewValues = computed(() => {
  void formStateTick.value
  void Object.keys(runtimeMeta.runtimeFormula).length

  const formulas = resolvePreviewFormulas(
    visibleFields.value,
    runtimeMeta.runtimeFormula,
  )
  for (const dep of collectFormulaDependencies(formulas)) {
    void formState.value[dep]
  }
  return computeFormPreviewValues(formState.value, visibleFields.value, formulas)
})

function displayFieldValue(field: LayoutFieldMetadata): unknown {
  if (hasPreviewValue(previewValues.value, field.field)) {
    return previewValues.value[field.field]
  }
  return formState.value[field.field]
}

function dynamicChoiceSource(field: LayoutFieldMetadata): DynamicPicklistSource | null {
  const raw = runtimeMeta.runtimeFieldProps[field.field]?.choiceSource
  return isDynamicPicklistSource(raw) ? raw : null
}

function sensitivitySourceFor(field: LayoutFieldMetadata): SensitivitySource {
  return (
    parseSensitivitySource(
      runtimeMeta.runtimeFieldProps[field.field]?.sensitivitySource,
    ) ?? defaultSensitivitySource()
  )
}

function fieldComponentProps(field: LayoutFieldMetadata): Record<string, unknown> {
  return buildComponentProps(
    field,
    runtimeMeta.runtimeFieldProps[field.field] ?? {},
    props.readonly,
    readonlyFieldNames.value,
    props.parentName,
    props.parentId,
    runtimeMeta.runtimeReadonly[field.field],
  )
}

/** Runtime number/currency props for child lookup — never override modelValue. */
function childLookupFieldBindProps(field: LayoutFieldMetadata): Record<string, unknown> {
  const {
    modelValue: _modelValue,
    'onUpdate:modelValue': _onUpdate,
    id: _id,
    disabled: _disabled,
    ...rest
  } = fieldComponentProps(field)
  return rest
}

function updateFormField(fieldName: string, value: unknown): void {
  if (Object.is(formState.value[fieldName], value)) return
  formState.value = { ...formState.value, [fieldName]: value }
  formStateTick.value += 1
}

function handleBlocksSaved(payload: { field: string; value: unknown }): void {
  updateFormField(payload.field, payload.value)
}

function handleFilesChanged(payload: {
  field: string
  value: Record<string, unknown>[]
}): void {
  updateFormField(payload.field, payload.value)
}

function handleAutoCompleteUpdate(
  field: LayoutFieldMetadata,
  value: Parameters<typeof autoComplete.updateValue>[1],
): void {
  autoComplete.updateValue(field, value)
  const relatedId = value?.value ?? null
  if (relatedId === null || relatedId === undefined || relatedId === '') {
    clearChildLookupValuesForSource(field.field)
  }
  void applyRelatedCopy(field, relatedId)
}

async function applyRelatedCopy(
  field: LayoutFieldMetadata,
  relatedId: string | number | null,
): Promise<void> {
  const copyMap: Record<string, string> = { ...(field.relatedCopy ?? {}) }

  // Create-only: also apply Setup "Default from parent field" paths like item.base_price.
  if (!props.recordId && props.schema.entity) {
    try {
      const definitions = await resolveDefaultFromParentDefinitions(
        props.schema.entity,
        (await getCachedCollectionFields(props.schema.entity)) as FieldDefinition[],
      )
      for (const pair of defaultFromParentTargetsForRelation(
        definitions,
        field.field,
      )) {
        if (!copyMap[pair.targetField]) {
          copyMap[pair.targetField] = pair.sourceField
        }
      }
    } catch {
      // Keep layout relatedCopy only if registry fields fail to load.
    }
  }

  const collection = field.relatedCollection?.trim()
  if (!collection || Object.keys(copyMap).length === 0) return

  const targetFields = Object.keys(copyMap)
  if (!relatedId && relatedId !== 0) {
    const cleared: Record<string, unknown> = { ...formState.value }
    for (const target of targetFields) {
      cleared[target] = null
    }
    formState.value = cleared
    formStateTick.value += 1
    return
  }

  try {
    const sourceFields = [...new Set([
      ...Object.values(copyMap).filter(Boolean),
      'name',
    ])]
    const record = await bridgeReadItem(collection, relatedId, {
      fields: ['id', ...sourceFields],
    })
    const next: Record<string, unknown> = { ...formState.value }
    for (const [target, source] of Object.entries(copyMap)) {
      if (!source) continue
      const raw = record[source]
      next[target] = raw === undefined ? null : raw
    }
    // Prefer catalog name when local name is empty.
    if (
      typeof record.name === 'string' &&
      record.name &&
      (!next.name || next.name === '')
    ) {
      next.name = record.name
    }
    formState.value = next
    formStateTick.value += 1
  } catch {
    // Keep current draft if related record cannot be loaded.
  }
}

async function syncFormState(fields: LayoutFieldMetadata[]): Promise<void> {
  const next = { ...formState.value }
  let changed = false
  for (const field of fields) {
    if (!(field.field in next)) {
      next[field.field] = defaultValueForField(field)
      changed = true
    }
  }
  const keys = new Set(fields.map((f) => f.field))
  // Keep roots referenced by tab/group show-if (e.g. `item` for `item.result_type`)
  // even when those fields are not on the edit canvas — otherwise every conditional
  // tab is hidden and the dialog shows "No tabs in this layout yet."
  const showIfRoots = collectShowIfRootFields(props.schema.sections)
  const parentFk = props.parentName?.trim() || ''
  for (const key of Object.keys(next)) {
    if (keys.has(key)) continue
    if (showIfRoots.some((root) => keysEqual(root, key))) continue
    // Keep ambient parent FK for child-lookup `$parent.*` filters even when the
    // parent field is not on this layout.
    if (parentFk && keysEqual(key, parentFk)) continue
    delete next[key]
    changed = true
  }
  const parentFieldMeta = parentFk
    ? fields.find((field) => keysEqual(field.field, parentFk))
    : undefined
  const parentFieldKey = parentFieldMeta?.field || parentFk
  if (
    parentFieldKey &&
    props.parentId !== undefined &&
    props.parentId !== null &&
    next[parentFieldKey] !== props.parentId
  ) {
    next[parentFieldKey] = props.parentId
    changed = true
  }
  if (changed) {
    formState.value = next
  }
  autoComplete.syncSelections(fields)
  if (
    parentFieldKey &&
    props.parentId !== undefined &&
    props.parentId !== null
  ) {
    const parentLabel =
      props.parentRecord &&
      typeof props.parentRecord.name === 'string' &&
      props.parentRecord.name.trim()
        ? props.parentRecord.name.trim()
        : String(props.parentId)
    autoComplete.seedSelection(parentFieldKey, {
      label: parentLabel,
      value: props.parentId,
    })
  }
  await fieldLabels.sync(fields)
  await runtimeMeta.sync(fields, autoComplete.onAutoComplete)
  await normalizeDraftValues()
}

async function normalizeDraftValues(): Promise<void> {
  const collection = props.schema.entity
  if (!collection) return

  const normalized = await normalizeEntityFormDraft(
    collection,
    props.schema,
    formState.value,
  )
  if (normalized !== formState.value) {
    formState.value = normalized
  }
}

watch(visibleFields, (fields) => void syncFormState(fields), {
  immediate: true,
  deep: true,
})

/** Required fields on currently visible tabs/groups (respects show-if). */
function validateRequired(): FormRequiredValidationResult {
  const missingLabels: string[] = []
  const seen = new Set<string>()

  for (const section of visibleSections.value) {
    const groups = filterVisibleLayoutGroups(section.groups, showIfEvalRecord.value)
    for (const group of groups) {
      for (const field of group.fields) {
        if (!isEditableFormLayoutField(field)) continue
        if (
          isDataTableField(field) ||
          isSchedulerField(field) ||
          isFilesField(field) ||
          isTreeTableField(field) ||
          isM2ABuilderField(field)
        ) {
          continue
        }
        if (readonlyFieldNames.value.has(field.field)) continue
        if (runtimeMeta.runtimeReadonly[field.field]) continue
        if (!runtimeMeta.runtimeRequired[field.field]) continue
        if (seen.has(field.field)) continue
        seen.add(field.field)

        const raw = formState.value[field.field]
        const selected = autoComplete.selections[field.field]
        const value =
          isAutoCompleteField(field) || isRelationPickerField(field)
            ? (selected ?? raw)
            : raw
        if (!isBlankFormValue(value)) continue
        missingLabels.push(fieldLabels.getLabel(field))
      }
    }
  }

  return { valid: missingLabels.length === 0, missingLabels }
}

defineExpose({ validateRequired })

</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="visibleSections.length > 0" class="flex flex-col gap-4">
      <div
        class="layout-tabs flex gap-[0.4rem] border-b border-surface-200"
        role="tablist"
      >
        <button
          v-for="(section, index) in visibleSections"
          :key="section.id"
          type="button"
          class="layout-tab border border-transparent border-b-0 rounded-t-lg bg-transparent text-muted-color cursor-pointer px-3 py-2 font-[inherit]"
          :class="{
            'layout-tab--active border-surface-200 bg-surface-0 text-primary font-semibold':
              activeSectionIndex === index,
          }"
          role="tab"
          :aria-selected="activeSectionIndex === index"
          @click="activeSectionIndex = index"
        >
          {{ section.title || sectionLabel(section, index, t) }}
        </button>
      </div>

      <section v-if="activeSection" class="grid gap-4 pt-4">
        <p v-if="activeSection.description" class="mt-1 mb-0 text-[0.85rem] text-muted-color">
          {{ activeSection.description }}
        </p>

        <Panel
          v-for="group in visibleGroups"
          :key="group.id"
          :header="group.title"
          toggleable
          v-model:collapsed="groupCollapsed[group.id]"
          class="layout-group-panel mt-4 border border-surface-200 rounded-lg overflow-hidden"
        >
          <div
            class="grid grid-cols-12 gap-x-3"
            :class="isGroupInlineLabels(group) ? 'gap-y-1 layout-fields--inline' : 'gap-y-4'"
          >
            <div
              v-for="field in group.fields.filter(isEditableFormLayoutField)"
              :key="field.id"
              class="min-w-0"
              :class="{
                'layout-field--inline flex w-full flex-col gap-[0.35rem] py-1.5 border-b border-surface-100 md:flex-row md:items-center md:gap-3':
                  isGroupInlineLabels(group) && !isFullWidthLayoutField(field) && !isCheckboxField(field),
                'flex flex-col gap-[0.35rem]':
                  !isGroupInlineLabels(group) || isFullWidthLayoutField(field) || isCheckboxField(field),
                '!col-span-12': isFullWidthLayoutField(field),
              }"
              :style="gridStyle(field)"
            >
              <template v-if="isDataTableField(field)">
                <RelatedDataTableField
                  :field="field"
                  :entity="schema.entity"
                  :parent-id="parentId"
                  :parent-name="parentName"
                  :parent-record="formState"
                  :active="!groupCollapsed[group.id]"
                />
              </template>
              <template v-else-if="isM2ABuilderField(field)">
                <M2ABlocksField
                  :field="field"
                  :entity="schema.entity"
                  :parent-id="recordId"
                  :model-value="formState[field.field]"
                  :original-value="formState[field.field]"
                  :editable="!readonly && !readonlyFieldNames.has(field.field)"
                  @saved="handleBlocksSaved"
                />
              </template>
              <template v-else>
              <label
                v-if="!isCheckboxField(field)"
                class="text-[0.85rem] font-medium text-surface-700"
                :class="{
                  'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) && !isFullWidthLayoutField(field),
                }"
                :for="field.field"
              >
                {{ fieldLabels.getLabel(field) }}
                <span v-if="runtimeMeta.runtimeRequired[field.field]" class="text-red-600">*</span>
              </label>

              <div
                class="flex flex-col gap-[0.35rem]"
                :class="{
                  '!flex-row items-center gap-2': isCheckboxField(field),
                  'flex-1 min-w-0 w-full': isGroupInlineLabels(group) && !isFullWidthLayoutField(field) && !isCheckboxField(field),
                }"
              >
                <CrmTreeTable
                  v-if="isTreeTableField(field)"
                  :model-value="treeTableValue(formState[field.field])"
                  :settings="field.treeTable"
                  :disabled="readonly"
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmScheduler
                  v-else-if="isSchedulerField(field)"
                  :settings="field.scheduler"
                />
                <AttachedDataTableField
                  v-else-if="isFilesField(field)"
                  :field="field"
                  :model-value="formState"
                  :parent-id="recordId"
                  :parent-name="schema.entity"
                  @files-changed="handleFilesChanged"
                />
                <CrmM2MMultiSelect
                  v-else-if="isM2MMultiSelectField(field)"
                  :model-value="formState[field.field]"
                  :collection="field.relatedCollection"
                  :disabled="
                    readonly ||
                    readonlyFieldNames.has(field.field) ||
                    Boolean(fieldComponentProps(field).disabled)
                  "
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmChildLookupField
                  v-else-if="childLookupFor(field)"
                  v-bind="childLookupFieldBindProps(field)"
                  :input-id="field.field"
                  :target-field="field.field"
                  :model-value="formState[field.field]"
                  :settings="childLookupFor(field)"
                  :fields="visibleFields"
                  :source-record="formState"
                  :entity-collection="schema.entity"
                  :parent-collection="parentCollection"
                  :parent-id="parentId"
                  :parent-name="parentName"
                  :parent-record="parentRecord"
                  :prefer-picklist="field.component === 'ChildLookup'"
                  :preserve-draft-on-hydrate="recordId != null && recordId !== ''"
                  :disabled="Boolean(fieldComponentProps(field).disabled)"
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <ScheduleTemplateEditor
                  v-else-if="isRepeaterField(field)"
                  v-model="formState[field.field]"
                  :readonly="readonly"
                  :disabled="Boolean(fieldComponentProps(field).disabled)"
                />
                <CrmAddressField
                  v-else-if="isAddressField(field)"
                  :input-id="field.field"
                  :model-value="formState[field.field]"
                  :readonly="readonly"
                  :disabled="
                    readonly ||
                    readonlyFieldNames.has(field.field) ||
                    Boolean(fieldComponentProps(field).disabled)
                  "
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmSensitivityMatrixField
                  v-else-if="isSensitivityMatrixField(field)"
                  :input-id="field.field"
                  :model-value="formState[field.field]"
                  :sensitivity-source="sensitivitySourceFor(field)"
                  :entity-collection="schema.entity"
                  :source-record="formState"
                  :readonly="readonly"
                  :disabled="
                    readonly ||
                    readonlyFieldNames.has(field.field) ||
                    Boolean(fieldComponentProps(field).disabled)
                  "
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmJsonListField
                  v-else-if="isJsonListField(field)"
                  :input-id="field.field"
                  :model-value="formState[field.field]"
                  :columns="
                    (fieldComponentProps(field).columns as JsonListColumn[] | undefined) ??
                    []
                  "
                  :readonly="readonly"
                  :disabled="
                    readonly ||
                    readonlyFieldNames.has(field.field) ||
                    Boolean(fieldComponentProps(field).disabled)
                  "
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmJsonCodeField
                  v-else-if="isJsonCodeField(field)"
                  :input-id="field.field"
                  :model-value="formState[field.field]"
                  :readonly="readonly"
                  :disabled="
                    readonly ||
                    readonlyFieldNames.has(field.field) ||
                    Boolean(fieldComponentProps(field).disabled)
                  "
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmDynamicPicklist
                  v-else-if="dynamicChoiceSource(field)"
                  :input-id="field.field"
                  :model-value="displayFieldValue(field)"
                  :choice-source="dynamicChoiceSource(field)!"
                  :entity-collection="schema.entity"
                  :source-record="formState"
                  :disabled="Boolean(fieldComponentProps(field).disabled)"
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <component
                  :is="resolvePrimeVueComponent(field.component)"
                  v-else-if="
                    resolvePrimeVueComponent(field.component) &&
                    !isAutoCompleteField(field) &&
                    !isRelationPickerField(field) &&
                    !isM2MMultiSelectField(field)
                  "
                  :model-value="displayFieldValue(field)"
                  v-bind="fieldComponentProps(field)"
                  @update:model-value="updateFormField(field.field, $event)"
                />
                <CrmAutoComplete
                  v-else-if="isAutoCompleteField(field) || isRelationPickerField(field)"
                  v-bind="fieldComponentProps(field)"
                  :model-value="autoComplete.selections[field.field]"
                  :collection="field.relatedCollection"
                  :template="autoComplete.templates[field.field]"
                  :allow-create="true"
                  :show-clear="true"
                  @update:model-value="handleAutoCompleteUpdate(field, $event)"
                />
                <p v-else class="m-0 text-[0.85rem] text-red-600">
                  {{ t('formRenderer.unknownComponent', 'Unknown component: {component}', { component: field.component }) }}
                </p>

                <label
                  v-if="isCheckboxField(field)"
                  class="text-[0.9rem] cursor-pointer"
                  :for="field.field"
                >
                  {{ fieldLabels.getLabel(field) }}
                  <span v-if="runtimeMeta.runtimeRequired[field.field]" class="text-red-600">*</span>
                </label>
              </div>
              </template>
            </div>
          </div>

          <p v-if="group.fields.length === 0" class="m-0 text-surface-400 text-[0.9rem]">
            {{ t('formRenderer.noFields', 'No fields in this group yet.') }}
          </p>
        </Panel>

        <p
          v-if="visibleGroups.length === 0"
          class="m-0 text-surface-400 text-[0.9rem]"
        >
          {{ t('formRenderer.noGroups', 'No groups in this tab yet.') }}
        </p>
      </section>
    </div>

    <p v-else class="m-0 text-surface-400 text-[0.9rem]">
      {{ t('formRenderer.noTabs', 'No tabs in this layout yet.') }}
    </p>
  </div>
</template>

<style scoped>
.layout-tabs {
  margin-bottom: 0;
}

.layout-tab--active {
  border-color: var(--p-surface-200);
  background: var(--p-surface-0);
  color: var(--p-primary-color);
  font-weight: 600;
}

.layout-group-panel :deep(.p-panel-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--p-primary-50);
  color: var(--p-surface-900);
  font-weight: 600;
}

.layout-group-panel :deep(.p-panel-content) {
  padding: 1rem;
  background: var(--p-surface-0);
}

.files-field {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 0.75rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  background: var(--p-surface-50);
  min-height: 3.5rem;
}

.files-field--list {
  flex-direction: column;
}

.files-field--gallery {
  gap: 0.75rem;
}

.files-field__item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.65rem;
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
  font-size: 0.82rem;
  color: var(--p-surface-700);
  max-width: 100%;
}

.files-field--thumbnail .files-field__item,
.files-field--gallery .files-field__item {
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem;
  width: 8rem;
  text-align: center;
}

.files-field__thumb {
  width: 4.5rem;
  height: 4.5rem;
  object-fit: cover;
  border-radius: 4px;
  background: var(--p-surface-200);
  flex-shrink: 0;
}

.files-field--gallery .files-field__thumb {
  width: 7rem;
  height: 7rem;
}

.files-field__icon {
  font-size: 1.75rem;
  line-height: 1;
  flex-shrink: 0;
}

.files-field__meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.files-field--thumbnail .files-field__meta,
.files-field--gallery .files-field__meta {
  align-items: center;
}

.files-field__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--p-surface-900);
  max-width: 100%;
}

.files-field__col {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.files-field__col-label {
  font-weight: 500;
  color: var(--p-surface-400);
  margin-right: 0.2rem;
}

.files-field__empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: auto;
  font-size: 0.85rem;
  color: var(--p-surface-400);
  padding: 0.5rem;
}

.files-field__empty-icon {
  font-size: 1.1rem;
  opacity: 0.6;
}
</style>
