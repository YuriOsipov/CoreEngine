<script lang="ts">
export default {
  name: 'FlowTriggersSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { featureFlags } from '@/core/graphql/featureFlags'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'
import {
  deleteFlowTrigger,
  fetchFailedFlowDispatches,
  fetchFlowTriggers,
  upsertFlowTrigger,
  type GraphQlFlowDispatch,
  type GraphQlFlowTrigger,
} from '@/core/graphql/flowTriggersApi'
import { useTranslation } from '@/core/translation'
import SetupPageHeader from '../components/setup/SetupPageHeader.vue'

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()

const graphqlEnabled = featureFlags.schemaFromGraphQL
const loading = ref(false)
const saving = ref(false)
const isAdmin = ref(false)
const flows = ref<GraphQlFlowTrigger[]>([])
const failedRuns = ref<GraphQlFlowDispatch[]>([])
const failedVisible = ref(false)
const failedLoading = ref(false)
const searchQuery = ref('')
const dialogVisible = ref(false)
const editingKey = ref<string | null>(null)
/** Config keys the dialog does not edit (patch, allowedFields, allowedRoles, …). */
const editingConfig = ref<Record<string, unknown>>({})

const form = reactive({
  key: '',
  enabled: true,
  description: '',
  /**
   * Customer's n8n (ce-{key}), Activepieces (flowId), or custom absolute URL.
   * CoreEngine does not ship either automation engine.
   */
  httpTarget: 'n8n' as 'n8n' | 'activepieces' | 'url',
  /** Activepieces Catch Webhook Live URL id (last path segment). */
  flowId: '',
  /** Append /sync so the destination waits and returns the workflow response. */
  sync: false,
  url: '',
  method: 'POST',
  authType: 'none' as string,
  authToken: '',
  authHeaderName: 'X-API-Key',
  authHeaderValue: '',
  authUsername: '',
  authPassword: '',
})

const httpTargetOptions = computed(() => [
  {
    label: t('setup.flows.httpTargetN8n', 'Your n8n (recommended)'),
    value: 'n8n',
  },
  {
    label: t('setup.flows.httpTargetActivepieces', 'Your Activepieces (MIT)'),
    value: 'activepieces',
  },
  {
    label: t('setup.flows.httpTargetUrl', 'Custom URL'),
    value: 'url',
  },
])

const methodOptions = [
  { label: 'POST', value: 'POST' },
  { label: 'GET', value: 'GET' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' },
  { label: 'DELETE', value: 'DELETE' },
]

const authTypeOptions = computed(() => [
  { label: t('setup.flows.authNone', 'None'), value: 'none' },
  { label: t('setup.flows.authBearer', 'Bearer token'), value: 'bearer' },
  { label: t('setup.flows.authApiKey', 'API key header'), value: 'api_key' },
  { label: t('setup.flows.authBasic', 'Basic auth'), value: 'basic' },
])

const failedRunsLabel = computed(() => {
  const count = failedRuns.value.length
  if (!count) return t('setup.flows.failedRuns', 'Failed runs')
  if (count >= 50) return t('setup.flows.failedRunsCount', 'Failed runs ({count})', { count: '50+' })
  return t('setup.flows.failedRunsCount', 'Failed runs ({count})', { count })
})

const filteredFlows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return flows.value
  return flows.value.filter((flow) => {
    const url =
      typeof flow.config?.url === 'string' ? flow.config.url.toLowerCase() : ''
    const target =
      typeof flow.config?.target === 'string'
        ? flow.config.target.toLowerCase()
        : ''
    return (
      flow.key.toLowerCase().includes(query) ||
      flow.handler.toLowerCase().includes(query) ||
      (flow.description || '').toLowerCase().includes(query) ||
      url.includes(query) ||
      target.includes(query)
    )
  })
})

function showError(err: unknown, fallback: string): void {
  const detail = err instanceof Error && err.message ? err.message : fallback
  toast.add({
    severity: 'error',
    summary: t('common.error', 'Error'),
    detail,
    life: 5000,
  })
}

function handlerLabel(handler: string): string {
  if (handler === 'http') return t('setup.flows.handlerHttpShort', 'HTTP')
  return handler
}

