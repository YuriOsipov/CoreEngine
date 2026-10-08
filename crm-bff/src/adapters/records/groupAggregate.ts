/** In-memory GROUP BY for GraphQL backends that lack SQL grouping (Hasura v2). */

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function groupKey(row: Record<string, unknown>, fields: string[]): string {
  return fields.map((field) => JSON.stringify(row[field] ?? null)).join('\0')
}

interface Bucket {
  group: Record<string, unknown>
  count: number
  numbers: Map<string, number[]>
  distinct: Map<string, Set<string>>
}

/**
 * Collapse rows into the same shape as postgresAggregate:
 * `{ [groupField]: value, [fn]: { [aggField]: number } }`.
 */
export function groupAggregateRows(
  nodes: Record<string, unknown>[],
  groupFields: string[],
  aggregate: Record<string, unknown>,
  limit = -1,
): Record<string, unknown>[] {
  const entries = Object.entries(aggregate)
  if (!groupFields.length || !entries.length) return []

  const buckets = new Map<string, Bucket>()
  for (const node of nodes) {
    const key = groupKey(node, groupFields)
    let bucket = buckets.get(key)
    if (!bucket) {
      const group: Record<string, unknown> = {}
      for (const field of groupFields) group[field] = node[field] ?? null
      bucket = { group, count: 0, numbers: new Map(), distinct: new Map() }
      buckets.set(key, bucket)
    }
    bucket.count += 1

    for (const [fn, field] of entries) {
      const lower = fn.toLowerCase()
      if (lower === 'count') continue
      const col = String(field ?? '*') || '*'
      const raw = col === '*' ? node.id : node[col]
      if (lower.includes('distinct')) {
        let set = bucket.distinct.get(fn)
        if (!set) {
          set = new Set()
          bucket.distinct.set(fn, set)
        }
        set.add(JSON.stringify(raw ?? null))
        continue
      }
      if (lower === 'sum' || lower === 'avg' || lower === 'min' || lower === 'max') {
        let list = bucket.numbers.get(fn)
        if (!list) {
          list = []
          bucket.numbers.set(fn, list)
        }
        list.push(toNumber(raw))
      }
    }
  }

  const rows = [...buckets.values()].map((bucket) => {
    const out: Record<string, unknown> = { ...bucket.group }
    for (const [fn, field] of entries) {
      const col = String(field ?? '*') || '*'
      const lower = fn.toLowerCase()
      let value = 0
      if (lower === 'count') {
        value = bucket.count
      } else if (lower === 'countdistinct') {
        value = bucket.distinct.get(fn)?.size ?? 0
      } else if (lower === 'sum') {
        value = (bucket.numbers.get(fn) ?? []).reduce((sum, n) => sum + n, 0)
      } else if (lower === 'sumdistinct') {
        const set = bucket.distinct.get(fn)
        value = set
          ? [...set].reduce((sum, item) => sum + toNumber(JSON.parse(item) as unknown), 0)
          : 0
      } else if (lower === 'avg' || lower === 'avgdistinct') {
        if (lower === 'avgdistinct') {
          const set = bucket.distinct.get(fn)
          const nums = set
            ? [...set].map((item) => toNumber(JSON.parse(item) as unknown))
            : []
          value = nums.length ? nums.reduce((sum, n) => sum + n, 0) / nums.length : 0
        } else {
          const nums = bucket.numbers.get(fn) ?? []
          value = nums.length ? nums.reduce((sum, n) => sum + n, 0) / nums.length : 0
        }
      } else if (lower === 'min') {
        const nums = bucket.numbers.get(fn) ?? []
        value = nums.length ? Math.min(...nums) : 0
      } else if (lower === 'max') {
        const nums = bucket.numbers.get(fn) ?? []
        value = nums.length ? Math.max(...nums) : 0
      } else {
        throw new Error(`groupAggregateRows: unsupported function "${fn}"`)
      }
      out[fn] = { [col]: value }
    }
    return out
  })

  if (limit >= 0) return rows.slice(0, limit)
  return rows
}

export function aggregateSelectFields(
  groupFields: string[],
  aggregate: Record<string, unknown>,
): string[] {
  const fields = new Set<string>(groupFields)
  for (const [fn, field] of Object.entries(aggregate)) {
    const col = String(field ?? '*') || '*'
    if (col !== '*') fields.add(col)
    if (fn.toLowerCase().includes('count')) fields.add('id')
  }
  return [...fields]
}
