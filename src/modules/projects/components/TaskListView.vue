<script lang="ts">
export default { name: 'TaskListView' }
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslation } from '@/core/translation'
import type { PmStatusDefinition, PmTaskRecord } from '@/interfaces/projects'
import { relationId } from '../services/pmUtils'

const props = defineProps<{
  tasks: PmTaskRecord[]
  statuses: PmStatusDefinition[]
  serviceCounts?: Record<string, number>
}>()

const emit = defineEmits<{
  open: [task: PmTaskRecord]
  statusChange: [task: PmTaskRecord, status: string]
}>()

const { t } = useTranslation()

const statusColor = computed(() => {
  const map = new Map(props.statuses.map((status) => [status.key, status.color]))
  return (key: string | null | undefined) => map.get(key || 'todo') || '#64748b'
})

const statusLabel = computed(() => {
  const map = new Map(props.statuses.map((status) => [status.key, status.label]))
  return (key: string | null | undefined) => map.get(key || 'todo') || key || '—'
})

const rows = computed(() => {
  const byParent = new Map<string | null, PmTaskRecord[]>()
  for (const task of props.tasks) {
    const parent = relationId(task.parent)
    const list = byParent.get(parent) ?? []
    list.push(task)
    byParent.set(parent, list)
  }
  const out: Array<PmTaskRecord & { depth: number }> = []
  const walk = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort(
      (a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0),
    )
    for (const child of children) {
      out.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  const seen = new Set(out.map((row) => row.id))
  for (const task of props.tasks) {
    if (!seen.has(task.id)) out.push({ ...task, depth: 0 })
  }
  return out
})

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}
</script>

<template>
  <DataTable :value="rows" data-key="id" size="small" class="pm-list-table" striped-rows>
    <Column :header="t('projects.taskName', 'Name')">
      <template #body="{ data }">
        <button
          type="button"
          class="pm-task-link"
          :style="{ paddingLeft: `${data.depth * 1.1}rem` }"
          @click="emit('open', data)"
        >
          <i v-if="data.is_milestone" class="pi pi-flag" />
          {{ data.name }}
        </button>
      </template>
    </Column>
    <Column :header="t('projects.taskStatus', 'Status')" style="width: 10rem">
      <template #body="{ data }">
        <Select
          :model-value="data.stage_status"
          :options="statuses"
          option-label="label"
          option-value="key"
          class="w-full"
          @update:model-value="(value) => emit('statusChange', data, String(value))"
        >
          <template #value="{ value }">
            <span class="pm-status-chip" :style="{ background: statusColor(value) }">
              {{ statusLabel(value) }}
            </span>
          </template>
        </Select>
      </template>
    </Column>
    <Column :header="t('projects.startDate', 'Start')" style="width: 7.5rem">
      <template #body="{ data }">{{ formatDate(data.date_start) }}</template>
    </Column>
    <Column :header="t('projects.endDate', 'End')" style="width: 7.5rem">
      <template #body="{ data }">{{ formatDate(data.date_end) }}</template>
    </Column>
    <Column :header="t('projects.progress', 'Progress')" style="width: 8rem">
      <template #body="{ data }">
        <ProgressBar :value="Number(data.progress ?? 0)" :show-value="false" style="height: 0.5rem" />
      </template>
    </Column>
    <Column :header="t('projects.basePrice', 'Base price')" style="width: 7rem">
      <template #body="{ data }">{{ Number(data.base_price ?? 0).toLocaleString() }}</template>
    </Column>
    <Column :header="t('projects.pmCost', 'PM cost')" style="width: 7rem">
      <template #body="{ data }">{{ Number(data.pm_cost ?? 0).toLocaleString() }}</template>
    </Column>
    <Column :header="t('projects.services', 'Services')" style="width: 6rem">
      <template #body="{ data }">
        {{ serviceCounts?.[data.id] ?? 0 }}
      </template>
    </Column>
  </DataTable>
</template>

<style scoped>
.pm-task-link {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
}
.pm-task-link:hover {
  color: var(--p-primary-color, #2563eb);
}
.pm-status-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  color: #fff;
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
}
</style>
