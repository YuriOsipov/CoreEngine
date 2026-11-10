<script lang="ts">
export default {
  name: 'ObjectListDetailPanel',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RelatedListFieldHost from '@/modules/entities/components/RelatedListFieldHost.vue'
import DocTemplatePickerDialog from '@/modules/documents/components/DocTemplatePickerDialog.vue'
import DocValueListDialog from '@/modules/documents/components/DocValueListDialog.vue'
import DocFillDialog from '@/modules/documents/components/DocFillDialog.vue'
import DocViewDialog from '@/modules/documents/components/DocViewDialog.vue'
import ActionNumberPromptDialog from '@/core/ui-kit/ActionNumberPromptDialog.vue'
import { useEntityRecordActions } from '@/modules/entities/composables/useEntityRecordActions'
import type { EntityAction, LayoutFieldMetadata, ListViewDetailPanel } from '@/interfaces'
import { loadEntityLayoutById } from '@/modules/config/services/layoutSettings'
import {
  findBlockLayoutRelatedListField,
  listBlockLayoutRelatedListFields,
  relatedListFieldTabLabel,
} from '@/modules/config/utils/recordPageRelatedList'
import { canReadEntity, ensureEntityPermissions } from '@/core/entityPermissions'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  collection: string
  /** Prefetched related fields from Page Layout (preferred). */
  relatedFields?: LayoutFieldMetadata[]
  /** Prefetched actions from Page Layout default / detail Block Layout. */
  detailActions?: EntityAction[]
  /** @deprecated Legacy list-view detailPanel config when fields are not passed. */
  detailPanel?: ListViewDetailPanel | null
  parentId?: string | number | null
  parentRecord?: Record<string, unknown> | null
  loading?: boolean
  loadError?: string | null
}>()

const emit = defineEmits<{
  'view-record': [row: Record<string, unknown>, relatedCollection: string]
}>()

const { t } = useTranslation()

const legacyLoading = ref(false)
const legacyLoadError = ref<string | null>(null)
const legacyRelatedFields = ref<LayoutFieldMetadata[]>([])
const legacyDetailActions = ref<EntityAction[]>([])
const activeTab = ref<string>('')

const usePrefetched = computed(() => props.relatedFields !== undefined)

const hasParent = computed(
  () => props.parentId !== undefined && props.parentId !== null && props.parentId !== '',
)

const {
  actionRunning,
  actionMessage,
  actionError,
  templatePickerVisible,
  templatePickerLoading,
  publishedTemplates,
  docValueListVisible,
  docValueListLoading,
  docValueListItems,
  fillDialogVisible,
  fillTemplateId,
  fillDocValueId,
  fillExportMode,
  fillAttachFile,
  viewDialogVisible,
  viewTemplateId,
  viewDocValueId,
  viewMode,
  viewAutoSave,
  numberPromptVisible,
  numberPromptLabel,
  numberPromptHeader,
  runEntityAction,
  onNumberPromptConfirm,
  onExistingDocumentSelected,
  onNewDocumentFromList,
  onRuntimeTemplateSelected,
} = useEntityRecordActions({
  collection: () => props.collection,
  recordId: () => String(props.parentId ?? ''),
  record: () => props.parentRecord ?? {},
})

const legacyField = computed<LayoutFieldMetadata | null>(() => {
  const relatedCollection = props.detailPanel?.relatedCollection?.trim()
  if (!relatedCollection) return null
  return {
    id: 'object-list-detail-panel-legacy',
    field: relatedCollection,
    label: props.detailPanel?.label?.trim() || relatedCollection,
    component: 'DataTable',
    relatedCollection,
    dataTable: {
      ...(props.detailPanel?.dataTable ?? { columns: [] }),
      rowLimit: props.detailPanel?.dataTable?.rowLimit ?? 25,
    },
  }
})

const permissionsTick = ref(0)

void ensureEntityPermissions().then(() => {
  permissionsTick.value += 1
})

const displayFields = computed(() => {
  void permissionsTick.value
  const fields = usePrefetched.value
    ? (props.relatedFields ?? [])
    : legacyRelatedFields.value.length > 0
      ? legacyRelatedFields.value
      : legacyField.value
        ? [legacyField.value]
        : []
  return fields.filter((field) => canReadEntity(field.relatedCollection))
})

const resolvedActions = computed(() =>
  usePrefetched.value ? (props.detailActions ?? []) : legacyDetailActions.value,
)

