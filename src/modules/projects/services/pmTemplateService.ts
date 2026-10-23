import type {
  PmProjectTemplateRecord,
  PmProjectTemplateTaskItemRecord,
  PmProjectTemplateTaskRecord,
  PmTemplateSaveInput,
  PmTemplateTaskSaveInput,
} from '@/interfaces/projects'
import {
  PM_DEFAULT_STATUSES,
  PM_PROJECT_TEMPLATE_COLLECTION,
  PM_PROJECT_TEMPLATE_STAGE_COLLECTION,
  PM_PROJECT_TEMPLATE_STAGE_ITEM_COLLECTION,
} from '@/interfaces/projects'
import {
  bridgeCreateItem,
  bridgeDeleteItem,
  bridgeReadItem,
  bridgeReadItems,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import { asStatusDefinitions, asStringArray, relationId } from './pmUtils'

const TEMPLATE_FIELDS = [
  'id',
  'name',
  'description',
  'version',
  'default_duration_days',
  'default_statuses',
  'archived',
] as const

const TEMPLATE_TASK_FIELDS = [
  'id',
  'name',
  'description',
  'template',
  'parent',
  'offset_days',
  'duration_days',
  'depends_on',
  'default_stage_status',
  'is_milestone',
  'is_optional',
  'base_price',
  'pm_cost',
] as const

const TEMPLATE_TASK_ITEM_FIELDS = [
  'id',
  'name',
  'template_stage',
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
] as const

function mapTemplate(row: Record<string, unknown>): PmProjectTemplateRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: (row.description as string | null) ?? null,
    version: typeof row.version === 'number' ? row.version : Number(row.version ?? 1),
    default_duration_days:
      typeof row.default_duration_days === 'number'
        ? row.default_duration_days
        : row.default_duration_days == null
          ? null
          : Number(row.default_duration_days),
    default_statuses: asStatusDefinitions(row.default_statuses),
    archived: Boolean(row.archived),
    status: (row.status as string | null) ?? null,
  }
}

function mapTemplateTask(row: Record<string, unknown>): PmProjectTemplateTaskRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: (row.description as string | null) ?? null,
    template: relationId(row.template),
    parent: relationId(row.parent),
    offset_days: Number(row.offset_days ?? 0),
    duration_days: Number(row.duration_days ?? 1),
    depends_on: asStringArray(row.depends_on),
    default_stage_status: (row.default_stage_status as string | null) ?? 'todo',
    is_milestone: Boolean(row.is_milestone),
    is_optional: Boolean(row.is_optional),
    base_price: row.base_price == null ? 0 : Number(row.base_price),
    pm_cost: row.pm_cost == null ? 0 : Number(row.pm_cost),
    sort: Number(row.sort ?? 0),
  }
}

function mapTemplateTaskItem(row: Record<string, unknown>): PmProjectTemplateTaskItemRecord {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    template_stage: relationId(row.template_stage),
    item: row.item as PmProjectTemplateTaskItemRecord['item'],
    variant: row.variant as PmProjectTemplateTaskItemRecord['variant'],
    quantity: Number(row.quantity ?? 1),
    price: row.price == null ? null : Number(row.price),
    base_price: row.base_price == null ? null : Number(row.base_price),
    total: row.total == null ? null : Number(row.total),
    is_required: Boolean(row.is_required),
    sort: Number(row.sort ?? 0),
  }
}

export async function listProjectTemplates(includeArchived = false): Promise<PmProjectTemplateRecord[]> {
  const filter = includeArchived
    ? null
    : {
        _or: [{ archived: { _eq: false } }, { archived: { _null: true } }],
      }
  const rows = await bridgeReadItems(PM_PROJECT_TEMPLATE_COLLECTION, {
    filter,
    fields: [...TEMPLATE_FIELDS],
    sort: ['name'],
    limit: 500,
  })
  return rows.map(mapTemplate)
}

export async function getProjectTemplate(id: string): Promise<PmProjectTemplateRecord> {
  const row = await bridgeReadItem(PM_PROJECT_TEMPLATE_COLLECTION, id, {
    fields: [...TEMPLATE_FIELDS],
  })
  return mapTemplate(row)
}

