import type {
  PmApplyTemplateInput,
  PmApplyTemplateResult,
  PmProjectRecord,
  PmTaskItemRecord,
  PmTaskRecord,
} from '@/interfaces/projects'
import {
  PM_DEFAULT_STATUSES,
  PM_PROJECT_COLLECTION,
  PM_STAGE_COLLECTION,
  PM_STAGE_ITEM_COLLECTION,
} from '@/interfaces/projects'
import {
  bridgeCreateItem,
  bridgeDeleteItem,
  bridgeReadItem,
  bridgeReadItems,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import { applyCloneRelatedFromLayout } from '@/modules/entities/services/cloneRelatedFromSource'
import { loadTemplateTree } from './pmTemplateService'
import {
  addDaysIso,
  asStatusDefinitions,
  asStringArray,
  computeProjectProgress,
  lineBaseTotal,
  taskScheduleFromOffset,
  relationId,
  relationLabel,
  startOfDayIso,
  sumBasePrices,
} from './pmUtils'

const PROJECT_FIELDS = [
  'id',
  'name',
  'description',
  'patient',
  'patient.id',
  'patient.long_name',
  'patient.name',
  'facility',
  'facility.id',
  'facility.name',
  'template',
  'template.id',
  'template.name',
  'template_version',
  'date_start',
  'date_end',
  'progress',
  'base_price',
  'pm_cost',
  'owner',
  'notes',
  'statuses',
  'lifecycle',
] as const

const TASK_FIELDS = [
  'id',
  'name',
  'description',
  'project',
  'parent',
  'template_stage',
  'offset_days',
  'duration_days',
  'date_start',
  'date_end',
  'stage_status',
  'progress',
  'base_price',
  'pm_cost',
  'assignee',
  'assignee.id',
  'assignee.name',
  'depends_on',
  'is_milestone',
  'is_custom',
] as const

const TASK_ITEM_FIELDS = [
  'id',
  'name',
  'stage',
  'item',
  'item.id',
  'item.name',
  'item.base_price',
  'variant',
  'variant.id',
  'variant.name',
  'quantity',
  'price',
  'base_price',
  'total',
  'is_required',
  'item_status',
  'notes',
] as const

function mapProject(row: Record<string, unknown>): PmProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: (row.description as string | null) ?? null,
    patient: row.patient as PmProjectRecord['patient'],
    facility: row.facility as PmProjectRecord['facility'],
    template: row.template as PmProjectRecord['template'],
    template_version:
      row.template_version == null ? null : Number(row.template_version),
    date_start: (row.date_start as string | null) ?? null,
    date_end: (row.date_end as string | null) ?? null,
    progress: row.progress == null ? 0 : Number(row.progress),
    base_price: row.base_price == null ? 0 : Number(row.base_price),
    pm_cost: row.pm_cost == null ? 0 : Number(row.pm_cost),
    owner: relationId(row.owner),
    notes: (row.notes as string | null) ?? null,
    statuses: asStatusDefinitions(row.statuses),
    lifecycle: (row.lifecycle as PmProjectRecord['lifecycle']) ?? 'planned',
    status: (row.status as string | null) ?? null,
  }
}

function mapTask(row: Record<string, unknown>): PmTaskRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: (row.description as string | null) ?? null,
    project: relationId(row.project),
    parent: relationId(row.parent),
    template_stage: relationId(row.template_stage),
    offset_days: Number(row.offset_days ?? 0),
    duration_days: Number(row.duration_days ?? (row.is_milestone ? 0 : 1)),
    date_start: (row.date_start as string | null) ?? null,
    date_end: (row.date_end as string | null) ?? null,
    stage_status: (row.stage_status as string | null) ?? 'todo',
    progress: Number(row.progress ?? 0),
    base_price: row.base_price == null ? 0 : Number(row.base_price),
    pm_cost: row.pm_cost == null ? 0 : Number(row.pm_cost),
    assignee: row.assignee as PmTaskRecord['assignee'],
    depends_on: asStringArray(row.depends_on),
    is_milestone: Boolean(row.is_milestone),
    is_custom: Boolean(row.is_custom),
    sort: Number(row.sort ?? 0),
  }
}

