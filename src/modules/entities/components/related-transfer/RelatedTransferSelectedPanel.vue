<script setup lang="ts">
import type { DataTableColumnConfig, LayoutFieldChildLookup } from '@/interfaces'
import CrmChildLookupField from '@/core/ui-kit/CrmChildLookupField.vue'
import type { TransferRow } from './types'

const props = defineProps<{
  selectedPanelStyle: Record<string, string>
  selectedTitle: string
  pendingCount: number
  selectedRows: TransferRow[]
  targetColumns: DataTableColumnConfig[]
  loadingTarget: boolean
  scrollHeight: string
  emptyMessage: string
  hasAnyTotal: boolean
  selectedColumnTotals: Record<string, number>
  submitting: boolean
  stateHeader: string
  totalLabel: string
  pendingLabel: string
  currentLabel: string
  selectLookupPlaceholder: string
  formatTransferValue: (value: unknown) => string
  rowValue: (row: TransferRow, field: string) => unknown
  isEditablePendingField: (row: TransferRow, field: string) => boolean
  isNumericTargetField: (field: string) => boolean
  isChildLookupPendingField: (row: TransferRow, field: string) => boolean
  childLookupSettingsForField: (field: string) => LayoutFieldChildLookup | undefined
  lookupSelectOptions: (row: TransferRow, field: string) => Array<{ label: string; value: unknown }>
  targetCollection: string
  parentCollection: string
  parentId?: string | number
  parentName: string
  parentRecord: Record<string, unknown>
  sourcePrimaryKey: string
}>()

const emit = defineEmits<{
  'update-draft': [row: TransferRow, field: string, value: unknown]
  remove: [row: TransferRow]
}>()

function isNumericColumn(field: string): boolean {
  return props.isNumericTargetField(field)
}

/** Keep header/body/footer widths in sync for scrollable DataTable. */
function columnWidthStyle(field: string): string | undefined {
  if (props.childLookupSettingsForField(field)) return 'width: 12rem; min-width: 12rem'
  if (isNumericColumn(field)) return 'width: 7rem; min-width: 7rem'
  return undefined
}

function quantityModelValue(row: TransferRow, field: string): number {
  const raw = props.rowValue(row, field)
  const n = Number(raw)
  return isFinite(n) ? n : 0
}
</script>

<template>
  <section
    class="border border-surface-200 rounded-lg p-3 bg-surface-0 min-h-0 overflow-hidden"
    :style="selectedPanelStyle"
  >
    <div class="flex items-center justify-between mb-3">
      <h3 class="m-0 text-sm">{{ selectedTitle }}</h3>
      <Tag
        :value="String(pendingCount)"
        severity="info"
      />
    </div>

    <DataTable
      :value="selectedRows"
      size="small"
      :loading="loadingTarget"
      scrollable
      :scroll-height="scrollHeight"
      table-style="table-layout: fixed; width: 100%"
      :empty-message="emptyMessage"
      class="related-transfer-selected-table"
    >
      <Column
        v-for="(column, colIndex) in targetColumns"
        :key="column.field"
        :header="column.header"
        :style="columnWidthStyle(column.field)"
        :pt="{
          headerCell: { class: isNumericColumn(column.field) ? 'text-right' : 'text-left' },
          bodyCell: { class: isNumericColumn(column.field) ? 'text-right' : 'text-left' },
          footerCell: { class: isNumericColumn(column.field) ? 'text-right' : 'text-left' },
        }"
      >
        <template #body="{ data }">
          <CrmChildLookupField
            v-if="isChildLookupPendingField(data, column.field)"
            :model-value="rowValue(data, column.field)"
            :settings="childLookupSettingsForField(column.field)"
            :source-record="data.source ?? {}"
            :source-id-field="sourcePrimaryKey"
            :target-field="column.field"
            :entity-collection="targetCollection"
            :parent-collection="parentCollection"
            :parent-id="parentId"
            :parent-name="parentName"
            :parent-record="parentRecord"
            :options="lookupSelectOptions(data, column.field)"
            :placeholder="selectLookupPlaceholder"
            fluid
            size="small"
            input-class="related-transfer-lookup"
            @update:model-value="emit('update-draft', data, column.field, $event)"
          />
          <InputNumber
            v-else-if="isEditablePendingField(data, column.field)"
            :model-value="quantityModelValue(data, column.field)"
            :min="0"
            :min-fraction-digits="0"
            :max-fraction-digits="5"
            :allow-empty="false"
            show-buttons
            button-layout="stacked"
            size="small"
            class="related-transfer-spinner"
            @update:model-value="emit('update-draft', data, column.field, $event ?? 0)"
          />
          <span
            v-else
            class="block truncate"
            :class="isNumericColumn(column.field) ? 'tabular-nums' : undefined"
          >
            {{ formatTransferValue(rowValue(data, column.field)) }}
          </span>
        </template>
        <template v-if="hasAnyTotal" #footer>
          <span
            v-if="selectedColumnTotals[column.field] !== undefined"
            class="font-semibold text-primary-700 tabular-nums"
          >
            {{ formatTransferValue(selectedColumnTotals[column.field]) }}
          </span>
          <span
            v-else-if="colIndex === 0"
            class="text-xs font-semibold text-surface-500"
          >
            {{ totalLabel }}
          </span>
        </template>
      </Column>
      <Column :header="stateHeader" style="width: 6rem">
        <template #body="{ data }">
          <Tag
            :value="data.kind === 'pending' ? pendingLabel : currentLabel"
            :severity="data.kind === 'pending' ? 'warn' : 'success'"
          />
        </template>
        <template v-if="hasAnyTotal" #footer />
      </Column>
      <Column header="" style="width: 4rem">
        <template #body="{ data }">
          <Button
            v-if="data.kind === 'pending'"
            icon="pi pi-times"
            severity="danger"
            text
            size="small"
            :disabled="submitting"
            @click="emit('remove', data)"
          />
        </template>
        <template v-if="hasAnyTotal" #footer />
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.related-transfer-selected-table :deep(.p-datatable-table) {
  table-layout: fixed;
  width: 100%;
}

.related-transfer-selected-table :deep(.p-datatable-thead > tr > th),
.related-transfer-selected-table :deep(.p-datatable-tbody > tr > td),
.related-transfer-selected-table :deep(.p-datatable-tfoot > tr > td) {
  vertical-align: middle;
}

.related-transfer-selected-table :deep(.related-transfer-lookup) {
  width: 100%;
  min-width: 0;
}

.related-transfer-selected-table :deep(.related-transfer-lookup .p-select-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Stacked buttons are absolutely positioned over the input's end;
   do not override padding-inline-end or the digits hide under the buttons. */
.related-transfer-spinner {
  width: 6rem;
}

.related-transfer-spinner :deep(.p-inputnumber-input) {
  width: 100%;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
