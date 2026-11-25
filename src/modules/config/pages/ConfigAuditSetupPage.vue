<script lang="ts">
export default {
  name: 'ConfigAuditSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import {
  fetchConfigAudits,
  type ConfigAuditDto,
} from '@/core/graphql/configAuditApi'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'
import { readUsersBridge } from '@/core/graphql/usersApi'
import { formatAuditUserName } from '@/core/systemAuditDisplay'
import { useTranslation } from '@/core/translation'
import {
  computeConfigAuditChanges,
  type ConfigAuditChange,
} from '@/modules/config/utils/configAuditDiff'
import SetupPageHeader from '../components/setup/SetupPageHeader.vue'

const PAGE_SIZE = 50

const { t } = useTranslation()
const toast = useToast()

const loading = ref(false)
const isAdmin = ref(false)
const rows = ref<ConfigAuditDto[]>([])
const totalCount = ref(0)
const page = ref(0)
const resourceType = ref<string | null>(null)
const resourceKey = ref('')
const detailVisible = ref(false)
const selected = ref<ConfigAuditDto | null>(null)
const actorLabels = ref<Record<string, string>>({})

const resourceTypeOptions = computed(() => [
  { label: t('setup.configAudit.typeAll', 'All types'), value: null },
  { label: t('setup.configAudit.typeEntity', 'Entity'), value: 'entity' },
  { label: t('setup.configAudit.typeField', 'Field'), value: 'field' },
  { label: t('setup.configAudit.typeRole', 'Role'), value: 'role' },
  {
    label: t('setup.configAudit.typeRolePermissions', 'Role permissions'),
    value: 'role_permissions',
  },
  { label: t('setup.configAudit.typeUser', 'User'), value: 'user' },
  { label: t('setup.configAudit.typeLayout', 'Layout'), value: 'layout' },
  {
    label: t('setup.configAudit.typeOrgSetting', 'Org setting'),
    value: 'org_setting',
  },
  {
    label: t('setup.configAudit.typeAutomation', 'Automation'),
    value: 'automation',
  },
  {
    label: t('setup.configAudit.typeUniqueGroups', 'Unique groups'),
    value: 'unique_groups',
  },
  { label: t('setup.configAudit.typeOther', 'Other'), value: 'other' },
])

const rangeLabel = computed(() => {
  if (!totalCount.value) {
    return t('setup.configAudit.emptyRange', 'No entries')
  }
  const from = page.value * PAGE_SIZE + 1
  const to = Math.min((page.value + 1) * PAGE_SIZE, totalCount.value)
  return t('setup.configAudit.range', '{from}–{to} of {total}', {
    from,
    to,
    total: totalCount.value,
  })
})

const canPrev = computed(() => page.value > 0)
const canNext = computed(
  () => (page.value + 1) * PAGE_SIZE < totalCount.value,
)

function showError(err: unknown, fallback: string): void {
  toast.add({
    severity: 'error',
    summary: t('common.error', 'Error'),
    detail: err instanceof Error && err.message ? err.message : fallback,
    life: 5000,
  })
}

function actionSeverity(
  action: string,
): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
  const upper = String(action || '').toUpperCase()
  if (upper === 'CREATE') return 'success'
  if (upper === 'DELETE') return 'danger'
  if (upper === 'REPLACE') return 'warn'
  if (upper === 'UPDATE') return 'info'
  return 'secondary'
}

function actionLabel(action: string): string {
  const upper = String(action || '').toUpperCase()
  if (upper === 'CREATE') return t('setup.configAudit.actionCreate', 'Create')
  if (upper === 'UPDATE') return t('setup.configAudit.actionUpdate', 'Update')
  if (upper === 'DELETE') return t('setup.configAudit.actionDelete', 'Delete')
  if (upper === 'REPLACE') return t('setup.configAudit.actionReplace', 'Replace')
  return action
}

function resourceTypeLabel(type: string): string {
  const match = resourceTypeOptions.value.find((opt) => opt.value === type)
  return match?.label || type
}

