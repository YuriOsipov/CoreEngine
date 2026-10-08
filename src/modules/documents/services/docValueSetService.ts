import type {
  DocValueSetListItem,
  DocValueSetRecord,
  DocValueSetSaveInput,
} from '@/interfaces'
import {
  bridgeCreateItem,
  bridgeReadItem,
  bridgeReadItems,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import {
  DOC_ARCHIVED_FIELD,
  DOC_VALUE_SET_COLLECTION,
} from '@/interfaces/documents'
import { andFilters, notArchivedFilter } from './docArchiveFilter'

const LIST_FIELDS = ['id', 'name', 'description', 'template', 'date_updated'] as const

const DETAIL_FIELDS = [...LIST_FIELDS, 'values', DOC_ARCHIVED_FIELD] as const

function asRecord(value: unknown): DocValueSetRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = row.id == null ? '' : String(row.id).trim()
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!id || !name) return null
  const values =
    row.values && typeof row.values === 'object' && !Array.isArray(row.values)
      ? (row.values as Record<string, unknown>)
      : {}
  return {
    id,
    name,
    description: typeof row.description === 'string' ? row.description : null,
    template:
      typeof row.template === 'string' || (row.template && typeof row.template === 'object')
        ? (row.template as DocValueSetRecord['template'])
        : null,
    values,
    archived: typeof row.archived === 'boolean' ? row.archived : null,
    date_created: typeof row.date_created === 'string' ? row.date_created : null,
    date_updated: typeof row.date_updated === 'string' ? row.date_updated : null,
  }
}

function toListItem(record: DocValueSetRecord): DocValueSetListItem {
  return {
    id: record.id,
    name: record.name,
    description: record.description?.trim() || null,
  }
}

function namesMatch(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
}

export function isDocScenarioValues(values: Record<string, unknown> | null | undefined): boolean {
  return Boolean(values && values.kind === 'field')
}

export async function loadDocValueSetsForTemplate(
  templateId: string,
): Promise<DocValueSetListItem[]> {
  const normalized = templateId.trim()
  if (!normalized) return []

  const records = await bridgeReadItems(DOC_VALUE_SET_COLLECTION, {
    filter: andFilters({ template: { _eq: normalized } }, notArchivedFilter()),
    fields: [...LIST_FIELDS],
    sort: ['name'],
    limit: -1,
  })

  return records
    .map(asRecord)
    .filter((record): record is DocValueSetRecord => record !== null)
    .map(toListItem)
}

export async function loadDocValueSetById(
  docValueSetId: string,
): Promise<DocValueSetRecord | null> {
  const normalized = docValueSetId.trim()
  if (!normalized) return null
  try {
    const record = await bridgeReadItem(DOC_VALUE_SET_COLLECTION, normalized, {
      fields: [...DETAIL_FIELDS],
    })
    return asRecord(record)
  } catch {
    return null
  }
}

async function findByTemplateAndName(
  templateId: string,
  name: string,
): Promise<DocValueSetRecord | null> {
  const records = await bridgeReadItems(DOC_VALUE_SET_COLLECTION, {
    filter: { template: { _eq: templateId } },
    fields: [...DETAIL_FIELDS],
    limit: -1,
  })
  const matches = records
    .map(asRecord)
    .filter(
      (record): record is DocValueSetRecord =>
        record !== null && namesMatch(record.name, name),
    )
  return matches.find((record) => !record.archived) ?? matches[0] ?? null
}

/** Creates a scenario, or replaces values when the template already has this name. */
export async function saveDocValueSet(
  input: DocValueSetSaveInput,
): Promise<{ record: DocValueSetRecord; updated: boolean }> {
  const templateId = input.templateId.trim()
  const name = input.name.trim()
  if (!templateId) {
    throw new Error('Template is required.')
  }
  if (!name) {
    throw new Error('Scenario name is required.')
  }
  if (!isDocScenarioValues(input.values)) {
    throw new Error('Scenario values must be a DocEngine field export.')
  }

  const payload: Record<string, unknown> = {
    name,
    template: templateId,
    values: input.values,
    [DOC_ARCHIVED_FIELD]: false,
  }
  if (input.description !== undefined) {
    payload.description = input.description?.trim() || null
  }

  const existing = await findByTemplateAndName(templateId, name)
  if (existing) {
    const updated = asRecord(
      await bridgeUpdateItem(DOC_VALUE_SET_COLLECTION, existing.id, payload, {
        fields: [...DETAIL_FIELDS],
      }),
    )
    if (!updated) {
      throw new Error('Failed to save scenario.')
    }
    return { record: updated, updated: true }
  }

  const created = asRecord(
    await bridgeCreateItem(DOC_VALUE_SET_COLLECTION, payload, {
      fields: [...DETAIL_FIELDS],
    }),
  )
  if (!created) {
    throw new Error('Failed to save scenario.')
  }
  return { record: created, updated: false }
}
