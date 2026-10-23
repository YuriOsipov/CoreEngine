<script lang="ts">
export default {
  name: 'RelatedTransferField',
}
</script>

<script setup lang="ts">
import type { RelatedTransferSettings } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { useRelatedTransfer } from '@/modules/entities/composables/useRelatedTransfer'
import RelatedTransferHeader from '@/modules/entities/components/related-transfer/RelatedTransferHeader.vue'
import RelatedTransferSourcePanel from '@/modules/entities/components/related-transfer/RelatedTransferSourcePanel.vue'
import RelatedTransferSelectedPanel from '@/modules/entities/components/related-transfer/RelatedTransferSelectedPanel.vue'

const props = defineProps<{
  settings?: RelatedTransferSettings | null
  label?: string
  parentRecord: Record<string, unknown>
  parentCollection?: string
  parentId?: string | number
  targetParentField?: string
  currentTargetRows?: Record<string, unknown>[]
}>()

const emit = defineEmits<{
  submitted: [targetCollection: string]
}>()

const { t } = useTranslation()

const transfer = useRelatedTransfer({
  settings: () => props.settings,
  label: () => props.label,
  parentRecord: () => props.parentRecord,
  parentCollection: () => props.parentCollection,
  parentId: () => props.parentId,
  targetParentField: () => props.targetParentField,
  currentTargetRows: () => props.currentTargetRows,
  t,
  emitSubmitted: (collection) => emit('submitted', collection),
})
</script>

<template>
  <Panel class="related-transfer-field">
    <template #header>
      <RelatedTransferHeader
        :label="transfer.label.value ?? t('relatedTransfer.batchInsert', 'Batch insert')"
        :lookup-header-items="transfer.lookupHeaderItems.value"
        :computed-totals="transfer.computedTotals.value"
        :loading="transfer.loading.value"
        :submitting="transfer.submitting.value"
        :is-configured="transfer.isConfigured.value"
        :pending-count="transfer.pendingRows.value.length"
        :format-transfer-value="transfer.formatTransferValue"
        :refresh-label="t('common.refresh', 'Refresh')"
        :submit-label="t('relatedTransfer.submit', 'Submit selected')"
        @refresh="transfer.loadTransferData"
        @submit="transfer.submitPending"
      />
    </template>

    <Message
      v-if="!transfer.isConfigured.value"
      severity="warn"
      :closable="false"
    >
      {{ t('relatedTransfer.notConfigured', 'Related transfer is not configured.') }}
    </Message>

    <Message
      v-else-if="transfer.error.value"
      severity="error"
      :closable="false"
    >
      {{ transfer.error.value }}
    </Message>

    <Splitter
      v-if="transfer.isConfigured.value"
      :layout="transfer.shouldSplitSourceTree.value ? 'vertical' : 'horizontal'"
      state-key="related-transfer-splitter"
      state-storage="local"
      class="related-transfer-splitter"
    >
      <SplitterPanel :size="50" :min-size="20">
      <RelatedTransferSourcePanel
        :loading-source="transfer.loadingSource.value"
        :source-panel-style="transfer.sourcePanelStyle.value"
        :source-search-query="transfer.sourceSearchQuery.value"
        :search-placeholder="t('relatedTransfer.searchSource', 'Search...')"
        :source-title="t('relatedTransfer.source', 'Source')"
        :should-split-source-tree="transfer.shouldSplitSourceTree.value"
        :tree-mode-source-scroll-height="transfer.treeModeSourceScrollHeight"
        :table-mode-scroll-height="transfer.tableModeScrollHeight"
        :source-group-tree-nodes="transfer.sourceGroupTreeNodes.value"
        :groups-title="t('relatedTransfer.groups', 'Groups')"
        :items-title="t('relatedTransfer.items', 'Items')"
        :filtered-sorted-source-items="transfer.filteredSortedSourceItems.value"
        :source-table-columns="transfer.sourceTableColumns.value"
        :source-sort-field="transfer.sourceSortField.value"
        :source-sort-order="transfer.sourceSortOrder.value"
        :selected-source-group-id="transfer.selectedSourceGroupId.value"
        :select-group-message="t('relatedTransfer.selectSourceGroup', 'Select a group to show items.')"
        :no-source-items-message="t('relatedTransfer.noSourceItems', 'No source items found.')"
        :existing-duplicate-values="transfer.existingDuplicateValues.value"
        :source-primary-key="transfer.sourcePrimaryKey.value"
        :submitting="transfer.submitting.value"
        :add-label="t('common.add', 'Add')"
        :source-display-value="transfer.sourceDisplayValue"
        :is-numeric-source-field="transfer.isNumericSourceField"
        :source-value="transfer.sourceValue"
        :is-selected-source-group="transfer.isSelectedSourceGroup"
        @update:source-search-query="transfer.sourceSearchQuery.value = $event"
        @select-group="transfer.selectSourceGroup"
        @sort="transfer.onSourceSort"
        @add="transfer.addSourceItem"
      />
      </SplitterPanel>

      <SplitterPanel :size="50" :min-size="20">
      <RelatedTransferSelectedPanel
        :selected-panel-style="transfer.selectedPanelStyle.value"
        :selected-title="t('relatedTransfer.selected', 'Selected')"
        :pending-count="transfer.pendingRows.value.length"
        :selected-rows="transfer.selectedRows.value"
        :target-columns="transfer.targetColumns.value"
        :loading-target="transfer.loadingTarget.value"
        :scroll-height="transfer.shouldSplitSourceTree.value
          ? transfer.treeModeSelectedScrollHeight
          : transfer.tableModeScrollHeight"
        :empty-message="t('relatedTransfer.noSelectedItems', 'No selected items yet.')"
        :has-any-total="transfer.hasAnyTotal.value"
        :selected-column-totals="transfer.selectedColumnTotals.value"
        :submitting="transfer.submitting.value"
        :state-header="t('relatedTransfer.state', 'State')"
        :total-label="t('relatedTransfer.total', 'Total')"
        :pending-label="t('relatedTransfer.pending', 'Pending')"
        :current-label="t('relatedTransfer.current', 'Current')"
        :select-lookup-placeholder="t('relatedTransfer.selectLookupValue', 'Select value')"
        :format-field-value="transfer.formatTargetFieldValue"
        :row-value="transfer.rowValue"
        :is-editable-pending-field="transfer.isEditablePendingField"
        :is-numeric-target-field="transfer.isNumericTargetField"
        :is-child-lookup-pending-field="transfer.isChildLookupPendingField"
        :child-lookup-settings-for-field="transfer.childLookupSettingsForField"
        :lookup-select-options="transfer.lookupSelectOptions"
        :target-collection="transfer.targetCollection.value"
        :parent-collection="transfer.parentCollection.value"
        :parent-id="transfer.parentId.value"
        :parent-name="transfer.parentName.value"
        :parent-record="transfer.parentRecord.value"
        :source-primary-key="transfer.sourcePrimaryKey.value"
        @update-draft="transfer.updatePendingDraft"
        @remove="transfer.removePending"
      />
      </SplitterPanel>
    </Splitter>
  </Panel>
</template>

<style scoped>
.related-transfer-field {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.related-transfer-field :deep(.p-panel-header) {
  flex: 0 0 auto;
}

.related-transfer-field :deep(.p-panel-content-container),
.related-transfer-field :deep(.p-panel-content-wrapper),
.related-transfer-field :deep(.p-panel-content) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.related-transfer-splitter {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: none;
  background: transparent;
}

.related-transfer-splitter :deep(.p-splitter-panel) {
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  flex-grow: 0;
  display: flex;
  flex-direction: column;
}
</style>