function formatWhen(value: string): string {
  return formatLocalizedDateTime(value) || value
}

function actorLabel(userId: string | null | undefined): string {
  const id = String(userId || '').trim()
  if (!id) return t('setup.configAudit.unknownActor', 'Unknown user')
  return actorLabels.value[id] || t('setup.configAudit.unknownActor', 'Unknown user')
}

function rowChanges(row: ConfigAuditDto | null): ConfigAuditChange[] {
  if (!row) return []
  return computeConfigAuditChanges(row.before, row.after, row.action)
}

const selectedChanges = computed(() => rowChanges(selected.value))

function changesSummary(row: ConfigAuditDto): string {
  const changes = rowChanges(row)
  if (!changes.length) return row.summary || '—'
  if (changes.length === 1) {
    return t('setup.configAudit.oneChange', '{field}: {from} → {to}', {
      field: changes[0]!.label,
      from: changes[0]!.previousValue,
      to: changes[0]!.nextValue,
    })
  }
  return t('setup.configAudit.manyChanges', '{count} fields changed', {
    count: changes.length,
  })
}

function isMultilineValue(value: string): boolean {
  return value.includes('\n') || value.length > 80
}

function openDetail(row: ConfigAuditDto): void {
  selected.value = row
  detailVisible.value = true
}

async function hydrateActors(nodes: ConfigAuditDto[]): Promise<void> {
  const ids = [
    ...new Set(
      nodes
        .map((row) => String(row.userId || '').trim())
        .filter(Boolean),
    ),
  ]
  if (!ids.length) {
    actorLabels.value = {}
    return
  }
  try {
    const users = await readUsersBridge({
      ids,
      fields: ['id', 'first_name', 'last_name', 'email'],
      limit: ids.length,
    })
    const next: Record<string, string> = {}
    for (const user of users) {
      const id = String(user.id ?? '').trim()
      if (!id) continue
      const label = formatAuditUserName({
        id: user.id as string | number | null | undefined,
        first_name:
          typeof user.first_name === 'string' ? user.first_name : null,
        last_name: typeof user.last_name === 'string' ? user.last_name : null,
        email: typeof user.email === 'string' ? user.email : null,
      })
      if (label) next[id] = label
    }
    // Keep requested ids mapped when GraphQL returns backend_user_id as id.
    for (const id of ids) {
      if (next[id]) continue
      const match = users.find((user) => String(user.id) === id)
      if (!match) continue
      const label = formatAuditUserName({
        id: match.id as string | number | null | undefined,
        first_name:
          typeof match.first_name === 'string' ? match.first_name : null,
        last_name: typeof match.last_name === 'string' ? match.last_name : null,
        email: typeof match.email === 'string' ? match.email : null,
      })
      if (label) next[id] = label
    }
    actorLabels.value = next
  } catch (err) {
    console.warn('[configAudit] failed to resolve actor labels', err)
    actorLabels.value = {}
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const me = await readCurrentUserBridge()
    isAdmin.value = Boolean(me.adminAccess || me.roleAdminAccess)
    if (!isAdmin.value) {
      rows.value = []
      totalCount.value = 0
      actorLabels.value = {}
      return
    }
    const pageData = await fetchConfigAudits({
      resourceType: resourceType.value,
      resourceKey: resourceKey.value.trim() || null,
      limit: PAGE_SIZE,
      offset: page.value * PAGE_SIZE,
    })
    rows.value = pageData.nodes
    totalCount.value = pageData.totalCount
    await hydrateActors(pageData.nodes)
  } catch (err) {
    showError(err, t('setup.configAudit.loadError', 'Failed to load config audit'))
  } finally {
    loading.value = false
  }
}

function refreshFromStart(): void {
  page.value = 0
  void load()
}

function prevPage(): void {
  if (!canPrev.value) return
  page.value -= 1
  void load()
}

function nextPage(): void {
  if (!canNext.value) return
  page.value += 1
  void load()
}

