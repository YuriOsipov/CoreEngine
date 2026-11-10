<script lang="ts">
export default {
  name: 'ObjectListCompactCardList',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import {
  fetchCompactRecordDetails,
  type CompactRecordDetailsRuntime,
  type CompactRecordRuntimeField,
} from '@/modules/entities/services/recordDetails'
import { useEntityPermissions } from '@/core/entityPermissions'
import { useTranslation } from '@/core/translation'

type CardCacheEntry = {
  status: 'loading' | 'ready' | 'error'
  runtime?: CompactRecordDetailsRuntime | null
  error?: string | null
}

const props = withDefaults(
  defineProps<{
    collection: string
    primaryKey: string
    rows: Record<string, unknown>[]
    selection?: Record<string, unknown> | null
    loading?: boolean
    hasMore?: boolean
    loadingMore?: boolean
    totalRecords?: number
    /** Page size for infinite scroll load-more (matches CrmDataTable lazy). */
    pageSize?: number
    showNewButton?: boolean
    emptyMessage?: string
    /** Bump to invalidate compact field cache (e.g. after list refresh). */
    reloadToken?: number
    /** When token bumps, refetch this record’s compact card (e.g. after detail edit). */
    invalidateRecordId?: string | null
    invalidateToken?: number
  }>(),
  {
    selection: null,
    loading: false,
    hasMore: false,
    loadingMore: false,
    totalRecords: 0,
    pageSize: 25,
    showNewButton: false,
    emptyMessage: '',
    reloadToken: 0,
    invalidateRecordId: null,
    invalidateToken: 0,
  },
)

const emit = defineEmits<{
  'update:selection': [row: Record<string, unknown> | null]
  'load-more': [payload: { offset: number; limit: number }]
  refreshed: []
}>()

const { t } = useTranslation()
const { canCreate: canCreateRecords } = useEntityPermissions(() => props.collection)

const createDialogVisible = ref(false)
const cardCache = ref<Record<string, CardCacheEntry>>({})
let loadGeneration = 0

const showNewButtonEffective = computed(
  () => Boolean(props.showNewButton) && canCreateRecords.value,
)

const selectedId = computed(() => {
  if (!props.selection) return null
  const id = props.selection[props.primaryKey]
  if (id === null || id === undefined || id === '') return null
  return String(id)
})

const rowCountLabel = computed(() => {
  const loaded = props.rows.length
  const total = props.totalRecords
  if (total > loaded) {
    return t('objectList.compactCardCountMore', '{loaded} of {total}+ items', {
      loaded,
      total,
    })
  }
  return t('objectList.compactCardCount', '{count} items', { count: loaded })
})

watch(
  () => [props.collection, props.rows] as const,
  () => {
    void ensureCardsLoaded()
  },
  { immediate: true, deep: true },
)

watch(
  () => [props.collection, props.reloadToken] as const,
  () => {
    cardCache.value = {}
    loadGeneration += 1
    void ensureCardsLoaded()
  },
)

watch(
  () => [props.invalidateRecordId, props.invalidateToken] as const,
  ([id, token]) => {
    if (!id || !token) return
    const next = { ...cardCache.value }
    delete next[id]
    cardCache.value = next
    void loadCard(id)
  },
)

async function loadCard(id: string): Promise<void> {
  const collection = props.collection
  if (!collection || !id) return
  const generation = loadGeneration
  cardCache.value = {
    ...cardCache.value,
    [id]: { status: 'loading' },
  }
  try {
    const runtime = await fetchCompactRecordDetails(collection, id, {
      includeRelatedCounts: false,
    })
    if (generation !== loadGeneration) return
    cardCache.value = {
      ...cardCache.value,
      [id]: { status: 'ready', runtime },
    }
  } catch (err) {
    if (generation !== loadGeneration) return
    cardCache.value = {
      ...cardCache.value,
      [id]: {
        status: 'error',
        error:
          err instanceof Error
            ? err.message
            : t('objectList.compactCardLoadError', 'Failed to load compact details.'),
      },
    }
  }
}

async function ensureCardsLoaded(): Promise<void> {
  const collection = props.collection
  if (!collection || props.rows.length === 0) return

  const generation = loadGeneration
  const missing: string[] = []
  for (const row of props.rows) {
    const id = row[props.primaryKey]
    if (id === null || id === undefined || id === '') continue
    const key = String(id)
    const existing = cardCache.value[key]
    if (existing?.status === 'ready' || existing?.status === 'loading') continue
    missing.push(key)
  }

  if (missing.length === 0) return

  const concurrency = 4
  let index = 0
  async function worker(): Promise<void> {
    while (index < missing.length) {
      if (generation !== loadGeneration) return
      const current = missing[index++]
      if (!current) return
      await loadCard(current)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()),
  )
}

function rowId(row: Record<string, unknown>): string | null {
  const id = row[props.primaryKey]
  if (id === null || id === undefined || id === '') return null
  return String(id)
}

function isSelected(row: Record<string, unknown>): boolean {
  const id = rowId(row)
  return id !== null && id === selectedId.value
}

function selectRow(row: Record<string, unknown>): void {
  emit('update:selection', row)
}

function cardFields(row: Record<string, unknown>): CompactRecordRuntimeField[] {
  const id = rowId(row)
  if (!id) return []
  return cardCache.value[id]?.runtime?.fields ?? []
}

function titleField(row: Record<string, unknown>): CompactRecordRuntimeField | null {
  return cardFields(row)[0] ?? null
}

function secondaryField(row: Record<string, unknown>): CompactRecordRuntimeField | null {
  return cardFields(row)[1] ?? null
}

function metaFields(row: Record<string, unknown>): CompactRecordRuntimeField[] {
  return cardFields(row).slice(2)
}

function fallbackTitle(row: Record<string, unknown>): string {
  const id = rowId(row)
  for (const key of ['name', 'title', 'label']) {
    const value = row[key]
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value)
    }
  }
  return id ?? t('objectList.compactCardUntitled', 'Untitled')
}

