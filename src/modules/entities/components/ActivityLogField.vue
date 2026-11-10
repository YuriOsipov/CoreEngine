<script lang="ts">
export default {
  name: 'ActivityLogField',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  ACTIVITY_LOG_PAGE_SIZE,
  normalizeActivityLogSettings,
} from '@/interfaces'
import {
  fetchRecordActivityLogPage,
  type ActivityLogDeltaEntry,
  type ActivityLogEntry,
} from '../services/activityLogService'
import { recordActivityLogRoute } from '@/core/compactRecordRoutes'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    collection: string
    recordId: string | number
    active?: boolean
    /** preview = last N on record page; full = View-all page with lazy load */
    mode?: 'preview' | 'full'
    showViewAll?: boolean
    pageSize?: number
  }>(),
  {
    active: true,
    mode: 'preview',
    showViewAll: true,
    pageSize: ACTIVITY_LOG_PAGE_SIZE,
  },
)

const { t, i18n } = useTranslation()
const entries = ref<ActivityLogEntry[]>([])
const totalCount = ref(0)
/** Cumulative server rows fetched (before client-side filters) — used as next offset. */
const fetchedCount = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const expandedRows = ref<ActivityLogEntry[]>([])
const scrollPanel = ref<HTMLElement | null>(null)

const settings = computed(() => normalizeActivityLogSettings(props.field.activityLog))
const showDeltas = computed(() => settings.value.showDeltas)
const isFullMode = computed(() => props.mode === 'full')
const hasMore = computed(() => fetchedCount.value < totalCount.value)
const hasParent = computed(
  () => props.recordId !== undefined && props.recordId !== null && props.recordId !== '',
)
const viewAllTo = computed(() =>
  hasParent.value
    ? recordActivityLogRoute(props.collection, props.recordId)
    : { name: 'home' as const },
)

