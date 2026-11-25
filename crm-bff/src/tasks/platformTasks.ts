/**
 * Idempotent seed for platform-standard scheduled tasks.
 * Safe to call on every BFF start — INSERT … ON CONFLICT (key) DO NOTHING.
 */
import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { isMissingTasksTable } from './taskService.js'

const PURGE_SCHEDULE = {
  rules: [
    {
      interval: 'days',
      every: 1,
      minute: 0,
      hour: 3,
      weekdays: [1],
      dayOfMonth: 1,
      cron: '',
    },
  ],
}

/**
 * Ensure the standard "Hard delete old archived records" task exists
 * (disabled by default — admins opt in via Setup → Tasks).
 */
export async function ensurePlatformScheduledTasks(): Promise<void> {
  try {
    await query(
      `INSERT INTO public.app_scheduled_tasks (
         id, key, name, job_type, cron, schedule, timezone, enabled, params, description, next_run_at
       ) VALUES (
         $1::uuid,
         'purge_archived_records',
         'Hard delete old archived records',
         'purge_archived_records',
         '0 3 * * *',
         $2::jsonb,
         'UTC',
         false,
         $3::jsonb,
         'Permanently delete archived records older than the retention window (date_updated).',
         NULL
       )
       ON CONFLICT (key) DO NOTHING`,
      [
        randomUUID(),
        JSON.stringify(PURGE_SCHEDULE),
        JSON.stringify({ retentionDays: 90, limitPerEntity: 500 }),
      ],
    )
  } catch (error) {
    if (isMissingTasksTable(error)) return
    throw error
  }
}
