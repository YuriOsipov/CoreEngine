<script setup lang="ts">
import type { TreeNode } from 'openvue/treenode'
import type { DataTableColumnConfig } from '@/interfaces'
import RelatedTransferSourceTable from './RelatedTransferSourceTable.vue'

defineProps<{
  loadingSource: boolean
  sourcePanelStyle: Record<string, string>
  sourceSearchQuery: string
  searchPlaceholder: string
  sourceTitle: string
  shouldSplitSourceTree: boolean
  treeModeSourceScrollHeight: string
  tableModeScrollHeight: string
  sourceGroupTreeNodes: TreeNode[]
  groupsTitle: string
  itemsTitle: string
  filteredSortedSourceItems: Record<string, unknown>[]
  sourceTableColumns: DataTableColumnConfig[]
  sourceSortField?: string
  sourceSortOrder: 1 | -1
  selectedSourceGroupId: string | number | null
  selectGroupMessage: string
  noSourceItemsMessage: string
  existingDuplicateValues: Set<string>
  sourcePrimaryKey: string
  submitting: boolean
  addLabel: string
  sourceDisplayValue: (item: Record<string, unknown>, field: string) => string
  sourceValue: (row: Record<string, unknown> | undefined, field: string) => string | number | null
  isSelectedSourceGroup: (node: TreeNode) => boolean
}>()

const emit = defineEmits<{
  'update:sourceSearchQuery': [value: string]
  selectGroup: [node: TreeNode]
  sort: [event: { sortField?: string | ((item: unknown) => string) | null; sortOrder?: 1 | -1 | 0 | null }]
  add: [item: Record<string, unknown>]
}>()
</script>

<template>
  <section
    class="border border-surface-200 rounded-lg p-3 bg-surface-0 min-h-0 overflow-hidden"
    :style="sourcePanelStyle"
  >
    <div class="flex items-center justify-between mb-3">
      <h3 class="m-0 text-sm">{{ sourceTitle }}</h3>
      <ProgressSpinner
        v-if="loadingSource"
        style="width: 1.35rem; height: 1.35rem"
        stroke-width="4"
      />
    </div>

    <div class="mb-3">
      <InputText
        :model-value="sourceSearchQuery"
        size="small"
        fluid
        :placeholder="searchPlaceholder"
        @update:model-value="emit('update:sourceSearchQuery', $event ?? '')"
      />
    </div>

    <div
      v-if="shouldSplitSourceTree"
      class="grid min-h-0 grid-cols-[minmax(220px,0.35fr)_minmax(0,1fr)] gap-3 max-[900px]:grid-cols-1"
      :style="{ height: treeModeSourceScrollHeight }"
    >
      <section class="border border-surface-200 rounded-lg p-2 min-h-0 min-w-0 overflow-y-auto">
        <h4 class="m-0 mb-2 text-[0.8rem]">{{ groupsTitle }}</h4>
        <Tree
          :value="sourceGroupTreeNodes"
          class="border-0 p-0"
        >
          <template #default="{ node }">
            <div
              class="w-full rounded px-2 py-1 cursor-pointer truncate"
              :class="{ 'bg-primary-50 text-primary-700 font-semibold': isSelectedSourceGroup(node) }"
              role="button"
              tabindex="0"
              @click="emit('selectGroup', node)"
              @keydown.enter="emit('selectGroup', node)"
            >
              {{ node.label }}
            </div>
          </template>
        </Tree>
      </section>

      <section class="border border-surface-200 rounded-lg p-2 min-h-0 min-w-0 overflow-y-auto">
        <h4 class="m-0 mb-2 text-[0.8rem]">{{ itemsTitle }}</h4>
        <RelatedTransferSourceTable
          :items="filteredSortedSourceItems"
          :columns="sourceTableColumns"
          :loading="loadingSource"
          :scroll-height="treeModeSourceScrollHeight"
          :sort-field="sourceSortField"
          :sort-order="sourceSortOrder"
          :empty-message="selectedSourceGroupId === null ? selectGroupMessage : noSourceItemsMessage"
          :existing-duplicate-values="existingDuplicateValues"
          :source-primary-key="sourcePrimaryKey"
          :submitting="submitting"
          :add-label="addLabel"
          :source-display-value="sourceDisplayValue"
          :source-value="sourceValue"
          @sort="emit('sort', $event)"
          @add="emit('add', $event)"
        />
      </section>
    </div>

    <RelatedTransferSourceTable
      v-else
      :items="filteredSortedSourceItems"
      :columns="sourceTableColumns"
      :loading="loadingSource"
      :scroll-height="tableModeScrollHeight"
      :sort-field="sourceSortField"
      :sort-order="sourceSortOrder"
      :empty-message="noSourceItemsMessage"
      :existing-duplicate-values="existingDuplicateValues"
      :source-primary-key="sourcePrimaryKey"
      :submitting="submitting"
      :add-label="addLabel"
      :source-display-value="sourceDisplayValue"
      :source-value="sourceValue"
      @sort="emit('sort', $event)"
      @add="emit('add', $event)"
    />
  </section>
</template>
