<script lang="ts">
export default {
  name: 'CrmDataTableGrid',
}
</script>

<script setup lang="ts">
import { Dropdown as FloatingDropdown } from 'floating-vue'
import type { RouteLocationRaw } from 'vue-router'
import { RouterLink } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import CompactRecordTooltip from '@/modules/entities/components/CompactRecordTooltip.vue'
import CrmHtmlCell from '@/core/ui-kit/CrmHtmlCell.vue'
import { isHtmlEditorColumn } from '@/core/fieldHelpers'
import { useTranslation } from '@/core/translation'
import type { LayoutFieldChildLookup } from '@/interfaces/config'
import type { PrimeVueComponentType } from '@/interfaces/entities'

export type CrmDataTableGridColumn = {
  field: string
  header: string
  component?: PrimeVueComponentType
  relatedCollection?: string
  template?: string
  format?: string
  autoRecordId?: boolean
  recordLink?: boolean
  valueCollection?: string
  inlineEditable?: boolean
  childLookup?: LayoutFieldChildLookup | null
}

export type CrmDataTableEditRequest = {
  row: Record<string, unknown>
  column: CrmDataTableGridColumn
  cellRect: DOMRect
  event: MouseEvent
}

const props = defineProps<{
  columnLayoutKey: number
  tableRows: Record<string, unknown>[]
  displayedColumns: CrmDataTableGridColumn[]
  managedPrimaryKey: string
  loading?: boolean
  lazy?: boolean
  paginator?: boolean
  activeRowsPerPage: number
  isCompact?: boolean
  isSelectionEnabled?: boolean
  selection: Record<string, unknown> | null
  expandedRowGroups: unknown[]
  isRowGroupingActive?: boolean
  groupExpandable?: boolean
  activeGroupField?: string | null
  effectiveSortField?: string | null
  effectiveSortOrder?: 1 | -1 | null
  sortableColumns?: boolean
  reorderableColumns?: boolean
  rowDraggable?: boolean
  rowDragDisabled?: boolean
  canDragRows?: boolean
  showDeleteButton?: boolean
  emptyMessage: string
  formatGroupHeader: (row: Record<string, unknown>) => string
  resolveColumnKey: (column: CrmDataTableGridColumn) => string
  columnStyle: (column: CrmDataTableGridColumn) => Record<string, string>
  isNumericColumn?: (column: CrmDataTableGridColumn) => boolean
  resolveCellValue: (row: Record<string, unknown>, column: CrmDataTableGridColumn) => unknown
  formatValue: (value: unknown, column: CrmDataTableGridColumn) => string
  canLinkM2OCell: (column: CrmDataTableGridColumn, value: unknown) => boolean
  relatedRecordRoute: (
    column: CrmDataTableGridColumn,
    value: unknown,
  ) => RouteLocationRaw | null
  compactTooltipState: (
    column: CrmDataTableGridColumn,
    value: unknown,
  ) => { loading: boolean; error: string | null; runtime: unknown } | null
  loadCompactTooltip: (column: CrmDataTableGridColumn, value: unknown) => void
  isCellInlineEditable: (
    row: Record<string, unknown>,
    column: CrmDataTableGridColumn,
  ) => boolean
}>()

const emit = defineEmits<{
  'update:selection': [row: Record<string, unknown> | null]
  'update:expandedRowGroups': [groups: unknown[]]
  sort: [event: unknown]
  'column-reorder': [event: unknown]
  'row-select': [event: unknown]
  'row-unselect': [event: unknown]
  'edit-request': [payload: CrmDataTableEditRequest]
  'row-drag-start': [payload: { row: Record<string, unknown>; event: DragEvent }]
  'row-drag-end': [payload: { row: Record<string, unknown>; event: DragEvent }]
  'open-action-menu': [payload: { event: Event; row: Record<string, unknown> }]
}>()

const { t } = useTranslation()

function measureCellRect(event: Event): DOMRect {
  const target = event.currentTarget ?? event.target
  if (target instanceof Element) {
    // Prefer the editable cell chrome so the overlay matches the hover target,
    // not the full padded <td> (which left empty space under small inputs).
    const cell = target.closest('.crm-data-table__cell')
    if (cell instanceof HTMLElement) {
      return cell.getBoundingClientRect()
    }
    const td = target.closest('td')
    if (td instanceof HTMLElement) {
      return td.getBoundingClientRect()
    }
  }
  if (target instanceof HTMLElement) {
    return target.getBoundingClientRect()
  }
  return new DOMRect(0, 0, 120, 32)
}

function handleCellMouseDown(
  row: Record<string, unknown>,
  column: CrmDataTableGridColumn,
  event: MouseEvent,
): void {
  const target = event.target
  if (target instanceof Element && target.closest('a, button, input, textarea, .p-checkbox')) {
    return
  }
  if (!props.isCellInlineEditable(row, column)) return
  event.stopPropagation()
}

