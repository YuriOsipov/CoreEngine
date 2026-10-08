<script lang="ts">
export default { name: 'TaskBoardView' }
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslation } from '@/core/translation'
import type { PmStatusDefinition, PmTaskRecord } from '@/interfaces/projects'

const props = defineProps<{
  tasks: PmTaskRecord[]
  statuses: PmStatusDefinition[]
}>()

const emit = defineEmits<{
  open: [task: PmTaskRecord]
  statusChange: [task: PmTaskRecord, status: string]
}>()

const { t } = useTranslation()

const columns = computed(() =>
  props.statuses.map((status) => ({
    ...status,
    tasks: props.tasks.filter((task) => (task.stage_status || 'todo') === status.key),
  })),
)

function onDragStart(event: DragEvent, task: PmTaskRecord): void {
  event.dataTransfer?.setData('text/task-id', task.id)
}

function onDrop(event: DragEvent, statusKey: string): void {
  event.preventDefault()
  const taskId = event.dataTransfer?.getData('text/task-id')
  if (!taskId) return
  const task = props.tasks.find((entry) => entry.id === taskId)
  if (!task || task.stage_status === statusKey) return
  emit('statusChange', task, statusKey)
}
</script>

<template>
  <div class="pm-board">
    <div
      v-for="column in columns"
      :key="column.key"
      class="pm-board-col"
      @dragover.prevent
      @drop="onDrop($event, column.key)"
    >
      <header class="pm-board-col__head">
        <span class="pm-dot" :style="{ background: column.color }" />
        <strong>{{ column.label }}</strong>
        <Tag :value="String(column.tasks.length)" rounded />
      </header>
      <div class="pm-board-col__body">
        <article
          v-for="task in column.tasks"
          :key="task.id"
          class="pm-card"
          draggable="true"
          @dragstart="onDragStart($event, task)"
          @click="emit('open', task)"
        >
          <div class="pm-card__title">
            <i v-if="task.is_milestone" class="pi pi-flag" />
            {{ task.name }}
          </div>
          <div class="pm-card__meta">
            <ProgressBar
              :value="Number(task.progress ?? 0)"
              :show-value="false"
              style="height: 0.35rem"
            />
          </div>
        </article>
        <p v-if="column.tasks.length === 0" class="pm-empty">
          {{ t('projects.emptyColumn', 'No stages') }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pm-board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(220px, 1fr);
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.5rem;
  min-height: 320px;
}
.pm-board-col {
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 10px;
  min-height: 280px;
  display: flex;
  flex-direction: column;
}
.pm-board-col__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
}
.pm-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
}
.pm-board-col__body {
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}
.pm-card {
  background: #fff;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 8px;
  padding: 0.65rem 0.7rem;
  cursor: grab;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
}
.pm-card__title {
  font-size: 0.9rem;
  font-weight: 600;
  display: flex;
  gap: 0.35rem;
  align-items: center;
}
.pm-card__meta {
  margin-top: 0.45rem;
}
.pm-empty {
  color: var(--p-text-muted-color, #6b7280);
  font-size: 0.85rem;
  margin: 0.5rem 0;
  text-align: center;
}
</style>
