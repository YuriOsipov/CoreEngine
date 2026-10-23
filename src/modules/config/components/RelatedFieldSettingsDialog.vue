<script lang="ts">
export default {
  name: 'RelatedFieldSettingsDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DataTableSettings,
  LayoutFieldMetadata,
  PrimeVueComponentType,
  SchedulerSettings,
  TreeTableSettings,
} from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { normalizeTableSettings } from '@/modules/entities/services/tableSettings'
import { normalizeSchedulerSettings } from '@/modules/config/services/schedulerSettings'
import DataTableSettingsDesigner from './DataTableSettingsDesigner.vue'
import SchedulerSettingsDesigner from './SchedulerSettingsDesigner.vue'
import TreeTableSettingsDesigner from './TreeTableSettingsDesigner.vue'

export interface RelatedFieldSettingsApplyPayload {
  dataTable?: DataTableSettings
  treeTable?: TreeTableSettings
  scheduler?: SchedulerSettings
  field?: string
}

const props = defineProps<{
  visible: boolean
  field: LayoutFieldMetadata | null
  parentCollection?: string
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  apply: [payload: RelatedFieldSettingsApplyPayload]
}>()

const { t } = useTranslation()

const dataTableDraft = ref<DataTableSettings>({ columns: [], sort: null, groupBy: null })
const treeTableDraft = ref<TreeTableSettings | null>(null)
const schedulerDraft = ref<SchedulerSettings | null>(null)

const dialogVisible = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

const componentType = computed<PrimeVueComponentType | null>(
  () => props.field?.component ?? null,
)

const isDataTable = computed(() => componentType.value === 'DataTable')
const isTreeTable = computed(() => componentType.value === 'CrmTreeTable')
const isScheduler = computed(() => componentType.value === 'CrmScheduler')

const dialogHeader = computed(() => {
  const label = props.field?.label?.trim()
  if (label) {
    return t('formBuilder.relatedFieldDialogTitle', 'Configure {label}', { label })
  }
  return t('formBuilder.relatedFieldDialogTitleDefault', 'Configure related field')
})

const relatedCollection = computed(() => props.field?.relatedCollection ?? '')

function defaultTreeTableSettings(): TreeTableSettings {
  return {
    group: {
      collection: '',
      primaryKey: 'id',
      parentField: null,
      labelField: 'name',
    },
    main: {
      collection: '',
      groupField: '',
      primaryKey: 'id',
      labelField: 'name',
      labelFields: ['name'],
    },
    destination: {
      collection: props.parentCollection ?? '',
      key: props.field?.field ?? 'items',
    },
  }
}

function defaultSchedulerSettings(): SchedulerSettings {
  return normalizeSchedulerSettings({
    event: {
      collection: props.parentCollection ?? '',
      primaryKey: 'id',
      titleField: 'name',
      startField: 'start',
      endField: 'end',
      resourceField: '',
      defaultTitle: t('scheduler.createDefaultTitle', 'New visit'),
    },
  })
}

function cloneDataTableSettings(settings?: DataTableSettings | null): DataTableSettings {
  return normalizeTableSettings(
    settings
      ? JSON.parse(JSON.stringify(settings)) as DataTableSettings
      : { columns: [], sort: null, groupBy: null },
  )
}

function cloneTreeTableSettings(settings?: TreeTableSettings | null): TreeTableSettings {
  const base = settings ?? defaultTreeTableSettings()
  return JSON.parse(JSON.stringify(base)) as TreeTableSettings
}

function cloneSchedulerSettings(settings?: SchedulerSettings | null): SchedulerSettings {
  const base = settings ?? defaultSchedulerSettings()
  return JSON.parse(JSON.stringify(base)) as SchedulerSettings
}

function resetDrafts(): void {
  dataTableDraft.value = cloneDataTableSettings(props.field?.dataTable)
  treeTableDraft.value = cloneTreeTableSettings(props.field?.treeTable)
  schedulerDraft.value = cloneSchedulerSettings(props.field?.scheduler)
}

watch(
  () => [props.visible, props.field?.id] as const,
  ([visible]) => {
    if (!visible) return
    resetDrafts()
  },
)

function closeDialog(): void {
  dialogVisible.value = false
}

function applySettings(): void {
  if (!props.field) return

  if (isDataTable.value) {
    emit('apply', {
      dataTable: cloneDataTableSettings(dataTableDraft.value),
    })
  } else if (isTreeTable.value && treeTableDraft.value) {
    emit('apply', {
      treeTable: cloneTreeTableSettings(treeTableDraft.value),
      field: treeTableDraft.value.destination.key || props.field.field,
    })
  } else if (isScheduler.value && schedulerDraft.value) {
    emit('apply', {
      scheduler: cloneSchedulerSettings(schedulerDraft.value),
    })
  }

  closeDialog()
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    maximizable
    :header="dialogHeader"
    class="related-field-settings-dialog"
    :style="{ width: 'min(1100px, 96vw)', maxHeight: '92vh' }"
    :content-style="{
      maxHeight: 'calc(92vh - 8.5rem)',
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
    }"
  >
    <p
      v-if="relatedCollection"
      class="related-field-settings-dialog__meta m-0 shrink-0 text-[0.85rem] text-muted-color"
    >
      {{ t('formBuilder.relatedCollection', 'Related collection') }}:
      <code>{{ relatedCollection }}</code>
    </p>

    <DataTableSettingsDesigner
      v-if="isDataTable && relatedCollection"
      v-model="dataTableDraft"
      :collection="relatedCollection"
      :parent-collection="parentCollection"
      class="related-field-settings-dialog__designer mt-3"
    />

    <TreeTableSettingsDesigner
      v-else-if="isTreeTable && treeTableDraft"
      v-model="treeTableDraft"
      :collection="parentCollection"
      class="related-field-settings-dialog__designer mt-3"
    />

    <SchedulerSettingsDesigner
      v-else-if="isScheduler && schedulerDraft"
      v-model="schedulerDraft"
      :collection="parentCollection"
      class="related-field-settings-dialog__designer mt-3"
    />

    <Message
      v-else
      severity="warn"
      :closable="false"
      class="mt-3 shrink-0"
    >
      {{ t('formBuilder.relatedFieldDialogUnsupported', 'This field type cannot be configured here.') }}
    </Message>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="closeDialog"
      />
      <Button
        :label="t('common.apply', 'Apply')"
        @click="applySettings"
      />
    </template>
  </Dialog>
</template>

<style>
.related-field-settings-dialog.p-dialog {
  display: flex;
  flex-direction: column;
  min-height: min(44rem, 92vh);
  max-height: 92vh;
}

.related-field-settings-dialog .p-dialog-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding-bottom: 0.75rem !important;
}

.related-field-settings-dialog .p-dialog-content > .related-field-settings-dialog__designer {
  flex: 0 0 auto;
  align-self: stretch;
  min-height: 0;
  height: auto;
  overflow: visible;
}

.related-field-settings-dialog .p-dialog-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 1.25rem 1rem;
  border-top: 1px solid rgba(55, 53, 47, 0.1);
}
</style>
