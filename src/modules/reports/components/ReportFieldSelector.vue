<script lang="ts">
export default {
  name: 'ReportFieldSelector',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  listReportFieldTreeNodes,
  loadReportFieldTreeMetadata,
  type ReportFieldOption,
  type ReportFieldTreeMetadata,
  type ReportFieldTreeNode,
} from '../services/reportSettings'

interface CheckedTreeValue {
  checked: boolean
  partialChecked?: boolean
}

type TreeSelectionValue = Record<string, boolean | CheckedTreeValue> | null

type FieldTreeNode = Omit<ReportFieldTreeNode, 'children' | 'data'> & {
  children?: FieldTreeNode[]
  loading?: boolean
  data: ReportFieldOption & {
    childrenLoaded?: boolean
  }
}

const props = withDefaults(defineProps<{
  collection: string
  modelValue: string | string[] | null
  multiple?: boolean
  includeAny?: boolean
  placeholder?: string
}>(), {
  multiple: false,
  includeAny: false,
  placeholder: 'Select field',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]]
  'fields-loaded': [fields: ReportFieldOption[]]
}>()

const nodes = ref<FieldTreeNode[]>([])
const loading = ref(false)
const metadata = ref<ReportFieldTreeMetadata | null>(null)
let loadToken = 0

const treeValue = computed<TreeSelectionValue>(() => {
  if (!props.multiple) {
    return typeof props.modelValue === 'string' && props.modelValue
      ? { [props.modelValue]: true }
      : null
  }

  return selectedValues().reduce<Record<string, CheckedTreeValue>>((selection, value) => {
    selection[value] = { checked: true, partialChecked: false }
    return selection
  }, {})
})

watch(
  () => props.collection,
  () => {
    void loadRootNodes()
  },
  { immediate: true },
)

watch(
  () => props.modelValue,
  () => {
    void ensureSelectedPaths()
  },
  { deep: true },
)

function handleUpdate(value: unknown): void {
  if (!props.multiple) {
    emit('update:modelValue', singleSelectedValue(value))
    return
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    emit('update:modelValue', [])
    return
  }

  const selection = value as Record<string, CheckedTreeValue | boolean>
  emit(
    'update:modelValue',
    Object.entries(selection)
      .filter(([, selected]) =>
        selected === true ||
        (typeof selected === 'object' && selected.checked === true),
      )
      .map(([key]) => key),
  )
}

function singleSelectedValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

  const selection = value as Record<string, boolean | CheckedTreeValue>
  return Object.entries(selection).find(([, selected]) =>
    selected === true ||
    (typeof selected === 'object' && selected.checked === true),
  )?.[0] ?? ''
}

function handleNodeExpand(event: unknown): void {
  const node = ((event as { node?: FieldTreeNode })?.node ?? event) as FieldTreeNode
  void loadChildren(node)
}

async function loadRootNodes(): Promise<void> {
  const token = ++loadToken
  nodes.value = props.includeAny ? [anyNode()] : []
  metadata.value = null
  if (!props.collection) return

  loading.value = true
  try {
    const loadedMetadata = await loadReportFieldTreeMetadata()
    if (token !== loadToken) return
    metadata.value = loadedMetadata
    const loaded = mapNodes(
      await listReportFieldTreeNodes(
        props.collection,
        '',
        '',
        loadedMetadata,
      ),
    )
    if (token !== loadToken) return
    nodes.value = props.includeAny ? [anyNode(), ...loaded] : loaded
    emitLoadedFields(loaded)
    await ensureSelectedPaths()
  } finally {
    if (token === loadToken) {
      loading.value = false
    }
  }
}

async function loadChildren(node: FieldTreeNode | null): Promise<void> {
  if (
    !node ||
    node.leaf ||
    !node.data.relatedCollection ||
    node.data.childrenLoaded ||
    !metadata.value
  ) {
    return
  }
  node.loading = true
  refreshNodes()
  try {
    const children = mapNodes(
      await listReportFieldTreeNodes(
        props.collection,
        node.key,
        node.data.label,
        metadata.value,
      ),
    )
    node.children = children
    node.leaf = children.length === 0
    node.data.childrenLoaded = true
    emitLoadedFields(children)
  } finally {
    node.loading = false
    refreshNodes()
  }
}

async function ensureSelectedPaths(): Promise<void> {
  if (!props.collection || nodes.value.length === 0) return
  for (const path of selectedValues()) {
    await ensurePathLoaded(path)
  }
}

async function ensurePathLoaded(path: string): Promise<void> {
  const parts = path.split('.').filter(Boolean)
  if (parts.length < 2) return

  for (let index = 1; index < parts.length; index += 1) {
    const ancestorPath = parts.slice(0, index).join('.')
    const node = findNode(ancestorPath)
    if (!node) return
    await loadChildren(node)
  }
}

function selectedValues(): string[] {
  if (Array.isArray(props.modelValue)) return props.modelValue
  return typeof props.modelValue === 'string' && props.modelValue
    ? [props.modelValue]
    : []
}

function mapNodes(rawNodes: ReportFieldTreeNode[]): FieldTreeNode[] {
  return rawNodes.map((node) => ({
    ...node,
    data: { ...node.data },
    children: node.children ? [] : undefined,
  }))
}

function emitLoadedFields(loadedNodes: FieldTreeNode[]): void {
  emit('fields-loaded', loadedNodes.map((node) => node.data))
}

function findNode(key: string, list = nodes.value): FieldTreeNode | null {
  for (const node of list) {
    if (node.key === key) return node
    const child = node.children ? findNode(key, node.children) : null
    if (child) return child
  }
  return null
}

function refreshNodes(): void {
  nodes.value = [...nodes.value]
}

function anyNode(): FieldTreeNode {
  return {
    key: '*',
    label: '*',
    leaf: true,
    selectable: true,
    data: {
      field: '*',
      label: '*',
      type: 'alias',
      component: 'InputText',
    },
  }
}
</script>

<template>
  <TreeSelect
    :model-value="treeValue"
    :options="nodes"
    :selection-mode="multiple ? 'checkbox' : 'single'"
    :placeholder="placeholder"
    :loading="loading"
    display="chip"
    filter
    fluid
    @update:model-value="handleUpdate"
    @node-expand="handleNodeExpand"
  />
</template>
