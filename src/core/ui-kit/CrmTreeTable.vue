<script lang="ts">
export default {
  name: 'CrmTreeTable',
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { TreeNodeDropEvent } from 'openvue/tree'
import CrmDataTable from './CrmDataTable.vue'
import type { CrmDataTableColumn } from './CrmDataTable.vue'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import { updateObjectRecord } from '@/modules/entities/services/recordDetails'
import { fetchDataTableRuntime } from '@/modules/entities/services/dataTableRuntime'
import type {
  DataTableSettings,
  DataTableSortConfig,
  TreeTableSettings,
} from '@/interfaces'
import {
  getPathValue,
  recordId,
  recordLabel,
  scalarId,
} from '@/modules/entities/utils/recordDisplay'
import { nestRelationFilter } from '@/core/listFilterUtils'
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
  /** Groups filter chrome only — items pane is owned by the parent (ObjectListPage). */
  groupsOnly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [items: Record<string, unknown>[]]
  'item-selected': [item: Record<string, unknown>]
  'group-selected': [
    payload: {
      id: string | number
      record: Record<string, unknown>
      /** Selected group id plus all descendant group ids (for nested list / bulk filters). */
      subtreeIds: Array<string | number>
    } | null,
  ]
  'item-moved': [payload: { itemId: string | number; groupId: string | number }]
  'update:selectedGroupId': [id: string | number | null]
}>()

const groups = ref<Record<string, unknown>[]>([])
const items = ref<Record<string, unknown>[]>([])
const itemColumns = ref<CrmDataTableColumn[]>([])
const selectedGroupKey = ref<string | null>(null)
const selectedKeys = ref<Record<string, boolean>>({})
const expandedKeys = ref<Record<string, boolean>>({})
const groupSearch = ref('')
const activeItemSort = ref<DataTableSortConfig | null>(null)
const loadingGroups = ref(false)
const loadingItems = ref(false)
const createGroupDialogVisible = ref(false)
const createGroupParentId = ref<string | number | null>(null)
const createGroupParentRecord = ref<Record<string, unknown> | null>(null)
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

const effectiveItemSort = computed<DataTableSortConfig | null>(() => {
  if (activeItemSort.value?.field?.trim()) return activeItemSort.value
  const configured = props.settings?.main.sort
  if (configured?.field?.trim()) {
    return {
      field: configured.field.trim(),
      order: configured.order === -1 ? -1 : 1,
    }
  }
  return null
})

function treeItemTableSettings(): DataTableSettings | null {
  const settings = props.settings
  if (!settings) return null

  const primaryKey = settings.main.primaryKey
  const groupField = settings.main.groupField?.trim() || ''
  const fields = itemDisplayFields.value.filter((field) => field !== primaryKey)
  // Always request the group FK so CrmDataTable client parent-filter can match
  // rows even when the FK is not a visible display column.
  if (groupField && groupField !== primaryKey && !fields.includes(groupField)) {
    fields.push(groupField)
  }

  return {
    columns: fields.map((field) => ({ field, enabled: true })),
    sort: effectiveItemSort.value,
    groupBy: null,
  }
}

function visibleItemColumns(
  columns: CrmDataTableColumn[],
  settings: TreeTableSettings,
): CrmDataTableColumn[] {
  const display = new Set(
    itemDisplayFields.value.filter((field) => field !== settings.main.primaryKey),
  )
  return columns.filter((column) => display.has(column.field))
}

/** Keep Tree droppableNodes stable during save — toggling it tears down PrimeVue dragDropService mid-drag (stopDrag null). */
const canReparentGroups = computed(() =>
  Boolean(!props.disabled && props.settings?.group.parentField),
)

const canMoveItems = computed(() => {
  const groupField = props.settings?.main.groupField?.trim() || ''
  // Nested paths (item.item_group) are read-only for drag — the FK lives on the related record.
  return Boolean(
    !props.disabled &&
      !moving.value &&
      groupField &&
      !groupField.includes('.'),
  )
})

const splitterStateKey = computed(
  () => `crm-tree-table-splitter:${props.settings?.main.collection ?? 'unknown'}`,
)

/** Same collection on both panes — item CRUD must refresh the left tree. */
const isSelfRefTree = computed(() => {
  const settings = props.settings
  if (!settings?.group.collection || !settings.main.collection) return false
  return settings.group.collection === settings.main.collection
})

function compareTreeNodeLabels(left: TreeNode, right: TreeNode): number {
  return left.label.localeCompare(right.label, undefined, {
    sensitivity: 'base',
    numeric: true,
  })
}

