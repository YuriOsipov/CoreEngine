<script lang="ts">
export default {
  name: 'MessageTimelineField',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { LayoutFieldMetadata } from '@/interfaces'
import { normalizeMessageTimelineSettings } from '@/interfaces'
import { recordDetailRoute } from '@/core/compactRecordRoutes'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'
import CrmAutoComplete from '@/core/ui-kit/CrmAutoComplete.vue'
import CompactRecordTooltip from '@/modules/entities/components/CompactRecordTooltip.vue'
import {
  buildLivePalette,
  fetchFieldRuntimeMetadata,
  fetchRelatedCollectionOptionById,
  fetchTranslatedFieldLabel,
} from '@/modules/entities/services/collectionSchema'
import {
  fetchCompactRecordDetails,
  type CompactRecordDetailsRuntime,
} from '@/modules/entities/services/recordDetails'
import {
  fetchMessageTimeline,
  type MessageTimelineEntry,
} from '../services/messageTimelineService'

interface UserSelectOption {
  label: string
  value: string | number
}

interface EntryContextState {
  status: 'loading' | 'ready' | 'error'
  runtime?: CompactRecordDetailsRuntime | null
  displayLabel?: string | null
  error?: string | null
}

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    collection: string
    recordId: string | number
    active?: boolean
  }>(),
  {
    active: true,
  },
)

const { t, i18n } = useTranslation()
const entries = ref<MessageTimelineEntry[]>([])
const totalCount = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const filtering = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const peerFilter = ref<UserSelectOption | null>(null)
const peerLookupCollection = ref('')
const peerDisplayTemplate = ref<string | undefined>(undefined)
const peerFieldLabel = ref('')
const peerLookupProps = ref<Record<string, unknown>>({
  optionLabel: 'label',
  placeholder: 'Select...',
  dropdown: true,
  forceSelection: true,
})
const entryContextByKey = ref<Record<string, EntryContextState>>({})
let contextLoadGeneration = 0

const settings = computed(() => normalizeMessageTimelineSettings(props.field.messageTimeline))
const pageSize = computed(() => settings.value.maxItems)
const peerFilterEnabled = computed(
  () =>
    Boolean(settings.value.outgoingPeerField)
    || Boolean(settings.value.incomingPeerField),
)
const peerLookupLabel = computed(
  () =>
    peerFieldLabel.value
    || t('messageTimeline.peerFilter', 'Filter'),
)
const configured = computed(
  () =>
    Boolean(settings.value.outgoingCollection)
    && Boolean(settings.value.incomingCollection)
    && Boolean(settings.value.outgoingParentField)
    && Boolean(settings.value.incomingParentField),
)
const hasParent = computed(
  () => props.recordId !== undefined && props.recordId !== null && props.recordId !== '',
)
const peerFilterId = computed(() => peerFilter.value?.value ?? null)

/** Record / settings only — filter changes use a soft in-place reload. */
const recordWatchKey = computed(() =>
  [
    props.collection,
    props.recordId,
    i18n.language.value,
    JSON.stringify(settings.value),
  ].join('.'),
)

function entryKey(entry: MessageTimelineEntry): string {
  return `${entry.collection}:${entry.id}`
}

function typeIcon(type: string): string {
  switch (type) {
    case 'email':
      return 'pi pi-envelope'
    case 'whatsapp':
      return 'pi pi-whatsapp'
    case 'telegram':
      return 'pi pi-send'
    case 'internal':
      return 'pi pi-comments'
    default:
      return 'pi pi-comment'
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'email':
      return t('messageTimeline.typeEmail', 'Email')
    case 'whatsapp':
      return t('messageTimeline.typeWhatsapp', 'WhatsApp')
    case 'telegram':
      return t('messageTimeline.typeTelegram', 'Telegram')
    case 'internal':
      return t('messageTimeline.typeInternal', 'Internal')
    default:
      return type
  }
}

function formatWhen(value: string | null): string {
  if (!value) return ''
  return formatLocalizedDateTime(value)
}

function compactLayoutIdFor(entry: MessageTimelineEntry): string | null {
  return entry.direction === 'outgoing'
    ? settings.value.outgoingCompactLayoutId
    : settings.value.incomingCompactLayoutId
}

function contextFor(entry: MessageTimelineEntry): EntryContextState | null {
  return entryContextByKey.value[entryKey(entry)] ?? null
}

