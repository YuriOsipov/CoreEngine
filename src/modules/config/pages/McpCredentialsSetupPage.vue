<script lang="ts">
export default {
  name: 'McpCredentialsSetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'
import {
  approveMcpPendingAction,
  createMcpCredential,
  fetchMcpCredentials,
  fetchMcpPendingActions,
  rejectMcpPendingAction,
  revokeMcpCredential,
  type McpCredentialDto,
  type McpCredentialScope,
  type McpPendingActionDto,
} from '@/core/graphql/mcpCredentialsApi'
import { useTranslation } from '@/core/translation'
import SetupPageHeader from '../components/setup/SetupPageHeader.vue'

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const decidingId = ref<string | null>(null)
const isAdmin = ref(false)
const rows = ref<McpCredentialDto[]>([])
const pendingRows = ref<McpPendingActionDto[]>([])
const recentPendingRows = ref<McpPendingActionDto[]>([])
const dialogVisible = ref(false)
const tokenVisible = ref(false)
const createdToken = ref('')
const payloadVisible = ref(false)
const selectedPending = ref<McpPendingActionDto | null>(null)

const form = reactive({
  label: '',
  scopes: ['read'] as McpCredentialScope[],
  expiresInHours: 24,
})

const scopeOptions = computed(() => [
  {
    label: t('setup.mcp.scopeRead', 'read — list/inspect/query'),
    value: 'read' as McpCredentialScope,
  },
  {
    label: t('setup.mcp.scopeWrite', 'write — create/update/retry (+ read)'),
    value: 'write' as McpCredentialScope,
  },
  {
    label: t(
      'setup.mcp.scopeSchema',
      'schema — schema/layout writes (+ write/read; also needs MCP_SCHEMA_WRITE_ENABLED)',
    ),
    value: 'schema' as McpCredentialScope,
  },
])

const expiryOptions = computed(() => [
  { label: t('setup.mcp.expiry1h', '1 hour'), value: 1 },
  { label: t('setup.mcp.expiry8h', '8 hours'), value: 8 },
  { label: t('setup.mcp.expiry24h', '24 hours'), value: 24 },
  { label: t('setup.mcp.expiry7d', '7 days'), value: 168 },
  { label: t('setup.mcp.expiry30d', '30 days'), value: 720 },
])

const activeRows = computed(() =>
  rows.value.filter((row) => !row.revokedAt && new Date(row.expiresAt) > new Date()),
)

const revokedOrExpiredRows = computed(() =>
  rows.value.filter((row) => row.revokedAt || new Date(row.expiresAt) <= new Date()),
)

function showError(err: unknown, fallback: string): void {
  toast.add({
    severity: 'error',
    summary: t('common.error', 'Error'),
    detail: err instanceof Error && err.message ? err.message : fallback,
    life: 5000,
  })
}

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return formatLocalizedDateTime(value) || value
}

function scopesLabel(scopes: string[]): string {
  return scopes.length ? scopes.join(', ') : '—'
}

function isExpired(row: McpCredentialDto): boolean {
  return new Date(row.expiresAt) <= new Date()
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const me = await readCurrentUserBridge()
    isAdmin.value = Boolean(me?.adminAccess)
    if (!isAdmin.value) {
      rows.value = []
      pendingRows.value = []
      recentPendingRows.value = []
      return
    }
    const [credentials, pending, recent] = await Promise.all([
      fetchMcpCredentials(),
      fetchMcpPendingActions({ status: 'pending' }),
      fetchMcpPendingActions({ status: null }),
    ])
    rows.value = credentials
    pendingRows.value = pending
    recentPendingRows.value = recent
      .filter((row) => row.status !== 'pending')
      .slice(0, 20)
  } catch (err) {
    showError(err, t('setup.mcp.loadError', 'Failed to load MCP credentials'))
  } finally {
    loading.value = false
  }
}

function openPayload(row: McpPendingActionDto): void {
  selectedPending.value = row
  payloadVisible.value = true
}

function pendingStatusSeverity(
  status: string,
): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
  if (status === 'executed') return 'success'
  if (status === 'pending') return 'warn'
  if (status === 'failed' || status === 'rejected') return 'danger'
  if (status === 'approved') return 'info'
  return 'secondary'
}

function confirmApprove(row: McpPendingActionDto): void {
  confirm.require({
    message: t(
      'setup.mcp.approveConfirm',
      'Approve and execute "{summary}"? This runs as the requesting user.',
      { summary: row.summary },
    ),
    header: t('setup.mcp.approve', 'Approve'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.ok', 'OK'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void doApprove(row.id)
    },
  })
}

