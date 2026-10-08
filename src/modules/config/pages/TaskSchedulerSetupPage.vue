<script lang="ts">
export default {
  name: 'TaskSchedulerSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { featureFlags } from '@/core/graphql/featureFlags'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'
import {
  deleteScheduledTask,
  fetchScheduledTaskRuns,
  fetchScheduledTasks,
  runScheduledTask,
  upsertScheduledTask,
  type GraphQlScheduledTask,
  type GraphQlScheduledTaskRun,
} from '@/core/graphql/tasksApi'
import {
  defaultScheduleRule,
  parseScheduleSpec,
  type ScheduleInterval,
  type ScheduleRule,
} from '@/core/taskSchedule'
import { useTranslation } from '@/core/translation'

const { t } = useTranslation()

function hintTooltip(value: string) {
  return { value, class: 'setup-task-hint-tooltip' }
}
const confirm = useConfirm()
const toast = useToast()

const graphqlEnabled = featureFlags.schemaFromGraphQL
const loading = ref(false)
const saving = ref(false)
const runningId = ref<string | null>(null)
const isAdmin = ref(false)
const tasks = ref<GraphQlScheduledTask[]>([])
const searchQuery = ref('')
const dialogVisible = ref(false)
const historyVisible = ref(false)
const historyTask = ref<GraphQlScheduledTask | null>(null)
const historyRuns = ref<GraphQlScheduledTaskRun[]>([])
const historyLoading = ref(false)
const resultVisible = ref(false)
const resultRun = ref<GraphQlScheduledTaskRun | null>(null)
const editingId = ref<string | null>(null)
const paramsError = ref<string | null>(null)

const JOB_TYPES = [
  {
    id: 'generate_slots',
    params: { range: 'next_month' },
  },
  {
    id: 'verify_database',
    params: {},
  },
  {
    id: 'send_notification',
    params: { flowKey: 'notify', payload: {} },
  },
  {
    id: 'maintain_recent_views',
    params: { retentionDays: 90, maxPerUserCollection: 200 },
  },
] as const

const form = reactive({
  name: '',
  jobType: 'generate_slots',
  timezone: 'UTC',
  enabled: false,
  description: '',
  paramsText: '{\n  "range": "next_month"\n}',
  rules: [defaultScheduleRule()] as ScheduleRule[],
})

const jobTypeOptions = computed(() =>
  JOB_TYPES.map((entry) => ({
    label: jobTypeLabel(entry.id),
    value: entry.id,
  })),
)

const filteredTasks = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return tasks.value
  return tasks.value.filter((task) => {
    return (
      task.name.toLowerCase().includes(query) ||
      task.key.toLowerCase().includes(query) ||
      task.jobType.toLowerCase().includes(query) ||
      scheduleLabel(task).toLowerCase().includes(query)
    )
  })
})

const intervalOptions = computed(() => [
  { label: t('setup.tasks.intervalMinutes', 'Minutes'), value: 'minutes' },
  { label: t('setup.tasks.intervalHours', 'Hours'), value: 'hours' },
  { label: t('setup.tasks.intervalDays', 'Days'), value: 'days' },
  { label: t('setup.tasks.intervalWeeks', 'Weeks'), value: 'weeks' },
  { label: t('setup.tasks.intervalMonths', 'Months'), value: 'months' },
  { label: t('setup.tasks.intervalCron', 'Custom (Cron)'), value: 'cron' },
])

const hourOptions = computed(() =>
  Array.from({ length: 24 }, (_, hour) => ({
    label: hourLabel(hour),
    value: hour,
  })),
)

const weekdayOptions = computed(() => [
  { label: t('setup.tasks.weekdayMon', 'Monday'), value: 1 },
  { label: t('setup.tasks.weekdayTue', 'Tuesday'), value: 2 },
  { label: t('setup.tasks.weekdayWed', 'Wednesday'), value: 3 },
  { label: t('setup.tasks.weekdayThu', 'Thursday'), value: 4 },
  { label: t('setup.tasks.weekdayFri', 'Friday'), value: 5 },
  { label: t('setup.tasks.weekdaySat', 'Saturday'), value: 6 },
  { label: t('setup.tasks.weekdaySun', 'Sunday'), value: 0 },
])

