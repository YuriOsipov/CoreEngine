/**
 * Salesforce-style Auto Number display format.
 * Tokens: {0}/{000…} sequence, {YY}/{YYYY}, {MM}, {DD} from create date.
 */

const SEQUENCE_TOKEN = /\{(0+)\}/g
const DATE_TOKEN = /\{(YYYY|YY|MM|DD)\}/g

export function formatAutoNumber(
  displayFormat: string,
  sequence: number,
  createdAt: Date = new Date(),
): string {
  const format = String(displayFormat || '{0}').trim() || '{0}'
  const safeSequence = Number.isFinite(sequence) ? Math.max(0, Math.trunc(sequence)) : 0

  const withSequence = format.replace(SEQUENCE_TOKEN, (_match, zeros: string) => {
    const width = Math.min(10, Math.max(1, zeros.length))
    const raw = String(safeSequence)
    if (width <= 1) return raw
    return raw.padStart(width, '0')
  })

  const year = createdAt.getFullYear()
  const month = createdAt.getMonth() + 1
  const day = createdAt.getDate()

  return withSequence.replace(DATE_TOKEN, (_match, token: string) => {
    switch (token) {
      case 'YYYY':
        return String(year)
      case 'YY':
        return String(year).slice(-2)
      case 'MM':
        return String(month).padStart(2, '0')
      case 'DD':
        return String(day).padStart(2, '0')
      default:
        return ''
    }
  })
}

export function readAutoNumberOptions(options: Record<string, unknown>): {
  enabled: boolean
  displayFormat: string
  startingNumber: number
} {
  const mode = String(options.computeMode ?? options.compute_mode ?? '')
    .trim()
    .toLowerCase()
  const nested =
    options.autoNumber &&
    typeof options.autoNumber === 'object' &&
    !Array.isArray(options.autoNumber)
      ? (options.autoNumber as Record<string, unknown>)
      : null
  const enabled =
    mode === 'autonumber' ||
    options.autoNumber === true ||
    Boolean(nested)

  const displayFormat = String(
    nested?.displayFormat ??
      nested?.display_format ??
      options.displayFormat ??
      options.display_format ??
      '{0000}',
  ).trim() || '{0000}'

  const startingRaw = Number(
    nested?.startingNumber ??
      nested?.starting_number ??
      options.startingNumber ??
      options.starting_number ??
      1,
  )
  const startingNumber =
    Number.isFinite(startingRaw) && startingRaw >= 0
      ? Math.trunc(startingRaw)
      : 1

  return { enabled, displayFormat, startingNumber }
}

export function buildAutoNumberFieldOptions(input?: {
  displayFormat?: string
  startingNumber?: number
}): Record<string, unknown> {
  const displayFormat = String(input?.displayFormat || '{0000}').trim() || '{0000}'
  const startingRaw = Number(input?.startingNumber ?? 1)
  const startingNumber =
    Number.isFinite(startingRaw) && startingRaw >= 0
      ? Math.trunc(startingRaw)
      : 1
  return {
    computeMode: 'autoNumber',
    autoNumber: {
      displayFormat,
      startingNumber,
    },
  }
}
