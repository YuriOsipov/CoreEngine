import { ref, watch, type Ref } from 'vue'
import enUS from '@/assets/app-translations/en-US'
import ukUA from '@/assets/app-translations/uk-UA'
import { fetchTranslationsBridge } from '@/core/graphql/registryApi'

export type TranslationLanguage = 'en-US' | 'uk-UA'

export const DEFAULT_TRANSLATION_LANGUAGE: TranslationLanguage = 'en-US'
export const TRANSLATION_LANGUAGE_OPTIONS: Array<{
  label: string
  value: TranslationLanguage
}> = [
  {
    label: 'English',
    value: 'en-US',
  },
  {
    label: 'Ukrainian',
    value: 'uk-UA',
  },
]

const TRANSLATION_LANGUAGE_STORAGE_KEY = 'crm.translationLanguage'
const LEGACY_TRANSLATION_LANGUAGE_STORAGE_KEY = 'crm.directusTranslationLanguage'
const TRANSLATION_LITERAL_PATTERN = /\$t:[A-Za-z0-9_.-]+/gm

type TranslationTree = { [key: string]: string | TranslationTree }
type TranslationParams = Record<string, string | number>

export interface TranslationChoiceOption {
  text?: string
  label?: string
  value?: unknown
}

export interface TranslationFieldDefinition {
  collection: string
  field: string
  meta?: {
    note?: string | null
    translations?: Array<{
      language?: string
      translation?: string
    }> | null
  } | null
}

export interface TranslationCollectionDefinition {
  collection: string
  meta?: {
    note?: string | null
    translations?: Array<{
      language?: string
      translation?: string
    }> | null
  } | null
  schema?: {
    name?: string | null
  } | null
}

export interface DynamicTranslationContext {
  collection?: string
  field?: string
}

const appMessages: Record<TranslationLanguage, TranslationTree> = {
  'en-US': enUS,
  'uk-UA': ukUA,
}
const language = ref<TranslationLanguage>(readStoredLanguage())
const remoteTranslationMaps = new Map<string, Promise<Map<string, string>>>()
const yamlTranslationMaps = new Map<TranslationLanguage, Promise<Map<string, string>>>()

export function useTranslation(): {
  t: (key: string, fallback?: string, params?: TranslationParams) => string
  i18n: {
    language: typeof language
    setLanguage: (nextLanguage: TranslationLanguage) => void
  }
} {
  return {
    t,
    i18n: {
      language,
      setLanguage,
    },
  }
}

export function t(
  key: string,
  fallback = key,
  params: TranslationParams = {},
): string {
  const value = resolveMessage(appMessages[language.value], key) ?? fallback
  return interpolate(value, params)
}

export async function preloadTranslations(
  nextLanguage = language.value,
): Promise<Map<string, string>> {
  const [yaml, remote] = await Promise.all([
    yamlTranslationMap(nextLanguage),
    remoteTranslationMap(nextLanguage),
  ])

  return new Map([...yaml, ...remote])
}

export const preloadAppTranslations = preloadTranslations

export async function translateLabel(
  value: string,
  translationKeys: string[] = [],
  nextLanguage = language.value,
): Promise<string> {
  if (!value) return value
  if (value.match(TRANSLATION_LITERAL_PATTERN)) {
    return translateLiteral(value, nextLanguage)
  }

  const keys = uniqueKeys([
    ...translationKeys,
    value,
    labelToTranslationKey(value),
  ])

  for (const key of keys) {
    const translated = await readDynamicTranslation(key, nextLanguage)
    if (translated) return translated
  }

  return value
}

export async function translateCollection(
  collection: string,
  definition?: TranslationCollectionDefinition | null,
  nextLanguage = language.value,
): Promise<string> {
  const metadataTranslation = metadataTranslationForLanguage(
    definition?.meta?.translations,
    nextLanguage,
  )
  if (metadataTranslation) return metadataTranslation

  // entities.label is mapped to meta.note — prefer it over collections.* YAML keys
  // so Object Manager renames are not frozen by seed translation entries.
  const registryLabel = definition?.meta?.note?.trim()
  if (registryLabel) {
    return translateLabel(
      registryLabel,
      [registryLabel, labelToTranslationKey(registryLabel)],
      nextLanguage,
    )
  }

  const fallback =
    definition?.schema?.name?.trim() || humanizeName(collection)
  const humanizedCollection = humanizeName(collection)

  return translateLabel(
    fallback,
    [
      `collections.${collection}`,
      `collection.${collection}`,
      collection,
      humanizedCollection,
    ],
    nextLanguage,
  )
}

