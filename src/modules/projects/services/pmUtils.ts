import type { PmStatusDefinition } from '@/interfaces/projects'
import { PM_DEFAULT_STATUSES } from '@/interfaces/projects'

export function relationId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return id == null ? null : String(id)
  }
  return null
}

export function relationLabel(value: unknown, fallbackFields: string[] = ['name', 'long_name']): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
    for (const field of fallbackFields) {
      const raw = row[field]
      if (typeof raw === 'string' && raw.trim()) return raw
    }
    if (row.id != null) return String(row.id)
  }
  return ''
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
      return relationId(entry)
    })
    .filter((entry): entry is string => Boolean(entry))
}

export function asStatusDefinitions(value: unknown): PmStatusDefinition[] {
  if (!Array.isArray(value) || value.length === 0) return [...PM_DEFAULT_STATUSES]
  const parsed: PmStatusDefinition[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const key = typeof row.key === 'string' ? row.key : null
    if (!key) continue
    parsed.push({
      key,
      label: typeof row.label === 'string' && row.label ? row.label : key,
      color: typeof row.color === 'string' && row.color ? row.color : '#64748b',
    })
  }
  return parsed.length > 0 ? parsed : [...PM_DEFAULT_STATUSES]
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${isoDate}`)
  }
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

export function startOfDayIso(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date')
  }
  date.setUTCHours(0, 0, 0, 0)
  return date.toISOString()
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export function taskScheduleFromOffset(
  projectStartIso: string,
  offsetDays: number,
  durationDays: number,
): { date_start: string; date_end: string } {
  const origin = startOfDayIso(projectStartIso)
  const offset = Math.max(0, Number(offsetDays) || 0)
  const duration = Math.max(0, Number(durationDays) || 0)
  return {
    date_start: addDaysIso(origin, offset),
    date_end: addDaysIso(origin, offset + duration),
  }
}

export function canCompleteTask(params: {
  taskStatus: string
  dependsOn: string[]
  tasksById: Map<string, { stage_status?: string | null }>
  requiredItems: Array<{ is_required?: boolean | null; item_status?: string | null }>
}): { ok: boolean; reason?: string } {
  if (params.taskStatus === 'done' || params.taskStatus === 'skipped') {
    return { ok: true }
  }

  for (const depId of params.dependsOn) {
    const dep = params.tasksById.get(depId)
    const depStatus = dep?.stage_status ?? 'todo'
    if (depStatus !== 'done' && depStatus !== 'skipped') {
      return { ok: false, reason: 'blocked_by_dependency' }
    }
  }

  const unfinishedRequired = params.requiredItems.some(
    (item) =>
      item.is_required &&
      item.item_status !== 'delivered' &&
      item.item_status !== 'cancelled',
  )
  if (unfinishedRequired) {
    return { ok: false, reason: 'required_services' }
  }

  return { ok: true }
}

export function computeProjectProgress(
  tasks: Array<{ stage_status?: string | null; progress?: number | null }>,
): number {
  if (tasks.length === 0) return 0
  const total = tasks.reduce((sum, task) => {
    if (task.stage_status === 'done') return sum + 100
    if (task.stage_status === 'skipped') return sum + 100
    return sum + Math.max(0, Math.min(100, Number(task.progress ?? 0)))
  }, 0)
  return Math.round(total / tasks.length)
}

export function lineBaseTotal(
  basePrice: number | null | undefined,
  quantity: number | null | undefined,
): number {
  const price = Number(basePrice ?? 0)
  const qty = Number(quantity ?? 1)
  if (Number.isNaN(price) || Number.isNaN(qty)) return 0
  return price * qty
}

export function sumBasePrices(
  rows: Array<{ base_price?: number | null; total?: number | null; quantity?: number | null }>,
  preferTotal = true,
): number {
  return rows.reduce((sum, row) => {
    if (preferTotal && row.total != null && !Number.isNaN(Number(row.total))) {
      return sum + Number(row.total)
    }
    return sum + lineBaseTotal(row.base_price, row.quantity)
  }, 0)
}

export function formatMoney(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  if (Number.isNaN(amount)) return '0'
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
