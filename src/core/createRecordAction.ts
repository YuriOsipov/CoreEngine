/**
 * Resolve Block Record action `createRecord` field mappings into create-form
 * initial values (scalars / FK ids). Tokens: `$ME`, `$NOW`, `$NULL`.
 */
import type {
  EntityActionCreateRecordFieldMapping,
  EntityActionCreateRecordSettings,
} from '@/interfaces'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import {
  quoteMessageBody,
  withSubjectPrefix,
} from '@/core/messageCreateDefaults'

export type CreateRecordActionActor = {
  userId?: string | null
  /** Optional email for `$ME_EMAIL` when mapping from_email. */
  email?: string | null
}

export function canShowCreateRecordAction(options: {
  settings: EntityActionCreateRecordSettings | null | undefined
  canCreateTarget: boolean
  sourceWritable: boolean
}): boolean {
  if (!options.canCreateTarget) return false
  const target = String(options.settings?.targetCollection ?? '').trim()
  if (!target) return false
  if (options.settings?.whenSourceNotWritable === true && options.sourceWritable) {
    return false
  }
  return true
}

/** Visibility helper for a full EntityAction with behavior createRecord. */
export function isCreateRecordActionVisible(
  action: { behavior?: string; createRecord?: EntityActionCreateRecordSettings | null },
  options: { canCreateTarget: (collection: string) => boolean; sourceWritable: boolean },
): boolean {
  if (action.behavior !== 'createRecord') return false
  const target = String(action.createRecord?.targetCollection ?? '').trim()
  return canShowCreateRecordAction({
    settings: action.createRecord,
    canCreateTarget: Boolean(target) && options.canCreateTarget(target),
    sourceWritable: options.sourceWritable,
  })
}

function copyScalarOrFk(value: unknown): unknown | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const fk = extractRelationFieldId(value)
  if (fk !== null) return fk
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  return undefined
}

function readSourceField(
  source: Record<string, unknown>,
  field: string,
): unknown | undefined {
  const key = field.trim()
  if (!key) return undefined
  return copyScalarOrFk(source[key])
}

function resolveFieldValue(
  mapping: EntityActionCreateRecordFieldMapping,
  source: Record<string, unknown>,
): unknown | undefined {
  const fields =
    Array.isArray(mapping.sourceFields) && mapping.sourceFields.length > 0
      ? mapping.sourceFields
      : mapping.sourceField
        ? [mapping.sourceField]
        : []
  for (const field of fields) {
    const value = readSourceField(source, field)
    if (value !== undefined) return value
  }
  return undefined
}

function resolveStaticToken(
  value: unknown,
  actor?: CreateRecordActionActor,
): unknown {
  if (value === '$NULL') return null
  if (value === '$NOW') return new Date().toISOString()
  if (value === '$ME') {
    const id = String(actor?.userId ?? '').trim()
    return id || undefined
  }
  if (value === '$ME_EMAIL') {
    const email = String(actor?.email ?? '').trim()
    return email || undefined
  }
  return value
}

function applyTransform(
  mapping: EntityActionCreateRecordFieldMapping,
  value: unknown,
): unknown {
  const transform = mapping.transform ?? 'none'
  if (transform === 'none' || value === undefined) return value

  const asText =
    value == null
      ? ''
      : typeof value === 'string'
        ? value
        : String(value)

  if (transform === 'quoteLines') {
    return quoteMessageBody(asText)
  }

  if (transform === 'subjectPrefix') {
    const prefixRaw = String(mapping.prefix ?? '').trim() || 'Re:'
    const normalized =
      prefixRaw === 'Fwd:' || prefixRaw.toLowerCase() === 'fwd:'
        ? 'Fwd:'
        : prefixRaw === 'Re:' || prefixRaw.toLowerCase() === 're:'
          ? 'Re:'
          : prefixRaw
    if (normalized === 'Re:' || normalized === 'Fwd:') {
      return withSubjectPrefix(asText, normalized)
    }
    const trimmed = asText.trim()
    if (!trimmed) return normalized
    const re = new RegExp(
      `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`,
      'i',
    )
    const bare = trimmed.replace(re, '').trim()
    return bare ? `${normalized} ${bare}` : normalized
  }

  return value
}

/**
 * Build create-dialog initial values from layout mappings + current record.
 * Skips mappings that resolve to `undefined` (does not clear target keys).
 * Explicit `null` (e.g. `$NULL` or static null) is written.
 */
export function buildCreateRecordInitialValues(
  settings: EntityActionCreateRecordSettings | null | undefined,
  source: Record<string, unknown>,
  actor?: CreateRecordActionActor,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const mappings = settings?.fieldMappings ?? []
  for (const mapping of mappings) {
    const target = String(mapping.targetField ?? '').trim()
    if (!target) continue

    let raw: unknown
    if (mapping.source === 'static') {
      raw = resolveStaticToken(mapping.value, actor)
    } else {
      raw = resolveFieldValue(mapping, source)
      // Text transforms still apply when the source field is empty/missing.
      if (
        raw === undefined
        && (mapping.transform === 'subjectPrefix' || mapping.transform === 'quoteLines')
      ) {
        raw = ''
      }
    }

    if (raw === undefined) continue
    out[target] = applyTransform(mapping, raw)
  }
  return out
}
