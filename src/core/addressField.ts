import type { FieldDefinition } from '@/interfaces'

/** Storage keys — UI order follows Salesforce (street → city/state → zip/country). */
export const ADDRESS_SUB_FIELDS = [
  'address',
  'city',
  'state',
  'postCode',
  'country',
] as const

export type AddressSubFieldKey = (typeof ADDRESS_SUB_FIELDS)[number]

export type AddressValue = Record<AddressSubFieldKey, string>

function normalizeSpecial(
  special: string[] | string | null | undefined,
): string[] {
  if (!special) return []
  if (Array.isArray(special)) return special
  return [special]
}

export function isAddressFieldDefinition(field: FieldDefinition): boolean {
  const special = normalizeSpecial(field.meta?.special)
  if (special.includes('address')) return true

  const iface = (field.meta?.interface ?? '').toLowerCase()
  return iface === 'address' || iface.includes('address')
}

export function createEmptyAddressValue(): AddressValue {
  return {
    country: '',
    state: '',
    city: '',
    address: '',
    postCode: '',
  }
}

export function normalizeAddressValue(value: unknown): AddressValue {
  const base = createEmptyAddressValue()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base

  const row = value as Record<string, unknown>
  for (const key of ADDRESS_SUB_FIELDS) {
    const raw = row[key]
    base[key] = raw === null || raw === undefined ? '' : String(raw)
  }
  // Legacy / alternate post-code keys
  if (!base.postCode) {
    const alt = row.post_code ?? row.postalCode ?? row.zip
    if (alt !== null && alt !== undefined && String(alt).trim()) {
      base.postCode = String(alt)
    }
  }
  return base
}

export function isAddressValueEmpty(value: unknown): boolean {
  const normalized = normalizeAddressValue(value)
  return ADDRESS_SUB_FIELDS.every((key) => !normalized[key].trim())
}

/** Single-line summary for tables / compact display. */
export function formatAddressSummary(value: unknown, emptyValue = '-'): string {
  const normalized = normalizeAddressValue(value)
  const parts = [
    normalized.address,
    normalized.city,
    normalized.state,
    normalized.postCode,
    normalized.country,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : emptyValue
}

/** Multi-line compact display (Salesforce-style). */
export function formatAddressMultiline(value: unknown, emptyValue = '-'): string {
  const normalized = normalizeAddressValue(value)
  const street = normalized.address.trim()
  const city = normalized.city.trim()
  const state = normalized.state.trim()
  const zip = normalized.postCode.trim()
  const country = normalized.country.trim()

  // "Miami, FL 33129"
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')

  const lines = [street, cityStateZip, country].filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : emptyValue
}
