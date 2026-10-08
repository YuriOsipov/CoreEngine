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
    @sort="emit('sort', $event)"
  >
    <Column
      v-for="column in columns"
      :key="column.field"
      :field="column.field"
      :header="column.header"
      sortable
    >
      <template #body="{ data }">
        {{ sourceDisplayValue(data, column.field) }}
      </template>
    </Column>
    <Column header="" style="width: 5rem">
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
