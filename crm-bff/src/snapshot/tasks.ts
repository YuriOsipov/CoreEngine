export type TaskDefinition = {
  key: string
  name: string
  jobType: string
  cron: string
  schedule: unknown
  timezone: string
  enabled: boolean
  params: Record<string, unknown>
  description: string | null
}

/** Definition only. Runtime columns and run history stay on the source database. */
export function toTaskDefinition(row: {
  key: string
  name: string
  jobType: string
  cron: string
  schedule: unknown
  timezone: string
  enabled: boolean
  params: Record<string, unknown>
  description: string | null
}): TaskDefinition {
  return {
    key: row.key,
    name: row.name,
    jobType: row.jobType,
    cron: row.cron,
    schedule: row.schedule,
    timezone: row.timezone,
    enabled: row.enabled,
    params: row.params ?? {},
    description: row.description,
  }
}