async function doApprove(id: string): Promise<void> {
  decidingId.value = id
  try {
    const action = await approveMcpPendingAction(id)
    toast.add({
      severity: action.status === 'executed' ? 'success' : 'warn',
      summary: t('common.success', 'Success'),
      detail:
        action.status === 'executed'
          ? t('setup.mcp.approved', 'Pending action executed.')
          : t(
              'setup.mcp.approveFailedStatus',
              'Approval finished with status: {status}',
              { status: action.status },
            ),
      life: 4000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.mcp.approveError', 'Failed to approve pending action'))
  } finally {
    decidingId.value = null
  }
}

function confirmReject(row: McpPendingActionDto): void {
  confirm.require({
    message: t(
      'setup.mcp.rejectConfirm',
      'Reject "{summary}"? It will not run.',
      { summary: row.summary },
    ),
    header: t('setup.mcp.reject', 'Reject'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.ok', 'OK'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void doReject(row.id)
    },
  })
}

async function doReject(id: string): Promise<void> {
  decidingId.value = id
  try {
    await rejectMcpPendingAction(id)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('setup.mcp.rejected', 'Pending action rejected.'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.mcp.rejectError', 'Failed to reject pending action'))
  } finally {
    decidingId.value = null
  }
}

function openCreate(): void {
  form.label = ''
  form.scopes = ['read']
  form.expiresInHours = 24
  createdToken.value = ''
  tokenVisible.value = false
  dialogVisible.value = true
}

async function submitCreate(): Promise<void> {
  const label = form.label.trim()
  if (!label) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.mcp.labelRequired', 'Label is required.'),
      life: 3000,
    })
    return
  }
  if (!form.scopes.length) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('setup.mcp.scopeRequired', 'Select at least one scope.'),
      life: 3000,
    })
    return
  }
  saving.value = true
  try {
    const created = await createMcpCredential({
      label,
      scopes: form.scopes,
      expiresInHours: form.expiresInHours,
    })
    createdToken.value = created.token
    tokenVisible.value = true
    dialogVisible.value = false
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t(
        'setup.mcp.created',
        'Credential created. Copy the token now — it will not be shown again.',
      ),
      life: 5000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.mcp.createError', 'Failed to create MCP credential'))
  } finally {
    saving.value = false
  }
}

async function copyToken(): Promise<void> {
  try {
    await navigator.clipboard.writeText(createdToken.value)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('setup.mcp.copied', 'Token copied to clipboard.'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'setup.mcp.copyFailed',
        'Could not copy automatically — select and copy the token manually.',
      ),
      life: 5000,
    })
  }
}

function closeTokenDialog(): void {
  tokenVisible.value = false
  createdToken.value = ''
}

