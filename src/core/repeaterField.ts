import type { FieldDefinition, PrimeVueComponentType } from '@/interfaces'
import { humanizeFieldName, extractTemplateFields, renderTemplateLabel } from '@/modules/entities/utils/recordDisplay'

function normalizeSpecial(special: string[] | string | null | undefined): string[] {
  if (!special) return []
  if (Array.isArray(special)) return special
  return [special]
}

export type RepeaterEditMode = 'inline' | 'drawer'
export type RepeaterSortMode = 'manual' | 'disabled'

export interface RepeaterSubField {
  field: string
  name?: string
  type?: string
  interface?: string
  width?: 'half' | 'full'
  required?: boolean
  meta?: {
    field?: string
    interface?: string | null
    width?: string | null
    required?: boolean
    options?: Record<string, unknown> | null
  } | null
}

export interface RepeaterFormSchema {
  subFields: RepeaterSubField[]
  template?: string
  addLabel?: string
  editMode: RepeaterEditMode
  sort: RepeaterSortMode
}

export function isRepeaterFieldDefinition(field: FieldDefinition): boolean {
  const special = normalizeSpecial(field.meta?.special)
  if (special.includes('repeater')) return true

  const iface = (field.meta?.interface ?? '').toLowerCase()
  if (iface.includes('repeater')) return true
  if (iface === 'list' && Array.isArray(field.meta?.options?.fields)) return true

  return false
}

function resolveSubFieldName(item: Record<string, unknown>, meta: RepeaterSubField['meta']): string | undefined {
  if (typeof item.name === 'string' && item.name.trim()) return item.name.trim()
  const metaName = meta?.options?.fieldNote
  if (typeof metaName === 'string' && metaName.trim()) return metaName.trim()
  return undefined
}

function resolveSubFieldWidth(meta: RepeaterSubField['meta']): 'half' | 'full' {
  const raw = (meta?.width ?? '').toString().toLowerCase()
  if (raw === 'half' || raw === '50' || raw === 'half-width') return 'half'
  return 'full'
}

export function getRepeaterSubFields(field: FieldDefinition): RepeaterSubField[] {
  const raw = field.meta?.options?.fields
  if (!Array.isArray(raw)) return []

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const meta = (item.meta ?? null) as RepeaterSubField['meta']
      const resolvedField =
        typeof item.field === 'string' && item.field.trim()
          ? item.field.trim()
          : typeof meta?.field === 'string' && meta.field.trim()
            ? meta.field.trim()
            : ''

      return {
        field: resolvedField,
        name: resolveSubFieldName(item, meta),
        type: typeof item.type === 'string' ? item.type : 'string',
        interface:
          typeof item.interface === 'string'
            ? item.interface
            : typeof meta?.interface === 'string'
              ? meta.interface
              : undefined,
        width: resolveSubFieldWidth(meta),
        required: Boolean(meta?.required ?? item.required),
        meta,
      }
    })
    .filter((item) => item.field)
}

function resolveRepeaterTemplate(
  template: string | undefined,
  subFields: RepeaterSubField[],
): string | undefined {
  const trimmed = template?.trim()
  if (!trimmed) {
    const fallback = subFields[0]?.field
    return fallback ? `{{ ${fallback} }}` : undefined
  }

  const normalized = trimmed.replace(/\{\{\s*field\s*\}\}/gi, () => {
    const fallback = subFields[0]?.field
    return fallback ? `{{ ${fallback} }}` : '{{ field }}'
  })

  return normalized
}

function resolveRepeaterEditMode(options: Record<string, unknown> | null | undefined): RepeaterEditMode {
  const raw = String(options?.editMode ?? options?.mode ?? '').toLowerCase()
  return raw === 'drawer' ? 'drawer' : 'inline'
}

