const COLLAPSED_PREFIX = 'object-list-detail-collapsed:'
const SPLITTER_PREFIX = 'object-list-splitter:'

export type ListDetailSplitterOrientation = 'stacked' | 'sideBySide'

export function listDetailSplitterStateKey(
  collection: string,
  orientation: ListDetailSplitterOrientation = 'stacked',
): string {
  return `${SPLITTER_PREFIX}${collection}:${orientation}`
}

export function loadListDetailCollapsed(
  collection: string,
  defaultCollapsed = false,
): boolean {
  if (typeof localStorage === 'undefined' || !collection) return defaultCollapsed
  const raw = localStorage.getItem(`${COLLAPSED_PREFIX}${collection}`)
  if (raw === null) return defaultCollapsed
  return raw === 'true'
}

export function saveListDetailCollapsed(collection: string, collapsed: boolean): void {
  if (typeof localStorage === 'undefined' || !collection) return
  localStorage.setItem(`${COLLAPSED_PREFIX}${collection}`, String(collapsed))
}
