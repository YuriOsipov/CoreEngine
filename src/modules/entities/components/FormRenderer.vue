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
import CrmDynamicPicklist from '@/core/ui-kit/CrmDynamicPicklist.vue'
import {
  isDynamicPicklistSource,
  type DynamicPicklistSource,
} from '@/core/dynamicPicklist'
import type { JsonListColumn } from '@/core/jsonField'
import RelatedDataTableField from '@/modules/entities/components/RelatedDataTableField.vue'
import M2ABlocksField from '@/modules/entities/components/M2ABlocksField.vue'
import AttachedDataTableField from '@/modules/entities/components/AttachedDataTableField.vue'
import type {
  EntityLayoutSchema,
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
const activeSectionIndex = ref(0)

const activeSection = computed(() => props.schema.sections[activeSectionIndex.value])

const activeTabValue = computed({
  get: () => String(activeSectionIndex.value),
  set: (value: string | number) => {
    const index = Number(value)
    if (Number.isFinite(index)) {
      activeSectionIndex.value = index
    }
  },
})

watch(
  () => props.schema.sections.length,
  (sectionCount) => {
    if (activeSectionIndex.value >= sectionCount) {
      activeSectionIndex.value = 0
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
  void applyRelatedCopy(field, value?.value ?? null)
}

async function applyRelatedCopy(
  field: LayoutFieldMetadata,
  relatedId: string | number | null,
): Promise<void> {
  const copyMap = field.relatedCopy
  const collection = field.relatedCollection?.trim()
  if (!copyMap || !collection || Object.keys(copyMap).length === 0) return

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
  for (const key of Object.keys(next)) {
    if (!keys.has(key)) {
      delete next[key]
      changed = true
    }
  }
  if (
    props.parentName &&
    props.parentId !== undefined &&
    props.parentId !== null &&
    keys.has(props.parentName) &&
    next[props.parentName] !== props.parentId
  ) {
    next[props.parentName] = props.parentId
    changed = true
  }
  if (changed) {
    formState.value = next
  }
  autoComplete.syncSelections(fields)
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

</script>

<template>
  <div class="flex flex-col gap-4">
    <Tabs
      v-if="schema.sections.length > 0"
      v-model:value="activeTabValue"
      class="layout-tabs"
    >
      <TabList v-if="schema.sections.length > 1">
        <Tab
          v-for="(section, index) in schema.sections"
          :key="section.id"
          :value="String(index)"
        >
          {{ section.title || sectionLabel(section, index, t) }}
        </Tab>
      </TabList>

      <section v-if="activeSection" class="grid gap-4 pt-4">
        <p v-if="activeSection.description" class="mt-1 mb-0 text-[0.85rem] text-muted-color">
          {{ activeSection.description }}
        </p>

        <Panel
          v-for="group in activeSection.groups"
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
                  v-else-if="field.childLookup"
                  :input-id="field.field"
                  :target-field="field.field"
                  :model-value="formState[field.field]"
                  :settings="field.childLookup"
                  :fields="visibleFields"
                  :source-record="formState"
                  :entity-collection="schema.entity"
                  :parent-collection="parentCollection"
                  :parent-id="parentId"
                  :parent-name="parentName"
                  :parent-record="parentRecord"
                  :prefer-picklist="field.component === 'ChildLookup'"
                  :disabled="Boolean(fieldComponentProps(field).disabled)"
                  v-bind="fieldComponentProps(field)"
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
          v-if="activeSection.groups.length === 0"
          class="m-0 text-surface-400 text-[0.9rem]"
        >
          {{ t('formRenderer.noGroups', 'No groups in this tab yet.') }}
        </p>
      </section>
    </Tabs>

    <p v-else class="m-0 text-surface-400 text-[0.9rem]">
      {{ t('formRenderer.noTabs', 'No tabs in this layout yet.') }}
    </p>
  </div>
</template>

<style scoped>
.layout-tabs :deep(.p-tablist-tab-list) {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--p-surface-200);
  margin-bottom: 1rem;
}

.layout-tabs :deep(.p-tab) {
  padding: 0.55rem 0.8rem;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--p-text-muted-color);
  font: inherit;
  cursor: pointer;
}

.layout-tabs :deep(.p-tab-active) {
  border-color: var(--p-surface-200);
  background: var(--p-surface-0);
  color: var(--p-primary-color);
  font-weight: 600;
}

.layout-tabs :deep(.p-tabpanels) {
  padding: 0;
  background: transparent;
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
