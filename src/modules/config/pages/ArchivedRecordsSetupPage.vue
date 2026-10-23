<script lang="ts">
export default {
  name: 'ArchivedRecordsSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import CrmDataTable from '@/core/ui-kit/CrmDataTable.vue'
import { defaultDateTimeDisplayFormat } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'
import type { DataTableColumnConfig, DataTableSettings } from '@/interfaces'
import { loadCompactRecordDetailsSetting } from '@/modules/config/services/layoutSettings'
import {
  getCachedCollectionFields,
  listUserCollections,
  type UserCollectionOption,
} from '@/modules/entities/services/collectionSchema'
import {
  fetchObjectRecords,
  type ObjectRecordColumn,
} from '@/modules/entities/services/objectRecords'
import {
  hardDeleteObjectRecord,
  restoreObjectRecord,
} from '@/modules/entities/services/recordDetails'
import { formatDisplayValue } from '@/modules/entities/utils/recordDisplay'

const ALL_OBJECTS_VALUE = '__all__'
const ROW_KEY_FIELD = '__rowKey'
const COLLECTION_FIELD = '__collection'
const OBJECT_LABEL_FIELD = '__objectLabel'
const PER_COLLECTION_LIMIT = 100

const SKIP_COMPACT_FIELDS = new Set([
  'id',
  'name',
  'status',
  'is_deleted',
  'is_active',
  'sort',
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
])

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const collections = ref<UserCollectionOption[]>([])
const collectionsLoading = ref(true)
const selectedCollection = ref<string | null>(ALL_OBJECTS_VALUE)
const rows = ref<Record<string, unknown>[]>([])
const columns = ref<ObjectRecordColumn[]>([])
const primaryKey = ref(ROW_KEY_FIELD)
const totalCount = ref(0)
const loading = ref(false)
const bulkBusy = ref(false)
const restoringId = ref<string | null>(null)
const selectedRows = ref<Record<string, unknown>[]>([])
const searchQuery = ref('')
const loadError = ref<string | null>(null)

const isAllObjects = computed(() => selectedCollection.value === ALL_OBJECTS_VALUE)

const collectionOptions = computed(() => [
  {
    label: t('setup.archived.allObjects', 'All objects'),
    value: ALL_OBJECTS_VALUE,
  },
  ...collections.value.map((c) => ({ label: c.label, value: c.value })),
])

const collectionLabelByValue = computed(() => {
  const map = new Map<string, string>()
  for (const collection of collections.value) {
    map.set(collection.value, collection.label)
  }
  return map
})

const filteredRows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return rows.value
  return rows.value.filter((row) => {
    const haystack = [
      ...columns.value.map((column) => cellSearchText(row[column.field])),
      cellSearchText(row[OBJECT_LABEL_FIELD]),
      cellSearchText(row[COLLECTION_FIELD]),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
})

const selectedCount = computed(() => selectedRows.value.length)

const itemSummary = computed(() => {
  if (!selectedCollection.value) return ''
  const shown = filteredRows.value.length
  const total = totalCount.value
  if (searchQuery.value.trim() && shown !== total) {
    return t('setup.archived.filteredCount', '{shown} of {total} archived records', {
      shown,
      total,
    })
  }
  return t('setup.archived.itemCount', '{count} archived records', { count: total })
})

const canHardDeleteSelected = computed(
  () => selectedCount.value > 0 && !loading.value && !bulkBusy.value,
)
const canHardDeleteAll = computed(
  () => filteredRows.value.length > 0 && !loading.value && !bulkBusy.value,
)

function cellSearchText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('label' in value) return String((value as { label?: unknown }).label ?? '')
    return formatDisplayValue(value, { arrayDisplay: 'count' })
  }
  return String(value)
}

function allObjectsColumns(): ObjectRecordColumn[] {
  return [
    {
      field: OBJECT_LABEL_FIELD,
      header: t('setup.archived.objectColumn', 'Object'),
      enabled: true,
    },
    {
      field: 'name',
      header: t('common.name', 'Name'),
      enabled: true,
    },
    {
      field: 'user_updated',
      header: t('setup.archived.whoDeleted', 'Who deleted'),
      enabled: true,
    },
    {
      field: 'date_updated',
      header: t('setup.archived.whenDeleted', 'When deleted'),
      format: defaultDateTimeDisplayFormat(),
      enabled: true,
    },
  ]
}

