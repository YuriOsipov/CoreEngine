<script lang="ts">
export default {
  name: 'SetupFieldsPanel',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useTranslation } from '@/core/translation'
import type { LayoutFieldChildLookup } from '@/interfaces'
import {
  createRegistryFieldViaGraphQL,
  deleteRegistryFieldViaGraphQL,
  fetchEntityFieldsAndRelations,
  updateRegistryFieldViaGraphQL,
  type RegistryFieldInputDto,
  type RegistryFieldListRow,
} from '@/core/graphql/fieldsApi'
import {
  clearMetadataCache,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import { normalizeFieldInterface } from '@/core/graphql/schemaMapper'
import {
  deleteChildLookupFieldSetting,
  saveChildLookupFieldSetting,
} from '@/modules/config/services/layoutSettings'
import SetupFieldEditorDialog from './SetupFieldEditorDialog.vue'

const props = defineProps<{
  collection: string
}>()

const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()

const loading = ref(false)
const saving = ref(false)
const searchQuery = ref('')
const fields = ref<RegistryFieldListRow[]>([])
const entityOptions = ref<Array<{ label: string; value: string }>>([])

const editorVisible = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editingField = ref<RegistryFieldListRow | null>(null)

function formatErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('fields_entity_api_name_unique')) {
    return t(
      'setup.fields.duplicateApiName',
      'A field with this API name already exists on this object.',
    )
  }
  return raw
}

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: formatErrorMessage(err),
    life: 6000,
  })
}

const filteredFields = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return fields.value
  return fields.value.filter(
    (f) =>
      f.label.toLowerCase().includes(q) ||
      f.apiName.toLowerCase().includes(q) ||
      f.type.toLowerCase().includes(q) ||
      (f.relationKind ?? '').toLowerCase().includes(q) ||
      (f.relatedEntityApiName ?? '').toLowerCase().includes(q),
  )
})

const itemSummary = computed(() =>
  t('setup.itemCountSorted', '{count} Items, Sorted by Label', {
    count: filteredFields.value.length,
  }),
)

function isEffectivelyIndexed(row: RegistryFieldListRow): boolean {
  return (
    Boolean(row.isIndexed) ||
    Boolean(row.isUnique) ||
    row.relationKind === 'M2O'
  )
}

function dataTypeLabel(row: RegistryFieldListRow): string {
  // M2O === Lookup (same relation kind; prefer human "Lookup" label).
  if (row.relationKind === 'M2O') {
    const target = row.relatedEntityApiName?.trim()
    if (target) {
      return t('setup.fields.lookupOf', 'Lookup ({entity})', { entity: target })
    }
    return t('setup.fields.lookup', 'Lookup')
  }
  if (row.relationKind === 'M2M') {
    const target = row.relatedEntityApiName?.trim()
    if (target) {
      return t('setup.fields.m2mOf', 'Many-to-Many ({entity})', {
        entity: target,
      })
    }
    return t('setup.fields.relationM2M', 'Many-to-Many')
  }
  if (row.relationKind) {
    return `${row.relationKind}${row.relatedEntityApiName ? ` → ${row.relatedEntityApiName}` : ''}`
  }
  const options = row.options ?? {}
  const mode = String(options.computeMode ?? options.compute_mode ?? '')
    .trim()
    .toLowerCase()
  if (mode === 'formula' || (typeof options.template === 'string' && options.template.trim())) {
    return `${row.type} · ${t('setup.fields.computeFormulaShort', 'Formula')}`
  }
  if (mode === 'rollup' || (options.rollup && typeof options.rollup === 'object')) {
    return `${row.type} · ${t('setup.fields.computeRollupShort', 'Rollup')}`
  }
  if (
    mode === 'autonumber' ||
    options.autoNumber === true ||
    (options.autoNumber && typeof options.autoNumber === 'object')
  ) {
    return t('setup.fields.typeAutoNumber', 'Auto Number')
  }
  const iface = normalizeFieldInterface(row.interface || '')
  if (iface === 'address' || String(row.interface || '').toLowerCase().includes('address')) {
    return t('setup.fields.typeAddress', 'Address')
  }
  if (iface === 'select-dropdown') {
    return `${row.type} · ${t('setup.fields.ifacePicklist', 'Picklist')}`
  }
  return row.type
}

