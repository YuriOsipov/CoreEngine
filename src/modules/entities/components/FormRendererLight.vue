<script lang="ts">
export default {
  name: 'FormRendererLight',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Dropdown as FloatingDropdown } from 'floating-vue'
import CompactRecordTooltip from '@/modules/entities/components/CompactRecordTooltip.vue'
import CrmHtmlCell from '@/core/ui-kit/CrmHtmlCell.vue'
import ScheduleTemplateEditor from '@/core/ui-kit/ScheduleTemplateEditor.vue'
import AttachedDataTableField from '@/modules/entities/components/AttachedDataTableField.vue'
import ActivityLogField from '@/modules/entities/components/ActivityLogField.vue'
import DocEngineField from '@/modules/documents/components/DocEngineField.vue'
import SystemInfoBlock from '@/modules/entities/components/SystemInfoBlock.vue'
import RelatedListFieldHost from '@/modules/entities/components/RelatedListFieldHost.vue'
import { isBlockLayoutRelatedListField } from '@/modules/config/utils/recordPageRelatedList'
import type { EntityLayoutSchema, LayoutFieldMetadata } from '@/interfaces'
import { isSystemAuditLayoutField, isSystemInfoEnabled } from '@/core/layoutFieldRules'
import { useFieldLabels } from '@/core/useFieldLabels'
import { useCompactTooltip } from '@/core/useCompactTooltip'
import { useFieldDisplay } from '@/core/useFieldDisplay'
import {
  fieldRelatedRecordRoute,
} from '@/core/compactRecordRoutes'
import {
  coerceBooleanDisplayValue,
  gridStyle,
  isAddressField,
  isBooleanColumn,
  isFilesField,
  isFullWidthLayoutField,
  isGroupInlineLabels,
  isHtmlEditorField,
  isJsonCodeField,
  isJsonListField,
  isSensitivityMatrixField,
  isRepeaterField,
  isActivityLogField,
  isDocEngineField,
  isSchedulerField,
  isTreeTableField,
  relatedFieldValue,
  treeTableSummary,
  sectionLabel,
} from '@/core/fieldHelpers'
import { formatAddressMultiline } from '@/core/addressField'
import {
  formatJsonCodeSummary,
  formatJsonListSummary,
} from '@/core/jsonField'
import CrmSensitivityCrossTable from '@/core/ui-kit/CrmSensitivityCrossTable.vue'
import { useTranslation } from '@/core/translation'
import {
  filterVisibleLayoutGroups,
  filterVisibleLayoutSections,
} from '@/core/recordConditionMatch'
import { normalizeLayoutSchemaFilesFields } from '@/core/entityLayoutUtils'

const { t } = useTranslation()

const props = defineProps<{
  schema: EntityLayoutSchema
  modelValue: Record<string, unknown>
  parentId?: string | number
  parentName?: string
  m2aEditable?: boolean
  /**
   * Flat render for Page Layout field / field-group embeds:
   * no section tabs, no empty group chrome, no System block.
   */
  embedded?: boolean
}>()

const emit = defineEmits<{
  'blocks-saved': [payload: { field: string; value: unknown }]
  'related-changed': []
}>()

/** Keep Image M2O fields as single-file Files (not Attachments junction). */
const layoutSchema = computed(() => normalizeLayoutSchemaFilesFields(props.schema))

const fieldLabels = useFieldLabels(() => layoutSchema.value.entity)
const fieldDisplay = useFieldDisplay(() => layoutSchema.value.entity)
const compactTooltip = useCompactTooltip()
const activeSectionId = ref<string | null>(null)
const systemInfoCollapsed = ref(false)

