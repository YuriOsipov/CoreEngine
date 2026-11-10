import { computed, ref } from 'vue'
import {
  readOrgSettingBridge,
  upsertOrgSettingBridge,
} from '@/core/graphql/orgSettingsApi'
import type { TranslationLanguage } from '@/core/translation'

export const COMPANY_PROFILE_SETTING_KEY = 'company_profile'

export interface OrgAddress {
  country: string
  street: string
  city: string
  state: string
  postalCode: string
}

export interface CompanyProfile {
  organizationName: string
  address: OrgAddress
  language: TranslationLanguage
  currency: string
  dateFormat: string
  dateTimeFormat: string
  timeZone: string
}

export const DATE_FORMAT_PRESETS = [
  { label: 'M/d/yyyy (US)', value: 'M/d/yyyy' },
  { label: 'dd.MM.yyyy', value: 'dd.MM.yyyy' },
  { label: 'yyyy-MM-dd', value: 'yyyy-MM-dd' },
  { label: 'dd/MM/yyyy', value: 'dd/MM/yyyy' },
] as const

export const DATE_TIME_FORMAT_PRESETS = [
  { label: 'M/d/yyyy h:mm A (US)', value: 'M/d/yyyy h:mm A' },
  { label: 'dd.MM.yyyy HH:mm', value: 'dd.MM.yyyy HH:mm' },
  { label: 'yyyy-MM-dd HH:mm', value: 'yyyy-MM-dd HH:mm' },
  { label: 'M/d/yyyy HH:mm', value: 'M/d/yyyy HH:mm' },
] as const

export const CURRENCY_OPTIONS = [
  { label: 'USD — US Dollar', value: 'USD' },
  { label: 'EUR — Euro', value: 'EUR' },
  { label: 'UAH — Ukrainian Hryvnia', value: 'UAH' },
  { label: 'GBP — British Pound', value: 'GBP' },
] as const

/** Explicit symbols for supported org currencies (avoid Intl locale quirks). */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  UAH: '₴',
  GBP: '£',
}

/** ISO codes and bare symbols that mean "use company currency", not a field override. */
const ORG_CURRENCY_PLACEHOLDER_AFFIXES = new Set([
  ...Object.keys(CURRENCY_SYMBOLS),
  ...Object.values(CURRENCY_SYMBOLS),
  '¥',
  '円',
  'руб',
  'грн',
])

/**
 * True when a field prefix/suffix is a leftover org currency marker (ISO or symbol)
 * and should follow Company Information instead of locking the field.
 */
export function isOrgCurrencyPlaceholderAffix(value: string | null | undefined): boolean {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return true
  if (/^[A-Za-z]{3}$/.test(trimmed)) return true
  return ORG_CURRENCY_PLACEHOLDER_AFFIXES.has(trimmed)
}

/** Common IANA zones for Setup; browser zone is prepended at runtime if missing. */
export const TIME_ZONE_OPTIONS = [
  'UTC',
  'Europe/Kyiv',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Australia/Sydney',
] as const

const DEFAULT_PROFILE: CompanyProfile = {
  organizationName: '',
  address: {
    country: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
  },
  language: 'en-US',
  currency: 'USD',
  dateFormat: 'M/d/yyyy',
  dateTimeFormat: 'M/d/yyyy h:mm A',
  timeZone: 'UTC',
}

const profile = ref<CompanyProfile>(cloneProfile(DEFAULT_PROFILE))
const loaded = ref(false)

export const companyProfile = computed(() => profile.value)
export const orgCurrency = computed(() => profile.value.currency || 'USD')
export const orgDateFormat = computed(() => profile.value.dateFormat || '')
export const orgDateTimeFormat = computed(() => profile.value.dateTimeFormat || '')
export const orgTimeZone = computed(() => profile.value.timeZone || 'UTC')
export const orgLanguage = computed(() => profile.value.language || 'en-US')
export const orgLocaleLoaded = computed(() => loaded.value)

export function getCompanyProfile(): CompanyProfile {
  return cloneProfile(profile.value)
}

export function getOrgCurrencyCode(): string {
  return profile.value.currency?.trim() || 'USD'
}

export function getOrgDateFormat(): string | null {
  const value = profile.value.dateFormat?.trim()
  return value || null
}

export function getOrgDateTimeFormat(): string | null {
  const value = profile.value.dateTimeFormat?.trim()
  return value || null
}

export function getOrgTimeZone(): string {
  return profile.value.timeZone?.trim() || 'UTC'
}

export function getOrgLanguage(): TranslationLanguage {
  return profile.value.language === 'uk-UA' ? 'uk-UA' : 'en-US'
}

export function defaultCompanyProfile(): CompanyProfile {
  return cloneProfile({
    ...DEFAULT_PROFILE,
    timeZone: detectBrowserTimeZone(),
  })
}

