import { query } from '../db/pool.js'
import {
  formatAutoNumber,
  readAutoNumberOptions,
} from './autoNumberFormat.js'
import {
  clearComputedFieldMetaCache,
  loadEntityFieldMeta,
} from './fieldMeta.js'

export interface AutoNumberFieldMeta {
  fieldId: string
  apiName: string
  displayFormat: string
  startingNumber: number
}

export async function loadAutoNumberFields(
  entityApiName: string,
): Promise<AutoNumberFieldMeta[]> {
  const fields = await loadEntityFieldMeta(entityApiName)
  const out: AutoNumberFieldMeta[] = []
  for (const field of fields) {
    const cfg = readAutoNumberOptions(field.options)
    if (!cfg.enabled) continue
    out.push({
      fieldId: field.id,
      apiName: field.apiName,
      displayFormat: cfg.displayFormat,
      startingNumber: cfg.startingNumber,
    })
  }
  return out
}

/** Ensure counter row exists; bump next_value if startingNumber is higher. */
export async function ensureAutoNumberCounter(
  fieldId: string,
  startingNumber: number,
): Promise<void> {
  const start = Math.max(0, Math.trunc(startingNumber))
  await query(
    `INSERT INTO public.field_auto_number_counters (field_id, next_value)
     VALUES ($1::uuid, $2)
     ON CONFLICT (field_id) DO UPDATE SET
       next_value = GREATEST(
         public.field_auto_number_counters.next_value,
         EXCLUDED.next_value
       ),
       updated_at = now()`,
    [fieldId, start],
  )
}

async function allocateNextNumber(
  fieldId: string,
  startingNumber: number,
): Promise<number> {
  await ensureAutoNumberCounter(fieldId, startingNumber)
  const rows = await query<{ allocated: string }>(
    `UPDATE public.field_auto_number_counters
     SET next_value = next_value + 1,
         updated_at = now()
     WHERE field_id = $1::uuid
     RETURNING (next_value - 1)::text AS allocated`,
    [fieldId],
  )
  const allocated = Number(rows[0]?.allocated)
  if (!Number.isFinite(allocated)) {
    throw new Error(`Failed to allocate auto number for field ${fieldId}`)
  }
  return Math.trunc(allocated)
}

/**
 * Fields that stay auto-numbered on create but may be renamed on update
 * (DocEngine templates need human-editable names).
 * Keys are lowercased `entity:field`.
 */
const EDITABLE_AUTONUMBER_FIELDS = new Set(['doc_template:name'])

function isEditableAutoNumberField(
  entityApiName: string,
  fieldApiName: string,
): boolean {
  return EDITABLE_AUTONUMBER_FIELDS.has(
    `${entityApiName}:${fieldApiName}`.toLowerCase(),
  )
}

/** Remove client-supplied auto-number values — server owns persistence. */
export async function stripAutoNumberWrites(
  entityApiName: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await loadAutoNumberFields(entityApiName)
  if (!fields.length) return { ...patch }
  const next = { ...patch }
  for (const field of fields) {
    // Keep an explicit rename when the client sent a non-empty value.
    if (
      isEditableAutoNumberField(entityApiName, field.apiName) &&
      next[field.apiName] != null &&
      String(next[field.apiName]).trim() !== ''
    ) {
      continue
    }
    delete next[field.apiName]
  }
  return next
}

/**
 * Assign Auto Number values on create. Existing values are never rewritten.
 */
export async function applyAutoNumbersOnCreate(
  entityApiName: string,
  patch: Record<string, unknown>,
  createdAt: Date = new Date(),
): Promise<Record<string, unknown>> {
  const fields = await loadAutoNumberFields(entityApiName)
  if (!fields.length) return { ...patch }

  const next = { ...patch }
  for (const field of fields) {
    const sequence = await allocateNextNumber(
      field.fieldId,
      field.startingNumber,
    )
    next[field.apiName] = formatAutoNumber(
      field.displayFormat,
      sequence,
      createdAt,
    )
  }
  return next
}

export async function syncAutoNumberCounterFromOptions(
  fieldId: string,
  options: Record<string, unknown> | null | undefined,
): Promise<void> {
  const cfg = readAutoNumberOptions(
    options && typeof options === 'object' && !Array.isArray(options)
      ? options
      : {},
  )
  if (!cfg.enabled) return
  await ensureAutoNumberCounter(fieldId, cfg.startingNumber)
  clearComputedFieldMetaCache()
}
