<script lang="ts">
export default {
  name: 'CrmTreeTable',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TreeNodeDropEvent } from 'openvue/tree'
import CrmDataTable from './CrmDataTable.vue'
import type { CrmDataTableColumn } from './CrmDataTable.vue'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import { updateObjectRecord } from '@/modules/entities/services/recordDetails'
import type { TreeTableSettings } from '@/interfaces'
import {
  humanizeFieldName,
  recordId,
  recordLabel,
  scalarId,
} from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'

interface TreeNode {
  key: string
  label: string
  data: Record<string, unknown>
  children?: TreeNode[]
}

type AcceptedTreeNodeDropEvent = TreeNodeDropEvent & {
  accept?: () => void
}

const props = defineProps<{
  settings?: TreeTableSettings | null
  modelValue?: Array<string | number | Record<string, unknown>> | null
  disabled?: boolean
  mode?: 'picker' | 'browse'
  filter?: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  'update:modelValue': [items: Record<string, unknown>[]]
  'item-selected': [item: Record<string, unknown>]
}>()

const groups = ref<Record<string, unknown>[]>([])
const items = ref<Record<string, unknown>[]>([])
const selectedGroupKey = ref<string | null>(null)
const selectedKeys = ref<Record<string, boolean>>({})
const loadingGroups = ref(false)
const loadingItems = ref(false)
const createGroupDialogVisible = ref(false)
const moving = ref(false)
const error = ref<string | null>(null)
const draggedItem = ref<Record<string, unknown> | null>(null)
const treeNodes = ref<TreeNode[]>([])
let groupLoadToken = 0
let itemLoadToken = 0
const { t } = useTranslation()
const { canCreate: canCreateGroup } = useEntityPermissions(
  () => props.settings?.group.collection,
)

const selectedItems = computed<Record<string, unknown>[]>(() =>
  (props.modelValue ?? []).reduce<Record<string, unknown>[]>((records, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      records.push(item)
    }
    return records
  }, []),
)

const selectedGroup = computed(() =>
  selectedGroupKey.value
    ? groups.value.find(
        (group) =>
          String(recordId(group, props.settings?.group.primaryKey ?? 'id')) ===
          selectedGroupKey.value,
      ) ?? null
    : null,
)

const selectedItemIds = computed(() => {
  const settings = props.settings
  const ids = new Set<string>()
  if (!settings) return ids

  for (const item of props.modelValue ?? []) {
    const id =
      item && typeof item === 'object' && !Array.isArray(item)
        ? recordId(item, settings.main.primaryKey)
        : scalarId(item)
    if (id !== null) ids.add(String(id))
  }

  return ids
})

const itemDisplayFields = computed(() => {
  const settings = props.settings
  if (!settings) return []

  const fields =
    settings.main.labelFields?.length
      ? settings.main.labelFields
      : [settings.main.labelField || 'name']

  return Array.from(new Set(fields.filter(Boolean)))
})

const itemColumns = computed<CrmDataTableColumn[]>(() => {
  const settings = props.settings
  if (!settings) return []

  return itemDisplayFields.value
    .filter((field) => field !== settings.main.primaryKey)
    .map((field) => ({
      field,
      header: humanizeFieldName(field),
    }))
})

/** Keep Tree droppableNodes stable during save — toggling it tears down PrimeVue dragDropService mid-drag (stopDrag null). */
const canReparentGroups = computed(() =>
  Boolean(!props.disabled && props.settings?.group.parentField),
)

const canMoveItems = computed(() =>
  Boolean(!props.disabled && !moving.value && props.settings?.main.groupField),
)

const splitterStateKey = computed(
  () => `crm-tree-table-splitter:${props.settings?.main.collection ?? 'unknown'}`,
)

function buildTreeNodes(records: Record<string, unknown>[]): TreeNode[] {
  const settings = props.settings
  if (!settings) return []

  const nodeById = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const group of records) {
    const id = recordId(group, settings.group.primaryKey)
    if (id === null) continue
    nodeById.set(String(id), {
      key: String(id),
      label: recordLabel(group, settings.group.labelField),
      data: group,
      children: [],
    })
  }

  for (const node of nodeById.values()) {
    const parentId =
      settings.group.parentField && node.data[settings.group.parentField] !== undefined
        ? scalarId(node.data[settings.group.parentField])
        : null
    const parent = parentId === null ? null : nodeById.get(String(parentId))
    if (parent && parent.key !== node.key) {
      parent.children = [...(parent.children ?? []), node]
    } else {
      roots.push(node)
    }
  }

  return roots
}

