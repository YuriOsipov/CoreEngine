<script lang="ts">
export default { name: 'ProjectWorkspacePage' }
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useTranslation } from '@/core/translation'
import type {
  PmProjectRecord,
  PmTaskRecord,
  PmWorkspaceView,
} from '@/interfaces/projects'
import { PM_DEFAULT_STATUSES } from '@/interfaces/projects'
import TaskListView from '../components/TaskListView.vue'
import TaskBoardView from '../components/TaskBoardView.vue'
import TaskGanttView from '../components/TaskGanttView.vue'
import TaskDetailDrawer from '../components/TaskDetailDrawer.vue'
import {
  createTask,
  getProject,
  listProjectTasks,
  listTaskItems,
  patientLabel,
  refreshProjectProgress,
  updateProject,
  updateTask,
} from '../services/pmProjectService'
import { canCompleteTask, daysBetween } from '../services/pmUtils'
import { projectRecordFormRoute } from '@/core/compactRecordRoutes'

const props = defineProps<{ projectId: string }>()

const { t } = useTranslation()
const toast = useToast()
const route = useRoute()
const router = useRouter()

function parseWorkspaceView(value: unknown): PmWorkspaceView | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === 'list' || raw === 'board' || raw === 'gantt') return raw
  return null
}

const project = ref<PmProjectRecord | null>(null)
const tasks = ref<PmTaskRecord[]>([])
const serviceCounts = ref<Record<string, number>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const view = ref<PmWorkspaceView>(parseWorkspaceView(route.query.view) ?? 'gantt')
const drawerVisible = ref(false)
const selectedTask = ref<PmTaskRecord | null>(null)
const addingTask = ref(false)

const statuses = computed(() => project.value?.statuses?.length
  ? project.value.statuses
  : PM_DEFAULT_STATUSES)

const viewOptions = computed(() => [
  { label: t('projects.viewList', 'List'), value: 'list' },
  { label: t('projects.viewBoard', 'Board'), value: 'board' },
  { label: t('projects.viewGantt', 'Gantt'), value: 'gantt' },
])

async function load(options?: { silent?: boolean }): Promise<void> {
  if (!options?.silent) loading.value = true
  error.value = null
  try {
    project.value = await getProject(props.projectId)
    tasks.value = await listProjectTasks(props.projectId)
    const counts: Record<string, number> = {}
    await Promise.all(
      tasks.value.map(async (task) => {
        const items = await listTaskItems(task.id)
        counts[task.id] = items.length
      }),
    )
    serviceCounts.value = counts
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('projects.loadError', 'Failed to load project.')
  } finally {
    if (!options?.silent) loading.value = false
  }
}

function openTask(task: PmTaskRecord): void {
  selectedTask.value = task
  drawerVisible.value = true
}

async function moveTask(payload: {
  task: PmTaskRecord
  dateStart: string
  dateEnd: string
}): Promise<void> {
  const durationDays = Math.max(1, daysBetween(payload.dateStart, payload.dateEnd))
  const offsetDays = project.value?.date_start
    ? daysBetween(project.value.date_start, payload.dateStart)
    : Number(payload.task.offset_days ?? 0)
  tasks.value = tasks.value.map((task) =>
    task.id === payload.task.id
      ? {
          ...task,
          date_start: payload.dateStart,
          date_end: payload.dateEnd,
          duration_days: durationDays,
          offset_days: offsetDays,
        }
      : task,
  )
  try {
    await updateTask(payload.task.id, {
      date_start: payload.dateStart,
      date_end: payload.dateEnd,
      duration_days: durationDays,
      offset_days: offsetDays,
    })
    const patch: Record<string, unknown> = {}
    if (
      !project.value?.date_start ||
      new Date(payload.dateStart).getTime() < new Date(project.value.date_start).getTime()
    ) {
      patch.date_start = payload.dateStart
    }
    if (
      !project.value?.date_end ||
      new Date(payload.dateEnd).getTime() > new Date(project.value.date_end).getTime()
    ) {
      patch.date_end = payload.dateEnd
    }
    if (Object.keys(patch).length) {
      await updateProject(props.projectId, patch)
    }
    await load({ silent: true })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('projects.saveError', 'Save failed.'),
      life: 5000,
    })
    await load({ silent: true })
  }
}