function resolveRepeaterSortMode(options: Record<string, unknown> | null | undefined): RepeaterSortMode {
  const raw = String(options?.sort ?? options?.sortField ?? 'manual').toLowerCase()
  if (raw === 'disabled' || raw === 'none' || raw === 'off') return 'disabled'
  return 'manual'
}

export function buildRepeaterFormSchema(field: FieldDefinition): RepeaterFormSchema {
  const options = field.meta?.options ?? {}
  const subFields = getRepeaterSubFields(field)
  const addLabel =
    typeof options.addLabel === 'string' && options.addLabel.trim()
      ? options.addLabel.trim()
      : undefined

  return {
    subFields,
    template: resolveRepeaterTemplate(
      typeof options.template === 'string' ? options.template : undefined,
      subFields,
    ),
    addLabel,
    editMode: resolveRepeaterEditMode(options),
    sort: resolveRepeaterSortMode(options),
  }
}

export function normalizeRepeaterValue(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
}

export function getRepeaterTemplate(field: FieldDefinition): string | undefined {
  return buildRepeaterFormSchema(field).template
}

function coerceRepeaterSubFieldValue(subField: RepeaterSubField, value: unknown): unknown {
  const component = mapRepeaterSubFieldToComponent(subField)

  if (component === 'Checkbox') {
    if (value === true || value === 1 || value === '1' || value === 'true') return true
    return false
  }

  if (component === 'InputNumber') {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (value === null || value === undefined) return ''
  return value
}

function normalizeRepeaterRow(
  row: Record<string, unknown>,
  schema: RepeaterFormSchema,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const subField of schema.subFields) {
    normalized[subField.field] = coerceRepeaterSubFieldValue(subField, row[subField.field])
  }
  return normalized
}

export function normalizeRepeaterRows(
  value: unknown,
  schema: RepeaterFormSchema,
): Record<string, unknown>[] {
  return normalizeRepeaterValue(value).map((row) => normalizeRepeaterRow(row, schema))
}

export function serializeRepeaterRows(
  rows: Record<string, unknown>[],
  schema: RepeaterFormSchema,
): Record<string, unknown>[] {
  return rows.map((row) => normalizeRepeaterRow(row, schema))
}

export function mapRepeaterSubFieldToComponent(subField: RepeaterSubField): PrimeVueComponentType {
  const iface = (subField.meta?.interface ?? subField.interface ?? '').toLowerCase()
  const type = (subField.type ?? 'string').toLowerCase()

  if (iface.includes('wysiwyg') || iface.includes('rich-text-html')) return 'Editor'
  if (iface.includes('select-dropdown') || iface.includes('select')) return 'Select'
  if (iface.includes('multiline') || iface.includes('textarea') || type === 'text') return 'Textarea'
  if (iface.includes('number') || iface.includes('numeric') || ['integer', 'float', 'decimal', 'biginteger'].includes(type)) {
    return 'InputNumber'
  }
  if (iface.includes('toggle') || iface.includes('boolean') || type === 'boolean') return 'Checkbox'
  if (iface.includes('input') || type === 'string') return 'InputText'

  return 'InputText'
}

export function buildRepeaterSubFieldProps(subField: RepeaterSubField): Record<string, unknown> {
  const component = mapRepeaterSubFieldToComponent(subField)
  const options = subField.meta?.options ?? {}
  const props: Record<string, unknown> = {
    fluid: true,
  }

  if (component === 'Checkbox') {
    props.binary = true
  }

  if (component === 'Select') {
    props.optionLabel = 'label'
    props.optionValue = 'value'
    props.placeholder = 'Select...'
    const choices = options.choices
    if (Array.isArray(choices)) {
      props.options = choices
        .filter((choice) => choice && typeof choice === 'object' && 'value' in (choice as object))
        .map((choice) => {
          const entry = choice as Record<string, unknown>
          return {
            label: String(entry.text ?? entry.label ?? entry.value ?? ''),
            value: entry.value,
          }
        })
    }
  }

  if (component === 'Textarea') {
    const rows = options.rows
    if (typeof rows === 'number' && rows > 0) {
      props.rows = rows
    } else {
      props.autoResize = true
    }
  }

  if (component === 'Editor') {
    props.editorStyle = 'min-height: 200px'
    const softLimit = options.softLength ?? options.softLimit
    if (typeof softLimit === 'number' && softLimit > 0) {
      props.placeholder = `Max ${softLimit} characters (soft limit)`
    }
  }

  return props
}

