import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import type {
  FieldDefinition,
  DocListItem,
  DocRemoteListLabelFieldOption,
  DocResolveListItemsContext,
} from '@/interfaces'
import {
  fetchTranslatedFieldLabel,
  getCachedCollectionFields,
} from '@/modules/entities/services/collectionSchema'
import {
  loadPresetById,
  normalizePresetFilter,
} from '@/modules/documents/services/docPresets'

export {
  listRemoteListCollectionOptions,
  loadRemoteListCollectionCatalog,
} from '@/modules/documents/services/docCollectionTree'

const LABEL_FIELD_TYPES = new Set([
  'string',
  'text',
  'uuid',
  'integer',
  'bigInteger',
  'float',
  'decimal',
])

const PREFERRED_LABEL_FIELDS = ['name', 'title', 'label']

function isListableField(field: FieldDefinition): boolean {
  if (field.field === 'id') return false
  if (field.meta?.hidden) return false
  return LABEL_FIELD_TYPES.has(field.type)
}

export async function listRemoteListLabelFields(
  collection: string,
): Promise<DocRemoteListLabelFieldOption[]> {
  const fields = await getCachedCollectionFields(collection)
  const candidates = fields.filter(isListableField)

  return Promise.all(
    candidates.map(async (field) => ({
      id: field.field,
      label: await fetchTranslatedFieldLabel(collection, field.field, field.field),
    })),
  )
}

async function resolveLabelField(
  collection: string,
  configuredField?: string,
): Promise<string> {
  const trimmed = configuredField?.trim()
  if (trimmed) return trimmed

  const fields = await getCachedCollectionFields(collection)
  for (const candidate of PREFERRED_LABEL_FIELDS) {
    if (fields.some((field) => field.field === candidate && isListableField(field))) {
      return candidate
    }
  }

  const fallback = fields.find(isListableField)
  return fallback?.field ?? 'id'
}

function buildLabelSearchFilter(
  labelField: string,
  query: string,
): Record<string, unknown> | undefined {
  const trimmed = query.trim()
  if (!trimmed) return undefined
  return { [labelField]: { _icontains: trimmed } }
}

function combineFilters(
  presetFilter: Record<string, unknown> | null | undefined,
  labelSearchFilter: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const parts: Record<string, unknown>[] = []

  const preset = normalizePresetFilter(presetFilter)
  if (preset) {
    if (Array.isArray(preset._and)) {
      parts.push(...(preset._and as Record<string, unknown>[]))
    } else {
      parts.push(preset)
    }
  }

  if (labelSearchFilter) {
    parts.push(labelSearchFilter)
  }

  if (parts.length === 0) return undefined
  if (parts.length === 1) return parts[0]
  return { _and: parts }
}

function isRemoteListSchema(schema: {
  listSource?: string
  sourceCollection?: string
}): boolean {
  if (schema.listSource === 'remote') return true
  return Boolean(schema.sourceCollection?.trim())
}

function toListItem(
  row: Record<string, unknown>,
  labelField: string,
  withCode: boolean,
): DocListItem | null {
  const id = row.id
  if (id == null) return null

  const labelValue = row[labelField]
  const label = labelValue == null || String(labelValue).trim() === ''
    ? String(id)
    : String(labelValue)

  const item: DocListItem = {
    id: String(id),
    label,
  }

  if (withCode) {
    const codeValue = row.code
    if (codeValue != null && String(codeValue).trim() !== '') {
      item.code = String(codeValue)
    }
  }

  return item
}

export async function resolveDocRemoteListItems(
  ctx: DocResolveListItemsContext,
): Promise<DocListItem[]> {
  const schema = ctx.schema as {
    sourceCollection?: string
    sourceLabelField?: string
    sourcePresetId?: string
    withCode?: boolean
    listSource?: string
  }

  if (!isRemoteListSchema(schema)) return []

  const collection = schema.sourceCollection?.trim()
  if (!collection) return []

  const labelField = await resolveLabelField(collection, schema.sourceLabelField)
  const withCode = schema.withCode === true
  const fields = ['id', labelField, ...(withCode ? ['code'] : [])]
  const userQuery = ctx.query?.trim() ?? ''

  const preset = schema.sourcePresetId
    ? await loadPresetById(schema.sourcePresetId)
    : null

  const filter = combineFilters(
    preset?.filter ?? null,
    buildLabelSearchFilter(labelField, userQuery),
  )

  try {
    const rows = await queryRemoteRows(collection, {
      filter,
      fields,
      labelField,
    })

    return rows
      .map((row) => toListItem(row, labelField, withCode))
      .filter((item): item is DocListItem => item !== null)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Remote list search failed.'
    throw new Error(message)
  }
}

async function queryRemoteRows(
  collection: string,
  options: {
    filter?: Record<string, unknown>
    fields: string[]
    labelField: string
  },
): Promise<Record<string, unknown>[]> {
  const response = await bridgeReadItems(collection, {
    ...(options.filter ? { filter: options.filter } : {}),
    limit: 25,
    fields: options.fields,
    sort: [options.labelField],
  })

  return Array.isArray(response) ? response : []
}
