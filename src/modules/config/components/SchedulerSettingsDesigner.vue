<script lang="ts">
export default {
  name: 'SchedulerSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CrmScheduler from '@/core/ui-kit/CrmScheduler.vue'
import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import type {
  SchedulerAvailabilitySettings,
  SchedulerEventClickAction,
  SchedulerFilterLevel,
  SchedulerResourceSettings,
  SchedulerSettings,
  SchedulerViewMode,
} from '@/interfaces'
import {
  fetchChoiceLabelMap,
  getCachedCollectionFields,
  getCachedRelations,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import {
  loadSchedulerSettings,
  normalizeSchedulerSettings,
  saveSchedulerSettings,
} from '../services/schedulerSettings'
import { useTranslation } from '@/core/translation'
import {
  humanizeFieldName,
  relatedRecordDisplayField,
} from '@/modules/entities/utils/recordDisplay'

interface StatusColorOption {
  label: string
  value: string
}

const props = defineProps<{
  modelValue: SchedulerSettings
  collection?: string
  builderManaged?: boolean
}>()
const { t } = useTranslation()

const emit = defineEmits<{
  'update:modelValue': [settings: SchedulerSettings]
}>()

const collections = ref<Array<{ label: string; value: string }>>([])
const eventFields = ref<FieldDefinition[]>([])
const eventRelations = ref<RelationDefinition[]>([])
const filterFields = ref<FieldDefinition[]>([])
const filterRelations = ref<RelationDefinition[]>([])
const statusColorOptions = ref<StatusColorOption[]>([])
const statusColorsLoading = ref(false)
const availabilityFields = ref<FieldDefinition[]>([])
const availabilityRelations = ref<RelationDefinition[]>([])
const availabilityTypeOptions = ref<StatusColorOption[]>([])
const loading = ref(false)
const saving = ref(false)
const activeTab = ref<'main' | 'event' | 'availability' | 'preview'>('main')
const error = ref<string | null>(null)
const status = ref<string | null>(null)

const settings = computed(() => {
  const normalized = normalizeSchedulerSettings(props.modelValue)
  if (!props.collection) return normalized

  return normalizeSchedulerSettings({
    ...normalized,
    event: {
      ...normalized.event,
      collection: props.collection,
    },
  })
})
const viewModeOptions: Array<{ label: string; value: SchedulerViewMode }> = [
  { label: t('schedulerSettings.resourceCalendar', 'Resource calendar'), value: 'resourceCalendar' },
  { label: t('schedulerSettings.timelineScheduler', 'Timeline scheduler'), value: 'timelineScheduler' },
]
const eventFieldOptions = computed(() => fieldOptions(eventFields.value))
const filterRelationFieldOptions = computed(() =>
  filterRelations.value
    .filter((relation) => relation.related_collection)
    .map((relation) => {
      const field = filterFields.value.find((item) => item.field === relation.field)
      return {
        label: `${field?.meta?.note?.trim() || humanizeFieldName(relation.field)} (${relation.related_collection})`,
        value: relation.field,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
)
const eventResourceFieldOptions = computed(() =>
  eventRelations.value
    .filter((relation) => relation.related_collection)
    .map((relation) => {
      const field = eventFields.value.find((item) => item.field === relation.field)
      return {
        label: `${field?.meta?.note?.trim() || humanizeFieldName(relation.field)} (${relation.related_collection})`,
        value: relation.field,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
)
const optionalEventFieldOptions = computed(() => [
  { label: t('schedulerSettings.none', 'None'), value: '' },
  ...eventFieldOptions.value,
])
const clickActionOptions = computed(() => [
  {
    label: t('schedulerSettings.clickActionDetails', 'Open details page'),
    value: 'openDetails' as SchedulerEventClickAction,
  },
  {
    label: t('schedulerSettings.clickActionEdit', 'Open edit form'),
    value: 'openEditDialog' as SchedulerEventClickAction,
  },
])
const hasStatusColorOptions = computed(() => statusColorOptions.value.length > 0)
const availability = computed(() => settings.value.event.availability ?? null)
const availabilityFieldOptions = computed(() => fieldOptions(availabilityFields.value))
const availabilityResourceFieldOptions = computed(() =>
  availabilityRelations.value
    .filter((relation) => relation.related_collection)
    .map((relation) => {
      const field = availabilityFields.value.find((item) => item.field === relation.field)
      return {
        label: `${field?.meta?.note?.trim() || humanizeFieldName(relation.field)} (${relation.related_collection})`,
        value: relation.field,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
)
const hasAvailabilityTypeOptions = computed(
  () => availabilityTypeOptions.value.length > 0,
)
const canSaveSettings = computed(() => {
  const filter = settings.value.resource.filter
  const hasFilterSettings = !filter?.enabled ||
    Boolean(
      filter.collection &&
      filter.resourceField &&
      filter.levels.length > 0 &&
      filter.levels.every((level) => level.groupField),
    )
  return Boolean(settings.value.event.collection) &&
    Boolean(settings.value.event.resourceField) &&
    hasFilterSettings
})

watch(
  () => settings.value.resource.filter?.collection ?? '',
  async (collection) => {
    await loadCollectionFields(collection, filterFields)
    await loadFilterRelations(collection)
  },
  { immediate: true },
)

watch(
  () => settings.value.event.collection,
  async (collection) => {
    await loadCollectionFields(collection, eventFields)
    await loadEventRelations(collection)
    if (collection && !props.builderManaged) {
      await syncSavedSettings(collection)
    }
  },
  { immediate: true },
)

watch(
  () => [
    settings.value.event.collection,
    settings.value.event.statusField ?? '',
  ] as const,
  ([collection, statusField]) => {
    void loadStatusColorOptions(collection, statusField)
  },
  { immediate: true },
)

watch(
  () => availability.value?.collection ?? '',
  async (collection) => {
    await loadCollectionFields(collection, availabilityFields)
    await loadAvailabilityRelations(collection)
  },
  { immediate: true },
)

watch(
  () => [
    availability.value?.collection ?? '',
    availability.value?.typeField ?? '',
  ] as const,
  ([collection, typeField]) => {
    void loadAvailabilityTypeOptions(collection, typeField)
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
        : t('schedulerSettings.loadCollectionsError', 'Failed to load collections.')
  } finally {
    loading.value = false
  }
}

async function syncSavedSettings(collection: string): Promise<void> {
  const saved = await loadSchedulerSettings(collection)
  if (!saved) return

  const current = settings.value
  if (current.event.collection === collection && !current.resource.collection) {
    emit('update:modelValue', saved)
  }
}

async function loadCollectionFields(
  collection: string,
  target: typeof eventFields,
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

async function loadEventRelations(collection: string): Promise<void> {
  if (!collection) {
    eventRelations.value = []
    return
  }
  try {
    const relations = await getCachedRelations()
    eventRelations.value = relations.filter(
      (relation) =>
        relation.collection === collection &&
        Boolean(relation.field) &&
        Boolean(relation.related_collection),
    )
  } catch {
    eventRelations.value = []
  }
}

async function loadFilterRelations(collection: string): Promise<void> {
  if (!collection) {
    filterRelations.value = []
    return
  }
  try {
    const relations = await getCachedRelations()
    filterRelations.value = relations.filter(
      (relation) =>
        relation.collection === collection &&
        Boolean(relation.field) &&
        Boolean(relation.related_collection),
    )
  } catch {
    filterRelations.value = []
  }
}

async function loadAvailabilityRelations(collection: string): Promise<void> {
  if (!collection) {
    availabilityRelations.value = []
    return
  }
  try {
    const relations = await getCachedRelations()
    availabilityRelations.value = relations.filter(
      (relation) =>
        relation.collection === collection &&
        Boolean(relation.field) &&
        Boolean(relation.related_collection),
    )
  } catch {
    availabilityRelations.value = []
  }
}

async function loadAvailabilityTypeOptions(
  collection: string,
  typeField: string,
): Promise<void> {
  availabilityTypeOptions.value = []
  if (!collection || !typeField) return
  try {
    const labels = await fetchChoiceLabelMap(collection, typeField, 'Select')
    availabilityTypeOptions.value = Object.entries(labels)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    availabilityTypeOptions.value = []
  }
}

function defaultAvailabilitySettings(): SchedulerAvailabilitySettings {
  return {
    enabled: true,
    collection: 'crm_schedule',
    resourceField: 'provider',
    startField: 'date_start',
    endField: 'date_end',
    typeField: 'type',
    intakeValue: 'intake',
    blockValue: 'block',
  }
}

function updateAvailabilitySettings(
  patch: Partial<SchedulerAvailabilitySettings>,
): void {
  const base = availability.value ?? defaultAvailabilitySettings()
  updateEventSettings({ availability: { ...base, ...patch } })
}

function updateSettings(patch: Partial<SchedulerSettings>): void {
  emit('update:modelValue', normalizeSchedulerSettings({
    ...settings.value,
    ...patch,
  }))
  status.value = null
}

function updateViewMode(value: unknown): void {
  updateSettings({
    viewMode:
      value === 'timelineScheduler'
        ? 'timelineScheduler'
        : 'resourceCalendar',
  })
}

async function updateSchedulerResourceField(value: unknown): Promise<void> {
  const resourceField = typeof value === 'string' ? value : ''
  const resource = await resourceFromEventField(resourceField) ?? emptyResourceCollection()
  updateSettings({
    resource: {
      ...settings.value.resource,
      ...resource,
    },
    event: {
      ...settings.value.event,
      resourceField,
      resourceFields: resourceField ? [resourceField] : [],
    },
  })
}

function updateResourceTitle(value: unknown): void {
  const title = String(value)
  updateSettings({
    resource: {
      ...settings.value.resource,
      title,
    },
  })
}

function updateFilterCollection(collection: string): void {
  updateFilterSettings({
    enabled: Boolean(collection),
    collection,
    groupField: '',
    levels: [],
    resourceField: '',
  })
}

function updateFilterSettings(
  patch: Partial<NonNullable<SchedulerSettings['resource']['filter']>>,
): void {
  updateSettings({
    resource: {
      ...settings.value.resource,
      filter: {
        ...(settings.value.resource.filter ?? {
          enabled: false,
          title: 'Filter',
          collection: '',
          groupField: '',
          levels: [],
          resourceField: '',
        }),
        ...patch,
      },
    },
  })
}

function currentFilterLevels(): SchedulerFilterLevel[] {
  return settings.value.resource.filter?.levels ?? []
}

function defaultLevelTitle(groupField: string): string {
  if (!groupField) return ''
  const field = filterFields.value.find((item) => item.field === groupField)
  return field?.meta?.note?.trim() || humanizeFieldName(groupField)
}

function addFilterLevel(): void {
  updateFilterSettings({
    levels: [...currentFilterLevels(), { groupField: '', title: '' }],
  })
}

function removeFilterLevel(index: number): void {
  updateFilterSettings({
    levels: currentFilterLevels().filter((_, i) => i !== index),
  })
}

function updateFilterLevelGroupField(index: number, groupField: string): void {
  const levels = currentFilterLevels().map((level, i) => {
    if (i !== index) return level
    const keepTitle =
      Boolean(level.title.trim()) &&
      level.title.trim() !== defaultLevelTitle(level.groupField)
    return {
      groupField,
      title: keepTitle ? level.title : defaultLevelTitle(groupField),
    }
  })
  updateFilterSettings({ levels })
}

function updateFilterLevelTitle(index: number, title: string): void {
  const levels = currentFilterLevels().map(
    (level, i) => (i === index ? { ...level, title } : level),
  )
  updateFilterSettings({ levels })
}

function updateFilterTreeSettings(
  patch: Partial<NonNullable<SchedulerSettings['resource']['filter']>['tree']>,
): void {
  const current = settings.value.resource.filter?.tree
  updateFilterSettings({
    tree: {
      enabled: Boolean(patch?.enabled ?? current?.enabled),
      levelIndex: patch?.levelIndex ?? current?.levelIndex ?? 0,
      parentField: patch?.parentField ?? current?.parentField ?? '',
    },
  })
}

const filterTreeRelatedCollection = computed(() => {
  const groupField = settings.value.resource.filter?.levels?.[0]?.groupField
  if (!groupField) return ''
  return filterRelations.value.find((relation) => relation.field === groupField)
    ?.related_collection ?? ''
})

const filterTreeParentFields = ref<FieldDefinition[]>([])

watch(
  filterTreeRelatedCollection,
  async (collection) => {
    await loadCollectionFields(collection, filterTreeParentFields)
  },
  { immediate: true },
)

const filterTreeParentFieldOptions = computed(() =>
  fieldOptions(filterTreeParentFields.value),
)

async function resourceFromEventField(
  eventField: string,
): Promise<SchedulerResourceSettings | null> {
  const relation = eventRelations.value.find((item) => item.field === eventField)
  const collection = relation?.related_collection
  if (!collection) return null

  const fields = await getCachedCollectionFields(collection)
  const primaryKey = fields.find((field) => field.schema?.is_primary_key)?.field ?? 'id'
  return {
    title: settings.value.resource.title || 'Resources',
    collection,
    primaryKey,
    labelField: relatedRecordDisplayField(fields),
    eventField,
  }
}

function emptyResourceCollection(): SchedulerResourceSettings {
  return {
    title: settings.value.resource.title || 'Resources',
    collection: '',
    primaryKey: 'id',
    labelField: 'name',
    eventField: '',
  }
}

function updateEventSettings(
  patch: Partial<SchedulerSettings['event']>,
): void {
  updateSettings({
    event: {
      ...settings.value.event,
      ...patch,
    },
  })
}

function updateEventTitleFields(fields: unknown): void {
  const titleFields = Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === 'string')
    : []
  updateEventSettings({
    titleField: titleFields[0] ?? settings.value.event.titleField,
    titleFields: titleFields.length > 0 ? titleFields : [settings.value.event.titleField],
  })
}

async function loadStatusColorOptions(
  collection: string,
  statusField: string,
): Promise<void> {
  statusColorOptions.value = []
  if (!collection || !statusField) return

  statusColorsLoading.value = true
  try {
    const labels = await fetchChoiceLabelMap(collection, statusField, 'Select')
    statusColorOptions.value = Object.entries(labels)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } finally {
    statusColorsLoading.value = false
  }
}

function statusColorValue(status: string): string {
  return settings.value.event.statusColors?.[status] ?? '#000000'
}

function statusColorTextValue(status: string): string {
  return settings.value.event.statusColors?.[status] ?? ''
}

function updateStatusColor(status: string, color: string): void {
  const nextColors = { ...(settings.value.event.statusColors ?? {}) }
  const value = color.trim()
  if (value) {
    nextColors[status] = value
  } else {
    delete nextColors[status]
  }
  updateEventSettings({ statusColors: nextColors })
}

function handleStatusColorInput(status: string, event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  updateStatusColor(status, input.value)
}

function clearStatusColor(status: string): void {
  updateStatusColor(status, '')
}

async function saveSettings(): Promise<void> {
  saving.value = true
  error.value = null
  status.value = null
  try {
    await saveSchedulerSettings(settings.value)
    status.value = t('schedulerSettings.saved', 'Scheduler settings saved.')
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('schedulerSettings.saveError', 'Failed to save scheduler settings.')
  } finally {
    saving.value = false
  }
}

function fieldOptions(fields: FieldDefinition[]): Array<{
  label: string
  value: string
}> {
  return fields
    .filter((field) => field.type !== 'alias')
    .map((field) => ({
      label: field.meta?.note?.trim() || humanizeFieldName(field.field),
      value: field.field,
    }))
}

function hintTooltip(value: string) {
  return { value, class: 'scheduler-settings-hint-tooltip' }
}

</script>

<template>
  <div class="scheduler-settings-designer flex w-full flex-col gap-1">
    <div
      v-if="loading"
      class="scheduler-settings-designer__loading flex items-center gap-3 text-muted-color"
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

    <Tabs
      v-model:value="activeTab"
      class="scheduler-settings-tabs"
    >
      <TabList>
        <Tab value="main">{{ t('schedulerSettings.main', 'Main') }}</Tab>
        <Tab value="event">{{ t('schedulerSettings.event', 'Event') }}</Tab>
        <Tab value="availability">{{ t('schedulerSettings.availability', 'Availability') }}</Tab>
        <Tab value="preview">{{ t('schedulerSettings.preview', 'Preview') }}</Tab>
      </TabList>

      <TabPanels>
        <TabPanel value="main">
          <div class="scheduler-settings-tab">
    <section class="scheduler-settings-panel">
      <h3 class="scheduler-settings-panel__title m-0">{{ t('schedulerSettings.view', 'View') }}</h3>
      <div class="scheduler-settings-panel__grid">
        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.schedulerView', 'Scheduler view') }}
          <Select
            :model-value="settings.viewMode"
            :options="viewModeOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateViewMode"
          />
        </label>
      </div>
    </section>

    <section class="scheduler-settings-panel">
      <h3 class="scheduler-settings-panel__title m-0">{{ t('schedulerSettings.resource', 'Resource') }}</h3>
      <div class="scheduler-settings-panel__grid">
        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.resourceTitle', 'Resource title') }}
          <InputText
            :model-value="settings.resource.title"
            fluid
            @update:model-value="updateResourceTitle"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.schedulerResourceField', 'Scheduler resource field') }}
          <Select
            :model-value="settings.event.resourceField"
            :options="eventResourceFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateSchedulerResourceField"
          />
        </label>
      </div>

      <p
        v-if="eventResourceFieldOptions.length === 0"
        class="scheduler-settings-muted m-0"
      >
        {{ t('schedulerSettings.noResourceFields', 'No relation fields found for this event collection.') }}
      </p>

      <div
        v-else-if="settings.resource.collection"
        class="scheduler-settings-meta"
      >
        <strong>{{ settings.event.resourceField }}</strong>
        <span>{{ settings.resource.collection }}</span>
      </div>
    </section>

    <section class="scheduler-settings-panel">
      <div class="scheduler-settings-panel__heading">
        <h3 class="scheduler-settings-panel__title m-0">{{ t('schedulerSettings.filter', 'Filter') }}</h3>
        <label class="scheduler-settings-check">
          <Checkbox
            binary
            :model-value="settings.resource.filter?.enabled ?? false"
            @update:model-value="updateFilterSettings({ enabled: Boolean($event) })"
          />
          <span>{{ t('schedulerSettings.filterToggle', 'Filter') }}</span>
        </label>
      </div>

      <div
        v-if="settings.resource.filter?.enabled"
        class="flex flex-col gap-2"
      >
        <div class="scheduler-settings-panel__grid scheduler-settings-panel__grid--3">
          <label class="scheduler-settings-field">
            {{ t('schedulerSettings.filterTitle', 'Filter title') }}
            <InputText
              :model-value="settings.resource.filter.title"
              fluid
              @update:model-value="updateFilterSettings({ title: String($event) })"
            />
          </label>

          <label class="scheduler-settings-field">
            {{ t('schedulerSettings.filterCollection', 'Filter collection') }}
            <Select
              :model-value="settings.resource.filter.collection"
              :options="collections"
              option-label="label"
              option-value="value"
              :placeholder="t('common.selectCollection', 'Select collection')"
              fluid
              @update:model-value="updateFilterCollection(String($event))"
            />
          </label>

          <label class="scheduler-settings-field">
            {{ t('schedulerSettings.filterResourceField', 'Resource field') }}
            <Select
              :model-value="settings.resource.filter.resourceField"
              :options="filterRelationFieldOptions"
              option-label="label"
              option-value="value"
              fluid
              @update:model-value="updateFilterSettings({ resourceField: String($event) })"
            />
          </label>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="scheduler-settings-subhead">
              {{ t('schedulerSettings.filterLevels', 'Filter levels') }}
            </span>
            <Button
              :label="t('schedulerSettings.addFilterLevel', 'Add level')"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              text
              :disabled="!settings.resource.filter.collection"
              @click="addFilterLevel"
            />
          </div>

          <div
            v-for="(level, index) in settings.resource.filter.levels"
            :key="index"
            class="scheduler-settings-level"
          >
            <label class="scheduler-settings-field">
              {{ t('schedulerSettings.filterGroupField', 'Group field') }}
              <Select
                :model-value="level.groupField"
                :options="filterRelationFieldOptions"
                option-label="label"
                option-value="value"
                fluid
                @update:model-value="updateFilterLevelGroupField(index, String($event))"
              />
            </label>

            <label class="scheduler-settings-field">
              {{ t('schedulerSettings.filterTitle', 'Filter title') }}
              <InputText
                :model-value="level.title"
                fluid
                @update:model-value="updateFilterLevelTitle(index, String($event))"
              />
            </label>

            <Button
              icon="pi pi-times"
              severity="secondary"
              text
              rounded
              class="scheduler-settings-level__remove"
              :aria-label="t('common.remove', 'Remove')"
              @click="removeFilterLevel(index)"
            />
          </div>

          <p
            v-if="settings.resource.filter.levels.length === 0"
            class="scheduler-settings-muted m-0"
          >
            {{ t('schedulerSettings.noFilterLevels', 'Add at least one level.') }}
          </p>
        </div>

        <div
          v-if="settings.resource.filter.levels.length > 0"
          class="flex flex-col gap-1.5"
        >
          <label class="scheduler-settings-check">
            <Checkbox
              binary
              :model-value="settings.resource.filter.tree?.enabled ?? false"
              @update:model-value="updateFilterTreeSettings({ enabled: Boolean($event) })"
            />
            <span>{{ t('schedulerSettings.filterTree', 'Tree view for first filter level') }}</span>
          </label>

          <div
            v-if="settings.resource.filter.tree?.enabled"
            class="scheduler-settings-panel__grid"
          >
            <label class="scheduler-settings-field">
              {{ t('schedulerSettings.filterTreeParentField', 'Parent field') }}
              <Select
                :model-value="settings.resource.filter.tree.parentField"
                :options="filterTreeParentFieldOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('schedulerSettings.selectParentField', 'Select parent field')"
                fluid
                @update:model-value="updateFilterTreeSettings({ parentField: String($event) })"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
          </div>
        </TabPanel>

        <TabPanel value="event">
          <div class="scheduler-settings-tab">
    <section class="scheduler-settings-panel">
      <h3 class="scheduler-settings-panel__title m-0">{{ t('schedulerSettings.event', 'Event') }}</h3>
      <div class="scheduler-settings-panel__grid scheduler-settings-panel__grid--3">
        <label
          v-if="!collection"
          class="scheduler-settings-field"
        >
          {{ t('schedulerSettings.eventCollection', 'Event collection') }}
          <Select
            :model-value="settings.event.collection"
            :options="collections"
            option-label="label"
            option-value="value"
            :placeholder="t('common.selectCollection', 'Select collection')"
            fluid
            @update:model-value="updateEventSettings({ collection: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.eventPrimaryKey', 'Event primary key') }}
          <Select
            :model-value="settings.event.primaryKey"
            :options="eventFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateEventSettings({ primaryKey: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.eventTitleField', 'Event title field') }}
          <Select
            :model-value="settings.event.titleField"
            :options="eventFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateEventSettings({ titleField: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field scheduler-settings-field--wide">
          {{ t('schedulerSettings.eventDisplayFields', 'Event display fields') }}
          <MultiSelect
            :model-value="settings.event.titleFields ?? [settings.event.titleField]"
            :options="eventFieldOptions"
            option-label="label"
            option-value="value"
            display="chip"
            fluid
            @update:model-value="updateEventTitleFields"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.startField', 'Start field') }}
          <Select
            :model-value="settings.event.startField"
            :options="eventFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateEventSettings({ startField: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.endField', 'End field') }}
          <Select
            :model-value="settings.event.endField"
            :options="eventFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateEventSettings({ endField: String($event) })"
          />
        </label>
      </div>

      <label class="scheduler-settings-check">
        <Checkbox
          binary
          :model-value="settings.event.sourceMode === 'templateExpansion'"
          @update:model-value="
            updateEventSettings({
              sourceMode: $event ? 'templateExpansion' : 'direct',
            })
          "
        />
        <span>{{ t('schedulerSettings.templateExpansion', 'Generate events from recurrence rule') }}</span>
      </label>

      <div
        v-if="settings.event.sourceMode === 'templateExpansion'"
        class="scheduler-settings-panel__grid"
      >
        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.ruleField', 'Recurrence rule field') }}
          <Select
            :model-value="settings.event.ruleField ?? ''"
            :options="eventFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateEventSettings({ ruleField: String($event) })"
          />
        </label>
      </div>

      <div class="scheduler-settings-panel__grid scheduler-settings-panel__grid--3">
        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.statusField', 'Status field') }}
          <Select
            :model-value="settings.event.statusField ?? ''"
            :options="optionalEventFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="
              updateEventSettings({ statusField: $event ? String($event) : null })
            "
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.defaultNewEventTitle', 'Default new event title') }}
          <InputText
            :model-value="settings.event.defaultTitle"
            fluid
            @update:model-value="
              updateEventSettings({ defaultTitle: String($event || '') })
            "
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.clickAction', 'On event click') }}
          <Select
            :model-value="settings.event.clickAction ?? 'openDetails'"
            :options="clickActionOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="
              updateEventSettings({ clickAction: $event as SchedulerEventClickAction })
            "
          />
        </label>

        <label class="scheduler-settings-check self-end pb-1">
          <Checkbox
            binary
            :model-value="settings.event.allowDelete ?? false"
            @update:model-value="updateEventSettings({ allowDelete: Boolean($event) })"
          />
          <span>{{ t('schedulerSettings.allowDelete', 'Allow delete from scheduler') }}</span>
        </label>
      </div>
    </section>

    <section class="scheduler-settings-panel">
      <div class="scheduler-settings-panel__heading">
        <h3 class="scheduler-settings-panel__title m-0">
          {{ t('schedulerSettings.statusColors', 'Colors') }}
        </h3>
        <button
          type="button"
          class="scheduler-settings-hint"
          :aria-label="t('common.hint', 'Hint')"
          v-tooltip.bottom="hintTooltip(t(
            'schedulerSettings.statusColorHint',
            'Set an event color for each status value.',
          ))"
        />
      </div>
      <p
        v-if="!settings.event.statusField"
        class="scheduler-settings-muted m-0"
      >
        {{ t('schedulerSettings.statusFieldRequiredForColors', 'Select a status field to configure colors.') }}
      </p>
      <div
        v-else-if="statusColorsLoading"
        class="flex items-center gap-3 text-muted-color"
      >
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('schedulerSettings.loadingStatusValues', 'Loading status values...') }}</span>
      </div>
      <div
        v-else-if="hasStatusColorOptions"
        class="flex flex-col gap-1.5"
      >
        <div
          v-for="item in statusColorOptions"
          :key="item.value"
          class="scheduler-settings-status-row"
        >
          <span class="scheduler-settings-status-row__label">
            {{ item.label }}
            <code>{{ item.value }}</code>
          </span>
          <input
            type="color"
            class="scheduler-settings-status-row__swatch"
            :value="statusColorValue(item.value)"
            @input="handleStatusColorInput(item.value, $event)"
          >
          <InputText
            :model-value="statusColorTextValue(item.value)"
            placeholder="#3b82f6"
            class="w-full"
            @update:model-value="updateStatusColor(item.value, String($event || ''))"
          />
          <Button
            :label="t('schedulerSettings.defaultColor', 'Default')"
            size="small"
            severity="secondary"
            text
            @click="clearStatusColor(item.value)"
          />
        </div>
      </div>
      <p
        v-else
        class="scheduler-settings-muted m-0"
      >
        {{ t('schedulerSettings.noStatusColorOptions', 'No picklist values found for this status field.') }}
      </p>
    </section>
          </div>
        </TabPanel>

        <TabPanel value="availability">
          <div class="scheduler-settings-tab">
    <section class="scheduler-settings-panel">
      <div class="scheduler-settings-panel__heading">
        <h3 class="scheduler-settings-panel__title m-0">
          {{ t('schedulerSettings.availability', 'Availability') }}
        </h3>
        <button
          type="button"
          class="scheduler-settings-hint"
          :aria-label="t('common.hint', 'Hint')"
          v-tooltip.bottom="hintTooltip(t(
            'schedulerSettings.availabilityHint',
            'When enabled, new events can only be created inside an intake window and never overlapping a block window.',
          ))"
        />
        <label class="scheduler-settings-check ml-auto">
          <Checkbox
            binary
            :model-value="availability?.enabled ?? false"
            @update:model-value="updateAvailabilitySettings({ enabled: Boolean($event) })"
          />
          <span>{{ t('schedulerSettings.availabilityToggle', 'Enforce availability') }}</span>
        </label>
      </div>

      <div
        v-if="availability?.enabled"
        class="scheduler-settings-panel__grid scheduler-settings-panel__grid--3"
      >
        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityCollection', 'Availability collection') }}
          <Select
            :model-value="availability.collection"
            :options="collections"
            option-label="label"
            option-value="value"
            :placeholder="t('common.selectCollection', 'Select collection')"
            fluid
            @update:model-value="updateAvailabilitySettings({ collection: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityResourceField', 'Resource field') }}
          <Select
            :model-value="availability.resourceField"
            :options="availabilityResourceFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateAvailabilitySettings({ resourceField: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityStartField', 'Slot start field') }}
          <Select
            :model-value="availability.startField"
            :options="availabilityFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateAvailabilitySettings({ startField: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityEndField', 'Slot end field') }}
          <Select
            :model-value="availability.endField"
            :options="availabilityFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateAvailabilitySettings({ endField: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityTypeField', 'Slot type field') }}
          <Select
            :model-value="availability.typeField"
            :options="availabilityFieldOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateAvailabilitySettings({ typeField: String($event) })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityIntakeValue', 'Intake value') }}
          <Select
            v-if="hasAvailabilityTypeOptions"
            :model-value="availability.intakeValue"
            :options="availabilityTypeOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateAvailabilitySettings({ intakeValue: String($event) })"
          />
          <InputText
            v-else
            :model-value="availability.intakeValue"
            fluid
            @update:model-value="updateAvailabilitySettings({ intakeValue: String($event || '') })"
          />
        </label>

        <label class="scheduler-settings-field">
          {{ t('schedulerSettings.availabilityBlockValue', 'Block value') }}
          <Select
            v-if="hasAvailabilityTypeOptions"
            :model-value="availability.blockValue"
            :options="availabilityTypeOptions"
            option-label="label"
            option-value="value"
            fluid
            @update:model-value="updateAvailabilitySettings({ blockValue: String($event) })"
          />
          <InputText
            v-else
            :model-value="availability.blockValue"
            fluid
            @update:model-value="updateAvailabilitySettings({ blockValue: String($event || '') })"
          />
        </label>
      </div>
    </section>
          </div>
        </TabPanel>

        <TabPanel value="preview">
          <div class="scheduler-settings-tab scheduler-settings-tab--preview">
            <CrmScheduler
              v-if="activeTab === 'preview'"
              :settings="settings"
              class="scheduler-settings-preview"
            />
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <div
      v-if="!builderManaged"
      class="flex items-center gap-2 px-0.5"
    >
      <Button
        :label="t('schedulerSettings.saveSettings', 'Save scheduler settings')"
        size="small"
        severity="secondary"
        text
        :loading="saving"
        :disabled="!canSaveSettings"
        @click="saveSettings"
      />
    </div>
  </div>
</template>

<style scoped>
.scheduler-settings-designer {
  --sched-wash: #edf3f4;
  --sched-ink: #37352f;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  font-family: Inter, system-ui, sans-serif;
  color: var(--sched-ink);
}

.scheduler-settings-designer__loading :deep(.p-progressspinner) {
  height: 1.5rem;
  width: 1.5rem;
}

.scheduler-settings-tabs :deep(.p-tablist) {
  margin: 0 0.05rem;
}

.scheduler-settings-tabs :deep(.p-tablist-tab-list) {
  gap: 0.2rem;
  background: var(--sched-wash);
  border: 0;
  border-radius: 8px;
  padding: 0.2rem;
}

.scheduler-settings-tabs :deep(.p-tablist-active-bar) {
  display: none;
}

.scheduler-settings-tabs :deep(.p-tab) {
  padding: 0.45rem 0.9rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(55, 53, 47, 0.62);
}

.scheduler-settings-tabs :deep(.p-tab:hover) {
  background: rgba(255, 255, 255, 0.55);
  color: var(--sched-ink);
}

.scheduler-settings-tabs :deep(.p-tab-active),
.scheduler-settings-tabs :deep(.p-tab[data-p-active='true']) {
  background: #fff;
  color: var(--sched-ink);
  box-shadow: 0 0 0 1px rgba(55, 53, 47, 0.08), 0 1px 2px rgba(55, 53, 47, 0.08);
}

.scheduler-settings-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.scheduler-settings-tabs :deep(.p-tabpanels) {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0.55rem 0 0;
  background: transparent;
}

.scheduler-settings-tabs :deep(.p-tabpanel) {
  height: 100%;
  padding: 0;
}

.scheduler-settings-tab {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.1rem;
}

.scheduler-settings-tab--preview {
  overflow: hidden;
}

.scheduler-settings-preview {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.scheduler-settings-panel {
  width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 0.55rem;
  border-radius: 8px;
  background: var(--sched-wash);
  padding: 0.55rem 0.5rem 0.65rem;
}

.scheduler-settings-panel__heading {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.scheduler-settings-panel__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.scheduler-settings-panel__grid {
  display: grid;
  gap: 0.5rem 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.scheduler-settings-panel__grid--3 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 720px) {
  .scheduler-settings-panel__grid--3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.scheduler-settings-field {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.scheduler-settings-field--wide {
  grid-column: 1 / -1;
}

.scheduler-settings-subhead {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(55, 53, 47, 0.7);
}

.scheduler-settings-muted {
  font-size: 0.75rem;
  color: rgba(55, 53, 47, 0.5);
}

.scheduler-settings-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.65);
  font-size: 0.75rem;
  color: rgba(55, 53, 47, 0.65);
}

.scheduler-settings-meta strong {
  font-weight: 600;
  color: var(--sched-ink);
}

.scheduler-settings-check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.7);
  cursor: pointer;
}

.scheduler-settings-level {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.5rem 0.65rem;
  align-items: end;
  padding: 0.4rem 0.45rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.65);
}

.scheduler-settings-level__remove {
  width: 1.75rem;
  height: 1.75rem;
  margin-bottom: 0.1rem;
}

.scheduler-settings-status-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(7rem, 9rem) auto;
  gap: 0.45rem;
  align-items: center;
  padding: 0.35rem 0.45rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.65);
}

.scheduler-settings-status-row__label {
  display: grid;
  gap: 0.1rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--sched-ink);
  min-width: 0;
}

.scheduler-settings-status-row__label code {
  font-size: 0.68rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.5);
}

.scheduler-settings-status-row__swatch {
  width: 2rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.scheduler-settings-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.scheduler-settings-hint:focus-visible {
  outline: 2px solid rgba(55, 53, 47, 0.35);
  outline-offset: 2px;
}

.scheduler-settings-hint::before {
  content: 'i';
}
</style>

<style>
.scheduler-settings-hint-tooltip,
.scheduler-settings-hint-tooltip .p-tooltip-text {
  max-width: 18rem;
  font-size: 0.75rem;
  line-height: 1.35;
}
</style>