async function buildArchivedTableSettings(
  collection: string,
): Promise<DataTableSettings> {
  const [fields, compact] = await Promise.all([
    getCachedCollectionFields(collection),
    loadCompactRecordDetailsSetting(collection),
  ])
  const fieldNames = new Set(fields.map((field) => field.field))
  const columnsConfig: DataTableColumnConfig[] = []

  if (fieldNames.has('name')) {
    columnsConfig.push({
      field: 'name',
      header: t('common.name', 'Name'),
      enabled: true,
    })
  }

  for (const compactField of compact?.fields ?? []) {
    const fieldKey = compactField.field?.trim()
    if (!fieldKey || SKIP_COMPACT_FIELDS.has(fieldKey)) continue
    if (!fieldNames.has(fieldKey.split('.')[0] ?? fieldKey)) continue
    columnsConfig.push({
      field: fieldKey,
      header: compactField.label || fieldKey,
      relatedCollection: compactField.relatedCollection,
      format: compactField.format,
      enabled: true,
    })
  }

  if (fieldNames.has('user_updated')) {
    columnsConfig.push({
      field: 'user_updated',
      header: t('setup.archived.whoDeleted', 'Who deleted'),
      enabled: true,
    })
  }

  if (fieldNames.has('date_updated')) {
    columnsConfig.push({
      field: 'date_updated',
      header: t('setup.archived.whenDeleted', 'When deleted'),
      format: defaultDateTimeDisplayFormat(),
      enabled: true,
    })
  }

  return {
    columns: columnsConfig,
    recordLinkField: fieldNames.has('name') ? 'name' : null,
  }
}

function toArchiveRow(
  collection: string,
  objectLabel: string,
  record: Record<string, unknown>,
  recordPrimaryKey: string,
): Record<string, unknown> {
  const id = record[recordPrimaryKey]
  const idText = id === null || id === undefined ? '' : String(id)
  return {
    ...record,
    [COLLECTION_FIELD]: collection,
    [OBJECT_LABEL_FIELD]: objectLabel,
    [ROW_KEY_FIELD]: `${collection}:${idText}`,
  }
}

async function loadCollections(): Promise<void> {
  collectionsLoading.value = true
  try {
    collections.value = await listUserCollections()
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('builder.loadCollectionsError', 'Failed to load collections.'),
      life: 4000,
    })
  } finally {
    collectionsLoading.value = false
  }
}

async function loadSingleCollection(collection: string): Promise<void> {
  const tableSettings = await buildArchivedTableSettings(collection)
  const list = await fetchObjectRecords(collection, null, tableSettings, {
    archivedOnly: true,
    limit: 200,
    offset: 0,
  })
  const objectLabel =
    collectionLabelByValue.value.get(collection) ?? list.label ?? collection
  rows.value = list.records.map((record) =>
    toArchiveRow(collection, objectLabel, record, list.primaryKey),
  )
  columns.value = list.columns
  primaryKey.value = ROW_KEY_FIELD
  totalCount.value = list.totalCount
}

async function loadAllCollections(): Promise<void> {
  const results = await Promise.allSettled(
    collections.value.map(async (collection) => {
      const tableSettings: DataTableSettings = {
        columns: [
          { field: 'name', header: 'Name', enabled: true },
          { field: 'user_updated', header: 'Who deleted', enabled: true },
          {
            field: 'date_updated',
            header: 'When deleted',
            format: defaultDateTimeDisplayFormat(),
            enabled: true,
          },
        ],
        recordLinkField: 'name',
      }
      try {
        const list = await fetchObjectRecords(collection.value, null, tableSettings, {
          archivedOnly: true,
          limit: PER_COLLECTION_LIMIT,
          offset: 0,
        })
        return {
          collection: collection.value,
          label: collection.label,
          list,
        }
      } catch {
        // Entities without status / archived support are skipped.
        return {
          collection: collection.value,
          label: collection.label,
          list: null,
        }
      }
    }),
  )

  const merged: Record<string, unknown>[] = []
  let total = 0
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value.list) continue
    const { collection, label, list } = result.value
    total += list.totalCount
    for (const record of list.records) {
      merged.push(toArchiveRow(collection, label, record, list.primaryKey))
    }
  }

  merged.sort((a, b) => {
    const aDate = String(a.date_updated ?? '')
    const bDate = String(b.date_updated ?? '')
    return bDate.localeCompare(aDate)
  })

  rows.value = merged
  columns.value = allObjectsColumns()
  primaryKey.value = ROW_KEY_FIELD
  totalCount.value = total
}

