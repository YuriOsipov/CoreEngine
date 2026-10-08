<script lang="ts">
export default {
  name: 'DocumentTemplatesSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'
import type { DocTemplateListItem } from '@/interfaces'
import {
  deleteDocTemplate,
  loadAllDocTemplateListItems,
} from '@/modules/documents/services/docTemplateService'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
import SetupLayoutEditorDialog from '../components/setup/SetupLayoutEditorDialog.vue'

const route = useRoute()
const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()

const templates = ref<DocTemplateListItem[]>([])
const collectionOptions = ref<Array<{ label: string; value: string }>>([])
const loading = ref(false)
const searchQuery = ref('')
const collectionFilter = ref<string | null>(
  typeof route.query.collection === 'string' && route.query.collection.trim()
    ? route.query.collection.trim()
    : null,
)

const editorVisible = ref(false)
const editorCollection = ref('')
const editorLayoutId = ref<string | null>(null)

const createCollectionVisible = ref(false)
const createCollection = ref<string | null>(null)

const collectionLabelByApi = computed(() => {
  const map = new Map<string, string>()
  for (const opt of collectionOptions.value) {
    map.set(opt.value, opt.label)
  }
  return map
})

const filteredTemplates = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return templates.value.filter((row) => {
    if (collectionFilter.value && row.collection !== collectionFilter.value) {
      return false
    }
    if (!q) return true
    const collectionLabel = row.collection
      ? collectionLabelByApi.value.get(row.collection) ?? row.collection
      : ''
    return (
      row.name.toLowerCase().includes(q) ||
      (row.description ?? '').toLowerCase().includes(q) ||
      (row.collection ?? '').toLowerCase().includes(q) ||
      collectionLabel.toLowerCase().includes(q) ||
      (row.roleName ?? '').toLowerCase().includes(q)
    )
  })
})

const itemSummary = computed(() =>
  t('setup.itemCountSortedByName', '{count} Items, Sorted by Name', {
    count: filteredTemplates.value.length,
  }),
)

function collectionLabel(apiName: string | null | undefined): string {
  if (!apiName) return '—'
  return collectionLabelByApi.value.get(apiName) ?? apiName
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [rows, collections] = await Promise.all([
      loadAllDocTemplateListItems('setup'),
      listUserCollections(),
    ])
    templates.value = rows
    collectionOptions.value = collections.map((c) => ({
      label: `${c.label} (${c.value})`,
      value: c.value,
    }))
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('documents.loadTemplatesError', 'Failed to load document templates.'),
      detail: err instanceof Error ? err.message : String(err),
      life: 6000,
    })
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  createCollection.value = collectionFilter.value
  createCollectionVisible.value = true
}

function confirmCreateCollection(): void {
  if (!createCollection.value) return
  editorCollection.value = createCollection.value
  editorLayoutId.value = null
  createCollectionVisible.value = false
  editorVisible.value = true
}

function openEdit(row: DocTemplateListItem): void {
  if (!row.collection) {
    toast.add({
      severity: 'warn',
      summary: t(
        'setup.documents.missingCollection',
        'This template has no source object.',
      ),
      life: 4000,
    })
    return
  }
  editorCollection.value = row.collection
  editorLayoutId.value = row.id
  editorVisible.value = true
}

function confirmDelete(row: DocTemplateListItem): void {
  confirm.require({
    header: t('setup.documents.deleteHeader', 'Delete template'),
    message: t(
      'setup.documents.deleteMessage',
      'Delete template "{name}"?',
      { name: row.name },
    ),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.delete', 'Delete'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void doDelete(row)
    },
  })
}

async function doDelete(row: DocTemplateListItem): Promise<void> {
  try {
    await deleteDocTemplate(row.id)
    toast.add({
      severity: 'success',
      summary: t('setup.documents.deleted', 'Template deleted'),
      life: 3000,
    })
    await load()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('setup.documents.deleteError', 'Failed to delete template'),
      detail: err instanceof Error ? err.message : String(err),
      life: 6000,
    })
  }
}

