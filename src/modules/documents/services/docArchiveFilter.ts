/** Active records: not soft-deleted via the `archived` field. */
export function notArchivedFilter(): Record<string, unknown> {
  return {
    _or: [
      { archived: { _eq: false } },
      { archived: { _null: true } },
    ],
  }
}

export function andFilters(
  ...parts: Array<Record<string, unknown>>
): Record<string, unknown> {
  const filters = parts.filter((part) => Object.keys(part).length > 0)
  if (filters.length === 0) return {}
  if (filters.length === 1) return filters[0]
  return { _and: filters }
}