async function loadArchivedRecords(): Promise<void> {
  const scope = selectedCollection.value
  if (!scope) return

  loading.value = true
  loadError.value = null
  selectedRows.value = []
  try {
    if (scope === ALL_OBJECTS_VALUE) {
      await loadAllCollections()
    } else {
      await loadSingleCollection(scope)
    }
  } catch (error) {
    rows.value = []
    columns.value = []
    totalCount.value = 0
    loadError.value =
      error instanceof Error
        ? error.message
        : t('setup.archived.loadError', 'Failed to load archived records.')
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: loadError.value,
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

function syncCollectionQuery(collection: string | null): void {
  const nextQuery = { ...route.query }
  if (collection && collection !== ALL_OBJECTS_VALUE) {
    nextQuery.collection = collection
  } else if (collection === ALL_OBJECTS_VALUE) {
    nextQuery.collection = ALL_OBJECTS_VALUE
  } else {
    delete nextQuery.collection
  }
  void router.replace({ query: nextQuery })
}

function onCollectionChange(value: string | null): void {
  selectedCollection.value = value || ALL_OBJECTS_VALUE
  searchQuery.value = ''
  selectedRows.value = []
  syncCollectionQuery(selectedCollection.value)
  void loadArchivedRecords()
}

function rowKey(row: Record<string, unknown>): string | null {
  const id = row[ROW_KEY_FIELD] ?? row[primaryKey.value]
  if (id === null || id === undefined || id === '') return null
  return String(id)
}

function rowCollection(row: Record<string, unknown>): string | null {
  const fromRow = row[COLLECTION_FIELD]
  if (typeof fromRow === 'string' && fromRow.trim()) return fromRow
  if (selectedCollection.value && selectedCollection.value !== ALL_OBJECTS_VALUE) {
    return selectedCollection.value
  }
  return null
}

function rowRecordId(row: Record<string, unknown>): string | null {
  const id = row.id
  if (id === null || id === undefined || id === '') return null
  return String(id)
}

function restoreRow(row: Record<string, unknown>): void {
  const collection = rowCollection(row)
  const id = rowRecordId(row)
  if (!collection || !id) return

  confirm.require({
    message: t('datatable.confirmRestoreMessage', 'Restore this record?'),
    header: t('datatable.confirmRestoreHeader', 'Confirm Restore'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('common.restore', 'Restore'),
    },
    accept: () => {
      void restoreRowConfirmed(collection, id)
    },
  })
}

async function restoreRowConfirmed(collection: string, id: string): Promise<void> {
  restoringId.value = `${collection}:${id}`
  try {
    await restoreObjectRecord(collection, id)
    toast.add({
      severity: 'success',
      summary: t('common.restore', 'Restore'),
      detail: t('datatable.restoreSuccess', 'Record restored.'),
      life: 3000,
    })
    await loadArchivedRecords()
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('datatable.restoreError', 'Failed to restore record.'),
      life: 4000,
    })
  } finally {
    restoringId.value = null
  }
}

async function hardDeleteRows(targets: Record<string, unknown>[]): Promise<void> {
  if (!targets.length) return
  bulkBusy.value = true
  let deleted = 0
  let failed = 0
  try {
    for (const row of targets) {
      const collection = rowCollection(row)
      const id = rowRecordId(row)
      if (!collection || !id) {
        failed += 1
        continue
      }
      try {
        await hardDeleteObjectRecord(collection, id)
        deleted += 1
      } catch {
        failed += 1
      }
    }
    if (deleted > 0) {
      toast.add({
        severity: 'success',
        summary: t('setup.archived.hardDelete', 'Delete permanently'),
        detail: t('setup.archived.hardDeleteSuccess', 'Permanently deleted {count} record(s).', {
          count: deleted,
        }),
        life: 4000,
      })
    }
    if (failed > 0) {
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail: t(
          'setup.archived.hardDeletePartialError',
          'Failed to permanently delete {count} record(s).',
          { count: failed },
        ),
        life: 5000,
      })
    }
    await loadArchivedRecords()
  } finally {
    bulkBusy.value = false
  }
}

function confirmHardDeleteSelected(): void {
  const targets = selectedRows.value
  if (!targets.length) return
  confirm.require({
    message: t(
      'setup.archived.hardDeleteSelectedMessage',
      'Permanently delete {count} selected archived record(s)? This cannot be undone.',
      { count: targets.length },
    ),
    header: t('setup.archived.hardDelete', 'Delete permanently'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('setup.archived.hardDelete', 'Delete permanently'),
      severity: 'danger',
    },
    accept: () => {
      void hardDeleteRows(targets)
    },
  })
}

function confirmHardDeleteAll(): void {
  const targets = filteredRows.value
  if (!targets.length) return
  confirm.require({
    message: t(
      'setup.archived.hardDeleteAllMessage',
      'Permanently delete all {count} archived record(s) in the current list? This cannot be undone.',
      { count: targets.length },
    ),
    header: t('setup.archived.hardDeleteAll', 'Delete all permanently'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('setup.archived.hardDeleteAll', 'Delete all permanently'),
      severity: 'danger',
    },
    accept: () => {
      void hardDeleteRows(targets)
    },
  })
}