function sortTreeNodesByLabel(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort(compareTreeNodeLabels)
  for (const node of sorted) {
    if (node.children?.length) {
      node.children = sortTreeNodesByLabel(node.children)
    }
  }
  return sorted
}

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

  return sortTreeNodesByLabel(roots)
}

function syncTreeNodesFromGroups(): void {
  treeNodes.value = buildTreeNodes(groups.value)
}

function filterTreeNodes(nodes: TreeNode[], query: string): TreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return nodes

  const result: TreeNode[] = []
  for (const node of nodes) {
    const selfMatch = node.label.toLowerCase().includes(normalized)
    const childMatches = filterTreeNodes(node.children ?? [], query)
    if (!selfMatch && childMatches.length === 0) continue

    result.push({
      ...node,
      children:
        selfMatch && childMatches.length === 0
          ? [...(node.children ?? [])]
          : childMatches,
    })
  }
  return result
}

function collectExpandKeys(nodes: TreeNode[]): Record<string, boolean> {
  const keys: Record<string, boolean> = {}
  for (const node of nodes) {
    if (!node.children?.length) continue
    keys[node.key] = true
    Object.assign(keys, collectExpandKeys(node.children))
  }
  return keys
}

const displayedTreeNodes = computed(() =>
  filterTreeNodes(treeNodes.value, groupSearch.value),
)

watch(groupSearch, (query) => {
  if (!query.trim()) return
  expandedKeys.value = {
    ...expandedKeys.value,
    ...collectExpandKeys(displayedTreeNodes.value),
  }
})