function destinationLabel(flow: GraphQlFlowTrigger): string {
  if (flow.handler !== 'http') return '—'
  const target =
    typeof flow.config?.target === 'string'
      ? flow.config.target.trim().toLowerCase()
      : ''
  if (target === 'n8n') {
    return t('setup.flows.destinationN8n', 'n8n (ce-{key})', {
      key: flow.key,
    })
  }
  if (target === 'activepieces') {
    const flowId =
      typeof flow.config?.flowId === 'string' ? flow.config.flowId : ''
    return t('setup.flows.destinationActivepieces', 'Activepieces ({flowId})', {
      flowId: flowId || '—',
    })
  }
  const url = typeof flow.config?.url === 'string' ? flow.config.url : ''
  return url || '—'
}

function resetAuthFields(): void {
  form.authType = 'none'
  form.authToken = ''
  form.authHeaderName = 'X-API-Key'
  form.authHeaderValue = ''
  form.authUsername = ''
  form.authPassword = ''
}

function resetForm(): void {
  form.key = ''
  form.enabled = true
  form.description = ''
  form.httpTarget = 'n8n'
  form.flowId = ''
  form.sync = false
  form.url = ''
  form.method = 'POST'
  resetAuthFields()
  editingKey.value = null
  editingConfig.value = {}
}

function loadAuthFromConfig(config: Record<string, unknown>): void {
  resetAuthFields()
  const auth =
    config.auth && typeof config.auth === 'object' && !Array.isArray(config.auth)
      ? (config.auth as Record<string, unknown>)
      : null
  if (!auth) return
  const type = String(auth.type || 'none').trim().toLowerCase()
  if (type === 'bearer') {
    form.authType = 'bearer'
    form.authToken = String(auth.token ?? '')
    return
  }
  if (type === 'api_key' || type === 'apikey') {
    form.authType = 'api_key'
    form.authHeaderName = String(auth.headerName ?? auth.header_name ?? 'X-API-Key')
    form.authHeaderValue = String(
      auth.headerValue ?? auth.header_value ?? auth.token ?? '',
    )
    return
  }
  if (type === 'basic') {
    form.authType = 'basic'
    form.authUsername = String(auth.username ?? '')
    form.authPassword = String(auth.password ?? '')
  }
}