async function load(): Promise<void> {
  if (!props.collection) return
  loading.value = true
  try {
    const data = await fetchEntityFieldsAndRelations(props.collection)
    fields.value = data.fields
  } catch (err) {
    showError(err, t('setup.fields.loadError', 'Failed to load fields'))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editorMode.value = 'create'
  editingField.value = null
  editorVisible.value = true
}

function openEdit(row: RegistryFieldListRow): void {
  editorMode.value = 'edit'
  editingField.value = row
  editorVisible.value = true
}

async function handleSave(payload: {
  input: RegistryFieldInputDto
  applyDdl: boolean
  childLookup?: {
    enabled: boolean
    settings: LayoutFieldChildLookup | null
  }
}): Promise<void> {
  saving.value = true
  try {
    if (editorMode.value === 'create') {
      await createRegistryFieldViaGraphQL(
        props.collection,
        payload.input,
        payload.applyDdl,
      )
      toast.add({
        severity: 'success',
        summary: t('setup.fields.created', 'Field created'),
        detail: payload.applyDdl
          ? t('setup.fields.createdWithDdl', 'Registry + crm_schema updated')
          : t(
              'setup.fields.createdRegistryOnly',
              'Saved to registry (DDL skipped)',
            ),
        life: 4000,
      })
    } else if (editingField.value) {
      await updateRegistryFieldViaGraphQL(
        editingField.value.id,
        payload.input,
        payload.applyDdl,
      )
      toast.add({
        severity: 'success',
        summary: t('setup.fields.updated', 'Field updated'),
        life: 3000,
      })
    }

    if (payload.childLookup) {
      await saveChildLookupFieldSetting(
        props.collection,
        payload.input.apiName,
        payload.childLookup.enabled ? payload.childLookup.settings : null,
        null,
      )
    }

    clearMetadataCache()
    editorVisible.value = false
    await load()
  } catch (err) {
    showError(err, t('setup.fields.saveError', 'Failed to save field'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(row: RegistryFieldListRow): void {
  if (row.isSystem) {
    toast.add({
      severity: 'warn',
      summary: t('setup.fields.systemProtected', 'System field'),
      detail: t(
        'setup.fields.cannotDeleteSystem',
        'System fields cannot be deleted.',
      ),
      life: 4000,
    })
    return
  }
  confirm.require({
    header: t('setup.fields.deleteHeader', 'Delete field'),
    message: t(
      'setup.fields.deleteMessage',
      'Remove "{label}" ({api}) from the registry? The physical crm_schema column is kept (data safety).',
      { label: row.label, api: row.apiName },
    ),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.delete', 'Delete'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void doDelete(row)
    },
  })
}

async function doDelete(row: RegistryFieldListRow): Promise<void> {
  saving.value = true
  try {
    await deleteRegistryFieldViaGraphQL(props.collection, row.apiName, false)
    try {
      await deleteChildLookupFieldSetting(props.collection, row.apiName, null)
    } catch {
      // Field registry delete succeeded; orphaned lookup settings are non-fatal.
    }
    clearMetadataCache()
    toast.add({
      severity: 'success',
      summary: t('setup.fields.deleted', 'Field deleted'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.fields.deleteError', 'Failed to delete field'))
  } finally {
    saving.value = false
  }
}

watch(
  () => props.collection,
  () => {
    void load()
  },
)

onMounted(() => {
  void load()
  void listUserCollections({ includeInternal: true, includeHidden: true }).then((cols) => {
    entityOptions.value = cols.map((c) => ({
      label: `${c.label} (${c.value})`,
      value: c.value,
    }))
  })
})
</script>

<template>
  <section class="setup-fields-panel">
    <div class="setup-panel-header">
      <div>
        <h3 class="m-0">
          {{ t('setup.fieldsAndRelationships', 'Fields & Relationships') }}
        </h3>
        <p class="setup-panel-header__meta">
          {{ itemSummary }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
            :disabled="loading || saving"
          />
        </IconField>
        <Button
          :label="t('setup.fields.new', 'New')"
          icon="pi pi-plus"
          :disabled="loading || saving"
          @click="openCreate"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.fields.loading', 'Loading fields...') }}</span>
    </div>

    <DataTable
      v-else
      :value="filteredFields"
      striped-rows
      size="small"
      :empty-message="t('setup.fields.empty', 'No fields yet.')"
    >
      <Column
        field="label"
        :header="t('setup.fields.columnLabel', 'Field Label')"
        sortable
      >
        <template #body="{ data }">
          <button
            type="button"
            class="setup-link setup-link--button"
            @click="openEdit(data)"
          >
            {{ data.label }}
          </button>
        </template>
      </Column>
      <Column
        field="apiName"
        :header="t('setup.fields.columnApiName', 'Field Name')"
        sortable
      />
      <Column
        :header="t('setup.fields.columnDataType', 'Data Type')"
        sortable
        sort-field="type"
      >
        <template #body="{ data }">
          {{ dataTypeLabel(data) }}
        </template>
      </Column>
      <Column
        field="required"
        :header="t('setup.fields.columnRequired', 'Required')"
      >
        <template #body="{ data }">
          <i
            v-if="data.required"
            class="pi pi-check"
          />
        </template>
      </Column>
      <Column
        field="isUnique"
        :header="t('setup.fields.columnUnique', 'Unique')"
      >
        <template #body="{ data }">
          <i
            v-if="data.isUnique"
            class="pi pi-check"
          />
        </template>
      </Column>
      <Column
        :header="t('setup.fields.columnIndexed', 'Indexed')"
        sortable
        sort-field="isIndexed"
      >
        <template #body="{ data }">
          <i
            v-if="isEffectivelyIndexed(data)"
            class="pi pi-check"
          />
        </template>
      </Column>
      <Column
        field="isSystem"
        :header="t('setup.fields.columnSystem', 'System')"
      >
        <template #body="{ data }">
          <Tag
            v-if="data.isSystem"
            severity="secondary"
            :value="t('setup.fields.system', 'System')"
          />
        </template>
      </Column>
      <Column :header="t('setup.columnActions', 'Actions')">
        <template #body="{ data }">
          <div class="flex gap-2">
            <Button
              icon="pi pi-pencil"
              text
              rounded
              size="small"
              :aria-label="t('common.edit', 'Edit')"
              @click="openEdit(data)"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              :disabled="data.isSystem"
              :aria-label="t('common.delete', 'Delete')"
              @click="confirmDelete(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <SetupFieldEditorDialog
      v-model:visible="editorVisible"
      :mode="editorMode"
      :field="editingField"
      :collection="collection"
      :entity-options="entityOptions"
      @save="handleSave"
    />
  </section>
</template>