function mapTaskItem(row: Record<string, unknown>): PmTaskItemRecord {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    stage: relationId(row.stage),
    item: row.item as PmTaskItemRecord['item'],
    variant: row.variant as PmTaskItemRecord['variant'],
    quantity: Number(row.quantity ?? 1),
    price: row.price == null ? null : Number(row.price),
    base_price: row.base_price == null ? null : Number(row.base_price),
    total: row.total == null ? null : Number(row.total),
    is_required: Boolean(row.is_required),
    item_status: (row.item_status as PmTaskItemRecord['item_status']) ?? 'planned',
    notes: (row.notes as string | null) ?? null,
    sort: Number(row.sort ?? 0),
  }
}

export async function listProjects(patientId?: string | null): Promise<PmProjectRecord[]> {
  const filter = patientId ? { patient: { _eq: patientId } } : null
  const rows = await bridgeReadItems(PM_PROJECT_COLLECTION, {
    filter,
    fields: [...PROJECT_FIELDS],
    sort: ['-date_start', 'name'],
    limit: 500,
  })
  return rows.map(mapProject)
}

export async function getProject(id: string): Promise<PmProjectRecord> {
  const row = await bridgeReadItem(PM_PROJECT_COLLECTION, id, {
    fields: [...PROJECT_FIELDS],
  })
  return mapProject(row)
}

function hasIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Fill start/end once from project start + offset + duration. Does not rewrite later edits. */
export async function initializeTaskSchedule(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const offset = Math.max(0, Number(payload.offset_days ?? 0))
  const duration = Math.max(
    0,
    Number(payload.duration_days ?? (payload.is_milestone ? 0 : 1)),
  )
  const next: Record<string, unknown> = {
    ...payload,
    offset_days: payload.offset_days ?? offset,
    duration_days: payload.duration_days ?? duration,
  }
  if (hasIsoDate(next.date_start) && hasIsoDate(next.date_end)) return next

  const projectId = relationId(next.project)
  if (!projectId) return next
  const project = await getProject(projectId)
  if (!project.date_start) return next
  const dates = taskScheduleFromOffset(project.date_start, offset, duration)
  return {
    ...next,
    date_start: hasIsoDate(next.date_start) ? next.date_start : dates.date_start,
    date_end: hasIsoDate(next.date_end) ? next.date_end : dates.date_end,
  }
}

export async function updateProject(
  id: string,
  payload: Record<string, unknown>,
): Promise<PmProjectRecord> {
  const row = await bridgeUpdateItem(PM_PROJECT_COLLECTION, id, payload, {
    fields: [...PROJECT_FIELDS],
  })
  return mapProject(row)
}

export async function listProjectTasks(projectId: string): Promise<PmTaskRecord[]> {
  const rows = await bridgeReadItems(PM_STAGE_COLLECTION, {
    filter: { project: { _eq: projectId } },
    fields: [...TASK_FIELDS],
    sort: ['date_start', 'name'],
    limit: 5000,
  })
  return rows.map(mapTask)
}

export async function updateTask(
  id: string,
  payload: Record<string, unknown>,
): Promise<PmTaskRecord> {
  const row = await bridgeUpdateItem(PM_STAGE_COLLECTION, id, payload, {
    fields: [...TASK_FIELDS],
  })
  return mapTask(row)
}

export async function createTask(payload: Record<string, unknown>): Promise<PmTaskRecord> {
  const scheduled = await initializeTaskSchedule(payload)
  const row = await bridgeCreateItem(
    PM_STAGE_COLLECTION,
    { is_active: true, is_custom: true, ...scheduled },
    { fields: [...TASK_FIELDS] },
  )
  return mapTask(row)
}

export async function deleteTask(id: string): Promise<void> {
  await bridgeDeleteItem(PM_STAGE_COLLECTION, id)
}

export async function listTaskItems(taskId: string): Promise<PmTaskItemRecord[]> {
  const rows = await bridgeReadItems(PM_STAGE_ITEM_COLLECTION, {
    filter: { stage: { _eq: taskId } },
    fields: [...TASK_ITEM_FIELDS],
    sort: ['name'],
    limit: 500,
  })
  return rows.map(mapTaskItem)
}