function syncTreeNodesFromGroups(): void {
  treeNodes.value = buildTreeNodes(groups.value)
}

watch(
  () => props.settings,
  () => {
    groups.value = []
    items.value = []
    treeNodes.value = []
    selectedGroupKey.value = null
    selectedKeys.value = {}
    if (props.settings) {
      void loadGroups()
    }
  },
  { immediate: true, deep: true },
)

watch(selectedGroupKey, () => {
  items.value = []
  if (selectedGroupKey.value) {
    void loadItems()
  }
})

watch(
  () => props.filter,
  () => {
    if (selectedGroupKey.value) {
      void loadItems()
    }
  },
  { deep: true },
)

function updateSelectedKeys(keys: Record<string, boolean>): void {
  selectedKeys.value = keys
  selectedGroupKey.value = Object.keys(keys).find((key) => keys[key]) ?? null
}

function updateTreeNodesModel(nodes: unknown): void {
  treeNodes.value = Array.isArray(nodes) ? (nodes as TreeNode[]) : []
}

function startItemDrag(payload: {
  row: Record<string, unknown>
  event: DragEvent
}): void {
  if (!canMoveItems.value) return

  draggedItem.value = payload.row
  const id = props.settings
    ? recordId(payload.row, props.settings.main.primaryKey)
    : null
  payload.event.dataTransfer?.setData('text/plain', id === null ? 'item' : String(id))
  if (payload.event.dataTransfer) {
    payload.event.dataTransfer.effectAllowed = 'move'
  }
}

function clearDragState(): void {
  draggedItem.value = null
}