function handleRefresh(): void {
  void loadArchivedRecords()
}

function resolveInitialCollection(): string {
  const fromQuery =
    typeof route.query.collection === 'string' ? route.query.collection.trim() : ''
  if (fromQuery === ALL_OBJECTS_VALUE) return ALL_OBJECTS_VALUE
  if (fromQuery && collections.value.some((c) => c.value === fromQuery)) return fromQuery
  return ALL_OBJECTS_VALUE
}

onMounted(async () => {
  await loadCollections()
  selectedCollection.value = resolveInitialCollection()
  syncCollectionQuery(selectedCollection.value)
  await loadArchivedRecords()
})

watch(
  () => route.query.collection,
  (value) => {
    const next =
      typeof value === 'string' && value.trim()
        ? value.trim()
        : ALL_OBJECTS_VALUE
    if (next === selectedCollection.value) return
    if (
      next !== ALL_OBJECTS_VALUE &&
      !collections.value.some((c) => c.value === next)
    ) {
      return
    }
    selectedCollection.value = next
    searchQuery.value = ''
    selectedRows.value = []
    void loadArchivedRecords()
  },
)
</script>

<template>
  <section class="setup-tab-content flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h2>{{ t('setup.archived.title', 'Archived records') }}</h2>
      <p class="text-muted-color m-0">
        {{
          t(
            'setup.archived.subtitle',
            'Browse soft-deleted records by object and restore them when needed.',
          )
        }}
      </p>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1 min-w-[240px]">
        <label for="archived-object-select" class="text-[0.85rem]">
          {{ t('setup.archived.selectObject', 'Object') }}
        </label>
        <Select
          input-id="archived-object-select"
          :model-value="selectedCollection"
          :options="collectionOptions"
          option-label="label"
          option-value="value"
          :placeholder="t('setup.archived.selectObjectPlaceholder', 'Select an object')"
          :loading="collectionsLoading"
          filter
          class="w-full"
          @update:model-value="onCollectionChange"
        />
      </div>
      <div class="flex flex-col gap-1 min-w-[220px] flex-1">
        <label for="archived-search" class="text-[0.85rem]">
          {{ t('setup.archived.search', 'Filter records') }}
        </label>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            id="archived-search"
            v-model="searchQuery"
            class="w-full"
            :placeholder="t('setup.archived.searchPlaceholder', 'Search archived rows…')"
          />
        </IconField>
      </div>
      <Button
        :label="t('common.refresh', 'Refresh')"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        :loading="loading"
        @click="handleRefresh"
      />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <p
        v-if="itemSummary"
        class="text-muted-color text-[0.85rem] m-0 mr-auto"
      >
        {{ itemSummary }}
        <span v-if="isAllObjects" class="ml-1">
          ({{ t('setup.archived.allObjects', 'All objects') }})
        </span>
      </p>
      <Button
        :label="
          t('setup.archived.hardDeleteSelected', 'Delete selected ({count})', {
            count: selectedCount,
          })
        "
        icon="pi pi-trash"
        size="small"
        severity="danger"
        outlined
        :disabled="!canHardDeleteSelected"
        :loading="bulkBusy"
        @click="confirmHardDeleteSelected"
      />
      <Button
        :label="t('setup.archived.hardDeleteAll', 'Delete all permanently')"
        icon="pi pi-trash"
        size="small"
        severity="danger"
        :disabled="!canHardDeleteAll"
        :loading="bulkBusy"
        @click="confirmHardDeleteAll"
      />
    </div>

    <Message
      v-if="loadError"
      severity="warn"
      :closable="false"
    >
      {{ loadError }}
    </Message>

    <CrmDataTable
      v-else
      v-model:selection="selectedRows"
      selection-mode="multiple"
      :rows="filteredRows"
      :columns="columns"
      :collection="isAllObjects ? '' : selectedCollection || ''"
      :primary-key="primaryKey"
      :loading="loading"
      :total-records="filteredRows.length"
      paginator
      :rows-per-page="25"
      :show-new-button="false"
      :show-delete-button="false"
      :show-edit-record-action="false"
      :show-view-record-action="false"
      :record-links-enabled="false"
      :empty-message="t('setup.archived.empty', 'No archived records found for this object.')"
    >
      <template #actions="{ row }">
        <Button
          :label="t('common.restore', 'Restore')"
          icon="pi pi-replay"
          size="small"
          severity="success"
          outlined
          :loading="restoringId === rowKey(row)"
          :disabled="Boolean(restoringId) || bulkBusy"
          @click.stop="restoreRow(row)"
        />
      </template>
    </CrmDataTable>
  </section>
</template>