const isLoading = computed(() =>
  usePrefetched.value ? Boolean(props.loading) : legacyLoading.value,
)

const resolvedLoadError = computed(() =>
  usePrefetched.value ? (props.loadError ?? null) : legacyLoadError.value,
)

const useTabs = computed(() => displayFields.value.length > 1)

const showContent = computed(
  () => hasParent.value && (displayFields.value.length > 0 || resolvedActions.value.length > 0),
)

watch(
  () =>
    [
      props.collection,
      usePrefetched.value,
      props.detailPanel?.blockLayoutId ?? '',
      props.detailPanel?.relatedFieldId ?? '',
      props.detailPanel?.relatedCollection ?? '',
    ] as const,
  () => {
    if (usePrefetched.value) {
      legacyRelatedFields.value = []
      legacyDetailActions.value = []
      legacyLoadError.value = null
      legacyLoading.value = false
      return
    }
    void loadLegacyLayoutContent()
  },
  { immediate: true },
)

watch(
  displayFields,
  (fields) => {
    if (!fields.length) {
      activeTab.value = ''
      return
    }
    if (!fields.some((field) => field.id === activeTab.value)) {
      activeTab.value = fields[0]!.id
    }
  },
  { immediate: true },
)

watch(
  () => props.parentId,
  () => {
    actionMessage.value = null
    actionError.value = null
  },
)

async function loadLegacyLayoutContent(): Promise<void> {
  const blockLayoutId = props.detailPanel?.blockLayoutId?.trim()
  if (!blockLayoutId) {
    legacyRelatedFields.value = []
    legacyDetailActions.value = []
    legacyLoadError.value = null
    legacyLoading.value = false
    return
  }

  legacyLoading.value = true
  legacyLoadError.value = null
  try {
    const schema = await loadEntityLayoutById(props.collection, blockLayoutId)
    legacyDetailActions.value = Array.isArray(schema?.actions) ? schema.actions : []
    const all = listBlockLayoutRelatedListFields(schema)
    const relatedFieldId = props.detailPanel?.relatedFieldId?.trim()
    if (relatedFieldId) {
      const matched =
        findBlockLayoutRelatedListField(schema, relatedFieldId, null) ??
        all.find((field) => field.id === relatedFieldId) ??
        null
      legacyRelatedFields.value = matched ? [matched] : []
    } else {
      legacyRelatedFields.value = all
    }
  } catch (err) {
    legacyRelatedFields.value = []
    legacyDetailActions.value = []
    legacyLoadError.value =
      err instanceof Error
        ? err.message
        : t('objectList.detailLoadLayoutError', 'Failed to load Block Layout related lists.')
  } finally {
    legacyLoading.value = false
  }
}

function emitViewRecord(row: Record<string, unknown>, relatedCollection: string): void {
  emit('view-record', row, relatedCollection)
}
</script>