export async function translateField(
  definition: TranslationFieldDefinition,
  fallbackLabel?: string,
  nextLanguage = language.value,
): Promise<string> {
  const metadataTranslation = metadataTranslationForLanguage(
    definition.meta?.translations,
    nextLanguage,
  )
  if (metadataTranslation) return metadataTranslation

  const fallback =
    fallbackLabel?.trim() ||
    definition.meta?.note?.trim() ||
    humanizeName(definition.field)

  return translateLabel(
    fallback,
    [
      `fields.${definition.collection}.${definition.field}`,
      `${definition.collection}.${definition.field}`,
      definition.field,
    ],
    nextLanguage,
  )
}

export async function translateChoice(
  choice: TranslationChoiceOption,
  context: DynamicTranslationContext = {},
  nextLanguage = language.value,
): Promise<string> {
  const value = choice.value === undefined ? '' : String(choice.value)
  const fallback = choice.text ?? choice.label ?? value
  const keys = [
    context.collection && context.field && value
      ? `choices.${context.collection}.${context.field}.${value}`
      : '',
    context.collection && context.field && value
      ? `${context.collection}.${context.field}.${value}`
      : '',
    context.field && value ? `${context.field}.${value}` : '',
    value,
  ]

  return translateLabel(fallback, keys, nextLanguage)
}

export async function translateChoiceLabel(
  value: string,
  nextLanguage = language.value,
): Promise<string> {
  return translateLabel(value, [value], nextLanguage)
}

export async function translateChoiceMap(
  choices: unknown,
  context: DynamicTranslationContext = {},
  nextLanguage = language.value,
): Promise<Map<string, string>> {
  if (!Array.isArray(choices)) return new Map()

  const labels = new Map<string, string>()
  for (const choice of choices as TranslationChoiceOption[]) {
    if (choice.value === undefined) continue
    labels.set(
      String(choice.value),
      await translateChoice(choice, context, nextLanguage),
    )
  }

  return labels
}


export function useTranslatedCollection(collection: () => string): Ref<string> {
  const label = ref('')
  let token = 0

  watch(
    collection,
    (nextCollection) => {
      const currentToken = ++token
      label.value = nextCollection ? humanizeName(nextCollection) : ''
      if (!nextCollection) return

      void translateCollection(nextCollection).then((translated) => {
        if (currentToken === token) {
          label.value = translated
        }
      })
    },
    { immediate: true },
  )

  return label
}

export function getTranslationLanguage(): TranslationLanguage {
  return language.value
}


export function setLanguage(nextLanguage: TranslationLanguage): void {
  language.value = nextLanguage
  localStorage.setItem(TRANSLATION_LANGUAGE_STORAGE_KEY, nextLanguage)
  void preloadTranslations(nextLanguage)
}

export const setTranslationLanguage = setLanguage