export async function saveProjectTemplate(
  input: PmTemplateSaveInput,
  id?: string | null,
): Promise<PmProjectTemplateRecord> {
  const payload: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? null,
    default_duration_days: input.default_duration_days ?? null,
    default_statuses: input.default_statuses ?? PM_DEFAULT_STATUSES,
    version: input.version ?? 1,
    archived: input.archived ?? false,
  }
  const row = id
    ? await bridgeUpdateItem(PM_PROJECT_TEMPLATE_COLLECTION, id, payload, {
        fields: [...TEMPLATE_FIELDS],
      })
    : await bridgeCreateItem(PM_PROJECT_TEMPLATE_COLLECTION, payload, {
        fields: [...TEMPLATE_FIELDS],
      })
  return mapTemplate(row)
}

export async function listTemplateTasks(templateId: string): Promise<PmProjectTemplateTaskRecord[]> {
  const rows = await bridgeReadItems(PM_PROJECT_TEMPLATE_STAGE_COLLECTION, {
    filter: { template: { _eq: templateId } },
    fields: [...TEMPLATE_TASK_FIELDS],
    sort: ['offset_days', 'name'],
    limit: 2000,
  })
  return rows.map(mapTemplateTask)
}

export async function saveTemplateTask(
  input: PmTemplateTaskSaveInput,
  id?: string | null,
): Promise<PmProjectTemplateTaskRecord> {
  const payload: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? null,
    template: input.template,
    parent: input.parent ?? null,
    offset_days: input.offset_days ?? 0,
    duration_days: input.duration_days ?? 1,
    depends_on: input.depends_on ?? [],
    default_stage_status: input.default_stage_status ?? 'todo',
    is_milestone: input.is_milestone ?? false,
    is_optional: input.is_optional ?? false,
    base_price: input.base_price ?? 0,
    pm_cost: input.pm_cost ?? 0,
    is_active: true,
  }
  const row = id
    ? await bridgeUpdateItem(PM_PROJECT_TEMPLATE_STAGE_COLLECTION, id, payload, {
        fields: [...TEMPLATE_TASK_FIELDS],
      })
    : await bridgeCreateItem(PM_PROJECT_TEMPLATE_STAGE_COLLECTION, payload, {
        fields: [...TEMPLATE_TASK_FIELDS],
      })
  return mapTemplateTask(row)
}

export async function deleteTemplateTask(id: string): Promise<void> {
  await bridgeDeleteItem(PM_PROJECT_TEMPLATE_STAGE_COLLECTION, id)
}

export async function listTemplateTaskItems(
  templateTaskId: string,
): Promise<PmProjectTemplateTaskItemRecord[]> {
  const rows = await bridgeReadItems(PM_PROJECT_TEMPLATE_STAGE_ITEM_COLLECTION, {
    filter: { template_stage: { _eq: templateTaskId } },
    fields: [...TEMPLATE_TASK_ITEM_FIELDS],
    sort: ['name'],
    limit: 500,
  })
  return rows.map(mapTemplateTaskItem)
}

export async function saveTemplateTaskItem(
  payload: Record<string, unknown>,
  id?: string | null,
): Promise<PmProjectTemplateTaskItemRecord> {
  const row = id
    ? await bridgeUpdateItem(PM_PROJECT_TEMPLATE_STAGE_ITEM_COLLECTION, id, payload, {
        fields: [...TEMPLATE_TASK_ITEM_FIELDS],
      })
    : await bridgeCreateItem(PM_PROJECT_TEMPLATE_STAGE_ITEM_COLLECTION, payload, {
        fields: [...TEMPLATE_TASK_ITEM_FIELDS],
      })
  return mapTemplateTaskItem(row)
}

export async function deleteTemplateTaskItem(id: string): Promise<void> {
  await bridgeDeleteItem(PM_PROJECT_TEMPLATE_STAGE_ITEM_COLLECTION, id)
}

export async function loadTemplateTree(templateId: string): Promise<{
  template: PmProjectTemplateRecord
  tasks: PmProjectTemplateTaskRecord[]
  itemsByTaskId: Map<string, PmProjectTemplateTaskItemRecord[]>
}> {
  const template = await getProjectTemplate(templateId)
  const tasks = await listTemplateTasks(templateId)
  const itemsByTaskId = new Map<string, PmProjectTemplateTaskItemRecord[]>()
  await Promise.all(
    tasks.map(async (task) => {
      const items = await listTemplateTaskItems(task.id)
      itemsByTaskId.set(task.id, items)
    }),
  )
  return { template, tasks, itemsByTaskId }
}