function buildAuthConfig(): Record<string, unknown> {
  if (form.authType === 'bearer') {
    return { type: 'bearer', token: form.authToken.trim() }
  }
  if (form.authType === 'api_key') {
    return {
      type: 'api_key',
      headerName: form.authHeaderName.trim() || 'X-API-Key',
      headerValue: form.authHeaderValue.trim(),
    }
  }
  if (form.authType === 'basic') {
    return {
      type: 'basic',
      username: form.authUsername.trim(),
      password: form.authPassword,
    }
  }
  return { type: 'none' }
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(flow: GraphQlFlowTrigger): void {
  editingKey.value = flow.key
  editingConfig.value = { ...(flow.config ?? {}) }
  form.key = flow.key
  form.enabled = flow.enabled
  form.description = flow.description || ''
  // Legacy non-http rows (e.g. removed update_record) must be re-saved as HTTP.
  const isHttp = flow.handler === 'http'
  const target =
    isHttp && typeof flow.config?.target === 'string'
      ? flow.config.target.trim().toLowerCase()
      : ''
  form.httpTarget =
    target === 'n8n' || target === 'activepieces' ? target : 'url'
  form.flowId =
    isHttp && typeof flow.config?.flowId === 'string' ? flow.config.flowId : ''
  form.sync = isHttp
    ? flow.config?.sync === true ||
      String(flow.config?.sync || '')
        .trim()
        .toLowerCase() === 'true'
    : false
  form.url = isHttp && typeof flow.config?.url === 'string' ? flow.config.url : ''
  form.method =
    isHttp && typeof flow.config?.method === 'string' && flow.config.method
      ? String(flow.config.method).toUpperCase()
      : 'POST'
  if (isHttp) loadAuthFromConfig(flow.config ?? {})
  else resetAuthFields()
  dialogVisible.value = true
}

async function load(): Promise<void> {
  if (!graphqlEnabled) return
  loading.value = true
  try {
    const me = await readCurrentUserBridge()
    isAdmin.value = Boolean(me.adminAccess || me.roleAdminAccess)
    if (!isAdmin.value) {
      flows.value = []
      return
    }
    flows.value = await fetchFlowTriggers()
    try {
      failedRuns.value = await fetchFailedFlowDispatches(50)
    } catch (err) {
      failedRuns.value = []
      showError(err, t('setup.flows.failedRunsError', 'Failed to load external flow run errors'))
    }
  } catch (err) {
    showError(err, t('setup.flows.loadError', 'Failed to load external flows'))
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  const key = form.key.trim()
  if (!key) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.keyRequired', 'External flow key is required.'),
      life: 4000,
    })
    return
  }
  if (form.httpTarget === 'url' && !form.url.trim()) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.urlRequired', 'HTTP URL is required.'),
      life: 4000,
    })
    return
  }
  if (form.httpTarget === 'activepieces' && !form.flowId.trim()) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'setup.flows.flowIdRequired',
        'Activepieces flow id is required (Catch Webhook Live URL).',
      ),
      life: 4000,
    })
    return
  }
  if (
    form.httpTarget === 'url' &&
    form.authType === 'bearer' &&
    !form.authToken.trim()
  ) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.authTokenRequired', 'Bearer token is required.'),
      life: 4000,
    })
    return
  }
  if (
    form.httpTarget === 'url' &&
    form.authType === 'api_key' &&
    !form.authHeaderValue.trim()
  ) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.authHeaderValueRequired', 'API key value is required.'),
      life: 4000,
    })
    return
  }
  if (
    form.httpTarget === 'url' &&
    form.authType === 'basic' &&
    !form.authUsername.trim()
  ) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.authUsernameRequired', 'Basic auth username is required.'),
      life: 4000,
    })
    return
  }

  saving.value = true
  try {
    const preserved = editingConfig.value
    const config: Record<string, unknown> =
      form.httpTarget === 'n8n'
        ? {
            allowedRoles: preserved.allowedRoles,
            target: 'n8n',
            ...(form.sync ? { sync: true } : {}),
            method: form.method || 'POST',
            headers: { Accept: 'application/json' },
            auth: { type: 'none' },
          }
        : form.httpTarget === 'activepieces'
          ? {
              allowedRoles: preserved.allowedRoles,
              target: 'activepieces',
              flowId: form.flowId.trim(),
              ...(form.sync ? { sync: true } : {}),
              method: form.method || 'POST',
              headers: { Accept: 'application/json' },
              auth: { type: 'none' },
            }
          : {
              allowedRoles: preserved.allowedRoles,
              url: form.url.trim(),
              ...(form.sync ? { sync: true } : {}),
              method: form.method || 'POST',
              headers: { Accept: 'application/json' },
              auth: buildAuthConfig(),
            }

    await upsertFlowTrigger({
      key,
      handler: 'http',
      enabled: form.enabled,
      description: form.description.trim() || null,
      config,
    })
    dialogVisible.value = false
    await load()
    toast.add({
      severity: 'success',
      summary: t('setup.flows.saved', 'External flow saved'),
      detail: t(
        'setup.flows.savedDetail',
        'Use this key in Automations → Call external flow.',
      ),
      life: 4000,
    })
  } catch (err) {
    showError(err, t('setup.flows.saveError', 'Failed to save external flow'))
  } finally {
    saving.value = false
  }
}

async function openFailedRuns(): Promise<void> {
  failedVisible.value = true
  failedLoading.value = true
  try {
    failedRuns.value = await fetchFailedFlowDispatches(50)
  } catch (err) {
    failedRuns.value = []
    showError(err, t('setup.flows.failedRunsError', 'Failed to load external flow run errors'))
  } finally {
    failedLoading.value = false
  }
}

function recordLabel(row: GraphQlFlowDispatch): string {
  const collection = row.collection || ''
  const id = row.recordId || ''
  if (collection && id) return `${collection} / ${id}`
  return collection || id || '—'
}