function emitEditRequest(
  row: Record<string, unknown>,
  column: CrmDataTableGridColumn,
  event: MouseEvent,
): void {
  emit('edit-request', {
    row,
    column,
    cellRect: measureCellRect(event),
    event,
  })
}

function handleCellClick(
  row: Record<string, unknown>,
  column: CrmDataTableGridColumn,
  event: MouseEvent,
): void {
  const target = event.target
  if (target instanceof Element && target.closest('a, button, input, textarea, .p-checkbox')) {
    return
  }
  if (!props.isCellInlineEditable(row, column)) return
  event.stopPropagation()
  emitEditRequest(row, column, event)
}

function handleEditButton(
  row: Record<string, unknown>,
  column: CrmDataTableGridColumn,
  event: MouseEvent,
): void {
  event.stopPropagation()
  event.preventDefault()
  emitEditRequest(row, column, event)
}
</script>

<template>
  <DataTable
    :key="columnLayoutKey"
    :expanded-row-groups="expandedRowGroups"
    :selection="selection"
    :value="tableRows"
    :data-key="managedPrimaryKey"
    :selection-mode="isSelectionEnabled ? 'single' : undefined"
    :meta-key-selection="false"
    :loading="loading"
    scrollable
    :scrollHeight="isCompact ? undefined : 'flex'"
    class="crm-data-table"
    :class="{
      'crm-data-table--selectable': isSelectionEnabled,
      'crm-data-table--compact': isCompact,
    }"
    size="small"
    striped-rows
    :lazy="lazy"
    :paginator="paginator && !lazy"
    :rows="activeRowsPerPage"
    :custom-sort="isRowGroupingActive"
    :sort-field="effectiveSortField"
    :sort-order="effectiveSortOrder"
    :row-group-mode="isRowGroupingActive ? 'subheader' : undefined"
    :group-rows-by="activeGroupField ?? undefined"
    :expandable-row-groups="isRowGroupingActive && groupExpandable !== false"
    :reorderable-columns="reorderableColumns"
    table-style="min-width: 100%"
    @update:expanded-row-groups="emit('update:expandedRowGroups', $event)"
    @update:selection="emit('update:selection', $event)"
    @sort="emit('sort', $event)"
    @column-reorder="emit('column-reorder', $event)"
    @row-select="emit('row-select', $event)"
    @row-unselect="emit('row-unselect', $event)"
  >
    <template v-if="isRowGroupingActive" #groupheader="{ data }">
      <span class="crm-data-table__group-header-label">{{ formatGroupHeader(data) }}</span>
    </template>
    <Column
      v-for="column in displayedColumns"
      :key="resolveColumnKey(column)"
      :column-key="resolveColumnKey(column)"
      :field="column.field"
      :header="column.header"
      :sortable="sortableColumns"
      :reorderable-column="!column.autoRecordId"
      :align="isNumericColumn?.(column) ? 'right' : undefined"
      :align-header="isNumericColumn?.(column) ? 'right' : undefined"
      :style="columnStyle(column)"
    >
      <template #body="{ data }">
        <slot
          name="cell"
          :row="data"
          :column="column"
          :value="resolveCellValue(data, column)"
        >
          <div
            class="crm-data-table__cell"
            :class="{
              'crm-data-table__cell--editable': isCellInlineEditable(data, column),
              'crm-data-table__cell--numeric': isNumericColumn?.(column),
            }"
            @mousedown="handleCellMouseDown(data, column, $event)"
            @click="handleCellClick(data, column, $event)"
          >
            <FloatingDropdown
              v-if="canLinkM2OCell(column, resolveCellValue(data, column))"
              theme="compact-record"
              placement="top-start"
              :distance="8"
              :delay="{ show: 250, hide: 150 }"
              :triggers="['hover', 'focus']"
              :popper-triggers="['hover']"
              @show="loadCompactTooltip(column, resolveCellValue(data, column))"
            >
              <RouterLink
                v-if="relatedRecordRoute(column, resolveCellValue(data, column))"
                :to="relatedRecordRoute(column, resolveCellValue(data, column))!"
                class="crm-data-table__m2o"
                @click.stop
              >
                {{ formatValue(resolveCellValue(data, column), column) }}
              </RouterLink>

              <template #popper>
                <CompactRecordTooltip
                  :loading="
                    compactTooltipState(column, resolveCellValue(data, column))?.loading ?? false
                  "
                  :error="
                    compactTooltipState(column, resolveCellValue(data, column))?.error ?? null
                  "
                  :runtime="
                    (compactTooltipState(column, resolveCellValue(data, column))?.runtime as any)
                  "
                />
              </template>
            </FloatingDropdown>
            <CrmHtmlCell
              v-else-if="isHtmlEditorColumn(column) && !column.recordLink"
              :html="String(resolveCellValue(data, column) ?? '')"
            />
            <span
              v-else
              class="crm-data-table__cell-text"
            >
              {{ formatValue(resolveCellValue(data, column), column) }}
            </span>
            <Button
              v-if="isCellInlineEditable(data, column)"
              type="button"
              icon="pi pi-pencil"
              text
              rounded
              size="small"
              severity="secondary"
              class="crm-data-table__cell-edit"
              :aria-label="
                t('datatable.editCellAria', 'Edit {field}', {
                  field: column.header || column.field,
                })
              "
              :title="t('datatable.editCell', 'Edit')"
              @mousedown.stop
              @click="handleEditButton(data, column, $event)"
            />
          </div>
        </slot>
      </template>
    </Column>

    <Column
      v-if="rowDraggable"
      column-key="row-drag"
      :reorderable-column="false"
      header=""
      style="width: 3.5rem; min-width: 3.5rem"
    >
      <template #body="{ data }">
        <Button
          type="button"
          icon="pi pi-arrows-alt"
          size="small"
          text
          severity="secondary"
          class="crm-data-table__drag-handle"
          :disabled="rowDragDisabled"
          :draggable="canDragRows"
          :aria-label="t('datatable.dragRow', 'Drag row')"
          @click.stop
          @dragstart="emit('row-drag-start', { row: data, event: $event })"
          @dragend="emit('row-drag-end', { row: data, event: $event })"
        />
      </template>
    </Column>

    <Column
      v-if="$slots.actions"
      column-key="actions"
      :reorderable-column="false"
      header=""
      style="width: 3.5rem; min-width: 3.5rem"
    >
      <template #body="{ data }">
        <slot name="actions" :row="data" />
      </template>
    </Column>

    <Column
      v-if="showDeleteButton"
      column-key="record-actions"
      :reorderable-column="false"
      header=""
      style="width: 3.5rem; min-width: 3.5rem"
    >
      <template #body="{ data }">
        <Button
          type="button"
          icon="pi pi-ellipsis-v"
          size="small"
          severity="secondary"
          outlined
          class="crm-data-table__actions-button"
          :aria-label="t('datatable.actions', 'Record actions')"
          aria-haspopup="true"
          aria-controls="overlay_menu"
          @click.stop="emit('open-action-menu', { event: $event, row: data })"
        />
      </template>
    </Column>

    <template #empty>
      <span class="crm-data-table__empty">{{ emptyMessage }}</span>
    </template>
  </DataTable>
