import type { FieldDefinition } from '@/interfaces'
import type { TreeNode } from 'primevue/treenode'
import { humanizeFieldName } from '@/modules/entities/utils/recordDisplay'

export interface FieldOption {
  label: string
  value: string
}

export type FieldTreeNode = TreeNode & {
  data: FieldOption
  children?: FieldTreeNode[]
}

export function fieldSelectOptions(fields: FieldDefinition[]): FieldOption[] {
  return fields
    .filter((field) => field.type !== 'alias')
    .map((field) => ({
      label: field.meta?.note?.trim() || humanizeFieldName(field.field),
      value: field.field,
    }))
}

export function nestedFieldOptions(
  fields: FieldDefinition[],
  nestedFieldsByCollection: Record<string, FieldDefinition[]>,
  relatedCollectionForField: (field: FieldDefinition) => string,
): FieldOption[] {
  return fields
    .filter((field) => field.type !== 'alias')
    .flatMap((field) => {
      const [base] = fieldSelectOptions([field])
      if (!base) return []

      const relatedCollection = relatedCollectionForField(field)
      if (!relatedCollection) return [base]

      return [
        base,
        ...fieldSelectOptions(nestedFieldsByCollection[relatedCollection] ?? []).map((nestedField) => ({
          label: `${base.label} / ${nestedField.label}`,
          value: `${field.field}.${nestedField.value}`,
        })),
      ]
    })
}

export function buildFieldTreeNodes(
  fields: FieldDefinition[],
  nestedFieldsByCollection: Record<string, FieldDefinition[]>,
  relatedCollectionForField: (field: FieldDefinition) => string,
): FieldTreeNode[] {
  return fields
    .filter((field) => field.type !== 'alias')
    .map((field) => {
      const [base] = fieldSelectOptions([field])
      if (!base) return null

      const relatedCollection = relatedCollectionForField(field)
      const nestedFields = relatedCollection
        ? fieldSelectOptions(nestedFieldsByCollection[relatedCollection] ?? [])
        : []

      const node: FieldTreeNode = {
        key: base.value,
        label: base.label,
        data: base,
        leaf: nestedFields.length === 0,
        children: nestedFields.map((nestedField) => ({
          key: `${field.field}.${nestedField.value}`,
          label: nestedField.label,
          data: {
            label: `${base.label} / ${nestedField.label}`,
            value: `${field.field}.${nestedField.value}`,
          },
          leaf: true,
        })),
      }

      return node
    })
    .filter((node): node is FieldTreeNode => Boolean(node))
}

export function pruneSelectedFieldTreeNodes(
  nodes: FieldTreeNode[],
  selectedPaths: ReadonlySet<string>,
): FieldTreeNode[] {
  return nodes.flatMap((node) => {
    const childNodes = node.children
      ? pruneSelectedFieldTreeNodes(node.children, selectedPaths)
      : []

    if (selectedPaths.has(String(node.key))) {
      return childNodes.length > 0 ? [{ ...node, children: childNodes, leaf: false }] : []
    }

    return [{
      ...node,
      children: childNodes.length > 0 ? childNodes : node.children,
      leaf: childNodes.length === 0 && !node.children?.length,
    }]
  })
}

export function filterFieldTreeNodes(
  nodes: FieldTreeNode[],
  query: string,
): FieldTreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return nodes

  return nodes.flatMap((node) => {
    const label = String(node.label ?? '').toLowerCase()
    const key = String(node.key ?? '').toLowerCase()
    const filteredChildren = node.children
      ? filterFieldTreeNodes(node.children, query)
      : []

    if (
      label.includes(normalized) ||
      key.includes(normalized) ||
      filteredChildren.length > 0
    ) {
      return [{
        ...node,
        children: filteredChildren.length > 0 ? filteredChildren : node.children,
      }]
    }

    return []
  })
}


export function collectExpandedTreeKeys(
  nodes: FieldTreeNode[],
): Record<string, boolean> {
  return nodes.reduce<Record<string, boolean>>((expanded, node) => {
    expanded[String(node.key)] = true
    if (node.children?.length) {
      Object.assign(expanded, collectExpandedTreeKeys(node.children))
    }
    return expanded
  }, {})
}
