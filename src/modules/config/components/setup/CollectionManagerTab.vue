<script lang="ts">
export default {
  name: 'CollectionManagerTab',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouterLink } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  createRegistryEntityViaGraphQL,
  deleteRegistryEntityViaGraphQL,
  type CreateRegistryEntityInput,
} from '@/core/graphql/entitiesApi'
import {
  clearMetadataCache,
  listUserCollections,
  type UserCollectionOption,
} from '@/modules/entities/services/collectionSchema'
import SetupEntityCreateDialog from './SetupEntityCreateDialog.vue'
import SetupEntityDeleteDialog from './SetupEntityDeleteDialog.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t } = useTranslation()
const collections = ref<UserCollectionOption[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const SHOW_INTERNAL_STORAGE_KEY = 'crm.setup.objects.showInternal'

function readShowInternalPreference(): boolean {
  try {
    return sessionStorage.getItem(SHOW_INTERNAL_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeShowInternalPreference(value: boolean): void {
  try {
    sessionStorage.setItem(SHOW_INTERNAL_STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* private mode / quota */
  }
}

const searchQuery = ref('')
const showInternal = ref(readShowInternalPreference())
const createVisible = ref(false)
const deleteVisible = ref(false)
const deletingRow = ref<UserCollectionOption | null>(null)

const filteredRows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return collections.value

  return collections.value.filter(
    (row) =>
      row.label.toLowerCase().includes(query)
      || row.value.toLowerCase().includes(query)
      || row.description.toLowerCase().includes(query),
  )
})

const itemSummary = computed(() =>
  t('setup.itemCountSorted', '{count} Items, Sorted by Label', {
    count: filteredRows.value.length,
  }),
)

async function loadCollections(opts?: { refresh?: boolean }): Promise<void> {
  const refresh = opts?.refresh !== false
  if (refresh) loading.value = true
  error.value = null
  try {
    if (refresh) clearMetadataCache()
    collections.value = await listUserCollections({
      includeInternal: showInternal.value,
      includeHidden: true,
    })
    if (collections.value.length === 0) {
      error.value = t('builder.noUserCollections', 'No user collections found in the registry.')
    }
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('builder.loadCollectionsError', 'Failed to load collections.')
  } finally {
    loading.value = false
  }
}

function onShowInternalChange(value: boolean): void {
  showInternal.value = value
  writeShowInternalPreference(value)
  void loadCollections({ refresh: false })
}

async function handleCreate(payload: {
  input: CreateRegistryEntityInput
  applyDdl: boolean
}): Promise<void> {
  saving.value = true
  try {
    const created = await createRegistryEntityViaGraphQL(
      payload.input,
      payload.applyDdl,
    )
    clearMetadataCache()
    createVisible.value = false
    toast.add({
      severity: 'success',
      summary: payload.applyDdl
        ? t('setup.objects.createdWithDdl', 'Object and crm_schema table created')
        : t('setup.objects.created', 'Object created'),
      life: 3000,
    })
    await router.push({
      name: 'setup-collection',
      params: { collection: created.apiName },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const alreadyExists = /already exists/i.test(message)
    const apiName = payload.input.apiName.trim().toLowerCase().replace(/\s+/g, '_')
    if (alreadyExists && apiName) {
      createVisible.value = false
      toast.add({
        severity: 'warn',
        summary: t('setup.objects.alreadyExists', 'Object already exists'),
        detail: t(
          'setup.objects.alreadyExistsDetail',
          'Opening "{api}" from Object Manager.',
          { api: apiName },
        ),
        life: 5000,
      })
      clearMetadataCache()
      await router.push({
        name: 'setup-collection',
        params: { collection: apiName },
      })
      return
    }
    toast.add({
      severity: 'error',
      summary: t('setup.objects.createError', 'Failed to create object'),
      detail: message,
      life: 6000,
    })
  } finally {
    saving.value = false
  }
}

function openDelete(row: UserCollectionOption): void {
  deletingRow.value = row
  deleteVisible.value = true
}

async function handleDeleteConfirm(): Promise<void> {
  const row = deletingRow.value
  if (!row) return
  saving.value = true
  try {
    await deleteRegistryEntityViaGraphQL(row.value)
    clearMetadataCache()
    deleteVisible.value = false
    deletingRow.value = null
    toast.add({
      severity: 'success',
      summary: t('setup.objects.deleted', 'Object deleted'),
      life: 3000,
    })
    await loadCollections()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('setup.objects.deleteError', 'Failed to delete object'),
      detail: err instanceof Error ? err.message : String(err),
      life: 6000,
    })
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadCollections()
})

watch(
  () => route.fullPath,
  () => {
    if (route.name === 'setup-objects') {
      void loadCollections()
    }
  },
)
</script>

<template>
  <section class="setup-tab-content">
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.objectManager', 'Object Manager') }}</h2>
        <p class="setup-panel-header__meta">
          {{ itemSummary }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="showInternal"
            binary
            input-id="objects-show-internal"
            :disabled="loading || saving"
            @update:model-value="onShowInternalChange"
          />
          <label for="objects-show-internal">
            {{ t('setup.objects.showInternal', 'Show internal') }}
          </label>
        </div>
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
          :label="t('setup.objects.new', 'New')"
          icon="pi pi-plus"
          :disabled="loading || saving"
          @click="createVisible = true"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.loadingCollections', 'Loading collections...') }}</span>
    </div>

    <Message
      v-else-if="error"
      severity="warn"
      :closable="false"
    >
      {{ error }}
    </Message>

    <DataTable
      v-else
      :value="filteredRows"
      striped-rows
      table-style="table-layout: fixed; width: 100%"
      :empty-message="t('setup.noCollections', 'No collections match your search.')"
    >
      <Column
        field="label"
        :header="t('setup.columnLabel', 'Label')"
        sortable
        style="width: 20rem"
        header-style="width: 20rem"
      >
        <template #body="{ data }">
          <div class="setup-objects-label">
            <RouterLink
              :to="{ name: 'setup-collection', params: { collection: data.value } }"
              class="setup-link setup-objects-label__link"
            >
              <i
                v-if="data.icon"
                :class="data.icon"
                class="setup-objects-label__icon"
                aria-hidden="true"
              />
              <span>{{ data.label }}</span>
            </RouterLink>
            <Tag
              v-if="data.internal"
              severity="secondary"
              :value="t('setup.entityParameters.internal', 'Internal')"
            />
            <Tag
              v-if="data.hidden"
              severity="warn"
              :value="t('setup.objects.hidden', 'Hidden')"
            />
          </div>
        </template>
      </Column>
      <Column
        field="value"
        :header="t('setup.columnApiName', 'API Name')"
        sortable
        style="width: 14rem"
        header-style="width: 14rem"
      />
      <Column
        field="description"
        :header="t('setup.columnDescription', 'Description')"
      >
        <template #body="{ data }">
          {{
            data.description
              || t('setup.objectDescriptionEmpty', '—')
          }}
        </template>
      </Column>
      <Column
        :header="t('common.actions', 'Actions')"
        style="width: 5.5rem"
        header-style="width: 5.5rem"
      >
        <template #body="{ data }">
          <Button
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="danger"
            :disabled="saving"
            :aria-label="t('common.delete', 'Delete')"
            @click="openDelete(data)"
          />
        </template>
      </Column>
    </DataTable>

    <SetupEntityCreateDialog
      v-model:visible="createVisible"
      @save="handleCreate"
    />

    <SetupEntityDeleteDialog
      v-model:visible="deleteVisible"
      :api-name="deletingRow?.value ?? ''"
      :label="deletingRow?.label ?? ''"
      @confirm="handleDeleteConfirm"
    />
  </section>
</template>

<style scoped>
.setup-objects-label {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.setup-objects-label__link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.setup-objects-label__icon {
  font-size: 0.95rem;
}
</style>
