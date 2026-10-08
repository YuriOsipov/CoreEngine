<script lang="ts">
export default {
  name: 'ActivityLogField',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import { normalizeActivityLogSettings } from '@/interfaces'
import {
  fetchRecordActivityLog,
  type ActivityLogEntry,
} from '../services/activityLogService'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    collection: string
    recordId: string | number
    active?: boolean
  }>(),
  { active: true },
)

const { t, i18n } = useTranslation()
const entries = ref<ActivityLogEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const expandedRows = ref<ActivityLogEntry[]>([])

const settings = computed(() => normalizeActivityLogSettings(props.field.activityLog))
const showDeltas = computed(() => settings.value.showDeltas)

const watchKey = computed(() =>
  [
    props.collection,
    props.recordId,
    i18n.language.value,
    JSON.stringify(settings.value),
  ].join('.'),
)

function actionLabel(action: string): string {
  switch (action) {
    case 'create':
      return t('activityLog.actionCreate', 'Created')
    case 'update':
      return t('activityLog.actionUpdate', 'Updated')
    case 'delete':
      return t('activityLog.actionDelete', 'Deleted')
    default:
      return action
  }
}

function actionSeverity(action: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
  switch (action) {
    case 'create':
      return 'success'
    case 'update':
      return 'info'
    case 'delete':
      return 'danger'
    default:
      return 'secondary'
  }
}

async function loadActivityLog(): Promise<void> {
  if (!props.active) {
    entries.value = []
    error.value = null
    loading.value = false
    return
  }

  if (!props.collection || props.recordId === '' || props.recordId === undefined) {
    entries.value = []
    return
  }

  loading.value = true
  error.value = null
  try {
    entries.value = await fetchRecordActivityLog({
      collection: props.collection,
      recordId: props.recordId,
      settings: settings.value,
    })
  } catch (loadError) {
    entries.value = []
    error.value =
      loadError instanceof Error
        ? loadError.message
        : t('activityLog.loadFailed', 'Unable to load activity history.')
  } finally {
    loading.value = false
  }
}

watch(
  [watchKey, () => props.active],
  () => {
    void loadActivityLog()
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="text-surface-700 text-sm font-medium">
      {{ field.label || t('activityLog.title', 'Activity history') }}
    </div>

    <div
      v-if="loading"
      class="flex items-center justify-center gap-2 border border-surface-200 rounded-lg bg-surface-50 px-4 py-8 text-muted-color text-sm"
    >
      <ProgressSpinner class="w-8 h-8" stroke-width="4" />
      {{ t('activityLog.loading', 'Loading activity history…') }}
    </div>

    <Message
      v-else-if="error"
      severity="warn"
      :closable="false"
      class="m-0"
    >
      {{ error }}
    </Message>

    <div
      v-else-if="entries.length === 0"
      class="border border-surface-200 rounded-lg bg-surface-50 px-4 py-6 text-muted-color text-sm text-center"
    >
      {{ t('activityLog.empty', 'No activity recorded for this record yet.') }}
    </div>

    <DataTable
      v-else
      v-model:expanded-rows="expandedRows"
      :value="entries"
      data-key="id"
      size="small"
      striped-rows
      class="border border-surface-200 rounded-lg overflow-hidden"
    >
      <Column
        v-if="showDeltas"
        expander
        style="width: 3rem"
      />
      <Column
        field="timestampLabel"
        :header="t('activityLog.columnTimestamp', 'When')"
        style="min-width: 10rem"
      />
      <Column
        field="userName"
        :header="t('activityLog.columnUser', 'User')"
        style="min-width: 8rem"
      >
        <template #body="{ data }">
          {{ data.userName || t('activityLog.unknownUser', 'Unknown user') }}
        </template>
      </Column>
      <Column
        field="action"
        :header="t('activityLog.columnAction', 'Action')"
        style="width: 7rem"
      >
        <template #body="{ data }">
          <Tag
            :value="actionLabel(data.action)"
            :severity="actionSeverity(data.action)"
          />
        </template>
      </Column>
      <Column
        field="summary"
        :header="t('activityLog.columnSummary', 'Changes')"
      />

      <template v-if="showDeltas" #expansion="{ data }">
        <div class="flex flex-col gap-2 px-2 py-1">
          <p v-if="data.comment" class="m-0 text-sm text-muted-color">
            {{ t('activityLog.comment', 'Comment') }}: {{ data.comment }}
          </p>
          <div
            v-if="data.deltas.length === 0"
            class="text-sm text-muted-color"
          >
            {{ t('activityLog.noDeltaDetails', 'No field-level changes recorded.') }}
          </div>
          <ul
            v-else
            class="m-0 pl-5 flex flex-col gap-1 text-sm"
          >
            <li v-for="delta in data.deltas" :key="`${data.id}-${delta.field}`">
              <span class="font-medium">{{ delta.label }}:</span>
              <template
                v-if="
                  delta.previousValue &&
                  delta.previousValue !== '—' &&
                  delta.previousValue !== delta.value
                "
              >
                <span class="text-muted-color">{{ delta.previousValue }}</span>
                <span aria-hidden="true"> → </span>
                {{ delta.value }}
              </template>
              <template v-else>
                {{ delta.value }}
              </template>
            </li>
          </ul>
        </div>
      </template>
    </DataTable>
  </div>
</template>
