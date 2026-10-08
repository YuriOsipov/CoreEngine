import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { validateCron } from './cron.js'
import {
  compileSchedule,
  nextScheduleDate,
  parseScheduleSpec,
  type ScheduleSpec,
} from './scheduleSpec.js'
import { executeJobType, isJobType, type JobType } from './jobTypes.js'

export type TaskRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'
export type TaskRunTrigger = 'schedule' | 'manual'

export interface ScheduledTaskRow {
  id: string
  key: string
  name: string
  jobType: JobType
  cron: string
  schedule: ScheduleSpec
  timezone: string
  enabled: boolean
  params: Record<string, unknown>
  description: string | null
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduledTaskRunRow {
  id: string
  taskId: string
  status: TaskRunStatus
  trigger: TaskRunTrigger
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

export interface UpsertScheduledTaskInput {
  id?: string | null
  key?: string | null
  name: string
  jobType: string
  cron?: string | null
  schedule?: unknown
  timezone?: string | null
  enabled?: boolean | null
  params?: Record<string, unknown> | null
  description?: string | null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function iso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function mapTask(row: Record<string, unknown>): ScheduledTaskRow {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    jobType: String(row.job_type) as JobType,
    cron: String(row.cron),
    schedule: parseScheduleSpec(row.schedule, String(row.cron || '')),
    timezone: String(row.timezone || 'UTC'),
    enabled: Boolean(row.enabled),
    params: asObject(row.params),
    description: row.description == null ? null : String(row.description),
    lastRunAt: iso(row.last_run_at),
    nextRunAt: iso(row.next_run_at),
    lastStatus: row.last_status == null ? null : String(row.last_status),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function mapRun(row: Record<string, unknown>): ScheduledTaskRunRow {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    status: String(row.status) as TaskRunStatus,
    trigger: String(row.trigger) as TaskRunTrigger,
    payload: asObject(row.payload),
    result: row.result == null ? null : asObject(row.result),
    error: row.error == null ? null : String(row.error),
    startedAt: iso(row.started_at) || new Date().toISOString(),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at) || new Date().toISOString(),
  }
}

function slugKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${slug || 'task'}-${randomUUID().slice(0, 8)}`
}

export function isMissingTasksTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /app_scheduled_tasks|app_task_runs/i.test(message) && /does not exist/i.test(message)
}

export async function listScheduledTasks(): Promise<ScheduledTaskRow[]> {
  const rows = await query(
    `SELECT *
     FROM public.app_scheduled_tasks
     ORDER BY name ASC`,
  )
  return rows.map(mapTask)
}

export async function getScheduledTask(id: string): Promise<ScheduledTaskRow | null> {
  const rows = await query(
    `SELECT * FROM public.app_scheduled_tasks WHERE id = $1::uuid LIMIT 1`,
    [id],
  )
  return rows[0] ? mapTask(rows[0]) : null
}

export async function listScheduledTaskRuns(
  taskId: string,
  limit = 20,
): Promise<ScheduledTaskRunRow[]> {
  const rows = await query(
    `SELECT *
     FROM public.app_task_runs
     WHERE task_id = $1::uuid
     ORDER BY started_at DESC
     LIMIT $2`,
    [taskId, Math.min(Math.max(limit, 1), 100)],
  )
  return rows.map(mapRun)
}

function computeNextRun(
  spec: ScheduleSpec,
  timezone: string,
  from = new Date(),
): Date | null {
  return nextScheduleDate(spec, from, timezone)
}

export async function upsertScheduledTask(
  input: UpsertScheduledTaskInput,
): Promise<ScheduledTaskRow> {
  const name = input.name.trim()
  if (!name) throw new Error('name is required')
  if (!isJobType(input.jobType)) {
    throw new Error(`Unsupported job type "${input.jobType}"`)
  }
  const spec = parseScheduleSpec(input.schedule, input.cron ?? '')
  const crons = compileSchedule(spec)
  const cron = crons[0] ?? ''
  if (!cron) throw new Error('schedule is required')
  for (const expression of crons) validateCron(expression)
  const timezone = (input.timezone || 'UTC').trim() || 'UTC'
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
  } catch {
    throw new Error(`Unknown timezone "${timezone}"`)
  }
  const enabled = input.enabled === true
  const params = input.params && typeof input.params === 'object' ? input.params : {}
  const nextRun = enabled ? computeNextRun(spec, timezone) : null

  if (input.id) {
    const updated = await query(
      `UPDATE public.app_scheduled_tasks
       SET name = $2,
           job_type = $3,
           cron = $4,
           schedule = $5::jsonb,
           timezone = $6,
           enabled = $7,
           params = $8::jsonb,
           description = $9,
           next_run_at = $10
       WHERE id = $1::uuid
       RETURNING *`,
      [
        input.id,
        name,
        input.jobType,
        cron,
        JSON.stringify(spec),
        timezone,
        enabled,
        JSON.stringify(params),
        input.description?.trim() || null,
        nextRun,
      ],
    )
    if (!updated[0]) throw new Error('Scheduled task not found')
    return mapTask(updated[0])
  }

  const key = (input.key || '').trim() || slugKey(name)
  const created = await query(
    `INSERT INTO public.app_scheduled_tasks (
       id, key, name, job_type, cron, schedule, timezone, enabled, params, description, next_run_at
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11)
     RETURNING *`,
    [
      randomUUID(),
      key,
      name,
      input.jobType,
      cron,
      JSON.stringify(spec),
      timezone,
      enabled,
      JSON.stringify(params),
      input.description?.trim() || null,
      nextRun,
    ],
  )
  return mapTask(created[0]!)
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM public.app_scheduled_tasks WHERE id = $1::uuid RETURNING id`,
    [id],
  )
  return Boolean(rows[0])
}

