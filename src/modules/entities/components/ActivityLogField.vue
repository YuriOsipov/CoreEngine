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
  type ActivityLogDeltaEntry,
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

function isMultilineValue(value: string | null | undefined): boolean {
  if (!value) return false
  return value.includes('\n') || value.length > 120
}

function hasDeltaChange(delta: ActivityLogDeltaEntry): boolean {
  return Boolean(
    delta.previousValue &&
      delta.previousValue !== '—' &&
      delta.previousValue !== delta.value,
  )
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
      class="activity-log-table border border-surface-200 rounded-lg overflow-hidden"
    >
      <Column
        v-if="showDeltas"
        expander
        style="width: 3rem"
      />
      <Column
        field="timestampLabel"
        :header="t('activityLog.columnTimestamp', 'When')"
        style="min-width: 9rem; width: 9rem"
      />
      <Column
        field="userName"
        :header="t('activityLog.columnUser', 'User')"
        style="min-width: 7rem; width: 8rem"
      >
        <template #body="{ data }">
          {{ data.userName || t('activityLog.unknownUser', 'Unknown user') }}
        </template>
      </Column>
      <Column
        field="action"
        :header="t('activityLog.columnAction', 'Action')"
        style="width: 6.5rem"
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
        style="min-width: 8rem"
      >
        <template #body="{ data }">
          <span class="activity-log-summary__text">
            {{ data.summary || '—' }}
          </span>
        </template>
      </Column>

      <template v-if="showDeltas" #expansion="{ data }">
        <div class="activity-log-expansion flex flex-col gap-2 px-2 py-1">
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
            class="m-0 pl-0 list-none flex flex-col gap-3 text-sm"
          >
            <li
              v-for="delta in data.deltas"
              :key="`${data.id}-${delta.field}`"
              class="activity-log-delta"
            >
              <div class="font-medium mb-1">
                {{ delta.label }}
              </div>
              <template v-if="hasDeltaChange(delta)">
                <div class="activity-log-delta__block">
                  <div class="activity-log-delta__label text-muted-color">
                    {{ t('activityLog.previousValue', 'Previous') }}
                  </div>
                  <pre
                    v-if="isMultilineValue(delta.previousValue)"
                    class="activity-log-delta__pre"
                  >{{ delta.previousValue }}</pre>
                  <div
                    v-else
                    class="activity-log-delta__value text-muted-color"
                  >
                    {{ delta.previousValue }}
                  </div>
                </div>
                <div class="activity-log-delta__block">
                  <div class="activity-log-delta__label text-muted-color">
                    {{ t('activityLog.newValue', 'New') }}
                  </div>
                  <pre
                    v-if="isMultilineValue(delta.value)"
                    class="activity-log-delta__pre"
                  >{{ delta.value }}</pre>
                  <div
                    v-else
                    class="activity-log-delta__value"
                  >
                    {{ delta.value }}
                  </div>
                </div>
              </template>
              <template v-else>
                <pre
                  v-if="isMultilineValue(delta.value)"
                  class="activity-log-delta__pre"
                >{{ delta.value }}</pre>
                <div
                  v-else
                  class="activity-log-delta__value"
                >
                  {{ delta.value }}
                </div>
              </template>
            </li>
          </ul>
        </div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.activity-log-summary__text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  word-break: break-word;
}

.activity-log-delta__block + .activity-log-delta__block {
  margin-top: 0.5rem;
}

.activity-log-delta__label {
  font-size: 0.75rem;
  margin-bottom: 0.15rem;
}

.activity-log-delta__value {
  word-break: break-word;
}

.activity-log-delta__pre {
  margin: 0;
  max-height: 14rem;
  overflow: auto;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 0.4rem;
  background: var(--p-surface-50, #f8fafc);
  font-size: 0.75rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
