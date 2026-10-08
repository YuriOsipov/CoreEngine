import { graphqlRequest } from './client'

export interface GraphQlScheduledTask {
  id: string
  key: string
  name: string
  jobType: string
  cron: string
  schedule: Record<string, unknown>
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

export interface GraphQlScheduledTaskRun {
  id: string
  taskId: string
  status: string
  trigger: string
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

export interface GenerateScheduleSlotsInput {
  rangeStart: string
  rangeEnd: string
  providerIds?: string[] | null
  facilityIds?: string[] | null
}

export interface GenerateScheduleSlotsResult {
  templatesProcessed: number
  created: number
  skipped: number
}

export interface UpsertScheduledTaskInput {
  id?: string | null
  key?: string | null
  name: string
  jobType: string
  cron?: string | null
  schedule?: Record<string, unknown> | null
  timezone?: string | null
  enabled?: boolean | null
  params?: Record<string, unknown> | null
  description?: string | null
}

const TASK_FIELDS = `
  id
  key
  name
  jobType
  cron
  schedule
  timezone
  enabled
  params
  description
  lastRunAt
  nextRunAt
  lastStatus
  lastError
  createdAt
  updatedAt
`

const RUN_FIELDS = `
  id
  taskId
  status
  trigger
  payload
  result
  error
  startedAt
  finishedAt
  createdAt
`

const LIST_TASKS = /* GraphQL */ `
  query ScheduledTasks {
    scheduledTasks {
      ${TASK_FIELDS}
    }
  }
`

const LIST_RUNS = /* GraphQL */ `
  query ScheduledTaskRuns($taskId: ID!, $limit: Int) {
    scheduledTaskRuns(taskId: $taskId, limit: $limit) {
      ${RUN_FIELDS}
    }
  }
`

const UPSERT_TASK = /* GraphQL */ `
  mutation UpsertScheduledTask($input: UpsertScheduledTaskInput!) {
    upsertScheduledTask(input: $input) {
      ${TASK_FIELDS}
    }
  }
`

const DELETE_TASK = /* GraphQL */ `
  mutation DeleteScheduledTask($id: ID!) {
    deleteScheduledTask(id: $id)
  }
`

const RUN_TASK = /* GraphQL */ `
  mutation RunScheduledTask($id: ID!) {
    runScheduledTask(id: $id) {
      ${RUN_FIELDS}
    }
  }
`

const GENERATE_SLOTS = /* GraphQL */ `
  mutation GenerateScheduleSlots(
    $rangeStart: String!
    $rangeEnd: String!
    $providerIds: [ID!]
    $facilityIds: [ID!]
  ) {
    generateScheduleSlots(
      rangeStart: $rangeStart
      rangeEnd: $rangeEnd
      providerIds: $providerIds
      facilityIds: $facilityIds
    ) {
      templatesProcessed
      created
      skipped
    }
  }
`

export async function fetchScheduledTasks(): Promise<GraphQlScheduledTask[]> {
  const data = await graphqlRequest<{ scheduledTasks: GraphQlScheduledTask[] }>(LIST_TASKS)
  return data.scheduledTasks ?? []
}

export async function fetchScheduledTaskRuns(
  taskId: string,
  limit = 20,
): Promise<GraphQlScheduledTaskRun[]> {
  const data = await graphqlRequest<{ scheduledTaskRuns: GraphQlScheduledTaskRun[] }>(
    LIST_RUNS,
    { taskId, limit },
  )
  return data.scheduledTaskRuns ?? []
}

export async function upsertScheduledTask(
  input: UpsertScheduledTaskInput,
): Promise<GraphQlScheduledTask> {
  const data = await graphqlRequest<{ upsertScheduledTask: GraphQlScheduledTask }>(
    UPSERT_TASK,
    { input },
  )
  return data.upsertScheduledTask
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteScheduledTask: boolean }>(DELETE_TASK, { id })
  return Boolean(data.deleteScheduledTask)
}

export async function runScheduledTask(id: string): Promise<GraphQlScheduledTaskRun> {
  const data = await graphqlRequest<{ runScheduledTask: GraphQlScheduledTaskRun }>(RUN_TASK, {
    id,
  })
  return data.runScheduledTask
}

export async function generateScheduleSlotsViaGraphQL(
  input: GenerateScheduleSlotsInput,
): Promise<GenerateScheduleSlotsResult> {
  const data = await graphqlRequest<{ generateScheduleSlots: GenerateScheduleSlotsResult }>(
    GENERATE_SLOTS,
    {
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      providerIds: input.providerIds ?? null,
      facilityIds: input.facilityIds ?? null,
    },
  )
  return data.generateScheduleSlots
}
