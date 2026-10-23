<script lang="ts">
export default {
  name: 'SetupGeneralTab',
}
</script>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  getDataSource,
  getRecordsSource,
  getRegistrySource,
} from '@/core/graphql/featureFlags'
import { fetchBffHealth } from '@/core/graphql/registryApi'
import { useTranslation } from '@/core/translation'

const { t } = useTranslation()

const dataSource = getDataSource()
const recordsSource = getRecordsSource()
const registrySource = getRegistrySource()

const healthLoading = ref(false)
const healthOk = ref<boolean | null>(null)
const healthDetail = ref<string | null>(null)

onMounted(async () => {
  if (dataSource !== 'graphql') {
    healthOk.value = null
    healthDetail.value = t(
      'setup.dataSources.bffSkipped',
      'BFF health check skipped (VITE_DATA_SOURCE is not graphql).',
    )
    return
  }

  healthLoading.value = true
  try {
    const { health } = await fetchBffHealth()
    healthOk.value = Boolean(health.ok)
    healthDetail.value = t(
      'setup.dataSources.bffDetail',
      '{service} · entities {entities} · translations {translations}',
      {
        service: health.service || 'crm-bff',
        entities: health.registryEntities ?? 0,
        translations: health.translationEntries ?? 0,
      },
    )
  } catch (error) {
    healthOk.value = false
    healthDetail.value =
      error instanceof Error
        ? error.message
        : t('setup.dataSources.bffFailed', 'BFF health check failed')
  } finally {
    healthLoading.value = false
  }
})
</script>

<template>
  <section class="setup-tab-content flex flex-col gap-4">
    <h2>{{ t('setup.generalTitle', 'General') }}</h2>

    <div class="border border-surface-200 rounded-lg p-4 flex flex-col gap-3">
      <div class="font-semibold">
        {{ t('setup.dataSources.title', 'Data sources') }}
      </div>
      <div class="flex flex-wrap gap-2">
        <Tag
          severity="secondary"
          :value="
            t('setup.dataSources.dataTag', 'Data: {source}', { source: dataSource })
          "
        />
        <Tag
          severity="secondary"
          :value="
            t('setup.dataSources.recordsTag', 'Records: {source}', {
              source: recordsSource,
            })
          "
        />
        <Tag
          severity="secondary"
          :value="
            t('setup.dataSources.registryTag', 'Registry: {source}', {
              source: registrySource,
            })
          "
        />
        <Tag
          v-if="healthLoading"
          severity="info"
          :value="t('setup.dataSources.bffChecking', 'BFF: checking…')"
        />
        <Tag
          v-else-if="healthOk === true"
          severity="success"
          :value="t('setup.dataSources.bffOk', 'BFF: ok')"
        />
        <Tag
          v-else-if="healthOk === false"
          severity="danger"
          :value="t('setup.dataSources.bffDown', 'BFF: down')"
        />
        <Tag
          v-else
          severity="secondary"
          :value="t('setup.dataSources.bffIdle', 'BFF: n/a')"
        />
      </div>
      <p v-if="healthDetail" class="text-muted-color text-[0.8rem] m-0">
        {{ healthDetail }}
      </p>
    </div>

    <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
      <RouterLink
        :to="{ name: 'setup-schedule' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-calendar-clock text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('schedule.setupTitle', 'Schedule') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'schedule.setupLinkHint',
                'Provider work-time templates and slot generation.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-tasks' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-clock text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.tasks.title', 'Tasks') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.tasks.linkHint',
                'Schedule slot generation, database verification, and notifications.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-schema-sync' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-sync text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.schemaSync.title', 'Schema sync') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.schemaSync.linkHint',
                'Review registry sync status for SUPABASE/PLATFORM entities.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-archived' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-inbox text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.archived.title', 'Archived records') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.archived.linkHint',
                'Browse and restore soft-deleted records by object.',
              )
            }}
          </span>
        </span>
      </RouterLink>
    </div>
  </section>
</template>