function hourLabel(hour: number): string {
  if (hour === 0) return t('setup.tasks.midnight', 'Midnight')
  if (hour === 12) return t('setup.tasks.noon', 'Noon')
  if (hour < 12) return t('setup.tasks.hourAm', '{hour}am', { hour })
  return t('setup.tasks.hourPm', '{hour}pm', { hour: hour - 12 })
}

function clockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function weekdayNames(weekdays: number[]): string {
  const labels = weekdayOptions.value
  return weekdays
    .map((value) => labels.find((entry) => entry.value === value)?.label ?? String(value))
    .join(', ')
}

function ruleLabel(rule: ScheduleRule): string {
  if (rule.interval === 'minutes') {
    return t('setup.tasks.summaryMinutes', 'Every {every} min', { every: rule.every })
  }
  if (rule.interval === 'hours') {
    return t('setup.tasks.summaryHours', 'Every {every} h at :{minute}', {
      every: rule.every,
      minute: String(rule.minute).padStart(2, '0'),
    })
  }
  if (rule.interval === 'days') {
    return t('setup.tasks.summaryDays', 'Every {every} day(s) at {time}', {
      every: rule.every,
      time: clockTime(rule.hour, rule.minute),
    })
  }
  if (rule.interval === 'weeks') {
    return t('setup.tasks.summaryWeeks', '{days} at {time}', {
      days: weekdayNames(rule.weekdays),
      time: clockTime(rule.hour, rule.minute),
    })
  }
  if (rule.interval === 'months') {
    return t('setup.tasks.summaryMonths', 'Day {day} every {every} month(s) at {time}', {
      day: rule.dayOfMonth,
      every: rule.every,
      time: clockTime(rule.hour, rule.minute),
    })
  }
  return t('setup.tasks.summaryCron', '{cron}', { cron: rule.cron || 'cron' })
}

function scheduleLabel(task: GraphQlScheduledTask): string {
  const spec = parseScheduleSpec(task.schedule, task.cron)
  return spec.rules.map((rule) => ruleLabel(rule)).join(' · ')
}

function everyBounds(interval: ScheduleInterval): { min: number; max: number } {
  if (interval === 'minutes') return { min: 1, max: 59 }
  if (interval === 'hours') return { min: 1, max: 23 }
  if (interval === 'days') return { min: 1, max: 31 }
  if (interval === 'months') return { min: 1, max: 12 }
  return { min: 1, max: 1 }
}

function addRule(): void {
  form.rules.push(defaultScheduleRule())
}

function removeRule(index: number): void {
  if (form.rules.length <= 1) return
  form.rules.splice(index, 1)
}

function jobTypeLabel(jobType: string): string {
  if (jobType === 'generate_slots') {
    return t('setup.tasks.jobGenerateSlots', 'Generate slots')
  }
  if (jobType === 'verify_database') {
    return t('setup.tasks.jobVerifyDatabase', 'Database verification')
  }
  if (jobType === 'send_notification') {
    return t('setup.tasks.jobSendNotification', 'Send notification')
  }
  if (jobType === 'maintain_recent_views') {
    return t('setup.tasks.jobMaintainRecentViews', 'Maintain recently viewed')
  }
  return jobType
}

function statusSeverity(status: string | null): 'success' | 'danger' | 'info' | 'secondary' {
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'RUNNING') return 'info'
  return 'secondary'
}

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return formatLocalizedDateTime(value) || value
}

function defaultParamsText(jobType: string): string {
  const found = JOB_TYPES.find((entry) => entry.id === jobType)
  return JSON.stringify(found?.params ?? {}, null, 2)
}

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: err instanceof Error ? err.message : String(err),
    life: 6000,
  })
}

