<script lang="ts">
export default {
  name: 'SetupSchemaSyncTab',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { featureFlags } from '@/core/graphql/featureFlags'
import {
  fetchEntitySyncStatesFromGraphQL,
  fetchSchemaDriftFromGraphQL,
  runSchemaDriftCheckViaGraphQL,
  runSchemaSyncViaGraphQL,
  type GraphQlEntityDriftReport,
  type GraphQlEntitySyncState,
  type GraphQlSchemaDriftItem,
} from '@/core/graphql/syncApi'
import { useTranslation } from '@/core/translation'

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()

const graphqlEnabled = featureFlags.schemaFromGraphQL
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const states = ref<GraphQlEntitySyncState[]>([])
const driftReports = ref<GraphQlEntityDriftReport[]>([])
const selectedEntity = ref<string | null>(null)
const searchQuery = ref('')

const entityOptions = computed(() =>
  states.value
    .map((row) => ({
      label: row.entityApiName,
      value: row.entityApiName,
    }))
    .sort((a, b) => a.label.localeCompare(b.label)),
)

const filteredStates = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return states.value
  return states.value.filter(
    (row) =>
      row.entityApiName.toLowerCase().includes(query) ||
      row.status.toLowerCase().includes(query),
  )
})

const driftRows = computed<GraphQlSchemaDriftItem[]>(() => {
  const entity = selectedEntity.value
  const reports = entity
    ? driftReports.value.filter((report) => report.entityApiName === entity)
    : driftReports.value
  return reports.flatMap((report) => report.drift)
})

const driftSummary = computed(() => {
  const driftCount = driftReports.value.filter((row) => row.status === 'DRIFT').length
  const okCount = driftReports.value.filter((row) => row.status === 'OK').length
  const errorCount = driftReports.value.filter((row) => row.status === 'ERROR').length
  return t(
    'setup.schemaSync.driftSummary',
    '{ok} OK · {drift} drift · {error} error',
    { ok: okCount, drift: driftCount, error: errorCount },
  )
})

async function refresh(): Promise<void> {
  if (!graphqlEnabled) return
  loading.value = true
  error.value = null
  try {
    const [nextStates, nextDrift] = await Promise.all([
      fetchEntitySyncStatesFromGraphQL(),
      fetchSchemaDriftFromGraphQL(selectedEntity.value),
    ])
    states.value = nextStates
    driftReports.value = nextDrift
    if (
      selectedEntity.value &&
      !nextStates.some((row) => row.entityApiName === selectedEntity.value)
    ) {
      selectedEntity.value = null
    }
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('setup.schemaSync.loadError', 'Failed to load schema sync state.')
  } finally {
    loading.value = false
  }
}

async function runDriftCheck(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const job = await runSchemaDriftCheckViaGraphQL(selectedEntity.value)
    toast.add({
      severity: job.status === 'SUCCEEDED' ? 'success' : 'warn',
      summary: t('setup.schemaSync.driftCheckDone', 'Drift check finished'),
      detail: job.error || job.status,
      life: 4000,
    })
    await refresh()
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('setup.schemaSync.driftCheckError', 'Drift check failed.')
  } finally {
    busy.value = false
  }
}

async function runSync(dryRun: boolean): Promise<void> {
  const entity = selectedEntity.value?.trim()
  if (!entity) {
    toast.add({
      severity: 'warn',
      summary: t('setup.schemaSync.selectEntity', 'Select an entity'),
      detail: t(
        'setup.schemaSync.selectEntityHint',
        'Choose an entity before running schema sync.',
      ),
      life: 3500,
    })
    return
  }

  const execute = async () => {
    busy.value = true
    error.value = null
    try {
      const job = await runSchemaSyncViaGraphQL(entity, dryRun)
      const result = job.result ?? {}
      toast.add({
        severity: job.status === 'SUCCEEDED' && !job.error ? 'success' : 'warn',
        summary: dryRun
          ? t('setup.schemaSync.dryRunDone', 'Dry-run finished')
          : t('setup.schemaSync.applyDone', 'Schema sync applied'),
        detail:
          job.error ||
          t(
            'setup.schemaSync.jobResult',
            'created={created} skipped={skipped} errors={errors} status={status}',
            {
              created: Number(result.createdCount ?? 0),
              skipped: Number(result.skippedCount ?? 0),
              errors: Number(result.errorCount ?? 0),
              status: String(result.statusAfter ?? job.status),
            },
          ),
        life: 5000,
      })
      await refresh()
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : t('setup.schemaSync.syncError', 'Schema sync failed.')
    } finally {
      busy.value = false
    }
  }

  if (dryRun) {
    await execute()
    return
  }

  confirm.require({
    header: t('setup.schemaSync.applyConfirmHeader', 'Apply schema sync'),
    message: t(
      'setup.schemaSync.applyConfirmMessage',
      'Apply schema sync for "{entity}"? This alters crm_schema (columns, backfill, indexes, FKs, unique indexes).',
      { entity },
    ),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.apply', 'Apply'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void execute()
    },
  })
}