export function humanizeName(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export async function translateLiteral(
  value: string,
  nextLanguage = language.value,
): Promise<string> {
  const literals = Array.from(
    new Set(value.match(TRANSLATION_LITERAL_PATTERN) ?? []),
  )
  if (literals.length === 0) return value

  let translated = value
  for (const literal of literals) {
    const key = literal.replace('$t:', '')
    const label = await readDynamicTranslation(key, nextLanguage)
    translated = translated.split(literal).join(label ?? humanizeTranslationKey(key))
  }

  return translated
}

async function readDynamicTranslation(
  key: string,
  nextLanguage: TranslationLanguage,
): Promise<string | null> {
  const [remote, yaml] = await Promise.all([
    remoteTranslationMap(nextLanguage),
    yamlTranslationMap(nextLanguage),
  ])

  return remote.get(key) ?? yaml.get(key) ?? null
}

function remoteTranslationMap(
  nextLanguage: TranslationLanguage,
): Promise<Map<string, string>> {
  const cached = remoteTranslationMaps.get(nextLanguage)
  if (cached) return cached

  const request = fetchRemoteTranslations(nextLanguage)
  remoteTranslationMaps.set(nextLanguage, request)
  return request
}

async function fetchRemoteTranslations(
  nextLanguage: TranslationLanguage,
): Promise<Map<string, string>> {
  const translations = new Map<string, string>()

  try {
    const records = await fetchTranslationsBridge(nextLanguage)
    for (const record of records) {
      if (
        typeof record.key === 'string' &&
        record.key.trim() &&
        typeof record.value === 'string' &&
        record.value.trim()
      ) {
        translations.set(record.key, record.value)
      }
    }
  } catch {
    // Bundled YAML translations remain available when the API request fails.
  }

  return translations
}

function yamlTranslationMap(
  nextLanguage: TranslationLanguage,
): Promise<Map<string, string>> {
  const cached = yamlTranslationMaps.get(nextLanguage)
  if (cached) return cached

  const request = loadYamlTranslations(nextLanguage).then(parseYamlTranslations)
  yamlTranslationMaps.set(nextLanguage, request)
  return request
}

async function loadYamlTranslations(nextLanguage: TranslationLanguage): Promise<string> {
  switch (nextLanguage) {
    case 'uk-UA':
      return (
        await import('@/assets/registry-translations/uk-UA.yaml?raw')
      ).default
    case 'en-US':
    default:
      return (
        await import('@/assets/registry-translations/en-US.yaml?raw')
      ).default
  }
}

function parseYamlTranslations(yaml: string): Map<string, string> {
  const translations = new Map<string, string>()
  const parents: Array<{ indent: number; key: string }> = []

  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '---' || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('- ')) continue

    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const match = trimmed.match(/^([^:#][^:]*):(?:\s*(.*))?$/)
    if (!match) continue

    const key = unquoteYamlValue(match[1].trim())
    const rawValue = match[2]?.trim() ?? ''
    while (parents.length > 0 && parents[parents.length - 1].indent >= indent) {
      parents.pop()
    }

    const path = [...parents.map((parent) => parent.key), key].join('.')
    if (!rawValue || rawValue === '>' || rawValue === '|' || rawValue === '>-' || rawValue === '|-') {
      parents.push({ indent, key })
      continue
    }

    translations.set(path, unquoteYamlValue(rawValue))
  }

  return translations
}

function metadataTranslationForLanguage(
  translations:
    | Array<{ language?: string; translation?: string }>
    | null
    | undefined,
  nextLanguage: TranslationLanguage,
): string | null {
  return translations?.find(
    (translation) =>
      translation.language === nextLanguage &&
      typeof translation.translation === 'string' &&
      translation.translation.trim(),
  )?.translation ?? null
}

function resolveMessage(tree: TranslationTree, key: string): string | null {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[part]
    }
    return undefined
  }, tree)

  return typeof value === 'string' ? value : null
}

function interpolate(value: string, params: TranslationParams): string {
  return Object.entries(params).reduce(
    (text, [key, replacement]) =>
      text.split(`{${key}}`).join(String(replacement)),
    value,
  )
}

function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)))
}

function humanizeTranslationKey(key: string): string {
  return key
    .split('.')
    .at(-1)
    ?.replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || key
}

function labelToTranslationKey(label: string): string {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function unquoteYamlValue(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function readStoredLanguage(): TranslationLanguage {
  const stored =
    localStorage.getItem(TRANSLATION_LANGUAGE_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_TRANSLATION_LANGUAGE_STORAGE_KEY)
  if (isSupportedLanguage(stored)) return stored
  // Org default is applied after loadCompanyProfile via applyOrgLanguageDefault().
  return DEFAULT_TRANSLATION_LANGUAGE
}

/** Apply org company-profile language when the user has no sidebar preference. */
export function applyOrgLanguageDefault(orgLanguage: TranslationLanguage): void {
  const stored =
    localStorage.getItem(TRANSLATION_LANGUAGE_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_TRANSLATION_LANGUAGE_STORAGE_KEY)
  if (isSupportedLanguage(stored)) return
  if (!isSupportedLanguage(orgLanguage)) return
  if (language.value === orgLanguage) return
  language.value = orgLanguage
  void preloadTranslations(orgLanguage)
}

function isSupportedLanguage(value: unknown): value is TranslationLanguage {
  return TRANSLATION_LANGUAGE_OPTIONS.some((option) => option.value === value)
}