const watchKey = computed(() =>
  [
    props.collection,
    props.recordId,
    props.mode,
    props.pageSize,
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

function mergeEntries(existing: ActivityLogEntry[], next: ActivityLogEntry[]): ActivityLogEntry[] {
  const seen = new Set(existing.map((entry) => entry.id))
  const merged = [...existing]
  for (const entry of next) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    merged.push(entry)
  }
  return merged
}

async function loadActivityLog(reset = true): Promise<void> {
  if (!props.active) {
    entries.value = []
    totalCount.value = 0
    fetchedCount.value = 0
    error.value = null
    loading.value = false
    loadingMore.value = false
    return
  }

  if (!props.collection || props.recordId === '' || props.recordId === undefined) {
    entries.value = []
    totalCount.value = 0
    fetchedCount.value = 0
    return
  }

  if (reset) {
    loading.value = true
    error.value = null
  } else {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
  }

  try {
    const limit = isFullMode.value ? props.pageSize : settings.value.maxItems
    const offset = reset ? 0 : fetchedCount.value
    const page = await fetchRecordActivityLogPage({
      collection: props.collection,
      recordId: props.recordId,
      settings: settings.value,
      limit,
      offset,
    })
    totalCount.value = page.totalCount
    if (page.fetched === 0) {
      fetchedCount.value = page.totalCount
    } else {
      fetchedCount.value = reset
        ? page.offset + page.fetched
        : fetchedCount.value + page.fetched
    }
    entries.value = reset ? page.entries : mergeEntries(entries.value, page.entries)
  } catch (loadError) {
    if (reset) {
      entries.value = []
      totalCount.value = 0
      fetchedCount.value = 0
    }
    error.value =
      loadError instanceof Error
        ? loadError.message
        : t('activityLog.loadFailed', 'Unable to load activity history.')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function handleScroll(): void {
  if (!isFullMode.value || !hasMore.value || loadingMore.value || loading.value) return
  const panel = scrollPanel.value
  if (!panel) return
  const remaining = panel.scrollHeight - panel.scrollTop - panel.clientHeight
  if (remaining <= 120) {
    void loadActivityLog(false)
  }
}

watch(
  [watchKey, () => props.active],
  () => {
    void loadActivityLog(true).then(() => nextTick(handleScroll))
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  scrollPanel.value?.removeEventListener('scroll', handleScroll)
})

watch(scrollPanel, (panel, previous) => {
  previous?.removeEventListener('scroll', handleScroll)
  panel?.addEventListener('scroll', handleScroll)
})
</script>

<template>
  <div
    class="activity-log-field flex flex-col gap-2"
    :class="{ 'activity-log-field--full': isFullMode }"
  >
    <div
      v-if="!isFullMode"
      class="flex items-center justify-between gap-3"
    >
      <div class="text-surface-700 text-sm font-medium">
        {{ field.label || t('activityLog.title', 'Activity history') }}
      </div>
      <RouterLink
        v-if="showViewAll && hasParent"
        class="text-sm font-semibold text-primary no-underline hover:underline shrink-0"
        :to="viewAllTo"
      >
        {{ t('common.viewAll', 'View all') }}
      </RouterLink>
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

    <div
      v-else
      ref="scrollPanel"
      class="activity-log-field__scroll"
      :class="{ 'activity-log-field__scroll--full': isFullMode }"
    >
      <DataTable
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
            <DataTable
              v-else
              :value="data.deltas"
              data-key="field"
              size="small"
              class="activity-log-deltas-table"
            >
              <Column
                field="label"
                :header="t('activityLog.columnField', 'Field')"
                style="min-width: 7rem; width: 28%"
              >
                <template #body="{ data: delta }">
                  <span class="font-medium">{{ delta.label }}</span>
                </template>
              </Column>
              <Column
                :header="t('activityLog.columnOriginalValue', 'Original Value')"
                style="min-width: 6rem; width: 36%"
              >
                <template #body="{ data: delta }">
                  <pre
                    v-if="hasDeltaChange(delta) && isMultilineValue(delta.previousValue)"
                    class="activity-log-delta__pre"
                  >{{ delta.previousValue }}</pre>
                  <span
                    v-else
                    class="activity-log-delta__value text-muted-color"
                  >
                    {{ hasDeltaChange(delta) ? delta.previousValue : '—' }}
                  </span>
                </template>
              </Column>
              <Column
                :header="t('activityLog.columnNewValue', 'New Value')"
                style="min-width: 6rem; width: 36%"
              >
                <template #body="{ data: delta }">
                  <pre
                    v-if="isMultilineValue(delta.value)"
                    class="activity-log-delta__pre"
                  >{{ delta.value }}</pre>
                  <span
                    v-else
                    class="activity-log-delta__value"
                  >
                    {{ delta.value || '—' }}
                  </span>
                </template>
              </Column>
            </DataTable>
          </div>
        </template>
      </DataTable>

      <div
        v-if="isFullMode && loadingMore"
        class="flex items-center justify-center gap-2 px-3 py-3 text-muted-color text-sm"
      >
        <ProgressSpinner class="w-6 h-6" stroke-width="4" />
        {{ t('activityLog.loadingMore', 'Loading more…') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-log-field--full {
  min-height: 0;
  flex: 1 1 auto;
}

.activity-log-field__scroll--full {
  flex: 1 1 auto;
  min-height: 0;
  max-height: calc(100vh - 12rem);
  overflow: auto;
}

.activity-log-summary__text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  word-break: break-word;
}

.activity-log-deltas-table {
  width: 100%;
}

.activity-log-deltas-table :deep(.p-datatable-tbody > tr > td) {
  vertical-align: top;
}

.activity-log-delta__value {
  word-break: break-word;
}

.activity-log-delta__pre {
  margin: 0;
  max-height: 8rem;
  overflow: auto;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 0.35rem;
  background: var(--p-surface-50, #f8fafc);
  font-size: 0.75rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
