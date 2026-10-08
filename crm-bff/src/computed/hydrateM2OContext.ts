import { loadM2ORelations } from '../adapters/records/relations.js'
import { resolveRecordsStore } from '../adapters/records/registry.js'

function relationId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim()
    return id || null
  }
  if (typeof value === 'object' && value && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return id == null ? null : String(id)
  }
  return null
}

/** Collect M2O root fields referenced as `field.child` inside {{ templates }}. */
export function collectNestedRootFieldsFromTemplates(
  templates: Iterable<string>,
): Set<string> {
  const roots = new Set<string>()
  for (const raw of templates) {
    if (typeof raw !== 'string') continue
    for (const match of raw.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const expression = match[1] ?? ''
      for (const pathMatch of expression.matchAll(
        /\b([a-zA-Z_][\w]*)\.(?:[a-zA-Z_][\w.]*)/g,
      )) {
        const root = pathMatch[1]
        if (root && !root.startsWith('$')) roots.add(root)
      }
    }
  }
  return roots
}

/** Collect nested roots from set-field template values. */
export function collectNestedRootFields(
  setFields: Record<string, unknown>,
): Set<string> {
  return collectNestedRootFieldsFromTemplates(
    Object.values(setFields).filter((v): v is string => typeof v === 'string'),
  )
}

/**
 * Expand M2O id fields into related records so templates can read
 * nested paths such as `item.options`.
 */
export async function hydrateM2OContext(
  entityApiName: string,
  record: Record<string, unknown>,
  roots: Set<string>,
): Promise<Record<string, unknown>> {
  if (!roots.size) return { ...record }
  const context = { ...record }
  const relations = await loadM2ORelations(entityApiName)
  const byField = new Map(
    relations.map((rel) => [rel.fieldApiName, rel.relatedEntityApiName]),
  )

  for (const root of roots) {
    const relatedEntity = byField.get(root)
    if (!relatedEntity) continue
    const current = context[root]
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const nested = current as Record<string, unknown>
      if (nested.date_start != null || Object.keys(nested).length > 1) continue
    }
    const id = relationId(current)
    if (!id) continue
    try {
      const store = await resolveRecordsStore(relatedEntity)
      context[root] = await store.findOne(relatedEntity, id, null)
    } catch {
      // Keep scalar id when related row cannot be loaded.
    }
  }
  return context
}
