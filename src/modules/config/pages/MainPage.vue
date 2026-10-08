<script lang="ts">
export default {
  name: 'MainPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import CrmDataTable from '@/core/ui-kit/CrmDataTable.vue'
import {
  listReadableCollections,
  type ReadableCollectionOption,
} from '@/modules/entities/services/objectRecords'
import { useTranslation } from '@/core/translation'

const router = useRouter()
const { t } = useTranslation()
const collections = ref<ReadableCollectionOption[]>([])
const collectionRows = computed<Record<string, unknown>[]>(() =>
  collections.value.map((collection) => ({
    ...collection,
    description: t(
      'mainPage.collectionDescription',
      'Open the first 100 records readable by your current role.',
    ),
  })),
)
const collectionColumns = computed(() => [
  { field: 'label', header: t('common.collection', 'Collection') },
  { field: 'value', header: t('mainPage.columnKey', 'Key') },
  { field: 'description', header: t('mainPage.columnDescription', 'Description') },
])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  loading.value = true
  error.value = null
  try {
    collections.value = await listReadableCollections()
    if (collections.value.length === 0) {
      error.value = t(
        'mainPage.noReadableCollections',
        'No readable collections are available for this role.',
      )
    }
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('builder.loadCollectionsError', 'Failed to load collections.')
  } finally {
    loading.value = false
  }
})

function openCollection(collection: string): void {
  void router.push({
    name: 'object-list',
    params: { collection },
  })
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <h1>{{ t('mainPage.title', 'Objects') }}</h1>
          <p>{{ t('mainPage.subtitle', 'Select a collection available to your role.') }}</p>
        </div>
        <div class="flex gap-3">
          <RouterLink to="/dashboards" class="nav-link">{{ t('dashboard.title', 'Dashboards') }}</RouterLink>
          <RouterLink to="/setup/objects" class="nav-link">{{ t('setup.title', 'Setup') }}</RouterLink>
        </div>
      </div>
    </header>

    <section class="collection-directory">
      <div v-if="loading" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('mainPage.checkingPermissions', 'Checking collection permissions...') }}</span>
      </div>

      <Message
        v-else-if="error"
        severity="warn"
        :closable="false"
        class="collections-message"
      >
        {{ error }}
      </Message>

      <CrmDataTable
        v-else
        :rows="collectionRows"
        :columns="collectionColumns"
        :empty-message="t('mainPage.noReadableCollections', 'No readable collections are available for this role.')"
      >
        <template #actions="{ row }">
          <Button
            :label="t('mainPage.openRecords', 'Open records')"
            size="small"
            @click="openCollection(String(row.value))"
          />
        </template>
      </CrmDataTable>
    </section>
  </main>
</template>

