<script lang="ts">
export default { name: 'TaskDetailDrawer' }
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import type {
  PmStatusDefinition,
  PmTaskItemRecord,
  PmTaskRecord,
} from '@/interfaces/projects'
import {
  deleteTaskItem,
  listTaskItems,
  saveTaskItem,
  updateTask,
} from '../services/pmProjectService'
import { canCompleteTask, formatMoney, lineBaseTotal, relationLabel } from '../services/pmUtils'

const props = defineProps<{
  visible: boolean
  task: PmTaskRecord | null
  statuses: PmStatusDefinition[]
  allTasks: PmTaskRecord[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  updated: []
}>()

const { t } = useTranslation()
const toast = useToast()

const items = ref<PmTaskItemRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const name = ref('')
const description = ref('')
const taskStatus = ref('todo')
const progress = ref(0)
const dateStart = ref<Date | null>(null)
const dateEnd = ref<Date | null>(null)

const catalogItems = ref<Array<{ id: string; label: string }>>([])
const newItemId = ref<string | null>(null)
const newQty = ref(1)

const drawerVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const statusOptions = computed(() =>
  props.statuses.map((status) => ({
    label: status.label,
    value: status.key,
  })),
)

watch(
  () => [props.visible, props.task?.id] as const,
  async ([open]) => {
    if (!open || !props.task) return
    name.value = props.task.name
    description.value = props.task.description ?? ''
    taskStatus.value = props.task.stage_status ?? 'todo'
    progress.value = Number(props.task.progress ?? 0)
    dateStart.value = props.task.date_start ? new Date(props.task.date_start) : null
    dateEnd.value = props.task.date_end ? new Date(props.task.date_end) : null
    loading.value = true
    try {
      items.value = await listTaskItems(props.task.id)
      const rows = await bridgeReadItems('item', {
        fields: ['id', 'name'],
        sort: ['name'],
        limit: 300,
      })
      catalogItems.value = rows.map((row) => ({
        id: String(row.id),
        label: relationLabel(row, ['name']) || String(row.id),
      }))
    } finally {
      loading.value = false
    }
  },
)

async function saveTask(): Promise<void> {
  if (!props.task) return
  const tasksById = new Map(props.allTasks.map((task) => [task.id, task]))
  if (taskStatus.value === 'done') {
    const gate = canCompleteTask({
      taskStatus: taskStatus.value,
      dependsOn: props.task.depends_on ?? [],
      tasksById,
      requiredItems: items.value,
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

  saving.value = true
  try {
    await updateTask(props.task.id, {
      name: name.value,
      description: description.value || null,
      stage_status: taskStatus.value,
      progress: progress.value,
      pm_cost: Number(props.task.pm_cost ?? 0),
      date_start: dateStart.value?.toISOString() ?? null,
      date_end: dateEnd.value?.toISOString() ?? null,
    })
    emit('updated')
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('projects.taskSaved', 'Stage saved.'),
      life: 2500,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: error instanceof Error ? error.message : t('projects.saveError', 'Save failed.'),
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}

async function addService(): Promise<void> {
  if (!props.task || !newItemId.value) return
  const catalog = catalogItems.value.find((entry) => entry.id === newItemId.value)
  await saveTaskItem({
    stage: props.task.id,
    item: newItemId.value,
    name: catalog?.label ?? 'Service',
    quantity: newQty.value || 1,
    item_status: 'planned',
    is_required: false,
  })
  items.value = await listTaskItems(props.task.id)
  newItemId.value = null
  newQty.value = 1
  emit('updated')
}

async function markItemDelivered(item: PmTaskItemRecord): Promise<void> {
  await saveTaskItem({ item_status: 'delivered' }, item.id)
  if (props.task) items.value = await listTaskItems(props.task.id)
  emit('updated')
}

async function removeItem(item: PmTaskItemRecord): Promise<void> {
  await deleteTaskItem(item.id)
  if (props.task) items.value = await listTaskItems(props.task.id)
  emit('updated')
}
</script>

<template>
  <Drawer
    v-model:visible="drawerVisible"
    position="right"
    :header="t('projects.taskDetails', 'Stage details')"
    :style="{ width: 'min(420px, 100vw)' }"
  >
    <div v-if="!task" />
    <div v-else-if="loading" class="pm-center">
      <ProgressSpinner style="width: 2rem; height: 2rem" />
    </div>
    <div v-else class="pm-drawer">
      <label>{{ t('projects.taskName', 'Name') }}</label>
      <InputText v-model="name" class="w-full" />

      <label>{{ t('projects.description', 'Description') }}</label>
      <Textarea v-model="description" rows="3" class="w-full" auto-resize />

      <label>{{ t('projects.taskStatus', 'Status') }}</label>
      <Select
        v-model="taskStatus"
        :options="statusOptions"
        option-label="label"
        option-value="value"
        class="w-full"
      />

      <label>{{ t('projects.progress', 'Progress') }}%</label>
      <InputNumber v-model="progress" :min="0" :max="100" class="w-full" />

      <div class="pm-price-row">
        <div>
          <label>{{ t('projects.basePrice', 'Base price') }}</label>
          <div class="pm-readonly">{{ formatMoney(task.base_price) }}</div>
        </div>
        <div>
          <label>{{ t('projects.pmCost', 'PM cost') }}</label>
          <InputNumber
            :model-value="Number(task.pm_cost ?? 0)"
            class="w-full"
            @update:model-value="(value) => { if (task) task.pm_cost = Number(value ?? 0) }"
          />
        </div>
      </div>

      <div class="pm-dates">
        <div>
          <label>{{ t('projects.startDate', 'Start date') }}</label>
          <DatePicker v-model="dateStart" show-icon class="w-full" />
        </div>
        <div>
          <label>{{ t('projects.endDate', 'End date') }}</label>
          <DatePicker v-model="dateEnd" show-icon class="w-full" />
        </div>
      </div>

      <Button
        :label="t('common.save', 'Save')"
        class="w-full"
        :loading="saving"
        @click="saveTask"
      />

      <Divider />

      <h3>{{ t('projects.services', 'Services') }}</h3>
          <ul class="pm-service-list">
        <li v-for="item in items" :key="item.id">
          <div>
            <strong>{{ relationLabel(item.item, ['name']) || item.name || '—' }}</strong>
            <div class="pm-muted">
              qty {{ item.quantity ?? 1 }}
              · {{ t('projects.basePrice', 'Base price') }} {{ formatMoney(item.base_price) }}
              · {{ t('projects.lineTotal', 'Total') }} {{ formatMoney(item.total ?? lineBaseTotal(item.base_price, item.quantity)) }}
              · {{ item.item_status }}
              <Tag v-if="item.is_required" severity="danger" value="required" class="ml-1" />
            </div>
          </div>
          <div class="pm-service-actions">
            <Button
              v-if="item.item_status !== 'delivered'"
              icon="pi pi-check"
              text
              rounded
              size="small"
              @click="markItemDelivered(item)"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click="removeItem(item)"
            />
          </div>
        </li>
      </ul>

      <div class="pm-add-service">
        <Select
          v-model="newItemId"
          :options="catalogItems"
          option-label="label"
          option-value="id"
          filter
          class="w-full"
          :placeholder="t('projects.addService', 'Add service')"
        />
        <InputNumber v-model="newQty" :min="0.01" class="pm-qty" />
        <Button icon="pi pi-plus" @click="addService" />
      </div>
    </div>
  </Drawer>
</template>

<style scoped>
.pm-drawer {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.pm-drawer label {
  font-size: 0.8rem;
  font-weight: 600;
  margin-top: 0.4rem;
}
.pm-dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.pm-price-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.pm-readonly {
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 6px;
  background: var(--p-surface-50, #f8fafc);
}
.pm-service-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.pm-service-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 8px;
  padding: 0.5rem 0.65rem;
}
.pm-service-actions {
  display: flex;
  align-items: flex-start;
}
.pm-muted {
  color: var(--p-text-muted-color, #6b7280);
  font-size: 0.8rem;
}
.pm-add-service {
  display: grid;
  grid-template-columns: 1fr 5rem auto;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.pm-center {
  display: flex;
  justify-content: center;
  padding: 2rem;
}
</style>