function handleEditorSaved(): void {
  void load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-tab-content">
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.layoutType.documentTemplates', 'Document Templates') }}</h2>
        <p class="setup-panel-header__meta">
          {{ itemSummary }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <Select
          v-model="collectionFilter"
          :options="collectionOptions"
          option-label="label"
          option-value="value"
          show-clear
          filter
          class="setup-documents-collection-filter"
          :placeholder="t('setup.documents.filterObject', 'All objects')"
          :disabled="loading"
        />
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
            :disabled="loading"
          />
        </IconField>
        <Button
          :label="t('setup.objects.new', 'New')"
          icon="pi pi-plus"
          :disabled="loading"
          @click="openCreate"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('documents.loadingTemplates', 'Loading templates...') }}</span>
    </div>

    <DataTable
      v-else
      :value="filteredTemplates"
      striped-rows
      table-style="table-layout: fixed; width: 100%"
      :empty-message="t('documents.noTemplates', 'No document templates yet.')"
    >
      <Column
        field="name"
        :header="t('setup.columnLayoutName', 'Name')"
        sortable
      >
        <template #body="{ data }">
          <button
            type="button"
            class="setup-link"
            @click="openEdit(data)"
          >
            {{ data.name }}
          </button>
        </template>
      </Column>
      <Column
        field="description"
        :header="t('documents.templateDescription', 'Description')"
        sortable
      >
        <template #body="{ data }">
          <span
            class="setup-documents-description"
            :title="data.description || undefined"
          >
            {{ data.description?.trim() || '—' }}
          </span>
        </template>
      </Column>
      <Column
        field="collection"
        :header="t('setup.documents.columnObject', 'Object')"
        sortable
        style="width: 14rem"
      >
        <template #body="{ data }">
          {{ collectionLabel(data.collection) }}
        </template>
      </Column>
      <Column
        field="roleName"
        :header="t('layoutRole.role', 'Role')"
        sortable
        style="width: 12rem"
      >
        <template #body="{ data }">
          {{
            data.roleName
              || t('layoutRole.defaultRole', 'Default (all roles)')
          }}
        </template>
      </Column>
      <Column
        field="dateUpdated"
        :header="t('setup.columnModified', 'Modified')"
        sortable
        style="width: 12rem"
      >
        <template #body="{ data }">
          {{
            data.dateUpdated
              ? formatLocalizedDateTime(data.dateUpdated)
              : '—'
          }}
        </template>
      </Column>
      <Column
        header=""
        style="width: 5.5rem"
      >
        <template #body="{ data }">
          <Button
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="danger"
            :aria-label="t('common.delete', 'Delete')"
            @click="confirmDelete(data)"
          />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="createCollectionVisible"
      modal
      :header="t('setup.documents.newTemplate', 'New document template')"
      :style="{ width: 'min(28rem, 95vw)' }"
    >
      <div class="flex flex-col gap-2">
        <label>{{ t('setup.documents.sourceObject', 'Source object') }}</label>
        <Select
          v-model="createCollection"
          :options="collectionOptions"
          option-label="label"
          option-value="value"
          filter
          class="w-full"
          :placeholder="t('setup.fields.selectEntity', 'Select object')"
        />
        <small class="text-muted-color">
          {{
            t(
              'setup.documents.sourceObjectHint',
              'Fields from this object are available for mapping in the template.',
            )
          }}
        </small>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          severity="secondary"
          text
          @click="createCollectionVisible = false"
        />
        <Button
          :label="t('common.ok', 'OK')"
          :disabled="!createCollection"
          @click="confirmCreateCollection"
        />
      </template>
    </Dialog>

    <SetupLayoutEditorDialog
      v-model:visible="editorVisible"
      :collection="editorCollection"
      layout-type="document"
      :layout-id="editorLayoutId"
      @saved="handleEditorSaved"
    />
  </section>
</template>

<style scoped>
.setup-documents-collection-filter {
  min-width: 14rem;
}

.setup-documents-description {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setup-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--p-primary-color);
  font: inherit;
  text-align: left;
}

.setup-link:hover {
  text-decoration: underline;
}
</style>