export function normalizeCompanyProfile(raw: unknown): CompanyProfile {
  const base = defaultCompanyProfile()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const row = raw as Record<string, unknown>
  const addressRaw =
    row.address && typeof row.address === 'object' && !Array.isArray(row.address)
      ? (row.address as Record<string, unknown>)
      : {}

  const language =
    row.language === 'uk-UA' || row.language === 'en-US'
      ? row.language
      : base.language
  const currencyRaw =
    typeof row.currency === 'string' && row.currency.trim()
      ? row.currency.trim().toUpperCase()
      : ''
  const currency = CURRENCY_SYMBOLS[currencyRaw]
    ? currencyRaw
    : base.currency
  const dateFormat =
    typeof row.dateFormat === 'string' && row.dateFormat.trim()
      ? row.dateFormat.trim()
      : base.dateFormat
  const dateTimeFormat =
    typeof row.dateTimeFormat === 'string' && row.dateTimeFormat.trim()
      ? row.dateTimeFormat.trim()
      : base.dateTimeFormat
  const timeZone =
    typeof row.timeZone === 'string' && row.timeZone.trim()
      ? row.timeZone.trim()
      : base.timeZone

  return {
    organizationName:
      typeof row.organizationName === 'string' ? row.organizationName.trim() : '',
    address: {
      country: stringField(addressRaw.country),
      street: stringField(addressRaw.street),
      city: stringField(addressRaw.city),
      state: stringField(addressRaw.state),
      postalCode: stringField(addressRaw.postalCode),
    },
    language,
    currency,
    dateFormat,
    dateTimeFormat,
    timeZone,
  }
}

export async function loadCompanyProfile(): Promise<CompanyProfile> {
  try {
    const raw = await readOrgSettingBridge(COMPANY_PROFILE_SETTING_KEY)
    profile.value = normalizeCompanyProfile(raw)
  } catch {
    profile.value = defaultCompanyProfile()
  } finally {
    loaded.value = true
  }
  return getCompanyProfile()
}

export async function saveCompanyProfile(
  next: CompanyProfile,
): Promise<CompanyProfile> {
  const normalized = normalizeCompanyProfile(next)
  if (!normalized.organizationName.trim()) {
    throw new Error('Organization name is required')
  }
  await upsertOrgSettingBridge(COMPANY_PROFILE_SETTING_KEY, normalized)
  profile.value = normalized
  loaded.value = true
  return getCompanyProfile()
}

export function applyCompanyProfileLocally(next: CompanyProfile): void {
  profile.value = normalizeCompanyProfile(next)
  loaded.value = true
}

/** Currency symbol for org currency (e.g. `$`, `€`) — never ISO code text. */
export function getOrgCurrencySymbol(
  currency?: string,
  language?: string,
): string {
  const code = String(currency || getOrgCurrencyCode() || 'USD')
    .trim()
    .toUpperCase()
  const mapped = CURRENCY_SYMBOLS[code]
  if (mapped) return mapped

  const locale = language || getOrgLanguage()
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    const symbol = parts.find((part) => part.type === 'currency')?.value?.trim()
    // Some locales return the ISO code; never show that as the prefix.
    if (symbol && symbol.toUpperCase() !== code) return symbol
  } catch {
    // fall through
  }
  return code
}

/**
 * Org currency display: symbol as prefix, no ISO suffix (SF `$53.27`).
 */
export function formatOrgCurrencyValue(
  value: number,
  options: { decimalPlaces?: number; language?: string; currency?: string } = {},
): string {
  const locale = options.language || getOrgLanguage()
  const code = String(options.currency || getOrgCurrencyCode() || 'USD')
    .trim()
    .toUpperCase()
  const digits =
    typeof options.decimalPlaces === 'number'
      ? Math.min(38, Math.max(0, Math.trunc(options.decimalPlaces)))
      : 2
  const symbol = getOrgCurrencySymbol(code, locale)
  try {
    const amount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
    return `${symbol}${amount}`
  } catch {
    return `${symbol}${value.toFixed(digits)}`
  }
}

export function formatOrgCurrencySample(
  amount = 100,
  language?: string,
  currency?: string,
): string {
  return formatOrgCurrencyValue(amount, { language, currency, decimalPlaces: 2 })
}

export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function timeZoneSelectOptions(): Array<{ label: string; value: string }> {
  const browser = detectBrowserTimeZone()
  const zones = new Set<string>([browser, ...TIME_ZONE_OPTIONS])
  return [...zones].sort().map((zone) => ({
    label: zone === browser ? `${zone} (browser)` : zone,
    value: zone,
  }))
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cloneProfile(value: CompanyProfile): CompanyProfile {
  return {
    organizationName: value.organizationName,
    address: { ...value.address },
    language: value.language,
    currency: value.currency,
    dateFormat: value.dateFormat,
    dateTimeFormat: value.dateTimeFormat,
    timeZone: value.timeZone,
  }
}