export async function saveTaskItem(
  payload: Record<string, unknown>,
  id?: string | null,
): Promise<PmTaskItemRecord> {
  const quantity = Number(payload.quantity ?? 1)
  let basePrice =
    payload.base_price == null || payload.base_price === ''
      ? null
      : Number(payload.base_price)

  if (basePrice == null && payload.item) {
    const itemId = relationId(payload.item)
    if (itemId) {
      try {
        const itemRow = await bridgeReadItem('item', itemId, {
          fields: ['id', 'name', 'base_price'],
        })
        basePrice =
          itemRow.base_price == null ? 0 : Number(itemRow.base_price)
        if (!payload.name) payload.name = relationLabel(itemRow, ['name']) || 'Service'
      } catch {
        basePrice = 0
      }
    }
  }

  const resolvedBase = Number(basePrice ?? 0)
  const total = lineBaseTotal(resolvedBase, quantity)
  const body = {
    is_active: true,
    ...payload,
    quantity,
    base_price: resolvedBase,
    price: payload.price == null ? resolvedBase : Number(payload.price),
    total,
    name: payload.name ?? relationLabel(payload.item, ['name']) ?? 'Service',
  }
  const row = id
    ? await bridgeUpdateItem(PM_STAGE_ITEM_COLLECTION, id, body, {
        fields: [...TASK_ITEM_FIELDS],
      })
    : await bridgeCreateItem(PM_STAGE_ITEM_COLLECTION, body, {
        fields: [...TASK_ITEM_FIELDS],
      })
  return mapTaskItem(row)
}

export async function deleteTaskItem(id: string): Promise<void> {
  await bridgeDeleteItem(PM_STAGE_ITEM_COLLECTION, id)
}

/** Recalc step base_price from services, then project base_price / pm_cost rollups. */
export async function refreshProjectPricing(projectId: string): Promise<void> {
  const tasks = await listProjectTasks(projectId)
  let projectBase = 0
  let projectPmCost = 0

  for (const task of tasks) {
    const items = await listTaskItems(task.id)
    const stepBase = sumBasePrices(items)
    const stepPmCost = Number(task.pm_cost ?? 0)
    await updateTask(task.id, { base_price: stepBase })
    projectBase += stepBase
    projectPmCost += stepPmCost
  }

  const progress = computeProjectProgress(tasks)
  await updateProject(projectId, {
    base_price: projectBase,
    pm_cost: projectPmCost,
    progress,
  })
}

export async function refreshProjectProgress(projectId: string): Promise<number> {
  await refreshProjectPricing(projectId)
  const project = await getProject(projectId)
  return Number(project.progress ?? 0)
}

/** @deprecated Prefer layout-driven cloneRelatedFrom; kept only for rare direct callers. */
export async function maybeCloneTemplateSteps(
  project: Record<string, unknown>,
): Promise<void> {
  const { blockLayout } = await resolvePreferredBlockLayoutForCurrentUser(PM_PROJECT_COLLECTION)
  await applyCloneRelatedFromLayout(PM_PROJECT_COLLECTION, project, null, blockLayout)
}

export async function applyProjectTemplate(
  input: PmApplyTemplateInput,
): Promise<PmApplyTemplateResult> {
  const { template, tasks } = await loadTemplateTree(input.templateId)
  const dateStart = startOfDayIso(input.dateStart)
  const statuses = template.default_statuses?.length
    ? template.default_statuses
    : PM_DEFAULT_STATUSES

  let maxEnd = dateStart
  for (const task of tasks) {
    const offset = Number(task.offset_days ?? 0)
    const duration = Math.max(0, Number(task.duration_days ?? (task.is_milestone ? 0 : 1)))
    const end = addDaysIso(dateStart, offset + duration)
    if (new Date(end).getTime() > new Date(maxEnd).getTime()) maxEnd = end
  }

  const projectName = input.projectName?.trim() || `${template.name}`
  const { createObjectRecord } = await import('@/modules/entities/services/recordDetails')
  const projectRow = await createObjectRecord(PM_PROJECT_COLLECTION, {
    name: projectName,
    patient: input.patientId,
    facility: input.facilityId ?? null,
    template: template.id,
    template_version: template.version ?? 1,
    date_start: dateStart,
    date_end: maxEnd,
    statuses,
    lifecycle: 'planned',
    progress: 0,
    is_active: true,
  })

  const projectId = String(projectRow.id)
  const stages = await listProjectTasks(projectId)
  return {
    projectId,
    stageIds: stages.map((stage) => stage.id),
  }
}

export function patientLabel(project: PmProjectRecord): string {
  return relationLabel(project.patient, ['long_name', 'name']) || '—'
}