watch(
  () => props.settings,
  () => {
    groups.value = []
    items.value = []
    itemColumns.value = []
    treeNodes.value = []
    selectedGroupKey.value = null
    selectedKeys.value = {}
    expandedKeys.value = {}
    groupSearch.value = ''
    activeItemSort.value = null
    if (props.settings) {
      void loadGroups()
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => props.settings?.main.sort,
  () => {
    if (props.groupsOnly) return
    activeItemSort.value = null
    if (selectedGroupKey.value) {
      void loadItems()
    }
  },
  { deep: true },
)

watch(selectedGroupKey, () => {
  emitGroupSelection()
  if (props.groupsOnly) return
  items.value = []
  if (selectedGroupKey.value) {
    void loadItems()
  } else {
    itemColumns.value = []
  }
})

watch(
  () => props.filter,
  () => {
    if (props.groupsOnly) return
    if (selectedGroupKey.value) {
      void loadItems()
    }
  },
  { deep: true },
)

function emitGroupSelection(): void {
  const group = selectedGroup.value
  const id = group && props.settings
    ? recordId(group, props.settings.group.primaryKey)
    : null
  if (id === null || !group) {
    emit('group-selected', null)
    emit('update:selectedGroupId', null)
    return
  }
  emit('group-selected', {
    id,
    record: group,
    subtreeIds: collectSubtreeGroupIds(id),
  })
  emit('update:selectedGroupId', id)
}

function updateSelectedKeys(keys: Record<string, boolean>): void {
  selectedKeys.value = keys
  selectedGroupKey.value = Object.keys(keys).find((key) => keys[key]) ?? null
}

function updateTreeNodesModel(nodes: unknown): void {
  // Avoid replacing the full tree with a filtered subset while searching.
  if (groupSearch.value.trim()) return
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

function hasItemDragPayload(event: DragEvent): boolean {
  if (draggedItem.value) return true
  const types = event.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('text/plain')
}

function resolveDraggedItem(event: DragEvent): Record<string, unknown> | null {
  if (draggedItem.value) return draggedItem.value
  const settings = props.settings
  if (!settings) return null
  const raw = event.dataTransfer?.getData('text/plain')?.trim()
  if (!raw || raw === 'item' || raw === 'row') return null
  return { [settings.main.primaryKey]: raw }
}

function allowItemDrop(event: DragEvent): void {
  if (!canMoveItems.value || !hasItemDragPayload(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

async function dropItemOnTree(event: DragEvent): Promise<void> {
  if (!canMoveItems.value || !props.settings) return
  if (!hasItemDragPayload(event)) return
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
  if (!canMoveItems.value) return
  event.preventDefault()
  event.stopPropagation()
  if (!props.settings) return

  const item = resolveDraggedItem(event)
  if (!item) return

  const groupId = recordId(group, props.settings.group.primaryKey)
  if (groupId === null) return

  await moveItemToGroup(item, groupId)
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
  const groupField = settings?.main.groupField?.trim() || ''
  if (!settings || !groupField || moving.value || groupField.includes('.')) return

  const itemId = recordId(item, settings.main.primaryKey)
  if (itemId === null) return

  const currentGroupId = scalarId(getPathValue(item, groupField))
    ?? scalarId(item[groupField])
  if (
    (Object.prototype.hasOwnProperty.call(item, groupField) ||
      getPathValue(item, groupField) !== undefined) &&
    String(currentGroupId ?? '') === String(groupId)
  ) {
    clearDragState()
    return
  }

  moving.value = true
  error.value = null
  try {
    await updateObjectRecord(
      settings.main.collection,
      String(itemId),
      { [groupField]: groupId },
    )

    if (!props.groupsOnly) {
      items.value = items.value.filter(
        (row) => String(recordId(row, settings.main.primaryKey)) !== String(itemId),
      )
    }
    emit('item-moved', { itemId, groupId })
    if (isSelfRefTree.value) {
      await loadGroups()
    }
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

/** Selected group + every nested child group (BFS over parentField). */
function collectSubtreeGroupIds(rootId: string | number): Array<string | number> {
  const settings = props.settings
  const ids: Array<string | number> = [rootId]
  if (!settings?.group.parentField) return ids

  const primaryKey = settings.group.primaryKey
  const parentField = settings.group.parentField
  const childrenByParent = new Map<string, Array<string | number>>()

  for (const group of groups.value) {
    const id = recordId(group, primaryKey)
    if (id === null) continue
    const parentId = scalarId(group[parentField])
    if (parentId === null) continue
    const key = String(parentId)
    const list = childrenByParent.get(key) ?? []
    list.push(id)
    childrenByParent.set(key, list)
  }

  const queue = [String(rootId)]
  const seen = new Set<string>(queue)
  while (queue.length) {
    const current = queue.shift()!
    for (const childId of childrenByParent.get(current) ?? []) {
      const childKey = String(childId)
      if (seen.has(childKey)) continue
      seen.add(childKey)
      ids.push(childId)
      queue.push(childKey)
    }
  }

  return ids
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
    const labelField = settings.group.labelField?.trim()
    const rows = await readDynamicItems(settings.group.collection, {
      limit: -1,
      fields,
      ...(labelField ? { sort: [labelField] } : {}),
    })
    if (token === groupLoadToken) {
      groups.value = rows as Record<string, unknown>[]
      syncTreeNodesFromGroups()
      ensureDefaultGroupSelection()
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

/** Pick the first root group when nothing is selected (or selection is stale). */
function ensureDefaultGroupSelection(): void {
  const pk = props.settings?.group.primaryKey ?? 'id'
  if (selectedGroupKey.value) {
    const stillPresent = groups.value.some(
      (group) => String(recordId(group, pk)) === selectedGroupKey.value,
    )
    if (stillPresent) return
  }

  const firstRoot = treeNodes.value[0]
  if (!firstRoot) return
  focusGroupKey(firstRoot.key)
}

async function loadItems(): Promise<void> {
  if (props.groupsOnly) return
  const settings = props.settings
  if (!settings?.main.collection || !settings.main.groupField || !selectedGroup.value) {
    return
  }

  const groupId = recordId(selectedGroup.value, settings.group.primaryKey)
  if (groupId === null) return

  const tableSettings = treeItemTableSettings()
  if (!tableSettings) return

  const token = ++itemLoadToken
  loadingItems.value = true
  error.value = null

  try {
    const runtime = await fetchDataTableRuntime({
      collection: settings.main.collection,
      settings: tableSettings,
      limit: -1,
      parentCollection: settings.group.collection,
      parentId: groupId,
      listFilter: buildItemFilter(settings.main.groupField, groupId, props.filter),
    })
    if (token === itemLoadToken) {
      items.value = runtime.rows
      itemColumns.value = visibleItemColumns(runtime.columns, settings)
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
  if (!props.settings.group.parentField?.trim()) {
    createGroupParentId.value = null
    createGroupParentRecord.value = null
  } else {
    createGroupParentId.value = selectedGroupId()
    createGroupParentRecord.value = selectedGroup.value
  }
  createGroupDialogVisible.value = true
}

function updateCreateGroupDialogVisible(visible: boolean): void {
  createGroupDialogVisible.value = visible
  if (!visible) {
    createGroupParentId.value = null
    createGroupParentRecord.value = null
  }
}

function expandAncestorsOf(key: string): void {
  const settings = props.settings
  const parentField = settings?.group.parentField?.trim()
  if (!settings || !parentField) return

  const byId = new Map<string, Record<string, unknown>>()
  for (const group of groups.value) {
    const id = recordId(group, settings.group.primaryKey)
    if (id !== null) byId.set(String(id), group)
  }

  const next = { ...expandedKeys.value }
  let current = byId.get(key)
  const seen = new Set<string>()
  while (current) {
    const currentId = recordId(current, settings.group.primaryKey)
    if (currentId !== null) {
      const currentKey = String(currentId)
      if (seen.has(currentKey)) break
      seen.add(currentKey)
    }
    const parentId = scalarId(current[parentField])
    if (parentId === null) break
    const parentKey = String(parentId)
    next[parentKey] = true
    current = byId.get(parentKey)
  }
  expandedKeys.value = next
}

function focusGroupKey(key: string | null): void {
  if (!key) return
  selectedGroupKey.value = key
  selectedKeys.value = { [key]: true }
  expandAncestorsOf(key)
  void nextTick(() => {
    const el = document.querySelector(
      `[data-tree-group-key="${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
    )
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function handleGroupCreated(record: Record<string, unknown>): void {
  updateCreateGroupDialogVisible(false)
  groups.value = upsertRecord(groups.value, record, props.settings?.group.primaryKey ?? 'id')
  syncTreeNodesFromGroups()

  const id = props.settings ? recordId(record, props.settings.group.primaryKey) : null
  if (id !== null) {
    focusGroupKey(String(id))
  }
}

async function refreshTreeAfterItemChange(
  focusRecord?: Record<string, unknown> | null,
): Promise<void> {
  if (!isSelfRefTree.value) return

  const settings = props.settings
  const previousKey = selectedGroupKey.value
  const focusId =
    focusRecord && settings
      ? recordId(focusRecord, settings.main.primaryKey)
      : null
  const focusKey = focusId !== null ? String(focusId) : previousKey

  await loadGroups()

  if (focusKey) {
    focusGroupKey(focusKey)
  }

  // Selecting a different node already reloads items via selectedGroupKey watch.
  if (selectedGroupKey.value && selectedGroupKey.value === previousKey) {
    await loadItems()
  }
}

async function handleItemRecordCreated(row: Record<string, unknown>): Promise<void> {
  await refreshTreeAfterItemChange(row)
}

async function handleItemRecordUpdated(row: Record<string, unknown>): Promise<void> {
  await refreshTreeAfterItemChange(row)
}

async function handleItemRecordDeleted(row: Record<string, unknown>): Promise<void> {
  const settings = props.settings
  const parentField = settings?.group.parentField?.trim()
  let focusParent: Record<string, unknown> | null = null
  if (settings && parentField) {
    const parentId = scalarId(row[parentField])
    if (parentId !== null) {
      focusParent = { [settings.group.primaryKey]: parentId }
    }
  }
  await refreshTreeAfterItemChange(focusParent)
}

async function handleItemRecordRestored(row: Record<string, unknown>): Promise<void> {
  await refreshTreeAfterItemChange(row)
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
  const groupFilter = nestRelationFilter(groupField, { _eq: groupId })

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

function handleItemSortChange(payload: {
  field: string | null
  order: 1 | -1 | null
}): void {
  const field = payload.field?.trim() || ''
  if (!field || payload.order === null) {
    activeItemSort.value = null
  } else {
    activeItemSort.value = {
      field,
      order: payload.order === -1 ? -1 : 1,
    }
  }
  if (selectedGroupKey.value) {
    void loadItems()
  }
}

defineExpose({
  refreshGroups: loadGroups,
})

</script>

<template>
  <div class="crm-tree-table flex min-h-0 h-full flex-col gap-3">
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

      <section
        v-if="groupsOnly"
        class="crm-tree-table__pane crm-tree-table__pane--groups border border-surface-200 rounded-lg p-3"
      >
        <div class="flex items-center gap-3 justify-between mb-2 shrink-0">
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
        <IconField class="crm-tree-table__group-search shrink-0 mb-2 w-full">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="groupSearch"
            class="w-full"
            size="small"
            :placeholder="t('treeTable.searchGroups', 'Search groups…')"
            :disabled="loadingGroups"
          />
        </IconField>
        <div
          v-if="loadingGroups"
          class="crm-tree-table__loading flex items-center gap-3 text-muted-color text-[0.85rem] shrink-0"
        >
          <ProgressSpinner stroke-width="4" />
          <span>{{ t('treeTable.loadingGroups', 'Loading groups...') }}</span>
        </div>
        <div
          v-else
          class="crm-tree-table__groups-scroll"
        >
          <Tree
            :value="displayedTreeNodes"
            selection-mode="single"
            :selection-keys="selectedKeys"
            v-model:expanded-keys="expandedKeys"
            :draggable-nodes="canReparentGroups && !groupSearch.trim()"
            :droppable-nodes="canReparentGroups && !groupSearch.trim()"
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
          <p
            v-if="displayedTreeNodes.length === 0"
            class="m-0 text-muted-color text-[0.85rem]"
          >
            {{
              groupSearch.trim()
                ? t('treeTable.noGroupSearchResults', 'No groups match your search.')
                : t('treeTable.noGroups', 'No groups yet.')
            }}
          </p>
        </div>
      </section>

      <Splitter
        v-else
        :state-key="splitterStateKey"
        state-storage="local"
        class="crm-tree-table__splitter"
      >
        <SplitterPanel
          :size="40"
          :min-size="20"
          class="crm-tree-table__panel"
        >
          <section class="crm-tree-table__pane crm-tree-table__pane--groups border border-surface-200 rounded-lg p-3">
            <div class="flex items-center gap-3 justify-between mb-2 shrink-0">
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
            <IconField class="crm-tree-table__group-search shrink-0 mb-2 w-full">
              <InputIcon class="pi pi-search" />
              <InputText
                v-model="groupSearch"
                class="w-full"
                size="small"
                :placeholder="t('treeTable.searchGroups', 'Search groups…')"
                :disabled="loadingGroups"
              />
            </IconField>
            <div
              v-if="loadingGroups"
              class="crm-tree-table__loading flex items-center gap-3 text-muted-color text-[0.85rem] shrink-0"
            >
              <ProgressSpinner stroke-width="4" />
              <span>{{ t('treeTable.loadingGroups', 'Loading groups...') }}</span>
            </div>
            <div
              v-else
              class="crm-tree-table__groups-scroll"
            >
              <Tree
                :value="displayedTreeNodes"
                selection-mode="single"
                :selection-keys="selectedKeys"
                v-model:expanded-keys="expandedKeys"
                :draggable-nodes="canReparentGroups && !groupSearch.trim()"
                :droppable-nodes="canReparentGroups && !groupSearch.trim()"
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
              <p
                v-if="displayedTreeNodes.length === 0"
                class="m-0 text-muted-color text-[0.85rem]"
              >
                {{
                  groupSearch.trim()
                    ? t('treeTable.noGroupSearchResults', 'No groups match your search.')
                    : t('treeTable.noGroups', 'No groups yet.')
                }}
              </p>
            </div>
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
              :parent-collection="settings.group.collection"
              :parent-record="selectedGroup ?? undefined"
              :loading="loadingItems"
              :empty-message="t('treeTable.noItemsForGroup', 'No items for selected group.')"
              :show-new-button="!disabled"
              :new-button-label="t('treeTable.newItem', 'New item')"
              :show-delete-button="!disabled || mode === 'browse'"
              :sortable-columns="true"
              :reorderable-columns="false"
              :default-sort-field="effectiveItemSort?.field ?? null"
              :default-sort-order="effectiveItemSort?.order ?? null"
              :row-draggable="canMoveItems"
              @update:rows="items = $event"
              @sort-change="handleItemSortChange"
              @record-created="handleItemRecordCreated"
              @record-updated="handleItemRecordUpdated"
              @record-deleted="handleItemRecordDeleted"
              @record-restored="handleItemRecordRestored"
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
      :parent-id="createGroupParentId ?? undefined"
      :parent-collection="settings.group.collection"
      :parent-record="createGroupParentRecord ?? undefined"
      @update:visible="updateCreateGroupDialogVisible"
      @created="handleGroupCreated"
    />
  </div>
</template>

<style scoped>
.crm-tree-table {
  min-height: 0;
}

.crm-tree-table__splitter {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  height: 100%;
  border: none;
  background: transparent;
}

.crm-tree-table__splitter :deep(.p-splitter) {
  height: 100%;
  min-height: 0;
}

.crm-tree-table__splitter :deep(.p-splitter-panel) {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.crm-tree-table__panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex: 1 1 auto;
}

.crm-tree-table__pane {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.crm-tree-table__pane--groups {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.crm-tree-table__groups-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.crm-tree-table__group-search :deep(.p-inputtext) {
  width: 100%;
}

.crm-tree-table__loading :deep(.p-progressspinner) {
  height: 1.5rem;
  width: 1.5rem;
}
</style>