export function repeaterSubFieldLabel(subField: RepeaterSubField): string {
  return subField.name?.trim() || humanizeFieldName(subField.field)
}

export function repeaterSubFieldSpanClass(subField: RepeaterSubField): string {
  const component = mapRepeaterSubFieldToComponent(subField)
  if (component === 'Editor') return 'col-span-12'
  return subField.width === 'half' ? 'col-span-12 md:col-span-6' : 'col-span-12'
}

export function getRepeaterTemplateFields(template: string | undefined): string[] {
  return template?.trim() ? extractTemplateFields(template) : []
}

function containsHtmlMarkup(value: string): boolean {
  return /<[a-z][^>]*>/i.test(value) || /&lt;[a-z]/i.test(value)
}

function fieldValueUsesHtml(value: unknown, subField: RepeaterSubField): boolean {
  if (typeof value === 'string' && containsHtmlMarkup(value)) return true
  const iface = (subField.meta?.interface ?? subField.interface ?? '').toLowerCase()
  return iface.includes('wysiwyg') || iface.includes('rich-text-html')
}

export interface RepeaterItemDisplayResult {
  html: string
  isHtml: boolean
}

export function renderRepeaterItemContent(
  template: string | undefined,
  row: Record<string, unknown>,
  subFields: RepeaterSubField[],
): RepeaterItemDisplayResult {
  const fallbackField = subFields[0]?.field
  const resolvedTemplate = template?.trim() || (fallbackField ? `{{ ${fallbackField} }}` : '')
  if (!resolvedTemplate) return { html: '', isHtml: false }

  const html = renderTemplateLabel(resolvedTemplate, row).trim()
  if (!html) return { html: '', isHtml: false }

  const templateFields = getRepeaterTemplateFields(resolvedTemplate)
  const isHtml =
    containsHtmlMarkup(html) ||
    templateFields.some((token) => {
      const fieldKey = token.split('.')[0] ?? token
      const subField = subFields.find((field) => field.field === fieldKey)
      return subField ? fieldValueUsesHtml(row[fieldKey], subField) : false
    })

  return { html, isHtml }
}

export function repeaterSubFieldsOutsideTemplate(
  template: string | undefined,
  subFields: RepeaterSubField[],
): RepeaterSubField[] {
  const templateFields = getRepeaterTemplateFields(template)
  if (templateFields.length === 0) return subFields

  const templateFieldKeys = new Set(templateFields.map((field) => field.split('.')[0] ?? field))
  return subFields.filter((subField) => !templateFieldKeys.has(subField.field))
}

export function renderRepeaterItemLabel(
  template: string | undefined,
  row: Record<string, unknown>,
  subFields: RepeaterSubField[],
): string {
  const fallbackField = subFields[0]?.field
  const resolvedTemplate = template?.trim() || (fallbackField ? `{{ ${fallbackField} }}` : '')
  if (!resolvedTemplate) return ''

  const rendered = renderTemplateLabel(resolvedTemplate, row).trim()
  if (rendered) return rendered
  return fallbackField ? String(row[fallbackField] ?? '') : ''
}

export function createEmptyRepeaterRow(schema: RepeaterFormSchema | RepeaterSubField[]): Record<string, unknown> {
  const subFields = Array.isArray(schema) ? schema : schema.subFields
  const row: Record<string, unknown> = {}
  for (const subField of subFields) {
    row[subField.field] = mapRepeaterSubFieldToComponent(subField) === 'Checkbox' ? false : ''
  }
  return row
}