async function changeStatus(task: PmTaskRecord, status: string): Promise<void> {
  if (status === 'done') {
    const items = await listTaskItems(task.id)
    const gate = canCompleteTask({
      taskStatus: status,
      dependsOn: task.depends_on ?? [],
      tasksById: new Map(tasks.value.map((entry) => [entry.id, entry])),
      requiredItems: items,
    })
    if (!gate.ok) {
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail:
          gate.reason === 'required_services'
            ? t(
                'projects.requiredServicesBlock',
                'Deliver or cancel required services before completing this stage.',
              )
            : t(
                'projects.dependencyBlock',
                'Finish predecessor stages before completing this stage.',
              ),
        life: 5000,
      })
      return
    }
  }

  try {
    await updateTask(task.id, {
      stage_status: status,
      progress: status === 'done' || status === 'skipped' ? 100 : task.progress,
    })
    await refreshProjectProgress(props.projectId)
    await load()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: err instanceof Error ? err.message : t('projects.saveError', 'Save failed.'),
      life: 5000,
    })
  }
}

async function addTask(): Promise<void> {
  addingTask.value = true
  try {
    const created = await createTask({
      project: props.projectId,
      name: t('projects.newTask', 'New stage'),
      stage_status: 'todo',
      sort: tasks.value.length,
      offset_days: 0,
      duration_days: 1,
      is_custom: true,
    })
    await load()
    openTask(created)
  } finally {
    addingTask.value = false
  }
}

async function setLifecycle(value: string): Promise<void> {
  await updateProject(props.projectId, { lifecycle: value })
  await load()
}

watch(
  () => props.projectId,
  () => {
    void load()
  },
)

watch(
  () => route.query.view,
  (value) => {
    const next = parseWorkspaceView(value)
    if (next && next !== view.value) view.value = next
  },
)

watch(view, (value) => {
  if (parseWorkspaceView(route.query.view) === value) return
  void router.replace({ query: { ...route.query, view: value } })
})

onMounted(() => {
  void load()
})
</script>

<template>
  <main class="app-shell pm-page">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <Button
            :label="t('projects.back', 'All projects')"
            link
            icon="pi pi-arrow-left"
            @click="router.push({ name: 'projects' })"
          />
          <h1>{{ project?.name || t('projects.project', 'Project') }}</h1>
          <p class="pm-subtitle">
            {{ patientLabel(project || { id: '', name: '' }) }}
            · {{ Math.round(project?.progress ?? 0) }}%
            · {{ t('projects.basePrice', 'Base price') }} {{ Number(project?.base_price ?? 0).toLocaleString() }}
            · {{ t('projects.pmCost', 'PM cost') }} {{ Number(project?.pm_cost ?? 0).toLocaleString() }}
          </p>
        </div>
        <div class="pm-actions">
          <Select
            v-if="project"
            :model-value="project.lifecycle"
            :options="[
              { label: 'Planned', value: 'planned' },
              { label: 'Active', value: 'active' },
              { label: 'On hold', value: 'on_hold' },
              { label: 'Done', value: 'done' },
              { label: 'Cancelled', value: 'cancelled' },
            ]"
            option-label="label"
            option-value="value"
            @update:model-value="setLifecycle"
          />
          <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" />
          <Button
            :label="t('projects.recordDetails', 'Details')"
            icon="pi pi-id-card"
            severity="secondary"
            outlined
            @click="router.push(projectRecordFormRoute(props.projectId))"
          />
          <Button
            :label="t('projects.addTask', 'Add stage')"
            icon="pi pi-plus"
            :loading="addingTask"
            @click="addTask"
          />
        </div>
      </div>
    </header>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <div v-if="loading" class="pm-center"><ProgressSpinner /></div>

    <template v-else>
      <TaskListView
        v-if="view === 'list'"
        :tasks="tasks"
        :statuses="statuses"
        :service-counts="serviceCounts"
        @open="openTask"
        @status-change="changeStatus"
      />
      <TaskBoardView
        v-else-if="view === 'board'"
        :tasks="tasks"
        :statuses="statuses"
        @open="openTask"
        @status-change="changeStatus"
      />
      <TaskGanttView
        v-else
        :tasks="tasks"
        :statuses="statuses"
        :range-start="project?.date_start"
        :range-end="project?.date_end"
        @open="openTask"
        @move="moveTask"
      />
    </template>

    <TaskDetailDrawer
      v-model:visible="drawerVisible"
      :task="selectedTask"
      :statuses="statuses"
      :all-tasks="tasks"
      @updated="load"
    />
  </main>
</template>

<style scoped>
.pm-page {
  padding: 1rem 1.25rem 2rem;
}
.pm-subtitle {
  margin: 0.25rem 0 0;
  color: var(--p-text-muted-color, #6b7280);
}
.pm-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}
.pm-center {
  display: flex;
  justify-content: center;
  padding: 2rem;
}
</style>
