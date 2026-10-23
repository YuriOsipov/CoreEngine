const MAXIMIZED_STORAGE_KEY = 'helix:batch-insert-dialog-maximized'

export function loadBatchInsertDialogMaximized(defaultMaximized = false): boolean {
  if (typeof localStorage === 'undefined') return defaultMaximized
  const raw = localStorage.getItem(MAXIMIZED_STORAGE_KEY)
  if (raw === null) return defaultMaximized
  return raw === 'true'
}

export function saveBatchInsertDialogMaximized(maximized: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(MAXIMIZED_STORAGE_KEY, String(maximized))
}