function entryDisplayLabel(entry: MessageTimelineEntry): string {
  const fromContext = contextFor(entry)?.displayLabel?.trim()
  if (fromContext) return fromContext
  const subject = entry.subject?.trim()
  if (subject) return subject
  return String(entry.id)
}

function entryDetailRoute(entry: MessageTimelineEntry) {
  return recordDetailRoute(entry.collection, entry.id)
}

function mergeUnique(
  existing: MessageTimelineEntry[],
  next: MessageTimelineEntry[],
): MessageTimelineEntry[] {
  const seen = new Set(existing.map((entry) => `${entry.collection}:${entry.id}`))
  const merged = [...existing]
  for (const entry of next) {
    const key = `${entry.collection}:${entry.id}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged
}

async function loadEntryContext(
  entry: MessageTimelineEntry,
  generation: number,
): Promise<void> {
  const key = entryKey(entry)
  entryContextByKey.value = {
    ...entryContextByKey.value,
    [key]: { status: 'loading' },
  }
  try {
    const [runtime, option] = await Promise.all([
      fetchCompactRecordDetails(entry.collection, entry.id, {
        compactLayoutId: compactLayoutIdFor(entry),
        includeRelatedCounts: false,
      }),
      fetchRelatedCollectionOptionById(entry.collection, entry.id),
    ])
    if (generation !== contextLoadGeneration) return
    const displayLabel =
      option?.label?.trim()
      || entry.subject?.trim()
      || String(entry.id)
    entryContextByKey.value = {
      ...entryContextByKey.value,
      [key]: { status: 'ready', runtime, displayLabel },
    }
  } catch (loadError) {
    if (generation !== contextLoadGeneration) return
    entryContextByKey.value = {
      ...entryContextByKey.value,
      [key]: {
        status: 'error',
        error:
          loadError instanceof Error
            ? loadError.message
            : t('messageTimeline.contextLoadFailed', 'Unable to load message context.'),
      },
    }
  }
}

async function ensureEntryContexts(list: MessageTimelineEntry[]): Promise<void> {
  const generation = ++contextLoadGeneration
  const missing = list.filter((entry) => {
    const state = entryContextByKey.value[entryKey(entry)]
    return !state || state.status === 'error'
  })
  if (missing.length === 0) return

  const concurrency = 4
  let index = 0
  async function worker(): Promise<void> {
    while (index < missing.length) {
      if (generation !== contextLoadGeneration) return
      const current = missing[index++]
      if (!current) return
      await loadEntryContext(current, generation)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()),
  )
}

async function loadTimeline(
  reset: boolean,
  mode: 'hard' | 'soft' = 'hard',
): Promise<void> {
  if (!props.active || !hasParent.value || !configured.value) {
    entries.value = []
    totalCount.value = 0
    hasMore.value = false
    error.value = null
    loading.value = false
    filtering.value = false
    loadingMore.value = false
    entryContextByKey.value = {}
    return
  }

  if (reset) {
    error.value = null
    if (mode === 'soft') {
      filtering.value = true
    } else {
      loading.value = true
      entryContextByKey.value = {}
    }
  } else {
    if (loadingMore.value || filtering.value || !hasMore.value) return
    loadingMore.value = true
  }

  try {
    const offset = reset ? 0 : entries.value.length
    const page = await fetchMessageTimeline({
      parentId: props.recordId,
      parentCollection: props.collection,
      settings: settings.value,
      limit: pageSize.value,
      offset,
      peerId: peerFilterId.value,
    })
    totalCount.value = page.totalCount
    hasMore.value = page.hasMore
    entries.value = reset ? page.entries : mergeUnique(entries.value, page.entries)
    void ensureEntryContexts(entries.value)
  } catch (loadError) {
    if (reset) {
      entries.value = []
      totalCount.value = 0
      hasMore.value = false
    }
    error.value =
      loadError instanceof Error
        ? loadError.message
        : t('messageTimeline.loadFailed', 'Unable to load messages.')
  } finally {
    loading.value = false
    filtering.value = false
    loadingMore.value = false
  }
}

function loadMore(): void {
  void loadTimeline(false)
}

function onPeerLookupUpdate(value: UserSelectOption | null): void {
  peerFilter.value = value
}

function onFilterKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
  }
}

async function loadPeerLookupMeta(): Promise<void> {
  const collection =
    (settings.value.outgoingPeerField && settings.value.outgoingCollection)
    || (settings.value.incomingPeerField && settings.value.incomingCollection)
    || ''
  const field =
    settings.value.outgoingPeerField || settings.value.incomingPeerField
  if (!collection || !field) {
    peerLookupCollection.value = ''
    peerDisplayTemplate.value = undefined
    peerFieldLabel.value = ''
    return
  }
  try {
    const [metadata, label, palette] = await Promise.all([
      fetchFieldRuntimeMetadata(collection, field, 'AutoComplete'),
      fetchTranslatedFieldLabel(
        collection,
        field,
        t('messageTimeline.peerFilter', 'Filter'),
      ),
      buildLivePalette(collection),
    ])
    const paletteItem = palette.find((item) => item.fieldKey === field)
    peerLookupCollection.value = paletteItem?.relatedCollection?.trim() || ''
    peerDisplayTemplate.value = metadata.template
    peerLookupProps.value = {
      optionLabel: 'label',
      placeholder: 'Select...',
      ...metadata.props,
      dropdown: true,
      forceSelection: true,
    }
    if (typeof label === 'string' && label.trim()) {
      peerFieldLabel.value = label.trim()
    }
  } catch {
    peerLookupCollection.value = ''
    peerDisplayTemplate.value = undefined
  }
}

onMounted(() => {
  void loadPeerLookupMeta()
})

watch(
  [recordWatchKey, () => props.active],
  () => {
    if (peerFilter.value !== null) {
      peerFilter.value = null
    }
    void loadTimeline(true, 'hard')
  },
  { immediate: true },
)

watch(peerFilterId, (next, prev) => {
  if (next === prev) return
  if (loading.value) return
  void loadTimeline(true, 'soft')
})

watch(
  () =>
    [
      settings.value.outgoingCollection,
      settings.value.incomingCollection,
      settings.value.outgoingPeerField,
      settings.value.incomingPeerField,
    ] as const,
  () => {
    void loadPeerLookupMeta()
  },
)

watch(
  () =>
    [
      settings.value.outgoingCompactLayoutId,
      settings.value.incomingCompactLayoutId,
    ] as const,
  () => {
    entryContextByKey.value = {}
    if (entries.value.length > 0) {
      void ensureEntryContexts(entries.value)
    }
  },
)
</script>

<template>
  <div class="message-timeline-field flex flex-col gap-2">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="text-surface-700 text-sm font-medium shrink-0">
        {{ field.label || t('messageTimeline.title', 'Messages') }}
      </div>
      <span
        v-if="!loading && configured && (totalCount > 0 || entries.length > 0)"
        class="text-xs text-muted-color shrink-0 sm:order-last"
      >
        {{
          t('messageTimeline.showingCount', '{shown} of {total}', {
            shown: entries.length,
            total: Math.max(totalCount, entries.length),
          })
        }}
      </span>
    </div>

    <div
      v-if="configured && peerFilterEnabled && peerLookupCollection"
      class="flex w-full flex-col gap-1 md:w-1/2"
      @keydown="onFilterKeydown"
    >
      <label class="text-xs font-semibold text-surface-600">
        {{ peerLookupLabel }}
      </label>
      <div class="relative flex items-center gap-2">
        <CrmAutoComplete
          v-bind="peerLookupProps"
          :model-value="peerFilter"
          :collection="peerLookupCollection"
          :template="peerDisplayTemplate"
          :allow-create="false"
          :show-clear="true"
          :disabled="filtering"
          fluid
          class="w-full min-w-0"
          @update:model-value="onPeerLookupUpdate"
        />
        <ProgressSpinner
          v-if="filtering"
          class="w-6 h-6 shrink-0"
          stroke-width="4"
        />
      </div>
    </div>

    <div
      v-if="!configured"
      class="rounded-lg border border-dashed border-line bg-canvas px-4 py-6 text-sm text-ink-muted"
    >
      {{
        t(
          'messageTimeline.configureFields',
          'Select outgoing and incoming objects and their link fields in the Record Page Builder.',
        )
      }}
    </div>

    <div
      v-else-if="loading"
      class="flex items-center justify-center gap-2 rounded-lg border border-line bg-canvas px-4 py-8 text-sm text-ink-muted"
    >
      <ProgressSpinner
        class="w-8 h-8"
        stroke-width="4"
      />
      {{ t('messageTimeline.loading', 'Loading messages…') }}
    </div>

    <Message
      v-else-if="error && !filtering"
      severity="warn"
      :closable="false"
      class="m-0"
    >
      {{ error }}
    </Message>

    <div
      v-else-if="entries.length === 0 && !filtering"
      class="rounded-lg border border-line bg-canvas px-4 py-6 text-sm text-ink-muted"
    >
      {{ t('messageTimeline.empty', 'No messages yet.') }}
    </div>

    <div
      v-else-if="filtering && entries.length === 0"
      class="rounded-lg border border-line bg-canvas px-4 py-6 text-sm text-ink-muted"
    >
      {{ t('messageTimeline.loading', 'Loading messages…') }}
    </div>

    <template v-else>
      <Timeline
        :value="entries"
        class="message-timeline-field__timeline w-full"
      >
        <template #marker="{ item }">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-full text-sm z-10 shadow-sm"
            :class="
              item.direction === 'outgoing'
                ? 'bg-primary text-primary-contrast'
                : 'bg-soft text-ink'
            "
            :title="typeLabel(item.type)"
          >
            <i :class="typeIcon(item.type)" />
          </span>
        </template>

        <!-- OpenVue Timeline DOM order: opposite (left) | marker | content (right). -->
        <template #opposite="{ item }">
          <div
            v-if="item.direction === 'incoming'"
            class="message-timeline-bubble message-timeline-bubble--incoming text-left w-full max-w-md"
          >
            <div class="flex items-center justify-between gap-2 mb-2">
              <RouterLink
                :to="entryDetailRoute(item)"
                class="message-timeline-bubble__title truncate text-xs font-semibold text-ink hover:underline min-w-0"
              >
                {{ entryDisplayLabel(item) }}
              </RouterLink>
              <span class="text-xs text-muted-color whitespace-nowrap shrink-0">
                {{ formatWhen(item.dateCreated) }}
              </span>
            </div>
            <CompactRecordTooltip
              variant="panel"
              hide-labels
              :loading="contextFor(item)?.status === 'loading'"
              :error="contextFor(item)?.status === 'error' ? contextFor(item)?.error ?? null : null"
              :runtime="contextFor(item)?.status === 'ready' ? contextFor(item)?.runtime ?? null : null"
            />
          </div>
        </template>

        <template #content="{ item }">
          <div
            v-if="item.direction === 'outgoing'"
            class="message-timeline-bubble message-timeline-bubble--outgoing text-left w-full max-w-md ml-auto"
          >
            <div class="flex items-center justify-between gap-2 mb-2">
              <RouterLink
                :to="entryDetailRoute(item)"
                class="message-timeline-bubble__title truncate text-xs font-semibold text-primary hover:underline min-w-0"
              >
                {{ entryDisplayLabel(item) }}
                <span
                  v-if="item.isDraft"
                  class="font-normal text-muted-color"
                >
                  · {{ t('messageTimeline.draft', 'Draft') }}
                </span>
              </RouterLink>
              <span class="text-xs text-muted-color whitespace-nowrap shrink-0">
                {{ formatWhen(item.dateCreated) }}
              </span>
            </div>
            <CompactRecordTooltip
              variant="panel"
              hide-labels
              :loading="contextFor(item)?.status === 'loading'"
              :error="contextFor(item)?.status === 'error' ? contextFor(item)?.error ?? null : null"
              :runtime="contextFor(item)?.status === 'ready' ? contextFor(item)?.runtime ?? null : null"
            />
          </div>
        </template>
      </Timeline>

      <div
        v-if="hasMore || loadingMore"
        class="flex justify-center pt-1"
      >
        <Button
          type="button"
          :label="t('messageTimeline.loadMore', 'Load more')"
          severity="secondary"
          text
          size="small"
          :loading="loadingMore"
          :disabled="loadingMore"
          @click="loadMore"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.message-timeline-bubble {
  border-radius: 0.75rem;
  border: 1px solid var(--app-border, var(--p-content-border-color));
  padding: 0.65rem 0.85rem;
}

.message-timeline-bubble__title {
  text-decoration: none;
}

.message-timeline-bubble--outgoing {
  background: color-mix(
    in srgb,
    var(--p-primary-color) 18%,
    var(--app-panel, var(--p-content-background))
  );
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--app-border, transparent));
}

.message-timeline-bubble--incoming {
  background: var(--app-panel, var(--p-content-background));
  color: var(--app-text, var(--p-text-color));
}

.message-timeline-field__timeline :deep(.p-timeline-event-opposite),
.message-timeline-field__timeline :deep(.p-timeline-event-content) {
  flex: 1 1 0;
  min-width: 0;
}

.message-timeline-bubble :deep(.compact-record--panel) {
  background: transparent;
  border: none;
  padding: 0;
}
</style>