const visibleSections = computed(() =>
  filterVisibleLayoutSections(layoutSchema.value.sections, props.modelValue),
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

watch(
  () => layoutSchema.value.systemInfo?.collapsed,
  (collapsed) => {
    systemInfoCollapsed.value = collapsed ?? false
  },
  { immediate: true },
)

const groupCollapsed = reactive<Record<string, boolean>>({})

watch(
  layoutSchema,
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
  layoutSchema.value.sections.reduce<LayoutFieldMetadata[]>(
    (fields, section) => [
      ...fields,
      ...section.groups.reduce<LayoutFieldMetadata[]>(
        (groupFields, group) => [
          ...groupFields,
          ...group.fields.filter((field) => !isSystemAuditLayoutField(field)),
        ],
        [],
      ),
    ],
    [],
  ),
)

const showSystemInfo = computed(
  () => !props.embedded && isSystemInfoEnabled(layoutSchema.value),
)

const showSectionTabs = computed(
  () => !props.embedded && visibleSections.value.length > 1,
)

const activeSection = computed(() => visibleSections.value[activeSectionIndex.value])

const visibleGroups = computed(() =>
  activeSection.value
    ? filterVisibleLayoutGroups(activeSection.value.groups, props.modelValue)
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
  [visibleFields, () => props.modelValue, () => layoutSchema.value.entity],
  ([fields]) => {
    void fieldLabels.sync(fields)
    fieldDisplay.sync(fields, (f) => props.modelValue[f.field])
  },
  { immediate: true, deep: true },
)

</script>

<template>
  <div
    class="flex flex-col gap-4"
    :class="{ 'w-full min-w-0': embedded }"
  >
    <div v-if="visibleSections.length > 0" class="flex flex-col gap-4">
      <div
        v-if="showSectionTabs"
        class="flex gap-[0.4rem] border-b border-surface-200"
        role="tablist"
      >
        <button
          v-for="(section, sectionIndex) in visibleSections"
          :key="section.id"
          type="button"
          class="border border-transparent border-b-0 rounded-t-lg bg-transparent text-muted-color cursor-pointer px-3 py-2 font-[inherit]"
          :class="{
            'border-surface-200 bg-surface-0 text-primary font-semibold': activeSectionIndex === sectionIndex,
          }"
          role="tab"
          :aria-selected="activeSectionIndex === sectionIndex"
          @click="activeSectionIndex = sectionIndex"
        >
          {{ sectionLabel(section, sectionIndex, t) }}
        </button>
      </div>

      <h2
        v-else-if="embedded && activeSection?.title"
        class="m-0 text-base font-semibold text-surface-900"
      >
        {{ activeSection.title }}
      </h2>

      <section v-if="activeSection" class="flex flex-col gap-4">
        <p v-if="activeSection.description" class="m-0 text-muted-color text-sm">
          {{ activeSection.description }}
        </p>

        <section
          v-for="group in visibleGroups"
          :key="group.id"
          class="overflow-hidden"
          :class="embedded && !group.title
            ? ''
            : 'border border-surface-200 rounded-lg bg-surface-0'"
        >
          <button
            v-if="group.title"
            type="button"
            class="w-full flex items-center justify-between m-0 px-4 py-3 bg-primary-50 text-surface-900 text-[0.95rem] font-semibold border-0 cursor-pointer font-[inherit] text-left"
            @click="groupCollapsed[group.id] = !groupCollapsed[group.id]"
          >
            {{ group.title }}
            <i :class="groupCollapsed[group.id] ? 'pi pi-chevron-down' : 'pi pi-chevron-up'" class="text-xs text-muted-color" />
          </button>

          <div
            v-show="!groupCollapsed[group.id]"
            class="grid grid-cols-12 gap-x-3"
            :class="[
              group.title ? 'p-4' : (embedded ? 'p-0' : 'p-4'),
              isGroupInlineLabels(group) ? 'gap-y-0 layout-fields--inline' : 'gap-y-4',
            ]"
          >
            <div
              v-for="field in group.fields.filter(
                (item) => !isSystemAuditLayoutField(item) && item.component !== 'BlockLayout',
              )"
              :key="field.id"
              class="min-w-0"
              :class="{
                'layout-field--inline flex w-full flex-col gap-1 border-b border-surface-200 py-2 md:flex-row md:items-center md:gap-3':
                  isGroupInlineLabels(group) && !isFullWidthLayoutField(field),
                'flex flex-col gap-1': !isGroupInlineLabels(group) || isFullWidthLayoutField(field),
                '!col-span-12': isFullWidthLayoutField(field),
              }"
              :style="gridStyle(field)"
            >
              <template v-if="isBlockLayoutRelatedListField(field)">
                <RelatedListFieldHost
                  :field="field"
                  :collection="schema.entity"
                  :record-id="parentId"
                  :record="modelValue"
                  :active="!groupCollapsed[group.id]"
                  show-create
                  show-actions
                  :m2a-editable="Boolean(m2aEditable)"
                  files-readonly
                  @blocks-saved="emit('blocks-saved', $event)"
                  @related-changed="emit('related-changed')"
                />
              </template>

              <template v-else-if="isTreeTableField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="min-h-[2.35rem] break-words text-surface-900 px-0 py-[0.55rem] text-[0.95rem] leading-[1.35]"
                  :class="{
                    'border border-surface-200 rounded-md bg-surface-50 px-[0.65rem]': !embedded,
                    'flex-1 min-w-0 w-full': isGroupInlineLabels(group),
                  }"
                >{{ treeTableSummary(props.modelValue[field.field]) }}</div>
              </template>

              <template v-else-if="isSchedulerField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="min-h-[2.35rem] break-words text-surface-900 px-0 py-[0.55rem] text-[0.95rem] leading-[1.35]"
                  :class="{
                    'border border-surface-200 rounded-md bg-surface-50 px-[0.65rem]': !embedded,
                    'flex-1 min-w-0 w-full': isGroupInlineLabels(group),
                  }"
                >{{ t('formRenderer.scheduler', 'Scheduler') }}</div>
              </template>

              <template v-else-if="isFilesField(field)">
                <AttachedDataTableField
                  :field="field"
                  :model-value="modelValue"
                  :parent-id="parentId"
                  :parent-name="parentName"
                  readonly
                />
              </template>

              <template v-else-if="isActivityLogField(field)">
                <ActivityLogField
                  :field="field"
                  :collection="schema.entity"
                  :record-id="parentId ?? ''"
                  :active="!groupCollapsed[group.id]"
                />
              </template>

              <template v-else-if="isDocEngineField(field)">
                <DocEngineField
                  :field="field"
                  :collection="schema.entity"
                  :record-id="parentId ?? ''"
                  :active="!groupCollapsed[group.id]"
                />
              </template>

              <template v-else-if="isRepeaterField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div :class="{ 'flex-1 min-w-0 w-full': isGroupInlineLabels(group) }">
                  <ScheduleTemplateEditor
                    v-model="modelValue[field.field]"
                    readonly
                  />
                </div>
              </template>

              <template v-else-if="isAddressField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="layout-field__value min-w-0 whitespace-pre-line break-words text-surface-900 text-[0.95rem] leading-[1.35]"
                  :class="{
                    'min-h-[2.35rem] border border-surface-200 rounded-md bg-surface-50 px-[0.65rem] py-[0.55rem]':
                      !embedded && !isGroupInlineLabels(group),
                    'flex-1 w-full min-w-0 py-0.5': embedded || isGroupInlineLabels(group),
                  }"
                >{{ formatAddressMultiline(modelValue[field.field]) }}</div>
              </template>

              <template v-else-if="isSensitivityMatrixField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="layout-field__value min-w-0 w-full"
                  :class="{
                    'border border-surface-200 rounded-md bg-surface-50 px-[0.65rem] py-[0.55rem]':
                      !embedded && !isGroupInlineLabels(group),
                    'flex-1 min-w-0 py-0.5': embedded || isGroupInlineLabels(group),
                  }"
                >
                  <CrmSensitivityCrossTable :model-value="modelValue[field.field]" />
                </div>
              </template>

              <template v-else-if="isJsonListField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="layout-field__value min-w-0 break-words text-surface-900 text-[0.95rem] leading-[1.35]"
                  :class="{
                    'min-h-[2.35rem] border border-surface-200 rounded-md bg-surface-50 px-[0.65rem] py-[0.55rem]':
                      !embedded && !isGroupInlineLabels(group),
                    'flex-1 w-full min-w-0 py-0.5': embedded || isGroupInlineLabels(group),
                  }"
                >{{ formatJsonListSummary(modelValue[field.field], []) }}</div>
              </template>

              <template v-else-if="isJsonCodeField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="layout-field__value min-w-0 break-words font-mono text-sm text-surface-900 leading-[1.35]"
                  :class="{
                    'min-h-[2.35rem] border border-surface-200 rounded-md bg-surface-50 px-[0.65rem] py-[0.55rem]':
                      !embedded && !isGroupInlineLabels(group),
                    'flex-1 w-full min-w-0 py-0.5': embedded || isGroupInlineLabels(group),
                  }"
                >{{ formatJsonCodeSummary(modelValue[field.field]) }}</div>
              </template>

              <template v-else-if="isHtmlEditorField(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >{{ fieldLabels.getLabel(field) }}</div>
                <div
                  class="min-h-[2.35rem] break-words text-surface-900 px-0 py-[0.55rem] text-[0.95rem] leading-[1.35]"
                  :class="{
                    'border border-surface-200 rounded-md bg-surface-50 px-[0.65rem]': !embedded,
                    'flex-1 min-w-0 w-full': isGroupInlineLabels(group),
                  }"
                >
                  <CrmHtmlCell :html="String(modelValue[field.field] ?? '')" />
                </div>
              </template>

              <template v-else-if="isBooleanColumn(field)">
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >
                  {{ fieldLabels.getLabel(field) }}
                </div>
                <div
                  class="layout-field__value flex min-w-0 items-center text-surface-900"
                  :class="{
                    'min-h-[2.35rem] border border-surface-200 rounded-md bg-surface-50 px-[0.65rem] py-[0.55rem]':
                      !embedded && !isGroupInlineLabels(group),
                    'flex-1 w-full min-w-0 min-h-[2.5rem] py-0.5':
                      embedded || isGroupInlineLabels(group),
                  }"
                >
                  <Checkbox
                    class="pointer-events-none"
                    :model-value="coerceBooleanDisplayValue(modelValue[field.field])"
                    binary
                    :tabindex="-1"
                    :aria-label="fieldLabels.getLabel(field)"
                  />
                </div>
              </template>

              <template v-else>
                <div
                  class="text-muted-color text-xs font-medium leading-tight"
                  :class="{ 'md:w-[7.5rem] md:shrink-0 md:grow-0': isGroupInlineLabels(group) }"
                >
                  {{ fieldLabels.getLabel(field) }}
                </div>
                <div
                  class="layout-field__value min-w-0 break-words text-surface-900 text-[0.95rem] leading-[1.35]"
                  :class="{
                    'min-h-[2.35rem] border border-surface-200 rounded-md bg-surface-50 px-[0.65rem] py-[0.55rem]':
                      !embedded && !isGroupInlineLabels(group),
                    'flex-1 w-full min-w-0 py-0.5': embedded || isGroupInlineLabels(group),
                  }"
                >
                  <FloatingDropdown
                    v-if="relatedFieldValue(field, props.modelValue[field.field]) !== null"
                    theme="compact-record"
                    placement="top-start"
                    :distance="8"
                    :delay="{ show: 250, hide: 150 }"
                    :triggers="['hover', 'focus']"
                    :popper-triggers="['hover']"
                    @show="compactTooltip.loadForField(field, props.modelValue[field.field])"
                  >
                    <RouterLink
                      :to="fieldRelatedRecordRoute(field, relatedFieldValue(field, props.modelValue[field.field]))"
                      class="border-0 bg-transparent text-primary cursor-pointer font-[inherit] p-0 text-left underline decoration-dotted underline-offset-[3px]"
                    >
                      {{ fieldDisplay.displayValue(field, props.modelValue[field.field]) }}
                    </RouterLink>

                    <template #popper>
                      <CompactRecordTooltip
                        :loading="compactTooltip.getStateForField(field, props.modelValue[field.field])?.loading ?? false"
                        :error="compactTooltip.getStateForField(field, props.modelValue[field.field])?.error ?? null"
                        :runtime="compactTooltip.getStateForField(field, props.modelValue[field.field])?.runtime ?? null"
                      />
                    </template>
                  </FloatingDropdown>
                  <template v-else>
                    {{ fieldDisplay.displayValue(field, props.modelValue[field.field]) }}
                  </template>
                </div>
              </template>
            </div>
          </div>

          <p v-if="group.fields.length === 0" class="m-0 text-muted-color text-[0.9rem]">
            {{ t('formRenderer.noFields', 'No fields in this group yet.') }}
          </p>
        </section>

        <p v-if="visibleGroups.length === 0" class="m-0 text-muted-color text-[0.9rem]">
          {{ t('formRenderer.noGroups', 'No groups in this tab yet.') }}
        </p>
      </section>
    </div>

    <p v-else class="m-0 text-muted-color text-[0.9rem]">
      {{ t('formRenderer.noTabs', 'No tabs in this layout yet.') }}
    </p>

    <SystemInfoBlock
      v-if="showSystemInfo"
      :record="modelValue"
      v-model:collapsed="systemInfoCollapsed"
    />

  </div>

</template>
