export function setPathValue(
  record: Record<string, unknown>,
  parts: string[],
  value: unknown,
): void {
  if (parts.length === 0) return

  let cursor = record
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part]
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[part] = current === undefined || current === null
        ? {}
        : { id: current }
    }
    cursor = cursor[part] as Record<string, unknown>
  }

  cursor[parts[parts.length - 1]] = value
}

export function setPathValueByPath(
  record: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.').filter(Boolean)
  if (parts.length === 0) return
  setPathValue(record, parts, value)
}

export function readPath(
  record: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!record) return undefined

  const parts = path.split('.')
  return parts.reduce<unknown>((value, key, index) => {
    if (!value || typeof value !== 'object') return undefined
    const current = value as Record<string, unknown>
    const recordKey = resolveRecordKey(current, key, index < parts.length - 1)
    if (!recordKey) return undefined
    const next = current[recordKey]
    if (next && typeof next === 'object' && 'id' in next && path.endsWith(key)) {
      return (next as Record<string, unknown>).id
    }
    return next
  }, record)
}

export function resolveRecordKey(
  record: Record<string, unknown>,
  key: string,
  preferObject = false,
): string | null {
  const normalized = normalizeKey(key)
  const candidates = Object.keys(record).filter(
    (candidate) => normalizeKey(candidate) === normalized,
  )
  if (preferObject) {
    const objectKey = candidates.find((candidate) => {
      const value = record[candidate]
      return Boolean(value && typeof value === 'object')
    })
    if (objectKey) return objectKey
  }
  if (Object.prototype.hasOwnProperty.call(record, key)) return key
  return candidates[0] ?? null
}

export function keysEqual(left: string, right: string): boolean {
  return normalizeKey(left) === normalizeKey(right)
}

export function normalizeKey(key: string): string {
  return key.replace(/[_\s-]/g, '').toLowerCase()
}
