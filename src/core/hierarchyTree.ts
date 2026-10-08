export interface HierarchyTreeNode {
  key: string
  label: string
  data?: Record<string, unknown>
  children?: HierarchyTreeNode[]
}

export interface BuildHierarchyTreeOptions {
  primaryKey: string
  labelField: string
  parentField?: string | null
}

function scalarId(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  return null
}

function recordId(record: Record<string, unknown>, primaryKey: string): string | number | null {
  return scalarId(record[primaryKey])
}

function recordLabel(record: Record<string, unknown>, labelField: string): string {
  const value = record[labelField]
  if (value === null || value === undefined || value === '') {
    return String(recordId(record, 'id') ?? '')
  }
  if (typeof value === 'object') {
    const nested = value as Record<string, unknown>
    return String(nested.name ?? nested.title ?? nested.label ?? nested.id ?? '')
  }
  return String(value)
}

/** Builds a parent/child tree from flat records using a self-FK parent field. */
export function buildHierarchyTreeNodes(
  records: Record<string, unknown>[],
  options: BuildHierarchyTreeOptions,
): HierarchyTreeNode[] {
  const nodeById = new Map<string, HierarchyTreeNode>()
  const roots: HierarchyTreeNode[] = []

  for (const record of records) {
    const id = recordId(record, options.primaryKey)
    if (id === null) continue
    nodeById.set(String(id), {
      key: String(id),
      label: recordLabel(record, options.labelField) || String(id),
      data: record,
      children: [],
    })
  }

  for (const node of nodeById.values()) {
    const parentId =
      options.parentField && node.data && node.data[options.parentField] !== undefined
        ? scalarId(node.data[options.parentField])
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

/** Selected node key plus all descendant keys. */
export function collectTreeNodeAndDescendantKeys(
  nodes: HierarchyTreeNode[],
  selectedKey: string,
): Set<string> {
  const keys = new Set<string>()

  function walk(node: HierarchyTreeNode, collecting: boolean): void {
    const include = collecting || node.key === selectedKey
    if (include) keys.add(node.key)
    for (const child of node.children ?? []) {
      walk(child, include)
    }
  }

  for (const root of nodes) {
    walk(root, false)
  }
  return keys
}