function confirmRevoke(row: McpCredentialDto): void {
  confirm.require({
    message: t(
      'setup.mcp.revokeConfirm',
      'Revoke credential "{label}"? MCP clients using this token will stop working.',
      { label: row.label },
    ),
    header: t('setup.mcp.revoke', 'Revoke credential'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('common.ok', 'OK'),
    rejectLabel: t('common.cancel', 'Cancel'),
    accept: () => {
      void doRevoke(row.id)
    },
  })
}

async function doRevoke(id: string): Promise<void> {
  try {
    await revokeMcpCredential(id)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('setup.mcp.revoked', 'Credential revoked.'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.mcp.revokeError', 'Failed to revoke MCP credential'))
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mcp-credentials-setup">
    <SetupPageHeader
      :title="t('setup.mcp.title', 'MCP')"
      :meta="
        t(
          'setup.mcp.subtitle',
          'Credentials for MCP clients, and human approval for retry / schema writes.',
        )
      "
      icon-class="pi pi-key"
    >
      <template #actions>
        <Button
          v-if="isAdmin"
          :label="t('setup.mcp.new', 'Create credential')"
          icon="pi pi-plus"
          :disabled="loading"
          @click="openCreate"
        />
      </template>
    </SetupPageHeader>

    <Message
      v-if="!isAdmin && !loading"
      severity="warn"
      :closable="false"
      class="mb-3"
    >
      {{
        t(
          'setup.mcp.adminRequired',
          'Administrator access is required to manage MCP credentials.',
        )
      }}
    </Message>

    <div v-if="loading" class="text-color-secondary">
      {{ t('setup.mcp.loading', 'Loading MCP credentials...') }}
    </div>

    <template v-else-if="isAdmin">
      <h3 class="text-lg mb-2">
        {{ t('setup.mcp.pendingHeading', 'Pending approvals') }}
      </h3>
      <p class="text-color-secondary mb-3">
        {{
          t(
            'setup.mcp.pendingHint',
            'retry_message and schema/layout writes enqueue here. Approving runs them as the requesting user.',
          )
        }}
      </p>
      <DataTable
        :value="pendingRows"
        data-key="id"
        class="mb-4"
        striped-rows
        :empty-message="t('setup.mcp.pendingEmpty', 'No pending MCP actions.')"
      >
        <Column :header="t('setup.mcp.columnWhen', 'Requested')">
          <template #body="{ data }">
            {{ formatWhen(data.requestedAt) }}
          </template>
        </Column>
        <Column
          field="toolName"
          :header="t('setup.mcp.columnTool', 'Tool')"
        />
        <Column
          field="summary"
          :header="t('setup.mcp.columnSummary', 'Summary')"
        />
        <Column :header="t('setup.mcp.columnExpires', 'Expires')">
          <template #body="{ data }">
            {{ formatWhen(data.expiresAt) }}
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnActions', 'Actions')" style="width: 16rem">
          <template #body="{ data }">
            <div class="flex gap-1 flex-wrap">
              <Button
                :label="t('setup.mcp.approve', 'Approve')"
                size="small"
                :loading="decidingId === data.id"
                :disabled="Boolean(decidingId)"
                @click="confirmApprove(data)"
              />
              <Button
                :label="t('setup.mcp.reject', 'Reject')"
                severity="danger"
                text
                size="small"
                :disabled="Boolean(decidingId)"
                @click="confirmReject(data)"
              />
              <Button
                :label="t('setup.mcp.viewPayload', 'Payload')"
                severity="secondary"
                text
                size="small"
                @click="openPayload(data)"
              />
            </div>
          </template>
        </Column>
      </DataTable>

      <h3 class="text-lg mb-2">
        {{ t('setup.mcp.credentialsHeading', 'Credentials') }}
      </h3>
      <DataTable
        :value="activeRows"
        data-key="id"
        class="mb-4"
        striped-rows
        :empty-message="t('setup.mcp.empty', 'No active MCP credentials.')"
      >
        <Column
          field="label"
          :header="t('setup.mcp.columnLabel', 'Label')"
        />
        <Column :header="t('setup.mcp.columnScopes', 'Scopes')">
          <template #body="{ data }">
            {{ scopesLabel(data.scopes) }}
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnExpires', 'Expires')">
          <template #body="{ data }">
            {{ formatWhen(data.expiresAt) }}
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnLastUsed', 'Last used')">
          <template #body="{ data }">
            {{ formatWhen(data.lastUsedAt) }}
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnCreated', 'Created')">
          <template #body="{ data }">
            {{ formatWhen(data.createdAt) }}
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnActions', 'Actions')" style="width: 8rem">
          <template #body="{ data }">
            <Button
              :label="t('setup.mcp.revoke', 'Revoke')"
              severity="danger"
              text
              size="small"
              @click="confirmRevoke(data)"
            />
          </template>
        </Column>
      </DataTable>

      <h3 v-if="revokedOrExpiredRows.length" class="text-lg mb-2">
        {{ t('setup.mcp.inactiveHeading', 'Revoked / expired') }}
      </h3>
      <DataTable
        v-if="revokedOrExpiredRows.length"
        :value="revokedOrExpiredRows"
        data-key="id"
        striped-rows
      >
        <Column field="label" :header="t('setup.mcp.columnLabel', 'Label')" />
        <Column :header="t('setup.mcp.columnScopes', 'Scopes')">
          <template #body="{ data }">
            {{ scopesLabel(data.scopes) }}
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnStatus', 'Status')">
          <template #body="{ data }">
            <Tag
              v-if="data.revokedAt"
              severity="danger"
              :value="t('setup.mcp.statusRevoked', 'Revoked')"
            />
            <Tag
              v-else-if="isExpired(data)"
              severity="secondary"
              :value="t('setup.mcp.statusExpired', 'Expired')"
            />
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnExpires', 'Expires')">
          <template #body="{ data }">
            {{ formatWhen(data.expiresAt) }}
          </template>
        </Column>
      </DataTable>

      <h3 v-if="recentPendingRows.length" class="text-lg mb-2">
        {{ t('setup.mcp.recentPendingHeading', 'Recent decisions') }}
      </h3>
      <DataTable
        v-if="recentPendingRows.length"
        :value="recentPendingRows"
        data-key="id"
        class="mb-4"
        striped-rows
      >
        <Column :header="t('setup.mcp.columnWhen', 'Requested')">
          <template #body="{ data }">
            {{ formatWhen(data.requestedAt) }}
          </template>
        </Column>
        <Column field="toolName" :header="t('setup.mcp.columnTool', 'Tool')" />
        <Column field="summary" :header="t('setup.mcp.columnSummary', 'Summary')" />
        <Column :header="t('setup.mcp.columnStatus', 'Status')">
          <template #body="{ data }">
            <Tag
              :severity="pendingStatusSeverity(data.status)"
              :value="data.status"
            />
          </template>
        </Column>
        <Column :header="t('setup.mcp.columnActions', 'Actions')" style="width: 6rem">
          <template #body="{ data }">
            <Button
              :label="t('setup.mcp.viewPayload', 'Payload')"
              severity="secondary"
              text
              size="small"
              @click="openPayload(data)"
            />
          </template>
        </Column>
      </DataTable>
    </template>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="t('setup.mcp.createTitle', 'Create MCP credential')"
      :style="{ width: '32rem' }"
      :closable="!saving"
    >
      <div class="flex flex-column gap-3">
        <div class="flex flex-column gap-2">
          <label for="mcp-label">{{ t('setup.mcp.label', 'Label') }}</label>
          <InputText
            id="mcp-label"
            v-model="form.label"
            :placeholder="t('setup.mcp.labelPlaceholder', 'Cursor laptop')"
            :disabled="saving"
          />
        </div>
        <div class="flex flex-column gap-2">
          <label>{{ t('setup.mcp.scopes', 'Scopes') }}</label>
          <MultiSelect
            v-model="form.scopes"
            :options="scopeOptions"
            option-label="label"
            option-value="value"
            display="chip"
            :disabled="saving"
            class="w-full"
          />
          <small class="text-color-secondary">
            {{
              t(
                'setup.mcp.scopesHint',
                'Default is read-only. write includes read; schema includes write and read.',
              )
            }}
          </small>
        </div>
        <div class="flex flex-column gap-2">
          <label for="mcp-expiry">{{ t('setup.mcp.expiry', 'Expires in') }}</label>
          <Select
            id="mcp-expiry"
            v-model="form.expiresInHours"
            :options="expiryOptions"
            option-label="label"
            option-value="value"
            :disabled="saving"
            class="w-full"
          />
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          text
          :disabled="saving"
          @click="dialogVisible = false"
        />
        <Button
          :label="t('setup.mcp.create', 'Create')"
          icon="pi pi-check"
          :loading="saving"
          @click="submitCreate"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="tokenVisible"
      modal
      :header="t('setup.mcp.tokenTitle', 'Copy your MCP token')"
      :style="{ width: '36rem' }"
      :closable="true"
      @hide="closeTokenDialog"
    >
      <Message severity="warn" :closable="false" class="mb-3">
        {{
          t(
            'setup.mcp.tokenOnce',
            'This token is shown once. Store it in your MCP client config — do not paste it into chats or tickets.',
          )
        }}
      </Message>
      <Textarea
        :model-value="createdToken"
        readonly
        rows="3"
        class="w-full font-mono text-sm"
        autocomplete="off"
      />
      <template #footer>
        <Button
          :label="t('setup.mcp.copy', 'Copy token')"
          icon="pi pi-copy"
          @click="copyToken"
        />
        <Button
          :label="t('common.close', 'Close')"
          severity="secondary"
          @click="closeTokenDialog"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="payloadVisible"
      modal
      :header="t('setup.mcp.payloadTitle', 'Pending action payload')"
      :style="{ width: '40rem' }"
    >
      <template v-if="selectedPending">
        <p class="mb-2">
          <strong>{{ selectedPending.toolName }}</strong>
          — {{ selectedPending.summary }}
        </p>
        <Textarea
          :model-value="JSON.stringify(selectedPending.payload, null, 2)"
          readonly
          rows="14"
          class="w-full font-mono text-sm"
        />
        <Textarea
          v-if="selectedPending.result"
          :model-value="JSON.stringify(selectedPending.result, null, 2)"
          readonly
          rows="6"
          class="w-full font-mono text-sm mt-3"
        />
      </template>
      <template #footer>
        <Button
          :label="t('common.close', 'Close')"
          severity="secondary"
          @click="payloadVisible = false"
        />
      </template>
    </Dialog>
  </div>
</template>