</template>

<style scoped>
.crm-data-table--selectable :deep(.p-datatable-tbody > tr) {
  cursor: pointer;
}

.crm-data-table :deep(.p-datatable-thead > tr > th),
.crm-data-table :deep(.p-datatable-tbody > tr > td) {
  white-space: nowrap;
}

.crm-data-table__cell {
  align-items: center;
  display: flex;
  gap: 0.2rem;
  min-height: 1.65rem;
  min-width: 0;
  width: 100%;
}

.crm-data-table__cell--numeric {
  justify-content: flex-end;
}

.crm-data-table__cell--numeric .crm-data-table__cell-text {
  flex: 1;
  text-align: right;
}

.crm-data-table__cell--numeric.crm-data-table__cell--editable .crm-data-table__cell-edit {
  margin-inline-start: 0;
}

.crm-data-table__cell-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crm-data-table__cell--editable {
  border-radius: 4px;
  cursor: pointer;
  margin: -0.15rem -0.2rem;
  padding: 0.15rem 0.2rem;
}

.crm-data-table__cell--editable:hover {
  background: var(--p-surface-50, #f8fafc);
  box-shadow: inset 0 0 0 1px var(--p-primary-200, #99f6e4);
}

.crm-data-table__cell-edit {
  flex-shrink: 0;
  height: 1.5rem;
  margin-inline-start: auto;
  opacity: 0;
  padding: 0;
  width: 1.5rem;
}

.crm-data-table__cell--editable:hover .crm-data-table__cell-edit,
.crm-data-table__cell--editable:focus-within .crm-data-table__cell-edit {
  opacity: 1;
}

.crm-data-table__group-header-label {
  color: var(--p-surface-700);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.crm-data-table__m2o {
  color: #2563eb;
  font-weight: 600;
  text-decoration: none;
}

.crm-data-table__m2o:hover {
  text-decoration: underline;
}

.crm-data-table__drag-handle {
  cursor: grab;
}

.crm-data-table__drag-handle:active {
  cursor: grabbing;
}

.crm-data-table__actions-button {
  background: #f8fafc;
  border-color: #0f766e;
  color: #0f766e;
  font-weight: 700;
}

.crm-data-table__actions-button:hover {
  background: #ccfbf1;
  border-color: #0d9488;
  color: #0f766e;
}
</style>