watch(resourceType, () => {
  refreshFromStart()
})

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-tab-content">
    <SetupPageHeader
      :title="t('setup.configAudit.title', 'Config audit')"
      :meta="
        t(
          'setup.configAudit.subtitle',
          'Append-only trail of Setup changes (entities, fields, roles, permissions, users, layouts).',
        )
      "
      icon-class="pi pi-history"
    >
      <template #actions>
        <Button
          :label="t('common.refresh', 'Refresh')"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          :loading="loading"
          @click="load"
        />
      </template>
    </SetupPageHeader>

    <Message
      v-if="!loading && !isAdmin"
      severity="warn"
      :closable="false"
      class="mb-3"
    >
      {{
        t(
          'setup.configAudit.adminRequired',
          'Administrator access is required to view the config audit trail.',
        )
      }}
    </Message>

    <div
      v-if="isAdmin"
      class="config-audit-toolbar"
    >
      <div class="config-audit-toolbar__filters">
        <Select
          v-model="resourceType"
          :options="resourceTypeOptions"
          option-label="label"
          option-value="value"
          :placeholder="t('setup.configAudit.filterType', 'Resource type')"
          class="config-audit-toolbar__type"
          show-clear
        />
        <InputText
          v-model="resourceKey"
          :placeholder="
            t(
              'setup.configAudit.filterKey',
              'Resource key (e.g. account, employee.salary)',
            )
          "
          class="config-audit-toolbar__key"
          @keyup.enter="refreshFromStart"
        />
        <Button
          :label="t('setup.configAudit.search', 'Search')"
          icon="pi pi-search"
          @click="refreshFromStart"
        />
      </div>
      <div class="config-audit-toolbar__paging">
        <span class="text-muted-color">{{ rangeLabel }}</span>
        <Button
          icon="pi pi-chevron-left"
          severity="secondary"
          text
          :disabled="!canPrev || loading"
          :aria-label="t('setup.configAudit.previous', 'Previous')"
          @click="prevPage"
        />
        <Button
          icon="pi pi-chevron-right"
          severity="secondary"
          text
          :disabled="!canNext || loading"
          :aria-label="t('setup.configAudit.next', 'Next')"
          @click="nextPage"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.configAudit.loading', 'Loading config audit...') }}</span>
    </div>

    <DataTable
      v-else-if="isAdmin"
      :value="rows"
      striped-rows
      data-key="id"
      table-style="table-layout: fixed; width: 100%"
      :empty-message="
        t('setup.configAudit.empty', 'No Setup changes recorded yet.')
      "
    >
      <Column
        field="createdAt"
        :header="t('setup.configAudit.columnWhen', 'When')"
        style="width: 11rem"
        header-style="width: 11rem"
      >
        <template #body="{ data }">
          {{ formatWhen(data.createdAt) }}
        </template>
      </Column>
      <Column
        field="action"
        :header="t('setup.configAudit.columnAction', 'Action')"
        style="width: 7rem"
        header-style="width: 7rem"
      >
        <template #body="{ data }">
          <Tag
            :severity="actionSeverity(data.action)"
            :value="actionLabel(data.action)"
          />
        </template>
      </Column>
      <Column
        field="resourceType"
        :header="t('setup.configAudit.columnType', 'Type')"
        style="width: 9rem"
        header-style="width: 9rem"
      >
        <template #body="{ data }">
          {{ resourceTypeLabel(data.resourceType) }}
        </template>
      </Column>
      <Column
        field="resourceKey"
        :header="t('setup.configAudit.columnKey', 'Resource')"
        style="width: 12rem"
        header-style="width: 12rem"
      >
        <template #body="{ data }">
          <code class="config-audit-key">{{ data.resourceKey }}</code>
        </template>
      </Column>
      <Column
        field="summary"
        :header="t('setup.configAudit.columnSummary', 'Changes')"
      >
        <template #body="{ data }">
          <button
            type="button"
            class="setup-link setup-link--button"
            @click="openDetail(data)"
          >
            {{ changesSummary(data) }}
          </button>
        </template>
      </Column>
      <Column
        field="userId"
        :header="t('setup.configAudit.columnActor', 'Actor')"
        style="width: 10rem"
        header-style="width: 10rem"
      >
        <template #body="{ data }">
          {{ actorLabel(data.userId) }}
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="detailVisible"
      modal
      :header="t('setup.configAudit.detailTitle', 'Config change detail')"
      :style="{ width: 'min(48rem, 96vw)' }"
    >
      <template v-if="selected">
        <dl class="config-audit-detail">
          <div>
            <dt>{{ t('setup.configAudit.columnWhen', 'When') }}</dt>
            <dd>{{ formatWhen(selected.createdAt) }}</dd>
          </div>
          <div>
            <dt>{{ t('setup.configAudit.columnAction', 'Action') }}</dt>
            <dd>{{ actionLabel(selected.action) }}</dd>
          </div>
          <div>
            <dt>{{ t('setup.configAudit.columnType', 'Type') }}</dt>
            <dd>{{ resourceTypeLabel(selected.resourceType) }}</dd>
          </div>
          <div>
            <dt>{{ t('setup.configAudit.columnKey', 'Resource') }}</dt>
            <dd><code>{{ selected.resourceKey }}</code></dd>
          </div>
          <div>
            <dt>{{ t('setup.configAudit.columnActor', 'Actor') }}</dt>
            <dd>{{ actorLabel(selected.userId) }}</dd>
          </div>
          <div class="config-audit-detail__full">
            <dt>{{ t('setup.configAudit.columnSummary', 'Summary') }}</dt>
            <dd>{{ selected.summary || '—' }}</dd>
          </div>
        </dl>

        <p
          v-if="!selectedChanges.length"
          class="text-muted-color m-0"
        >
          {{
            t(
              'setup.configAudit.noDeltaDetails',
              'No field-level changes recorded.',
            )
          }}
        </p>
        <DataTable
          v-else
          :value="selectedChanges"
          data-key="field"
          size="small"
          class="config-audit-deltas"
        >
          <Column
            field="label"
            :header="t('setup.configAudit.columnField', 'Field')"
            style="width: 28%"
          >
            <template #body="{ data }">
              <span class="font-medium">{{ data.label }}</span>
            </template>
          </Column>
          <Column
            :header="t('setup.configAudit.columnOriginalValue', 'Original Value')"
            style="width: 36%"
          >
            <template #body="{ data }">
              <pre
                v-if="isMultilineValue(data.previousValue)"
                class="config-audit-delta__pre"
              >{{ data.previousValue }}</pre>
              <span
                v-else
                class="text-muted-color"
              >{{ data.previousValue }}</span>
            </template>
          </Column>
          <Column
            :header="t('setup.configAudit.columnNewValue', 'New Value')"
            style="width: 36%"
          >
            <template #body="{ data }">
              <pre
                v-if="isMultilineValue(data.nextValue)"
                class="config-audit-delta__pre"
              >{{ data.nextValue }}</pre>
              <span v-else>{{ data.nextValue }}</span>
            </template>
          </Column>
        </DataTable>
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.config-audit-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.config-audit-toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  flex: 1 1 20rem;
}

.config-audit-toolbar__type {
  min-width: 12rem;
}

.config-audit-toolbar__key {
  min-width: 16rem;
  flex: 1 1 14rem;
}

.config-audit-toolbar__paging {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.config-audit-key {
  font-size: 0.85em;
  word-break: break-all;
}

.config-audit-detail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem 1rem;
  margin: 0 0 1rem;
}

.config-audit-detail dt {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  margin-bottom: 0.15rem;
}

.config-audit-detail dd {
  margin: 0;
  word-break: break-word;
}

.config-audit-detail__full {
  grid-column: 1 / -1;
}

.config-audit-deltas {
  margin-top: 0.25rem;
}

.config-audit-delta__pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
  max-height: 10rem;
  overflow: auto;
}
</style>
