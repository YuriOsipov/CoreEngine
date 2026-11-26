<script setup lang="ts">
import type { DataTableColumnConfig } from '@/interfaces'

const props = defineProps<{
  items: Record<string, unknown>[]
  columns: DataTableColumnConfig[]
  loading: boolean
  scrollHeight: string
  sortField?: string
  sortOrder: 1 | -1
  emptyMessage: string
  existingDuplicateValues: Set<string>
  sourcePrimaryKey: string
  submitting: boolean
  addLabel: string
  sourceDisplayValue: (item: Record<string, unknown>, field: string) => string
  isNumericSourceField: (field: string) => boolean
  sourceValue: (row: Record<string, unknown> | undefined, field: string) => string | number | null
}>()

const emit = defineEmits<{
  sort: [event: { sortField?: string | ((item: unknown) => string) | null; sortOrder?: 1 | -1 | 0 | null }]
  add: [item: Record<string, unknown>]
}>()

function isAddDisabled(item: Record<string, unknown>): boolean {
  return props.existingDuplicateValues.has(
    String(props.sourceValue(item, props.sourcePrimaryKey) ?? ''),
  ) || props.submitting
}

function numericCellStyle(field: string): Record<string, string> | undefined {
  if (!props.isNumericSourceField(field)) return undefined
  return { textAlign: 'right' }
}

/**
 * First column (Item) stays fluid; Price / Quantity / Variant get fixed
 * widths so Variant does not eat half the Source panel under table-layout:fixed.
 */
function columnWidthStyle(field: string): string | undefined {
  const index = props.columns.findIndex((column) => column.field === field)
  if (index === 0) return undefined
  if (props.isNumericSourceField(field)) {
    return 'width: 7rem; min-width: 7rem'
  }
  return 'width: 7.5rem; min-width: 7.5rem'
}
</script>

<template>
  <DataTable
    :value="items"
    size="small"
    :loading="loading"
    scrollable
    :scroll-height="scrollHeight"
    lazy
    :sort-field="sortField"
    :sort-order="sortOrder"
    :empty-message="emptyMessage"
    table-style="table-layout: fixed; width: 100%"
    class="related-transfer-source-table"
    @sort="emit('sort', $event)"
  >
    <Column
      v-for="column in columns"
      :key="column.field"
      :field="column.field"
      sortable
      :header-style="numericCellStyle(column.field)"
      :body-style="numericCellStyle(column.field)"
      :style="columnWidthStyle(column.field)"
    >
      <template #header>
        <span
          class="block w-full"
          :class="isNumericSourceField(column.field) ? 'text-right tabular-nums' : undefined"
        >
          {{ column.header }}
        </span>
      </template>
      <template #body="{ data }">
        <span
          class="block w-full truncate"
          :class="isNumericSourceField(column.field) ? 'text-right tabular-nums' : undefined"
        >
          {{ sourceDisplayValue(data, column.field) }}
        </span>
      </template>
    </Column>
    <Column header="" style="width: 5rem; min-width: 5rem">
      <template #body="{ data }">
        <Button
          :label="addLabel"
          size="small"
          text
          :disabled="isAddDisabled(data)"
          @click="emit('add', data)"
        />
      </template>
    </Column>
  </DataTable>
</template>

<style scoped>
.related-transfer-source-table :deep(.p-datatable-table) {
  table-layout: fixed;
  width: 100%;
}

.related-transfer-source-table :deep(.p-datatable-thead > tr > th),
.related-transfer-source-table :deep(.p-datatable-tbody > tr > td) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