async function load(): Promise<void> {
  if (!graphqlEnabled) return
  loading.value = true
  try {
    const me = await readCurrentUserBridge()
    isAdmin.value = Boolean(me.adminAccess || me.roleAdminAccess)
    if (!isAdmin.value) {
      tasks.value = []
      return
    }
    tasks.value = await fetchScheduledTasks()
  } catch (err) {
    showError(err, t('setup.tasks.loadError', 'Failed to load tasks'))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.jobType = 'generate_slots'
  form.timezone = 'UTC'
  form.enabled = false
  form.description = ''
  form.paramsText = defaultParamsText('generate_slots')
  form.rules = [defaultScheduleRule()]
  paramsError.value = null
  dialogVisible.value = true
}

function openEdit(task: GraphQlScheduledTask): void {
  editingId.value = task.id
  form.name = task.name
  form.jobType = task.jobType
  form.timezone = task.timezone || 'UTC'
  form.enabled = task.enabled
  form.description = task.description || ''
  form.paramsText = JSON.stringify(task.params ?? {}, null, 2)
  form.rules = parseScheduleSpec(task.schedule, task.cron).rules
  paramsError.value = null
  dialogVisible.value = true
}

function onJobTypeChange(jobType: string): void {
  form.paramsText = defaultParamsText(jobType)
}

function parseParams(): Record<string, unknown> {
  const raw = form.paramsText.trim() || '{}'
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(t('setup.tasks.paramsObject', 'Params must be a JSON object.'))
  }
  return parsed as Record<string, unknown>
}

