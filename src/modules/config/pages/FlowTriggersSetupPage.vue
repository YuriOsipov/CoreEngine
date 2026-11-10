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
  fetchFlowTriggers,
  upsertFlowTrigger,
  type GraphQlFlowTrigger,
} from '@/core/graphql/flowTriggersApi'
import { useTranslation } from '@/core/translation'

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()

const graphqlEnabled = featureFlags.schemaFromGraphQL
const loading = ref(false)
const saving = ref(false)
const isAdmin = ref(false)
const flows = ref<GraphQlFlowTrigger[]>([])
const searchQuery = ref('')
const dialogVisible = ref(false)
const editingKey = ref<string | null>(null)

const form = reactive({
  key: '',
  handler: 'http' as string,
  enabled: true,
  description: '',
  url: '',
  method: 'POST',
  authType: 'none' as string,
  authToken: '',
  authHeaderName: 'X-API-Key',
  authHeaderValue: '',
  authUsername: '',
  authPassword: '',
})

const handlerOptions = computed(() => [
  {
    label: t('setup.flows.handlerHttp', 'HTTP (external URL)'),
    value: 'http',
  },
  {
    label: t('setup.flows.handlerUpdateRecord', 'Update record'),
    value: 'update_record',
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

const filteredFlows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return flows.value
  return flows.value.filter((flow) => {
    const url =
      typeof flow.config?.url === 'string' ? flow.config.url.toLowerCase() : ''
    return (
      flow.key.toLowerCase().includes(query) ||
      flow.handler.toLowerCase().includes(query) ||
      (flow.description || '').toLowerCase().includes(query) ||
      url.includes(query)
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
  if (handler === 'update_record') {
    return t('setup.flows.handlerUpdateRecordShort', 'Update record')
  }
  return handler
}

function destinationLabel(flow: GraphQlFlowTrigger): string {
  if (flow.handler === 'http') {
    const url = typeof flow.config?.url === 'string' ? flow.config.url : ''
    return url || '—'
  }
  if (flow.handler === 'update_record') {
    const collection =
      typeof flow.config?.collection === 'string' ? flow.config.collection : ''
    return collection
      ? t('setup.flows.updateRecordTarget', 'Collection: {collection}', {
          collection,
        })
      : t('setup.flows.updateRecordPayload', 'From payload')
  }
  return '—'
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
  form.handler = 'http'
  form.enabled = true
  form.description = ''
  form.url = ''
  form.method = 'POST'
  resetAuthFields()
  editingKey.value = null
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
  form.key = flow.key
  form.handler = flow.handler
  form.enabled = flow.enabled
  form.description = flow.description || ''
  form.url = typeof flow.config?.url === 'string' ? flow.config.url : ''
  form.method =
    typeof flow.config?.method === 'string' && flow.config.method
      ? String(flow.config.method).toUpperCase()
      : 'POST'
  loadAuthFromConfig(flow.config ?? {})
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
  } catch (err) {
    showError(err, t('setup.flows.loadError', 'Failed to load flows'))
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
      detail: t('setup.flows.keyRequired', 'Flow key is required.'),
      life: 4000,
    })
    return
  }
  if (form.handler === 'http' && !form.url.trim()) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.urlRequired', 'HTTP URL is required.'),
      life: 4000,
    })
    return
  }
  if (form.handler === 'http' && form.authType === 'bearer' && !form.authToken.trim()) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.flows.authTokenRequired', 'Bearer token is required.'),
      life: 4000,
    })
    return
  }
  if (
    form.handler === 'http' &&
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
    form.handler === 'http' &&
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
    const config: Record<string, unknown> =
      form.handler === 'http'
        ? {
            url: form.url.trim(),
            method: form.method || 'POST',
            headers: { Accept: 'application/json' },
            auth: buildAuthConfig(),
          }
        : form.handler === 'update_record'
          ? {}
          : {}

    await upsertFlowTrigger({
      key,
      handler: form.handler,
      enabled: form.enabled,
      description: form.description.trim() || null,
      config,
    })
    dialogVisible.value = false
    await load()
    toast.add({
      severity: 'success',
      summary: t('setup.flows.saved', 'Flow saved'),
      detail: t(
        'setup.flows.savedDetail',
        'Use this key in Automations → Trigger flow.',
      ),
      life: 4000,
    })
  } catch (err) {
    showError(err, t('setup.flows.saveError', 'Failed to save flow'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(flow: GraphQlFlowTrigger): void {
  confirm.require({
    message: t(
      'setup.flows.deleteConfirm',
      'Delete flow "{key}"? Automations that use this key will fail until updated.',
      { key: flow.key },
    ),
    header: t('setup.flows.delete', 'Delete flow'),
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
            summary: t('setup.flows.deleted', 'Flow deleted'),
            life: 3000,
          })
        } catch (err) {
          showError(err, t('setup.flows.deleteError', 'Failed to delete flow'))
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
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.flows.title', 'Flows') }}</h2>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.flows.subtitle',
              'Map a flow key to an external HTTP webhook (or update record). Use the key in Automations → Trigger flow.',
            )
          }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
          />
        </IconField>
        <Button
          :label="t('setup.flows.new', 'New flow')"
          icon="pi pi-plus"
          :disabled="!isAdmin || !graphqlEnabled"
          @click="openCreate"
        />
      </div>
    </div>

    <Message
      v-if="!graphqlEnabled"
      severity="warn"
      :closable="false"
    >
      {{
        t(
          'setup.flows.graphqlRequired',
          'Set VITE_DATA_SOURCE=graphql to manage flows.',
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
      <span>{{ t('setup.flows.loading', 'Loading flows...') }}</span>
    </div>

    <DataTable
      v-else-if="isAdmin"
      :value="filteredFlows"
      striped-rows
      data-key="key"
      :empty-message="t('setup.flows.empty', 'No flows yet. Create one to map a key to an external URL.')"
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
      v-model:visible="dialogVisible"
      modal
      :header="
        editingKey
          ? t('setup.flows.editTitle', 'Edit flow')
          : t('setup.flows.createTitle', 'New flow')
      "
      class="w-full max-w-xl"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-[0.85rem] font-medium">
            {{ t('setup.flows.key', 'Flow key') }}
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
                'This key is what you enter in Automations → Trigger flow.',
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