async function findRunningRun(taskId: string): Promise<ScheduledTaskRunRow | null> {
  const rows = await query(
    `SELECT * FROM public.app_task_runs
     WHERE task_id = $1::uuid AND status = 'RUNNING'
     ORDER BY started_at DESC
     LIMIT 1`,
    [taskId],
  )
  return rows[0] ? mapRun(rows[0]) : null
}

const STALE_RUN_MS = 30 * 60 * 1000

export async function failStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS)
  const rows = await query(
    `UPDATE public.app_task_runs
     SET status = 'FAILED',
         error = 'Stale run (scheduler timeout)',
         finished_at = now()
     WHERE status = 'RUNNING' AND started_at < $1
     RETURNING id`,
    [cutoff],
  )
  return rows.length
}

export async function listDueTasks(now = new Date()): Promise<ScheduledTaskRow[]> {
  const rows = await query(
    `SELECT *
     FROM public.app_scheduled_tasks
     WHERE enabled = true
       AND next_run_at IS NOT NULL
       AND next_run_at <= $1
     ORDER BY next_run_at ASC`,
    [now],
  )
  return rows.map(mapTask)
}

export async function refreshNextRun(task: ScheduledTaskRow, from = new Date()): Promise<void> {
  const next = task.enabled ? computeNextRun(task.schedule, task.timezone, from) : null
  await query(
    `UPDATE public.app_scheduled_tasks SET next_run_at = $2 WHERE id = $1::uuid`,
    [task.id, next],
  )
}

export async function runScheduledTask(
  taskId: string,
  trigger: TaskRunTrigger,
): Promise<ScheduledTaskRunRow> {
  const task = await getScheduledTask(taskId)
  if (!task) throw new Error('Scheduled task not found')

  const running = await findRunningRun(task.id)
  if (running) {
    throw new Error(`Task "${task.name}" is already running`)
  }

  const created = await query(
    `INSERT INTO public.app_task_runs (id, task_id, status, trigger, payload, started_at)
     VALUES ($1::uuid, $2::uuid, 'RUNNING', $3, $4::jsonb, now())
     RETURNING *`,
    [randomUUID(), task.id, trigger, JSON.stringify(task.params)],
  )
  const runId = String(created[0]?.id || '')
  if (!runId) throw new Error('Failed to create task run')

  try {
    const result = await executeJobType(task.jobType, task.params, task.timezone)
    const updated = await query(
      `UPDATE public.app_task_runs
       SET status = 'SUCCEEDED',
           result = $2::jsonb,
           finished_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [runId, JSON.stringify(result)],
    )
    const finishedAt = new Date()
    const next = task.enabled ? computeNextRun(task.schedule, task.timezone, finishedAt) : null
    await query(
      `UPDATE public.app_scheduled_tasks
       SET last_run_at = $2,
           next_run_at = $3,
           last_status = 'SUCCEEDED',
           last_error = NULL
       WHERE id = $1::uuid`,
      [task.id, finishedAt, next],
    )
    return mapRun(updated[0]!)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const updated = await query(
      `UPDATE public.app_task_runs
       SET status = 'FAILED',
           error = $2,
           finished_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [runId, message],
    )
    const finishedAt = new Date()
    const next = task.enabled ? computeNextRun(task.schedule, task.timezone, finishedAt) : null
    await query(
      `UPDATE public.app_scheduled_tasks
       SET last_run_at = $2,
           next_run_at = $3,
           last_status = 'FAILED',
           last_error = $4
       WHERE id = $1::uuid`,
      [task.id, finishedAt, next, message],
    )
    return mapRun(updated[0]!)
  }
}
