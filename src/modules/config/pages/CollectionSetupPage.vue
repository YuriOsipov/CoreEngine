<script lang="ts">
export default {
  name: 'CollectionSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import SetupCollectionNav from '../components/setup/SetupCollectionNav.vue'
import SetupEntityParametersPanel from '../components/setup/SetupEntityParametersPanel.vue'
import SetupFieldsPanel from '../components/setup/SetupFieldsPanel.vue'
import SetupLayoutEditorDialog from '../components/setup/SetupLayoutEditorDialog.vue'
import SetupLayoutListPanel from '../components/setup/SetupLayoutListPanel.vue'
import SetupRecordAutomationsPanel from '../components/setup/SetupRecordAutomationsPanel.vue'
import { useSetupCollectionSectionSync } from '../composables/useSetupCollectionSectionSync'
import { useSetupLayoutList } from '../composables/useSetupLayoutList'
import { scheduleFeatureAvailable } from '../services/scheduleFeature'
import { useTranslation } from '@/core/translation'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
import {
  DEFAULT_SETUP_SECTION,
  isSetupLayoutSection,
  routeQueryCollectionSection,
  type SetupCollectionSection,
} from '../types/setupCollectionSection'
import type { SetupLayoutType } from '../types/setupLayoutType'

const route = useRoute()
const router = useRouter()
const { t } = useTranslation()

const collection = computed(() => String(route.params.collection ?? ''))
const section = ref<SetupCollectionSection>(routeQueryCollectionSection(route))
const collectionLabel = ref(collection.value)
const editorVisible = ref(false)
const editorLayoutId = ref<string | null>(null)
const scheduleAvailable = ref(false)

// Document Templates moved to App Setup — redirect legacy deep links.
watch(
  section,
  (value) => {
    if (value === 'document') {
      void router.replace({
        name: 'setup-documents',
        query: collection.value ? { collection: collection.value } : undefined,
      })
    }
  },
  { immediate: true },
)

onMounted(() => {
  void scheduleFeatureAvailable().then((available) => {
    scheduleAvailable.value = available
    if (!available && section.value === 'scheduler') {
      section.value = DEFAULT_SETUP_SECTION
    }
  })
})

useSetupCollectionSectionSync(section)

const layoutType = computed<SetupLayoutType>(() =>
  isSetupLayoutSection(section.value) ? section.value : 'recordPage',
)

const showFields = computed(() => section.value === 'fields')
const showParameters = computed(
  () => section.value === 'parameters' || section.value === 'unique',
)
const showAutomations = computed(() => section.value === 'automations')
const showLayouts = computed(() => isSetupLayoutSection(section.value))

const {
  filteredLayouts,
  loading,
  error,
  searchQuery,
  refresh,
} = useSetupLayoutList(collection, layoutType)

void listUserCollections({ includeInternal: true, includeHidden: true }).then((collections) => {
  const match = collections.find((entry) => entry.value === collection.value)
  collectionLabel.value = match?.label ?? collection.value
})

watch(
  () => collection.value,
  () => {
    void listUserCollections({ includeInternal: true, includeHidden: true }).then((collections) => {
      const match = collections.find((entry) => entry.value === collection.value)
      collectionLabel.value = match?.label ?? collection.value
    })
  },
)

function openEditor(layoutId: string | null): void {
  editorLayoutId.value = layoutId
  editorVisible.value = true
}

function handleEditorSaved(): void {
  void refresh()
}
</script>

<template>
  <section class="setup-collection-page">
    <header class="setup-collection-page__header">
      <p class="setup-collection-page__breadcrumb">
        <RouterLink
          to="/setup/objects"
          class="setup-link"
        >
          {{ t('setup.title', 'Setup') }}
        </RouterLink>
        <span> &gt; </span>
        <RouterLink
          to="/setup/objects"
          class="setup-link"
        >
          {{ t('setup.objectManager', 'Object Manager') }}
        </RouterLink>
        <span> &gt; {{ collectionLabel }}</span>
      </p>
      <h2>{{ collectionLabel }}</h2>
    </header>

    <Message
      v-if="error && showLayouts"
      severity="error"
      :closable="false"
      class="mb-3"
    >
      {{ error }}
    </Message>

    <div class="setup-collection-page__body">
      <SetupCollectionNav v-model="section" />

      <SetupFieldsPanel
        v-if="showFields"
        :collection="collection"
      />

      <SetupEntityParametersPanel
        v-else-if="showParameters"
        :collection="collection"
      />

      <SetupRecordAutomationsPanel
        v-else-if="showAutomations"
        :collection="collection"
      />

      <SetupLayoutListPanel
        v-else
        :collection="collection"
        :layout-type="layoutType"
        :layouts="filteredLayouts"
        :loading="loading"
        :search-query="searchQuery"
        @update:search-query="searchQuery = $event"
        @new-layout="openEditor(null)"
        @edit-layout="openEditor($event)"
        @deleted="refresh()"
      />
    </div>

    <SetupLayoutEditorDialog
      v-model:visible="editorVisible"
      :collection="collection"
      :layout-type="layoutType"
      :layout-id="editorLayoutId"
      @saved="handleEditorSaved"
    />
  </section>
</template>
