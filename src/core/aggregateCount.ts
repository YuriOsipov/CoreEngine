export function aggregateCount(response: unknown): number {
  const first = Array.isArray(response) ? response[0] : response
  if (!first || typeof first !== 'object') return 0

  const count = (first as { count?: unknown }).count
  const directCount = numericCount(count)
  if (directCount !== null) return directCount

  if (count && typeof count === 'object') {
    const countRecord = count as Record<string, unknown>
    const starCount = numericCount(countRecord['*'])
    if (starCount !== null) return starCount

    for (const value of Object.values(countRecord)) {
      const nestedCount = numericCount(value)
      if (nestedCount !== null) return nestedCount
    }
  }

  return 0
}

function numericCount(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const numeric = Number(value)
    return Number.isNaN(numeric) ? null : numeric
  }
  return null
}
