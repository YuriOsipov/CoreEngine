/** Shared relation-interface helpers for registry schema sync. */

export const RELATION_INTERFACES = new Set([
  'm2o',
  'o2m',
  'm2m',
  'm2a',
  'file',
  'files',
  'list-m2m',
  'list-o2m',
  'list-m2a',
  'file-image',
])

export function specialForAliasInterface(iface: string | null | undefined): string[] {
  const value = String(iface || '').toLowerCase()
  if (value.includes('files') || value === 'files') return ['files']
  if (value.includes('m2m')) return ['m2m']
  if (value.includes('m2a')) return ['m2a']
  return ['o2m']
}

export function aliasInterfaceForSpecial(special: string[]): string {
  if (special.includes('m2a')) return 'list-m2a'
  if (special.includes('m2m')) return 'list-m2m'
  if (special.includes('files')) return 'files'
  return 'list-o2m'
}

export function isRelationInterfaceName(iface: string | null | undefined): boolean {
  const value = String(iface || '').toLowerCase()
  if (RELATION_INTERFACES.has(value)) return true
  return (
    value.includes('m2o') ||
    value.includes('o2m') ||
    value.includes('m2m') ||
    value.includes('m2a')
  )
}