async function save(): Promise<void> {
  paramsError.value = null
  let params: Record<string, unknown>
  try {
    params = parseParams()
  } catch (err) {
    paramsError.value =
      err instanceof Error
        ? err.message
        : t('setup.tasks.paramsInvalid', 'Params JSON is invalid.')
    return
  }
  if (!form.name.trim()) return
  saving.value = true
  try {
    await upsertScheduledTask({
      id: editingId.value,
      name: form.name.trim(),
      jobType: form.jobType,
      schedule: { rules: form.rules },
      timezone: form.timezone.trim() || 'UTC',
      enabled: form.enabled,
      params,
      description: form.description.trim() || null,
    })
    dialogVisible.value = false
    toast.add({
      severity: 'success',
      summary: t('setup.tasks.saved', 'Task saved'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.tasks.saveError', 'Failed to save task'))
  } finally {
    saving.value = false
  }
}

async function runNow(task: GraphQlScheduledTask): Promise<void> {
  runningId.value = task.id
  try {
    const run = await runScheduledTask(task.id)
    toast.add({
      severity: run.status === 'SUCCEEDED' ? 'success' : 'warn',
      summary:
        run.status === 'SUCCEEDED'
          ? t('setup.tasks.runSucceeded', 'Task finished')
          : t('setup.tasks.runFailed', 'Task failed'),
      detail: run.error || run.status,
      life: 5000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.tasks.runError', 'Failed to run task'))
  } finally {
    runningId.value = null
  }
}

function confirmDelete(task: GraphQlScheduledTask): void {
  confirm.require({
    header: t('setup.tasks.deleteHeader', 'Delete task'),
    message: t('setup.tasks.deleteMessage', 'Delete task "{name}"?', {
      name: task.name,
    }),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.delete', 'Delete'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void remove(task)
    },
  })
}

async function remove(task: GraphQlScheduledTask): Promise<void> {
  try {
    await deleteScheduledTask(task.id)
    toast.add({
      severity: 'success',
      summary: t('setup.tasks.deleted', 'Task deleted'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.tasks.deleteError', 'Failed to delete task'))
  }
}

async function openHistory(task: GraphQlScheduledTask): Promise<void> {
  historyTask.value = task
  historyVisible.value = true
  historyLoading.value = true
  try {
    historyRuns.value = await fetchScheduledTaskRuns(task.id, 30)
  } catch (err) {
    showError(err, t('setup.tasks.historyError', 'Failed to load run history'))
    historyRuns.value = []
  } finally {
    historyLoading.value = false
  }
}

function resultText(run: GraphQlScheduledTaskRun): string {
  if (run.error) return run.error
  if (!run.result) return ''
  try {
    return JSON.stringify(run.result, null, 2)
  } catch {
    return String(run.result)
  }
}

function hasResult(run: GraphQlScheduledTaskRun): boolean {
  return Boolean(run.error || run.result)
}

function openResult(run: GraphQlScheduledTaskRun): void {
  resultRun.value = run
  resultVisible.value = true
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-tab-content">
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.tasks.title', 'Tasks') }}</h2>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.tasks.subtitle',
              'Schedule background jobs: slot generation, database verification, and notifications.',
            )
          }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
          />
        </IconField>
        <Button
          :label="t('setup.tasks.new', 'New task')"
          icon="pi pi-plus"
          :disabled="!isAdmin || !graphqlEnabled"
          @click="openCreate"
        />
      </div>
    </div>

    <Message
      v-if="!graphqlEnabled"
      severity="warn"
      :closable="false"
    >
      {{
        t(
          'setup.tasks.graphqlRequired',
          'Set VITE_DATA_SOURCE=graphql to manage scheduled tasks.',
        )
      }}
    </Message>

    <Message
      v-else-if="!loading && !isAdmin"
      severity="warn"
      :closable="false"
    >
      {{ t('setup.access.adminRequired', 'Admin access is required.') }}
    </Message>

    <div
      v-else-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.tasks.loading', 'Loading tasks...') }}</span>
    </div>

    <DataTable
      v-else-if="isAdmin"
      :value="filteredTasks"
      striped-rows
      data-key="id"
      :empty-message="t('setup.tasks.empty', 'No scheduled tasks yet.')"
    >
      <Column
        field="name"
        :header="t('setup.tasks.columnName', 'Name')"
        sortable
      >
        <template #body="{ data }">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ data.name }}</span>
            <span class="text-muted-color text-[0.8rem]">{{ jobTypeLabel(data.jobType) }}</span>
          </div>
        </template>
      </Column>
      <Column
        field="cron"
        :header="t('setup.tasks.columnSchedule', 'Schedule')"
        style="width: 12rem"
      >
        <template #body="{ data }">
          <div class="flex flex-col gap-1">
            <span class="text-muted-color text-[0.8rem]">{{ scheduleLabel(data) }}</span>
            <span class="text-muted-color text-[0.8rem]">{{ data.timezone }}</span>
          </div>
        </template>
      </Column>
      <Column
        field="enabled"
        :header="t('setup.tasks.columnEnabled', 'Enabled')"
        style="width: 7rem"
      >
        <template #body="{ data }">
          <Tag
            :severity="data.enabled ? 'success' : 'secondary'"
            :value="data.enabled ? t('setup.tasks.on', 'On') : t('setup.tasks.off', 'Off')"
          />
        </template>
      </Column>
      <Column
        field="lastStatus"
        :header="t('setup.tasks.columnLastRun', 'Last run')"
        style="width: 14rem"
      >
        <template #body="{ data }">
          <div class="flex flex-col gap-1">
            <Tag
              v-if="data.lastStatus"
              :severity="statusSeverity(data.lastStatus)"
              :value="data.lastStatus"
            />
            <span class="text-muted-color text-[0.8rem]">{{ formatWhen(data.lastRunAt) }}</span>
            <span
              v-if="data.lastError"
              class="text-red-500 text-[0.75rem]"
            >
              {{ data.lastError }}
            </span>
          </div>
        </template>
      </Column>
      <Column
        field="nextRunAt"
        :header="t('setup.tasks.columnNextRun', 'Next run')"
        style="width: 11rem"
      >
        <template #body="{ data }">
          {{ data.enabled ? formatWhen(data.nextRunAt) : '—' }}
        </template>
      </Column>
      <Column
        :header="t('setup.columnActions', 'Actions')"
        style="width: 14rem"
      >
        <template #body="{ data }">
          <div class="flex flex-wrap gap-1">
            <Button
              :label="t('setup.tasks.runNow', 'Run now')"
              icon="pi pi-play"
              size="small"
              :loading="runningId === data.id"
              :disabled="runningId !== null"
              @click="runNow(data)"
            />
            <Button
              icon="pi pi-history"
              severity="secondary"
              text
              rounded
              :aria-label="t('setup.tasks.history', 'History')"
              @click="openHistory(data)"
            />
            <Button
              icon="pi pi-pencil"
              severity="secondary"
              text
              rounded
              :aria-label="t('common.edit', 'Edit')"
              @click="openEdit(data)"
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              :aria-label="t('common.delete', 'Delete')"
              @click="confirmDelete(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="
        editingId
          ? t('setup.tasks.edit', 'Edit task')
          : t('setup.tasks.new', 'New task')
      "
      class="setup-task-editor-dialog"
      :style="{ width: 'min(640px, 95vw)' }"
    >
      <div class="setup-task-editor">
        <section class="setup-task-panel">
          <label class="setup-task-field" for="task-name">
            {{ t('setup.tasks.columnName', 'Name') }}
            <InputText
              id="task-name"
              v-model="form.name"
              fluid
            />
          </label>
          <label class="setup-task-field" for="task-type">
            {{ t('setup.tasks.jobType', 'Job type') }}
            <Select
              id="task-type"
              v-model="form.jobType"
              :options="jobTypeOptions"
              option-label="label"
              option-value="value"
              fluid
              @update:model-value="onJobTypeChange"
            />
          </label>
        </section>

        <section class="setup-task-panel">
          <div class="setup-task-panel__heading">
            <h3 class="setup-task-panel__title m-0">
              {{ t('setup.tasks.triggerRules', 'Trigger rules') }}
            </h3>
            <Button
              :label="t('setup.tasks.addRule', 'Add rule')"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              text
              class="ml-auto"
              @click="addRule"
            />
          </div>
          <div
            v-for="(rule, index) in form.rules"
            :key="index"
            class="setup-task-rule"
          >
            <div class="setup-task-panel__heading">
              <label class="setup-task-field flex-1 min-w-0 m-0">
                {{ t('setup.tasks.interval', 'Trigger interval') }}
                <Select
                  v-model="rule.interval"
                  :options="intervalOptions"
                  option-label="label"
                  option-value="value"
                  fluid
                />
              </label>
              <Button
                v-if="form.rules.length > 1"
                icon="pi pi-times"
                severity="secondary"
                text
                rounded
                class="setup-task-rule__remove"
                :aria-label="t('setup.tasks.removeRule', 'Remove rule')"
                @click="removeRule(index)"
              />
            </div>
            <label
              v-if="rule.interval === 'minutes' || rule.interval === 'hours' || rule.interval === 'days' || rule.interval === 'months'"
              class="setup-task-field"
            >
              <span class="setup-task-field__label">
                {{
                  rule.interval === 'minutes'
                    ? t('setup.tasks.everyMinutes', 'Minutes between triggers')
                    : rule.interval === 'hours'
                      ? t('setup.tasks.everyHours', 'Hours between triggers')
                      : rule.interval === 'days'
                        ? t('setup.tasks.everyDays', 'Days between triggers')
                        : t('setup.tasks.everyMonths', 'Months between triggers')
                }}
                <button
                  type="button"
                  class="setup-task-hint"
                  :aria-label="t('common.hint', 'Hint')"
                  v-tooltip.bottom="hintTooltip(
                    rule.interval === 'minutes'
                      ? t('setup.tasks.rangeMinutes', 'Must be in range 1-59')
                      : rule.interval === 'hours'
                        ? t('setup.tasks.rangeHours', 'Must be in range 1-23')
                        : rule.interval === 'days'
                          ? t('setup.tasks.rangeDays', 'Must be in range 1-31')
                          : t('setup.tasks.rangeMonths', 'Must be in range 1-12'),
                  )"
                />
              </span>
              <InputNumber
                v-model="rule.every"
                :min="everyBounds(rule.interval).min"
                :max="everyBounds(rule.interval).max"
                show-buttons
                fluid
              />
            </label>
            <label
              v-if="rule.interval === 'weeks'"
              class="setup-task-field"
            >
              {{ t('setup.tasks.daysOfWeek', 'Days of the week') }}
              <MultiSelect
                v-model="rule.weekdays"
                :options="weekdayOptions"
                option-label="label"
                option-value="value"
                display="chip"
                fluid
              />
            </label>
            <label
              v-if="rule.interval === 'months'"
              class="setup-task-field"
            >
              {{ t('setup.tasks.dayOfMonth', 'Day of month') }}
              <InputNumber
                v-model="rule.dayOfMonth"
                :min="1"
                :max="31"
                show-buttons
                fluid
              />
            </label>
            <div
              v-if="rule.interval === 'days' || rule.interval === 'weeks' || rule.interval === 'months'"
              class="setup-task-panel__grid"
            >
              <label class="setup-task-field">
                {{ t('setup.tasks.triggerAtHour', 'Trigger at hour') }}
                <Select
                  v-model="rule.hour"
                  :options="hourOptions"
                  option-label="label"
                  option-value="value"
                  fluid
                />
              </label>
              <label
                v-if="rule.interval !== 'minutes' && rule.interval !== 'cron'"
                class="setup-task-field"
              >
                {{ t('setup.tasks.triggerAtMinute', 'Trigger at minute') }}
                <InputNumber
                  v-model="rule.minute"
                  :min="0"
                  :max="59"
                  show-buttons
                  fluid
                />
              </label>
            </div>
            <label
              v-else-if="rule.interval !== 'minutes' && rule.interval !== 'cron'"
              class="setup-task-field"
            >
              {{ t('setup.tasks.triggerAtMinute', 'Trigger at minute') }}
              <InputNumber
                v-model="rule.minute"
                :min="0"
                :max="59"
                show-buttons
                fluid
              />
            </label>
            <label
              v-if="rule.interval === 'cron'"
              class="setup-task-field"
            >
              <span class="setup-task-field__label">
                {{ t('setup.tasks.cron', 'Cron') }}
                <button
                  type="button"
                  class="setup-task-hint"
                  :aria-label="t('common.hint', 'Hint')"
                  v-tooltip.bottom="hintTooltip(t(
                    'setup.tasks.cronHint',
                    'minute hour day month weekday. Example: 0 2 * * *',
                  ))"
                />
              </span>
              <InputText
                v-model="rule.cron"
                fluid
              />
            </label>
          </div>
        </section>

        <section class="setup-task-panel">
          <label class="setup-task-field" for="task-tz">
            {{ t('setup.tasks.timezone', 'Timezone') }}
            <InputText
              id="task-tz"
              v-model="form.timezone"
              fluid
            />
          </label>
          <label class="setup-task-check">
            <ToggleSwitch
              v-model="form.enabled"
              input-id="task-enabled"
            />
            <span>{{ t('setup.tasks.enabled', 'Enabled') }}</span>
          </label>
          <label class="setup-task-field" for="task-desc">
            {{ t('setup.tasks.description', 'Description') }}
            <Textarea
              id="task-desc"
              v-model="form.description"
              rows="2"
              auto-resize
              fluid
            />
          </label>
        </section>

        <section class="setup-task-panel">
          <label class="setup-task-field" for="task-params">
            <span class="setup-task-field__label">
              {{ t('setup.tasks.params', 'Params (JSON)') }}
              <button
                type="button"
                class="setup-task-hint"
                :aria-label="t('common.hint', 'Hint')"
                v-tooltip.bottom="hintTooltip(t(
                  'setup.tasks.paramsHint',
                  'generate_slots: { \"range\": \"next_month\" }. verify_database: { \"entity\": \"optional\" }. send_notification: { \"flowKey\": \"notify\" }. maintain_recent_views: { \"retentionDays\": 90, \"maxPerUserCollection\": 200 }.',
                ))"
              />
            </span>
            <Textarea
              id="task-params"
              v-model="form.paramsText"
              rows="6"
              class="font-mono text-sm"
              fluid
            />
          </label>
          <Message
            v-if="paramsError"
            severity="error"
            :closable="false"
          >
            {{ paramsError }}
          </Message>
        </section>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          severity="secondary"
          text
          :disabled="saving"
          @click="dialogVisible = false"
        />
        <Button
          :label="t('common.save', 'Save')"
          :loading="saving"
          :disabled="!form.name.trim()"
          @click="save"
        />
      </template>
    </Dialog>
    <Dialog
      v-model:visible="historyVisible"
      modal
      :header="
        t('setup.tasks.historyTitle', 'Run history — {name}', {
          name: historyTask?.name || '',
        })
      "
      :style="{ width: 'min(720px, 95vw)' }"
    >
      <div
        v-if="historyLoading"
        class="page-loading"
      >
        <ProgressSpinner stroke-width="4" />
      </div>
      <DataTable
        v-else
        :value="historyRuns"
        striped-rows
        data-key="id"
        :empty-message="t('setup.tasks.historyEmpty', 'No runs yet.')"
      >
        <Column
          field="startedAt"
          :header="t('setup.tasks.columnStarted', 'Started')"
        >
          <template #body="{ data }">
            {{ formatWhen(data.startedAt) }}
          </template>
        </Column>
        <Column
          field="trigger"
          :header="t('setup.tasks.columnTrigger', 'Trigger')"
          style="width: 7rem"
        />
        <Column
          field="status"
          :header="t('setup.tasks.columnStatus', 'Status')"
          style="width: 8rem"
        >
          <template #body="{ data }">
            <Tag
              :severity="statusSeverity(data.status)"
              :value="data.status"
            />
          </template>
        </Column>
        <Column
          :header="t('setup.tasks.columnResult', 'Result')"
          style="width: 8rem"
        >
          <template #body="{ data }">
            <Button
              v-if="hasResult(data)"
              :label="t('setup.tasks.viewResult', 'View')"
              icon="pi pi-eye"
              size="small"
              severity="secondary"
              outlined
              @click="openResult(data)"
            />
            <span v-else class="text-muted-color">—</span>
          </template>
        </Column>
      </DataTable>
    </Dialog>

    <Dialog
      v-model:visible="resultVisible"
      modal
      :header="t('setup.tasks.resultTitle', 'Run result')"
      :style="{ width: 'min(640px, 95vw)' }"
    >
      <pre class="bg-surface-100 rounded-md text-[0.8rem] m-0 max-h-[24rem] overflow-auto p-3 whitespace-pre-wrap break-all">{{
        resultRun ? resultText(resultRun) : ''
      }}</pre>
    </Dialog>
  </section>
</template>

<style scoped>
.setup-task-editor {
  --task-wash: #edf3f4;
  --task-ink: #37352f;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-family: Inter, system-ui, sans-serif;
  color: var(--task-ink);
}

.setup-task-panel {
  width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 0.55rem;
  border-radius: 8px;
  background: var(--task-wash);
  padding: 0.55rem 0.5rem 0.65rem;
}

.setup-task-panel__heading {
  display: flex;
  align-items: flex-end;
  gap: 0.4rem;
  min-width: 0;
}

.setup-task-panel__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.setup-task-panel__grid {
  display: grid;
  gap: 0.5rem 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.setup-task-field {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.setup-task-field__label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.setup-task-check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.7);
  cursor: pointer;
}

.setup-task-rule {
  display: grid;
  gap: 0.5rem;
  padding: 0.45rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.65);
}

.setup-task-rule__remove {
  width: 1.75rem;
  height: 1.75rem;
  margin-bottom: 0.15rem;
}

.setup-task-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.setup-task-hint:focus-visible {
  outline: 2px solid rgba(55, 53, 47, 0.35);
  outline-offset: 2px;
}

.setup-task-hint::before {
  content: 'i';
}
</style>

<style>
.setup-task-editor-dialog .p-dialog-header {
  padding: 0.55rem 0.75rem;
}

.setup-task-editor-dialog .p-dialog-content {
  padding: 0.35rem 0.65rem 0.65rem !important;
}

.setup-task-editor-dialog .p-dialog-footer {
  padding: 0.45rem 0.75rem 0.65rem;
}

.setup-task-hint-tooltip,
.setup-task-hint-tooltip .p-tooltip-text {
  max-width: 20rem;
  font-size: 0.75rem;
  line-height: 1.35;
}
</style>