function allowItemDrop(event: DragEvent): void {
  if (!draggedItem.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

async function dropItemOnTree(event: DragEvent): Promise<void> {
  if (!draggedItem.value || !props.settings) return
  event.preventDefault()
  event.stopPropagation()

  const groupKey = itemDropGroupKey(event)
  if (!groupKey) return

  const group = groups.value.find(
    (row) => String(recordId(row, props.settings!.group.primaryKey)) === groupKey,
  )
  if (!group) return

  await dropItemOnGroup(group, event)
}

async function dropItemOnGroup(
  group: Record<string, unknown>,
  event: DragEvent,
): Promise<void> {
  if (!draggedItem.value) return
  event.preventDefault()
  event.stopPropagation()
  if (!props.settings) return

  const groupId = recordId(group, props.settings.group.primaryKey)
  if (groupId === null) return

  await moveItemToGroup(draggedItem.value, groupId)
}

function itemDropGroupKey(event: DragEvent): string | null {
  const target = event.target
  if (!(target instanceof Element)) return null

  const groupNode = target.closest('[data-tree-group-key]')
  const key = groupNode?.getAttribute('data-tree-group-key')
  return key || null
}

async function handleGroupNodeDrop(event: AcceptedTreeNodeDropEvent): Promise<void> {
  if (!event.accept || !props.settings) return

  const groupId = recordId(
    (event.dragNode.data ?? {}) as Record<string, unknown>,
    props.settings.group.primaryKey,
  )
  if (groupId === null) return

  const parentId = resolveDropParentId(event)
  if (!isGroupMoveAllowed(groupId, parentId)) return

  // accept() must run sync while dragDropService is still alive
  event.accept()

  await moveGroup(groupId, parentId)
  // Rebuild from groups (success) or roll back optimistic Tree accept() (failure)
  syncTreeNodesFromGroups()
}

function isGroupMoveAllowed(
  groupId: string | number,
  parentId: string | number | null,
): boolean {
  const settings = props.settings
  if (!settings?.group.parentField || moving.value) return false
  if (parentId !== null && String(groupId) === String(parentId)) return false
  if (parentId !== null && isGroupDescendant(parentId, groupId)) {
    error.value = t(
      'treeTable.cannotMoveGroupIntoChild',
      'Cannot move a group into its own child.',
    )
    return false
  }

  const group = groups.value.find(
    (item) => String(recordId(item, settings.group.primaryKey)) === String(groupId),
  )
  const currentParentId = group
    ? scalarId(group[settings.group.parentField])
    : null
  return String(currentParentId ?? '') !== String(parentId ?? '')
}

function resolveDropParentId(
  event: AcceptedTreeNodeDropEvent,
): string | number | null {
  const settings = props.settings
  if (!settings || !event.dropNode) return null

  if (event.dropPosition === 0) {
    return recordId(
      (event.dropNode.data ?? {}) as Record<string, unknown>,
      settings.group.primaryKey,
    )
  }

  const parentNode = findParentTreeNode(
    (event.value ?? []) as unknown as TreeNode[],
    String(event.dropNode.key),
  )

  return parentNode
    ? recordId(parentNode.data, settings.group.primaryKey)
    : null
}

function findParentTreeNode(
  nodes: TreeNode[],
  childKey: string,
): TreeNode | null {
  for (const node of nodes) {
    if ((node.children ?? []).some((child) => String(child.key) === childKey)) {
      return node
    }

    const parent = findParentTreeNode(node.children ?? [], childKey)
    if (parent) return parent
  }

  return null
}

async function moveGroup(
  groupId: string | number,
  parentId: string | number | null,
): Promise<boolean> {
  const settings = props.settings
  if (!settings?.group.parentField || moving.value) return false
  if (!isGroupMoveAllowed(groupId, parentId)) return false

  const group = groups.value.find(
    (item) => String(recordId(item, settings.group.primaryKey)) === String(groupId),
  )

  moving.value = true
  error.value = null
  try {
    const updated = await updateObjectRecord(
      settings.group.collection,
      String(groupId),
      { [settings.group.parentField]: parentId },
    )
    groups.value = upsertRecord(
      groups.value,
      {
        ...(group ?? {}),
        ...updated,
        [settings.group.primaryKey]: groupId,
        [settings.group.parentField]: parentId,
      },
      settings.group.primaryKey,
    )
    return true
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('treeTable.failedMoveGroup', 'Failed to move group.')
    return false
  } finally {
    moving.value = false
  }
}

async function moveItemToGroup(
  item: Record<string, unknown>,
  groupId: string | number,
): Promise<void> {
  const settings = props.settings
  if (!settings?.main.groupField || moving.value) return

  const itemId = recordId(item, settings.main.primaryKey)
  if (itemId === null) return

  const currentGroupId = scalarId(item[settings.main.groupField])
  if (String(currentGroupId ?? '') === String(groupId)) {
    clearDragState()
    return
  }

  moving.value = true
  error.value = null
  try {
    await updateObjectRecord(
      settings.main.collection,
      String(itemId),
      { [settings.main.groupField]: groupId },
    )

    items.value = items.value.filter(
      (row) => String(recordId(row, settings.main.primaryKey)) !== String(itemId),
    )
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('treeTable.failedMoveItem', 'Failed to move item.')
  } finally {
    moving.value = false
    clearDragState()
  }
}

function isGroupDescendant(
  maybeDescendantId: string | number,
  ancestorId: string | number,
): boolean {
  const settings = props.settings
  if (!settings?.group.parentField) return false

  let current = groups.value.find(
    (group) =>
      String(recordId(group, settings.group.primaryKey)) === String(maybeDescendantId),
  )
  const visited = new Set<string>()

  while (current) {
    const currentId = recordId(current, settings.group.primaryKey)
    if (currentId === null) return false
    if (visited.has(String(currentId))) return false
    visited.add(String(currentId))

    const parentId = scalarId(current[settings.group.parentField])
    if (parentId === null) return false
    if (String(parentId) === String(ancestorId)) return true

    current = groups.value.find(
      (group) =>
        String(recordId(group, settings.group.primaryKey)) === String(parentId),
    )
  }

  return false
}

async function loadGroups(): Promise<void> {
  const settings = props.settings
  if (!settings?.group.collection) return

  const token = ++groupLoadToken
  loadingGroups.value = true
  error.value = null

  try {
    const fields = Array.from(
      new Set([
        settings.group.primaryKey,
        settings.group.labelField,
        settings.group.parentField,
      ].filter(Boolean) as string[]),
    )
    const rows = await readDynamicItems(settings.group.collection, {
      limit: -1,
      fields,
    })
    if (token === groupLoadToken) {
      groups.value = rows as Record<string, unknown>[]
      syncTreeNodesFromGroups()
    }
  } catch (err) {
    if (token === groupLoadToken) {
      error.value =
        err instanceof Error
          ? err.message
          : t('treeTable.failedLoadGroups', 'Failed to load groups.')
    }
  } finally {
    if (token === groupLoadToken) {
      loadingGroups.value = false
    }
  }
}

async function loadItems(): Promise<void> {
  const settings = props.settings
  if (!settings?.main.collection || !settings.main.groupField || !selectedGroup.value) {
    return
  }

  const groupId = recordId(selectedGroup.value, settings.group.primaryKey)
  if (groupId === null) return

  const token = ++itemLoadToken
  loadingItems.value = true
  error.value = null

  try {
    const rows = await readDynamicItems(settings.main.collection, {
      limit: -1,
      fields: Array.from(
        new Set([
          settings.main.primaryKey,
          settings.main.groupField,
          ...itemDisplayFields.value,
        ]),
      ),
      filter: buildItemFilter(settings.main.groupField, groupId, props.filter),
    })
    if (token === itemLoadToken) {
      items.value = rows as Record<string, unknown>[]
    }
  } catch (err) {
    if (token === itemLoadToken) {
      error.value =
        err instanceof Error
          ? err.message
          : t('treeTable.failedLoadItems', 'Failed to load items.')
    }
  } finally {
    if (token === itemLoadToken) {
      loadingItems.value = false
    }
  }
}

function chooseItem(item: Record<string, unknown>): void {
  if (props.disabled) return
  if (props.mode === 'browse') {
    emit('item-selected', item)
    return
  }

  const id = props.settings ? recordId(item, props.settings.main.primaryKey) : null
  if (id !== null && selectedItemIds.value.has(String(id))) {
    emit(
      'update:modelValue',
      selectedItems.value.filter(
        (selected) => recordId(selected, props.settings!.main.primaryKey) !== id,
      ),
    )
    return
  }

  emit('update:modelValue', [...selectedItems.value, item])
}

function openCreateGroupDialog(): void {
  if (props.disabled || !props.settings?.group.collection || !canCreateGroup.value) {
    return
  }
  createGroupDialogVisible.value = true
}

function handleGroupCreated(record: Record<string, unknown>): void {
  createGroupDialogVisible.value = false
  groups.value = upsertRecord(groups.value, record, props.settings?.group.primaryKey ?? 'id')
  syncTreeNodesFromGroups()

  const id = props.settings ? recordId(record, props.settings.group.primaryKey) : null
  if (id !== null) {
    selectedGroupKey.value = String(id)
    selectedKeys.value = { [String(id)]: true }
  }
}

function selectedGroupId(): string | number | null {
  if (!selectedGroup.value || !props.settings) return null
  return recordId(selectedGroup.value, props.settings.group.primaryKey)
}

function buildItemFilter(
  groupField: string,
  groupId: string | number,
  filter?: Record<string, unknown> | null,
): Record<string, unknown> {
  const groupFilter = {
    [groupField]: {
      _eq: groupId,
    },
  }

  return filter && Object.keys(filter).length > 0
    ? { _and: [groupFilter, filter] }
    : groupFilter
}

function upsertRecord(
  records: Record<string, unknown>[],
  record: Record<string, unknown>,
  primaryKey: string,
): Record<string, unknown>[] {
  const id = recordId(record, primaryKey)
  if (id === null) return [record, ...records]

  const existingIndex = records.findIndex(
    (item) => String(recordId(item, primaryKey)) === String(id),
  )
  if (existingIndex === -1) return [record, ...records]

  const next = [...records]
  next[existingIndex] = record
  return next
}

async function readDynamicItems(
  collection: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  return bridgeReadItems(collection, params)
}

function isItemSelected(item: Record<string, unknown>): boolean {
  if (!props.settings) return false
  const id = recordId(item, props.settings.main.primaryKey)
  return id !== null && selectedItemIds.value.has(String(id))
}

</script>

<template>
  <div class="crm-tree-table flex flex-col gap-3 min-h-[18rem]">
    <Message
      v-if="!settings"
      severity="warn"
      :closable="false"
    >
      {{ t('treeTable.settingsNotConfigured', 'Tree table settings are not configured.') }}
    </Message>

    <template v-else>
      <Message
        v-if="error"
        severity="error"
        :closable="false"
      >
        {{ error }}
      </Message>

      <Message
        v-else-if="moving"
        severity="info"
        :closable="false"
      >
        {{ t('treeTable.savingMove', 'Saving move...') }}
      </Message>

      <Splitter
        :state-key="splitterStateKey"
        state-storage="local"
        class="crm-tree-table__splitter"
      >
        <SplitterPanel
          :size="40"
          :min-size="20"
          class="crm-tree-table__panel"
        >
          <section class="crm-tree-table__pane border border-surface-200 rounded-lg min-h-[18rem] p-3">
            <div class="flex items-center gap-3 justify-between mb-3">
              <h3 class="text-[0.9rem] m-0">{{ t('treeTable.groups', 'Groups') }}</h3>
              <Button
                v-if="canCreateGroup"
                :label="t('treeTable.newGroup', 'New group')"
                icon="pi pi-plus"
                size="small"
                text
                :disabled="disabled || !settings.group.collection"
                @click="openCreateGroupDialog"
              />
            </div>
            <div v-if="loadingGroups" class="crm-tree-table__loading flex items-center gap-3 text-muted-color text-[0.85rem]">
              <ProgressSpinner stroke-width="4" />
              <span>{{ t('treeTable.loadingGroups', 'Loading groups...') }}</span>
            </div>
            <template v-else>
              <Tree
                :value="treeNodes"
                selection-mode="single"
                :selection-keys="selectedKeys"
                :draggable-nodes="canReparentGroups"
                :droppable-nodes="canReparentGroups"
                :validate-drop="true"
                class="!border-0 !p-0"
                @dragover.capture="allowItemDrop"
                @drop.capture="dropItemOnTree"
                @node-drop="handleGroupNodeDrop"
                @update:selection-keys="updateSelectedKeys"
                @update:value="updateTreeNodesModel"
              >
                <template #default="{ node }">
                  <span
                    class="rounded inline-flex py-0.5 px-1"
                    :class="{ 'cursor-move': canReparentGroups || canMoveItems }"
                    :data-tree-group-key="node.key"
                    @dragover="allowItemDrop"
                    @drop="dropItemOnGroup(node.data, $event)"
                  >
                    {{ node.label }}
                  </span>
                </template>
              </Tree>
            </template>
          </section>
        </SplitterPanel>

        <SplitterPanel
          :size="60"
          :min-size="30"
          class="crm-tree-table__panel"
        >
          <section class="crm-tree-table__pane border border-surface-200 rounded-lg min-h-[18rem] p-3">
            <div class="flex items-center gap-3 justify-between mb-3">
              <h3 class="text-[0.9rem] m-0">{{ t('treeTable.items', 'Items') }}</h3>
            </div>
            <p v-if="!selectedGroupKey" class="text-muted-color text-[0.85rem]">
              {{ t('treeTable.selectGroup', 'Select a group.') }}
            </p>
            <CrmDataTable
              v-else
              :rows="items"
              :columns="itemColumns"
              :collection="settings.main.collection"
              :primary-key="settings.main.primaryKey"
              :parent-name="settings.main.groupField"
              :parent-id="selectedGroupId() ?? undefined"
              :loading="loadingItems"
              :empty-message="t('treeTable.noItemsForGroup', 'No items for selected group.')"
              :show-new-button="!disabled"
              :new-button-label="t('treeTable.newItem', 'New item')"
              :show-delete-button="!disabled || mode === 'browse'"
              :sortable-columns="false"
              :reorderable-columns="false"
              :row-draggable="canMoveItems"
              @update:rows="items = $event"
              @view-record="chooseItem"
              @row-drag-start="startItemDrag"
              @row-drag-end="clearDragState"
            >
              <template v-if="mode !== 'browse'" #actions="{ row }">
                <Button
                  :label="isItemSelected(row)
                    ? t('treeTable.selected', 'Selected')
                    : t('treeTable.choose', 'Choose')"
                  size="small"
                  :severity="isItemSelected(row) ? undefined : 'secondary'"
                  :outlined="!isItemSelected(row)"
                  :disabled="disabled"
                  @click="chooseItem(row)"
                />
              </template>
            </CrmDataTable>
          </section>
        </SplitterPanel>
      </Splitter>
    </template>

    <RecordCreateDialog
      v-if="settings?.group.collection"
      :visible="createGroupDialogVisible"
      :collection="settings.group.collection"
      :parent-field="settings.group.parentField || undefined"
      :parent-id="selectedGroupId() ?? undefined"
      @update:visible="createGroupDialogVisible = $event"
      @created="handleGroupCreated"
    />
  </div>
</template>

<style scoped>
.crm-tree-table__splitter {
  flex: 1 1 auto;
  width: 100%;
  min-height: 18rem;
  border: none;
  background: transparent;
}

.crm-tree-table__splitter :deep(.p-splitter-panel) {
  overflow: hidden;
}

.crm-tree-table__panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.crm-tree-table__pane {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.crm-tree-table__loading :deep(.p-progressspinner) {
  height: 1.5rem;
  width: 1.5rem;
}
</style>