<template>
  <div class="object-list-detail-panel flex h-full min-h-0 flex-col overflow-hidden">
    <p
      v-if="!hasParent"
      class="m-0 px-3 py-4 text-sm text-muted-color"
    >
      {{
        t(
          'objectList.detailSelectRecord',
          'Select a record to see related items.',
        )
      }}
    </p>

    <div
      v-else-if="isLoading"
      class="flex items-center gap-2 px-3 py-4 text-sm text-muted-color"
    >
      <ProgressSpinner style="width: 1.25rem; height: 1.25rem" stroke-width="6" />
      <span>{{ t('objectList.detailLoadingRelated', 'Loading related lists...') }}</span>
    </div>

    <Message
      v-else-if="resolvedLoadError"
      severity="error"
      :closable="false"
      class="m-2"
    >
      {{ resolvedLoadError }}
    </Message>

    <p
      v-else-if="!showContent"
      class="m-0 px-3 py-4 text-sm text-muted-color"
    >
      {{
        t(
          'objectList.detailNoRelatedLists',
          'No related lists on the Page Layout.',
        )
      }}
    </p>

    <template v-else>
      <Message
        v-if="actionError"
        severity="error"
        :closable="true"
        class="m-2 mb-0"
        @close="actionError = null"
      >
        {{ actionError }}
      </Message>
      <Message
        v-else-if="actionMessage"
        severity="success"
        :closable="true"
        class="m-2 mb-0"
        @close="actionMessage = null"
      >
        {{ actionMessage }}
      </Message>

      <!-- Single related list (or actions-only): actions row above content -->
      <template v-if="!useTabs">
        <div
          v-if="resolvedActions.length > 0"
          class="object-list-detail-panel__actions flex flex-shrink-0 flex-wrap items-center justify-end gap-1 border-b border-surface-200 px-2 py-1 dark:border-surface-700"
        >
          <Button
            v-for="action in resolvedActions"
            :key="action.id"
            :label="action.label"
            size="small"
            :loading="actionRunning[action.id]"
            :disabled="!hasParent"
            @click="runEntityAction(action)"
          />
        </div>
        <RelatedListFieldHost
          v-if="displayFields[0]"
          class="object-list-detail-panel__table min-h-0 flex-1 overflow-auto"
          :field="displayFields[0]"
          :collection="collection"
          :record-id="parentId"
          :record="parentRecord"
          show-create
          show-actions
          m2a-editable
          @view-record="emitViewRecord"
        />
      </template>

      <!-- Multiple related lists: actions beside TabList -->
      <Tabs
        v-else
        v-model:value="activeTab"
        class="object-list-detail-panel__tabs flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div class="object-list-detail-panel__tab-bar flex min-w-0 items-center gap-2 px-2">
          <TabList class="object-list-detail-panel__tab-list min-w-0 flex-1">
            <Tab
              v-for="field in displayFields"
              :key="field.id"
              :value="field.id"
            >
              {{ relatedListFieldTabLabel(field) }}
            </Tab>
          </TabList>
          <div
            v-if="resolvedActions.length > 0"
            class="object-list-detail-panel__actions flex flex-shrink-0 flex-wrap items-center justify-end gap-1"
          >
            <Button
              v-for="action in resolvedActions"
              :key="action.id"
              :label="action.label"
              size="small"
              :loading="actionRunning[action.id]"
              :disabled="!hasParent"
              @click="runEntityAction(action)"
            />
          </div>
        </div>
        <TabPanels class="min-h-0 flex-1 overflow-hidden">
          <TabPanel
            v-for="field in displayFields"
            :key="field.id"
            :value="field.id"
            class="h-full min-h-0 overflow-auto"
          >
            <RelatedListFieldHost
              class="object-list-detail-panel__table"
              :field="field"
              :collection="collection"
              :record-id="parentId"
              :record="parentRecord"
              :active="activeTab === field.id"
              show-create
              show-actions
              m2a-editable
              @view-record="emitViewRecord"
            />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>

    <DocTemplatePickerDialog
      v-model:visible="templatePickerVisible"
      :templates="publishedTemplates"
      :loading="templatePickerLoading"
      @select="onRuntimeTemplateSelected"
    />

    <DocValueListDialog
      v-model:visible="docValueListVisible"
      :documents="docValueListItems"
      :loading="docValueListLoading"
      @select="onExistingDocumentSelected"
      @new-document="onNewDocumentFromList"
    />

    <DocFillDialog
      v-if="hasParent && fillTemplateId"
      v-model:visible="fillDialogVisible"
      :collection="collection"
      :record-id="String(parentId ?? '')"
      :template-id="fillTemplateId"
      :doc-value-id="fillDocValueId"
      :export-mode="fillExportMode"
      :attach-file="fillAttachFile"
    />

    <DocViewDialog
      v-if="hasParent && viewTemplateId"
      v-model:visible="viewDialogVisible"
      :collection="collection"
      :record-id="String(parentId ?? '')"
      :template-id="viewTemplateId"
      :doc-value-id="viewDocValueId"
      :view-mode="viewMode"
      :auto-save="viewAutoSave"
    />

    <ActionNumberPromptDialog
      v-model:visible="numberPromptVisible"
      :header="numberPromptHeader"
      :label="numberPromptLabel"
      @confirm="onNumberPromptConfirm"
    />
  </div>
</template>

<style scoped>
.object-list-detail-panel__tabs :deep(.p-tablist) {
  border-width: 0;
}

.object-list-detail-panel__tab-bar {
  border-bottom: 1px solid var(--p-content-border-color, var(--p-surface-200));
}

.object-list-detail-panel__tabs :deep(.p-tabpanels) {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0.5rem 0 0;
  overflow: hidden;
}

.object-list-detail-panel__tabs :deep(.p-tabpanel) {
  height: 100%;
  min-height: 0;
}
</style>