function confirmDelete(flow: GraphQlFlowTrigger): void {
  confirm.require({
    message: t(
      'setup.flows.deleteConfirm',
      'Delete external flow "{key}"? Automations that use this key will fail until updated.',
      { key: flow.key },
    ),
    header: t('setup.flows.delete', 'Delete external flow'),
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: {
      label: t('common.delete', 'Delete'),
      severity: 'danger',
    },
    accept: () => {
      void (async () => {
        try {
          await deleteFlowTrigger(flow.key)
          await load()
          toast.add({
            severity: 'success',
            summary: t('setup.flows.deleted', 'External flow deleted'),
            life: 3000,
          })
        } catch (err) {
          showError(err, t('setup.flows.deleteError', 'Failed to delete external flow'))
        }
      })()
    },
  })
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-tab-content">
    <SetupPageHeader
      :title="t('setup.flows.title', 'External Flows')"
      :meta="
        t(
          'setup.flows.subtitle',
          'Map an external flow key to your n8n or an external HTTP webhook (or update record). Use the key in Automations → Call external flow.',
        )
      "
      icon-class="pi pi-link"
    >
      <template #actions>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
          />
        </IconField>
        <Button
          :label="failedRunsLabel"
          icon="pi pi-exclamation-triangle"
          severity="secondary"
          outlined
          :disabled="!isAdmin || !graphqlEnabled"
          @click="openFailedRuns"
        />
        <Button
          :label="t('setup.flows.new', 'New external flow')"
          icon="pi pi-plus"
          :disabled="!isAdmin || !graphqlEnabled"
          @click="openCreate"
        />
      </template>
    </SetupPageHeader>

    <Message
      v-if="!graphqlEnabled"
      severity="warn"
      :closable="false"
    >
      {{
        t(
          'setup.flows.graphqlRequired',
          'Set VITE_DATA_SOURCE=graphql to manage external flows.',
        )
      }}
    </Message>

    <Message
      v-else-if="!loading && !isAdmin"
      severity="warn"
      :closable="false"
    >
      {{ t('setup.access.adminRequired', 'Admin access is required.') }}
    </Message>

    <div
      v-else-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.flows.loading', 'Loading external flows...') }}</span>
    </div>

    <DataTable
      v-else-if="isAdmin"
      :value="filteredFlows"
      striped-rows
      data-key="key"
      :empty-message="t('setup.flows.empty', 'No external flows yet. Create one to map a key to n8n or an external URL.')"
    >
      <Column
        field="key"
        :header="t('setup.flows.columnKey', 'Key')"
        sortable
      >
        <template #body="{ data }">
          <button
            type="button"
            class="p-0 border-none bg-transparent text-primary cursor-pointer font-medium"
            @click="openEdit(data)"
          >
            {{ data.key }}
          </button>
        </template>
      </Column>
      <Column
        field="handler"
        :header="t('setup.flows.columnHandler', 'Handler')"
        style="width: 9rem"
      >
        <template #body="{ data }">
          <Tag
            :severity="data.handler === 'http' ? 'success' : 'secondary'"
            :value="handlerLabel(data.handler)"
          />
        </template>
      </Column>
      <Column
        :header="t('setup.flows.columnDestination', 'Destination')"
      >
        <template #body="{ data }">
          <span class="text-[0.85rem] break-all">{{ destinationLabel(data) }}</span>
        </template>
      </Column>
      <Column
        field="enabled"
        :header="t('setup.flows.columnEnabled', 'Enabled')"
        style="width: 7rem"
      >
        <template #body="{ data }">
          <Tag
            :severity="data.enabled ? 'success' : 'secondary'"
            :value="
              data.enabled
                ? t('setup.flows.on', 'On')
                : t('setup.flows.off', 'Off')
            "
          />
        </template>
      </Column>
      <Column
        field="updatedAt"
        :header="t('setup.flows.columnUpdated', 'Updated')"
        style="width: 11rem"
      >
        <template #body="{ data }">
          <span class="text-muted-color text-[0.8rem]">
            {{ formatLocalizedDateTime(data.updatedAt) || '—' }}
          </span>
        </template>
      </Column>
      <Column
        style="width: 6rem"
        :header="t('common.actions', 'Actions')"
      >
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              icon="pi pi-pencil"
              text
              rounded
              severity="secondary"
              :aria-label="t('common.edit', 'Edit')"
              @click="openEdit(data)"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              :aria-label="t('common.delete', 'Delete')"
              @click="confirmDelete(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="failedVisible"
      modal
      :header="t('setup.flows.failedRunsTitle', 'Failed external flow runs')"
      :style="{ width: 'min(840px, 95vw)' }"
    >
      <p class="text-muted-color text-[0.85rem] mt-0">
        {{
          t(
            'setup.flows.failedRunsHint',
            'Outbound connection calls that failed. n8n execution errors stay in n8n — import the failed-execution alert template.',
          )
        }}
      </p>
      <div
        v-if="failedLoading"
        class="page-loading"
      >
        <ProgressSpinner stroke-width="4" />
      </div>
      <DataTable
        v-else
        :value="failedRuns"
        striped-rows
        data-key="id"
        :empty-message="t('setup.flows.failedRunsEmpty', 'No failed external flow runs.')"
      >
        <Column
          field="startedAt"
          :header="t('setup.flows.columnWhen', 'When')"
          style="width: 11rem"
        >
          <template #body="{ data }">
            {{ formatLocalizedDateTime(data.startedAt) || '—' }}
          </template>
        </Column>
        <Column
          field="flowKey"
          :header="t('setup.flows.columnKey', 'Key')"
          style="width: 9rem"
        />
        <Column
          field="source"
          :header="t('setup.flows.columnSource', 'Source')"
          style="width: 9rem"
        />
        <Column
          :header="t('setup.flows.columnRecord', 'Record')"
          style="width: 12rem"
        >
          <template #body="{ data }">
            <span class="text-[0.8rem] break-all">{{ recordLabel(data) }}</span>
          </template>
        </Column>
        <Column
          field="error"
          :header="t('setup.flows.columnError', 'Error')"
        >
          <template #body="{ data }">
            <span class="text-[0.8rem] break-all">{{ data.error || '—' }}</span>
          </template>
        </Column>
      </DataTable>
    </Dialog>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="
        editingKey
          ? t('setup.flows.editTitle', 'Edit external flow')
          : t('setup.flows.createTitle', 'New external flow')
      "
      class="w-full max-w-xl"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-[0.85rem] font-medium">
            {{ t('setup.flows.key', 'External flow key') }}
          </label>
          <InputText
            v-model="form.key"
            :disabled="Boolean(editingKey)"
            :placeholder="t('setup.flows.keyPlaceholder', 'test_hook')"
          />
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.flows.keyHint',
                'This key is what you enter in Automations → Call external flow.',
              )
            }}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-[0.85rem] font-medium">
            {{ t('setup.flows.handler', 'Handler') }}
          </label>
          <Select
            v-model="form.handler"
            :options="handlerOptions"
            option-label="label"
            option-value="value"
          />
        </div>

        <template v-if="form.handler === 'http'">
          <div class="flex flex-col gap-1">
            <label class="text-[0.85rem] font-medium">
              {{ t('setup.flows.httpTarget', 'Destination') }}
            </label>
            <Select
              v-model="form.httpTarget"
              :options="httpTargetOptions"
              option-label="label"
              option-value="value"
            />
            <span class="text-muted-color text-[0.8rem]">
              {{
                form.httpTarget === 'n8n'
                  ? t(
                      'setup.flows.httpTargetN8nHint',
                      'Calls your n8n webhook at /webhook/ce-{key}. Point N8N_BASE_URL at the n8n instance you run. CoreEngine does not include n8n.',
                      { key: form.key.trim() || 'your_key' },
                    )
                  : form.httpTarget === 'activepieces'
                    ? t(
                        'setup.flows.httpTargetActivepiecesHint',
                        'Calls your Activepieces Catch Webhook at /api/v1/webhooks/{flowId}. Point ACTIVEPIECES_BASE_URL at the instance you run (MIT). CoreEngine does not include Activepieces.',
                      )
                    : t(
                        'setup.flows.httpTargetUrlHint',
                        'Paste any absolute webhook URL (advanced / non-n8n).',
                      )
              }}
            </span>
          </div>

          <div
            v-if="form.httpTarget === 'activepieces'"
            class="flex flex-col gap-1"
          >
            <label class="text-[0.85rem] font-medium">
              {{ t('setup.flows.flowId', 'Activepieces flow id') }}
            </label>
            <InputText
              v-model="form.flowId"
              :placeholder="
                t(
                  'setup.flows.flowIdPlaceholder',
                  'Last segment of Catch Webhook Live URL',
                )
              "
            />
          </div>

          <div
            v-if="form.httpTarget === 'url'"
            class="flex flex-col gap-1"
          >
            <label class="text-[0.85rem] font-medium">
              {{ t('setup.flows.url', 'External URL') }}
            </label>
            <InputText
              v-model="form.url"
              :placeholder="
                t(
                  'setup.flows.urlPlaceholder',
                  'https://integrations.example.com/api/hook',
                )
              "
            />
          </div>
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <ToggleSwitch v-model="form.sync" input-id="flow-sync" />
              <label for="flow-sync" class="text-[0.85rem]">
                {{
                  t(
                    'setup.flows.syncResponse',
                    'Wait for response (/sync)',
                  )
                }}
              </label>
            </div>
            <span v-if="form.sync" class="text-muted-color text-[0.8rem]">
              {{
                form.httpTarget === 'n8n'
                  ? t(
                      'setup.flows.syncResponseHintN8n',
                      'Posts to /webhook/ce-{key}/sync. Set that path on the n8n Webhook node and Respond to When Last Node Finishes or Respond to Webhook.',
                      { key: form.key.trim() || 'your_key' },
                    )
                  : form.httpTarget === 'activepieces'
                    ? t(
                        'setup.flows.syncResponseHintActivepieces',
                        'Appends /sync so Activepieces waits for a Return Response step.',
                      )
                    : t(
                        'setup.flows.syncResponseHintUrl',
                        'Appends /sync before the query string. A URL that already points at a file is left unchanged.',
                      )
              }}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-[0.85rem] font-medium">
              {{ t('setup.flows.method', 'HTTP method') }}
            </label>
            <Select
              v-model="form.method"
              :options="methodOptions"
              option-label="label"
              option-value="value"
            />
          </div>

          <template v-if="form.httpTarget === 'url'">
          <div class="flex flex-col gap-1">
            <label class="text-[0.85rem] font-medium">
              {{ t('setup.flows.authentication', 'Authentication') }}
            </label>
            <Select
              v-model="form.authType"
              :options="authTypeOptions"
              option-label="label"
              option-value="value"
            />
            <span class="text-muted-color text-[0.8rem]">
              {{
                t(
                  'setup.flows.authHint',
                  'Sent on outbound calls. Env N8N_WEBHOOK_SECRET is also added as X-CRM-Flow-Secret when set.',
                )
              }}
            </span>
          </div>

          <div
            v-if="form.authType === 'bearer'"
            class="flex flex-col gap-1"
          >
            <label class="text-[0.85rem] font-medium">
              {{ t('setup.flows.authToken', 'Bearer token') }}
            </label>
            <Password
              v-model="form.authToken"
              :feedback="false"
              toggle-mask
              class="w-full"
              input-class="w-full"
              :placeholder="t('setup.flows.authTokenPlaceholder', 'Token')"
            />
          </div>

          <template v-else-if="form.authType === 'api_key'">
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem] font-medium">
                {{ t('setup.flows.authHeaderName', 'Header name') }}
              </label>
              <InputText
                v-model="form.authHeaderName"
                :placeholder="t('setup.flows.authHeaderNamePlaceholder', 'X-API-Key')"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem] font-medium">
                {{ t('setup.flows.authHeaderValue', 'Header value') }}
              </label>
              <Password
                v-model="form.authHeaderValue"
                :feedback="false"
                toggle-mask
                class="w-full"
                input-class="w-full"
                :placeholder="t('setup.flows.authHeaderValuePlaceholder', 'Secret')"
              />
            </div>
          </template>

          <template v-else-if="form.authType === 'basic'">
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem] font-medium">
                {{ t('setup.flows.authUsername', 'Username') }}
              </label>
              <InputText
                v-model="form.authUsername"
                :placeholder="t('setup.flows.authUsernamePlaceholder', 'Username')"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem] font-medium">
                {{ t('setup.flows.authPassword', 'Password') }}
              </label>
              <Password
                v-model="form.authPassword"
                :feedback="false"
                toggle-mask
                class="w-full"
                input-class="w-full"
                :placeholder="t('setup.flows.authPasswordPlaceholder', 'Password')"
              />
            </div>
          </template>
          </template>
        </template>

        <div class="flex flex-col gap-1">
          <label class="text-[0.85rem] font-medium">
            {{ t('setup.flows.description', 'Description') }}
          </label>
          <InputText
            v-model="form.description"
            :placeholder="
              t('setup.flows.descriptionPlaceholder', 'Optional note')
            "
          />
        </div>

        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="form.enabled" />
          <span>{{ t('setup.flows.enabled', 'Enabled') }}</span>
        </div>
      </div>

      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          severity="secondary"
          text
          @click="dialogVisible = false"
        />
        <Button
          :label="t('common.save', 'Save')"
          :loading="saving"
          @click="save"
        />
      </template>
    </Dialog>
  </section>
</template>