function cardStatus(row: Record<string, unknown>): CardCacheEntry['status'] | 'empty' {
  const id = rowId(row)
  if (!id) return 'empty'
  return cardCache.value[id]?.status ?? 'loading'
}

function onScroll(event: Event): void {
  if (!props.hasMore || props.loadingMore || props.loading) return
  const el = event.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
    emit('load-more', {
      offset: props.rows.length,
      limit: Math.max(1, props.pageSize),
    })
  }
}

function openCreateDialog(): void {
  createDialogVisible.value = true
}

function onRecordCreated(): void {
  createDialogVisible.value = false
  emit('refreshed')
}

defineExpose({
  openCreateDialog,
})
</script>

<template>
  <div class="object-list-compact-cards flex h-full min-h-0 flex-col overflow-hidden">
    <div
      v-if="
        showNewButtonEffective ||
        $slots.toolbar ||
        $slots['toolbar-actions'] ||
        $slots['toolbar-filters'] ||
        $slots['toolbar-tools']
      "
      class="object-list-compact-cards__toolbar flex flex-shrink-0 flex-col gap-2 border-b border-surface-200 px-2 py-2 dark:border-surface-700"
    >
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <slot name="toolbar" />
        </div>
        <div
          v-if="$slots['toolbar-actions'] || showNewButtonEffective"
          class="flex flex-wrap items-center justify-end gap-2"
        >
          <slot name="toolbar-actions" />
          <Button
            v-if="showNewButtonEffective"
            :label="t('common.new', 'New')"
            size="small"
            @click="openCreateDialog"
          />
        </div>
      </div>
      <div
        v-if="$slots['toolbar-filters'] || $slots['toolbar-tools']"
        class="object-list-compact-cards__toolbar-secondary flex min-w-0 flex-nowrap items-center justify-between gap-2"
      >
        <div
          v-if="$slots['toolbar-filters']"
          class="object-list-compact-cards__toolbar-filters min-w-0 flex-1"
        >
          <slot name="toolbar-filters" />
        </div>
        <div
          v-if="$slots['toolbar-tools']"
          class="object-list-compact-cards__toolbar-tools flex shrink-0 flex-wrap items-center justify-end gap-2"
        >
          <slot name="toolbar-tools" />
        </div>
      </div>
    </div>

    <div class="object-list-compact-cards__meta flex-shrink-0 px-3 py-1.5 text-xs text-muted-color">
      {{ rowCountLabel }}
    </div>

    <div
      class="object-list-compact-cards__scroll min-h-0 flex-1 overflow-auto"
      @scroll="onScroll"
    >
      <div
        v-if="loading && rows.length === 0"
        class="flex items-center gap-2 px-3 py-4 text-sm text-muted-color"
      >
        <ProgressSpinner style="width: 1.25rem; height: 1.25rem" stroke-width="6" />
        <span>{{ t('objectList.loadingRecords', 'Loading records...') }}</span>
      </div>

      <p
        v-else-if="rows.length === 0"
        class="m-0 px-3 py-4 text-sm text-muted-color"
      >
        {{ emptyMessage || t('objectList.noRecords', 'No records found in this collection.') }}
      </p>

      <ul
        v-else
        class="object-list-compact-cards__list m-0 list-none p-0"
        role="listbox"
        :aria-label="t('objectList.compactCardList', 'Records')"
      >
        <li
          v-for="row in rows"
          :key="rowId(row) ?? JSON.stringify(row)"
          class="object-list-compact-cards__item"
          :class="{ 'object-list-compact-cards__item--selected': isSelected(row) }"
          role="option"
          :aria-selected="isSelected(row)"
          tabindex="0"
          @click="selectRow(row)"
          @keydown.enter.prevent="selectRow(row)"
          @keydown.space.prevent="selectRow(row)"
        >
          <div
            v-if="cardStatus(row) === 'loading'"
            class="px-1 py-1 text-sm text-muted-color"
          >
            {{ t('objectList.compactCardLoading', 'Loading…') }}
          </div>

          <template v-else>
            <div class="object-list-compact-cards__title-row">
              <span class="object-list-compact-cards__title">
                {{ titleField(row)?.value || fallbackTitle(row) }}
              </span>
              <span
                v-if="secondaryField(row)?.value"
                class="object-list-compact-cards__secondary"
              >
                {{ secondaryField(row)?.value }}
              </span>
            </div>
            <div
              v-if="metaFields(row).length > 0"
              class="object-list-compact-cards__meta-row"
            >
              <span
                v-for="(field, index) in metaFields(row)"
                :key="field.id"
                class="object-list-compact-cards__meta-field"
              >
                <template v-if="index > 0"> · </template>
                {{ field.value || '—' }}
              </span>
            </div>
            <p
              v-else-if="cardStatus(row) === 'error' || cardFields(row).length === 0"
              class="m-0 mt-1 text-xs text-muted-color"
            >
              {{
                cardStatus(row) === 'error'
                  ? t('objectList.compactCardLoadError', 'Failed to load compact details.')
                  : t('objectList.compactCardNoLayout', 'No compact layout configured.')
              }}
            </p>
          </template>
        </li>
      </ul>

      <div
        v-if="loadingMore"
        class="flex items-center justify-center gap-2 px-3 py-3 text-sm text-muted-color"
      >
        <ProgressSpinner style="width: 1rem; height: 1rem" stroke-width="6" />
        <span>{{ t('objectList.loadingMore', 'Loading more…') }}</span>
      </div>
    </div>

    <RecordCreateDialog
      v-if="collection"
      :visible="createDialogVisible"
      :collection="collection"
      @update:visible="createDialogVisible = $event"
      @created="onRecordCreated"
    />
  </div>
</template>

<style scoped>
.object-list-compact-cards__list {
  border-top: 1px solid var(--p-content-border-color, var(--p-surface-200));
}

.object-list-compact-cards__item {
  cursor: pointer;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid var(--p-content-border-color, var(--p-surface-200));
  background: var(--p-surface-0);
  transition: background-color 0.12s ease;
}

.object-list-compact-cards__item:hover {
  background: var(--p-surface-50);
}

.object-list-compact-cards__item--selected {
  background: color-mix(in srgb, var(--p-primary-color) 12%, var(--p-surface-0));
  box-shadow: inset 3px 0 0 var(--p-primary-color);
}

.object-list-compact-cards__title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.object-list-compact-cards__title {
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--p-primary-color);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.object-list-compact-cards__secondary {
  flex-shrink: 0;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.object-list-compact-cards__meta-row {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
</style>
