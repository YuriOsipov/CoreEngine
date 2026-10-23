<script lang="ts">
export default {
  name: 'ActivityLogPage',
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import ActivityLogField from '@/modules/entities/components/ActivityLogField.vue'
import {
  ACTIVITY_LOG_PAGE_SIZE,
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  normalizeActivityLogSettings,
  type LayoutFieldMetadata,
} from '@/interfaces'
import { resolveRecordPageLayoutForCurrentUser } from '@/modules/config/services/recordPageSettings'
import {
  buildRecordPageActivityLogField,
  listRecordPageActivityLogFields,
} from '@/modules/config/utils/recordPageActivityLog'
import { fetchObjectRecord } from '../services/recordDetails'
import { fetchCollectionDisplayTemplate } from '../services/collectionSchema'
import { renderTemplateLabel } from '../utils/recordDisplay'
import {
  useTranslation,
  useTranslatedCollection,
} from '@/core/translation'
import { useFavoriteContext } from '@/core/navigation/useFavoriteContext'

const route = useRoute()
const { t } = useTranslation()
const collectionName = computed(() => String(route.params.collection ?? ''))
const collectionLabel = useTranslatedCollection(() => collectionName.value)
const recordId = computed(() => String(route.params.id ?? ''))

const activityField = ref<LayoutFieldMetadata | null>(null)
const parentRecord = ref<Record<string, unknown>>({})
const loading = ref(false)
const error = ref<string | null>(null)

const { setFavoriteContext, clearFavoriteContext } = useFavoriteContext()

const pageTitle = computed(
  () =>
    activityField.value?.label?.trim() ||
    t('activityLog.title', 'Activity history'),
)

watchEffect(() => {
  const collection = collectionName.value
  const id = recordId.value
  const record = parentRecord.value
  if (!collection || !id || !Object.keys(record).length) return

  void fetchCollectionDisplayTemplate(collection).then((template) => {
    const parentName = template
      ? renderTemplateLabel(template, record)
      : String(record.id ?? id)
    setFavoriteContext({
      defaultLabel: `${collectionLabel.value} · ${parentName} · ${pageTitle.value}`,
      target: {
        kind: 'url',
        href: `/object/${collection}/${id}/activity`,
        external: false,
      },
    })
  })
})
onUnmounted(clearFavoriteContext)

async function loadPage(collection: string, id: string): Promise<void> {
  if (!collection || !id) {
    activityField.value = null
    parentRecord.value = {}
    return
  }

  loading.value = true
  error.value = null
  try {
    const [pageLayout, record] = await Promise.all([
      resolveRecordPageLayoutForCurrentUser(collection),
      fetchObjectRecord(collection, id),
    ])
    parentRecord.value = record
    const fromLayout = listRecordPageActivityLogFields(collection, pageLayout)
    activityField.value =
      fromLayout[0] ??
      buildRecordPageActivityLogField(collection, {
        id: 'activity-log-page',
        field: `activity_log:${collection}`,
        label: t('activityLog.title', 'Activity history'),
        activityLog: normalizeActivityLogSettings(DEFAULT_ACTIVITY_LOG_SETTINGS),
      })
  } catch (loadError) {
    activityField.value = null
    parentRecord.value = {}
    error.value =
      loadError instanceof Error
        ? loadError.message
        : t('activityLog.loadFailed', 'Unable to load activity history.')
  } finally {
    loading.value = false
  }
}

watch(
  [collectionName, recordId],
  ([collection, id]) => {
    void loadPage(collection, id)
  },
  { immediate: true },
)
</script>

<template>
  <main class="app-shell activity-log-page">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <RouterLink
            :to="`/object/${collectionName}/${recordId}`"
            class="nav-link"
          >
            {{
              t('activityLog.backToRecord', 'Back to {collection} record', {
                collection: collectionLabel,
              })
            }}
          </RouterLink>
          <h1>{{ pageTitle }}</h1>
          <p>
            {{
              t('activityLog.pageSubtitle', 'Full activity history for this {collection}.', {
                collection: collectionLabel,
              })
            }}
          </p>
        </div>
      </div>
    </header>

    <section class="workspace-pane activity-log-page__pane min-h-0">
      <div v-if="loading" class="page-loading">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('activityLog.loading', 'Loading activity history…') }}</span>
      </div>

      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
        class="collections-message"
      >
        {{ error }}
      </Message>

      <ActivityLogField
        v-else-if="activityField"
        class="activity-log-page__field"
        :field="activityField"
        :collection="collectionName"
        :record-id="recordId"
        mode="full"
        :show-view-all="false"
        :page-size="ACTIVITY_LOG_PAGE_SIZE"
      />
    </section>
  </main>
</template>

<style scoped>
.activity-log-page__pane {
  display: flex;
  flex-direction: column;
  margin-top: 1rem;
}

.activity-log-page__field {
  min-height: 0;
}
</style>