onMounted(() => {
  void refresh()
})

watch(selectedEntity, () => {
  if (!graphqlEnabled || loading.value || busy.value) return
  void refresh()
})
</script>

<template>
  <section class="setup-tab-content">
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.schemaSync.title', 'Schema sync') }}</h2>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.schemaSync.subtitle',
              'Registry → crm_schema DDL: add missing columns, backfill from data JSON, indexes, M2O FKs, and unique groups.',
            )
          }}
        </p>
      </div>
    </div>

    <Message
      v-if="!graphqlEnabled"
      severity="warn"
      :closable="false"
    >
      {{
        t(
          'setup.schemaSync.graphqlRequired',
          'Set VITE_DATA_SOURCE=graphql to use schema sync from Setup.',
        )
      }}
    </Message>

    <template v-else>
      <div class="flex flex-wrap items-end gap-3 mb-4">
        <div class="flex flex-col gap-1 min-w-[14rem]">
          <label class="text-sm text-muted-color">
            {{ t('setup.schemaSync.entity', 'Entity') }}
          </label>
          <Select
            v-model="selectedEntity"
            :options="entityOptions"
            option-label="label"
            option-value="value"
            show-clear
            :placeholder="t('setup.schemaSync.allEntities', 'All entities')"
            class="w-full"
            :disabled="busy || loading"
          />
        </div>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
            :disabled="loading"
          />
        </IconField>
        <div class="flex flex-wrap gap-2 ml-auto">
          <Button
            :label="t('setup.schemaSync.refresh', 'Refresh')"
            icon="pi pi-refresh"
            severity="secondary"
            :loading="loading"
            :disabled="busy"
            @click="refresh"
          />
          <Button
            :label="t('setup.schemaSync.runDrift', 'Check drift')"
            icon="pi pi-search"
            severity="secondary"
            :loading="busy"
            :disabled="loading"
            @click="runDriftCheck"
          />
          <Button
            :label="t('setup.schemaSync.dryRun', 'Dry-run sync')"
            icon="pi pi-eye"
            :loading="busy"
            :disabled="loading || !selectedEntity"
            @click="runSync(true)"
          />
          <Button
            :label="t('setup.schemaSync.apply', 'Apply sync')"
            icon="pi pi-cloud-upload"
            severity="danger"
            :loading="busy"
            :disabled="loading || !selectedEntity"
            @click="runSync(false)"
          />
        </div>
      </div>

      <div
        v-if="loading && !states.length"
        class="page-loading"
      >
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('setup.schemaSync.loading', 'Loading sync state...') }}</span>
      </div>

      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
        class="mb-3"
      >
        {{ error }}
      </Message>

      <template v-else>
        <p class="text-muted-color text-sm mb-2">
          {{ driftSummary }}
        </p>

        <DataTable
          :value="filteredStates"
          striped-rows
          size="small"
          class="mb-4"
          :empty-message="t('setup.schemaSync.noStates', 'No entity sync state yet.')"
        >
          <Column
            field="entityApiName"
            :header="t('setup.schemaSync.columnEntity', 'Entity')"
            sortable
          />
          <Column
            field="status"
            :header="t('setup.schemaSync.columnStatus', 'Status')"
            sortable
          >
            <template #body="{ data }">
              <Tag
                :value="data.status"
                :severity="
                  data.status === 'OK'
                    ? 'success'
                    : data.status === 'DRIFT'
                      ? 'warn'
                      : data.status === 'ERROR'
                        ? 'danger'
                        : 'secondary'
                "
              />
            </template>
          </Column>
          <Column
            field="lastSyncedVersion"
            :header="t('setup.schemaSync.columnVersion', 'Version')"
            sortable
          />
          <Column
            field="lastSyncedAt"
            :header="t('setup.schemaSync.columnSyncedAt', 'Last synced')"
            sortable
          />
          <Column
            field="lastError"
            :header="t('setup.schemaSync.columnError', 'Last error')"
          >
            <template #body="{ data }">
              <span class="text-sm">{{ data.lastError || '—' }}</span>
            </template>
          </Column>
        </DataTable>

        <h3 class="text-base font-semibold mb-2">
          {{ t('setup.schemaSync.driftTitle', 'Drift items') }}
        </h3>
        <DataTable
          :value="driftRows"
          striped-rows
          size="small"
          :empty-message="t('setup.schemaSync.noDrift', 'No drift items.')"
        >
          <Column
            field="entityApiName"
            :header="t('setup.schemaSync.columnEntity', 'Entity')"
            sortable
          />
          <Column
            field="fieldApiName"
            :header="t('setup.schemaSync.columnField', 'Field')"
            sortable
          />
          <Column
            field="kind"
            :header="t('setup.schemaSync.columnKind', 'Kind')"
            sortable
          />
          <Column
            field="message"
            :header="t('setup.schemaSync.columnMessage', 'Message')"
          />
        </DataTable>
      </template>
    </template>
  </section>
</template>
