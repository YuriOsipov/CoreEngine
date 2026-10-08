import {
  failStaleRuns,
  isMissingTasksTable,
  listDueTasks,
  listScheduledTasks,
  refreshNextRun,
  runScheduledTask,
} from './taskService.js'

const DEFAULT_INTERVAL_MS = 15_000

function schedulerEnabled(): boolean {
  const raw = (process.env.TASK_SCHEDULER_ENABLED || '').trim().toLowerCase()
  if (raw === 'false' || raw === '0' || raw === 'off') return false
  return true
}

function intervalMs(): number {
  const raw = Number(process.env.TASK_SCHEDULER_INTERVAL_MS)
  if (Number.isFinite(raw) && raw >= 5_000) return raw
  return DEFAULT_INTERVAL_MS
}

let ticking = false
let missingTableLogged = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await failStaleRuns()
    const due = await listDueTasks()
    for (const task of due) {
      try {
        await runScheduledTask(task.id, 'schedule')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/already running/i.test(message)) {
          continue
        }
        console.warn(`[tasks] scheduled run failed for "${task.key}": ${message}`)
        try {
          await refreshNextRun(task)
        } catch (refreshError) {
          console.warn('[tasks] failed to refresh next_run_at', refreshError)
        }
      }
    }
  } catch (error) {
    if (isMissingTasksTable(error)) {
      if (!missingTableLogged) {
        missingTableLogged = true
        console.warn(
          '[tasks] app_scheduled_tasks missing — run registry:migrate (202609080001_app_scheduled_tasks.sql)',
        )
      }
      return
    }
    console.warn('[tasks] scheduler tick failed', error)
  } finally {
    ticking = false
  }
}

async function hydrateNextRuns(): Promise<void> {
  try {
    const tasks = await listScheduledTasks()
    for (const task of tasks) {
      if (!task.enabled) continue
      if (task.nextRunAt) continue
      await refreshNextRun(task)
    }
  } catch (error) {
    if (isMissingTasksTable(error)) {
      if (!missingTableLogged) {
        missingTableLogged = true
        console.warn(
          '[tasks] app_scheduled_tasks missing — run registry:migrate (202609080001_app_scheduled_tasks.sql)',
        )
      }
      return
    }
    console.warn('[tasks] failed to hydrate next_run_at', error)
  }
}

export function startTaskScheduler(): void {
  if (!schedulerEnabled()) {
    console.info('[tasks] scheduler disabled (TASK_SCHEDULER_ENABLED=false)')
    return
  }
  void hydrateNextRuns().then(() => void tick())
  setInterval(() => {
    void tick()
  }, intervalMs())
}
