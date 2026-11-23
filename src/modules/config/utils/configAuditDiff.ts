export interface ConfigAuditChange {
  field: string
  label: string
  previousValue: string
  nextValue: string
}

function humanizeField(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left == null && right == null) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function formatConfigAuditValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Activity-log style changes-only view.
 * - Both before+after → diff unequal keys
 * - CREATE with after only → initial values (— → next)
 * - UPDATE with after only (legacy rows) → no deltas (cannot infer)
 * - DELETE with before only → cleared values (prev → —)
 */
export function computeConfigAuditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  action?: string | null,
): ConfigAuditChange[] {
  const prev = before && typeof before === 'object' ? before : {}
  const next = after && typeof after === 'object' ? after : {}
  const hasPrev = Object.keys(prev).some(
    (key) => !key.startsWith('_') && prev[key] !== undefined,
  )
  const hasNext = Object.keys(next).some(
    (key) => !key.startsWith('_') && next[key] !== undefined,
  )
  if (!hasPrev && !hasNext) return []

  const actionUpper = String(action || '').toUpperCase()
  // Match activity log: update without a prior snapshot cannot show field diffs.
  if (!hasPrev && hasNext && actionUpper === 'UPDATE') return []
  if (!hasPrev && hasNext && actionUpper && actionUpper !== 'CREATE') {
    // REPLACE / other without before → treat like create snapshot of written payload
  }

  const fields = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changes: ConfigAuditChange[] = []

  for (const field of [...fields].sort()) {
    if (field.startsWith('_')) continue
    const previousValue = Object.prototype.hasOwnProperty.call(prev, field)
      ? prev[field]
      : undefined
    const nextValue = Object.prototype.hasOwnProperty.call(next, field)
      ? next[field]
      : undefined

    if (nextValue === undefined && previousValue === undefined) continue
    if (!hasPrev && (nextValue === undefined || nextValue === null)) continue
    if (valuesEqual(previousValue, nextValue)) continue

    changes.push({
      field,
      label: humanizeField(field),
      previousValue: formatConfigAuditValue(
        hasPrev || previousValue !== undefined ? previousValue : null,
      ),
      nextValue: formatConfigAuditValue(
        hasNext || nextValue !== undefined ? nextValue : null,
      ),
    })
  }

  return changes
}
