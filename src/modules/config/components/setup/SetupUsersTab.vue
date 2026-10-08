<script lang="ts">
export default {
  name: 'SetupUsersTab',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  createAppUser,
  fetchAppRolesAdmin,
  fetchAppUsersAdmin,
  setAppUserPassword,
  updateAppUser,
  type AppRoleAdminDto,
  type AppUserAdminDto,
} from '@/core/graphql/userAdminApi'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'
import { formatUserLabel } from '@/modules/entities/utils/recordDisplay'

const { t } = useTranslation()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const isAdmin = ref(false)
const users = ref<AppUserAdminDto[]>([])
const roles = ref<AppRoleAdminDto[]>([])
const searchQuery = ref('')
const includeInactive = ref(true)
const dialogVisible = ref(false)
const passwordDialogVisible = ref(false)
const editingId = ref<string | null>(null)
const passwordUserId = ref<string | null>(null)

const form = reactive({
  email: '',
  firstName: '',
  lastName: '',
  roleId: null as string | null,
  password: '',
  isActive: true,
})

const passwordForm = reactive({
  password: '',
  confirm: '',
})

const roleOptions = computed(() =>
  roles.value.map((role) => ({
    label: role.isAdmin ? `${role.name} (Admin)` : role.name,
    value: role.id,
  })),
)

const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter((user) => {
    const label = formatUserLabel({
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
    }).toLowerCase()
    return (
      label.includes(q)
      || (user.email || '').toLowerCase().includes(q)
      || (user.roleName || '').toLowerCase().includes(q)
    )
  })
})

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: err instanceof Error ? err.message : String(err),
    life: 6000,
  })
}

function userDisplayName(user: AppUserAdminDto): string {
  return (
    formatUserLabel({
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
    }) || user.email || user.id
  )
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const me = await readCurrentUserBridge()
    isAdmin.value = Boolean(me.adminAccess || me.roleAdminAccess)
    if (!isAdmin.value) {
      users.value = []
      roles.value = []
      return
    }
    const [nextUsers, nextRoles] = await Promise.all([
      fetchAppUsersAdmin({
        search: null,
        includeInactive: includeInactive.value,
      }),
      fetchAppRolesAdmin(),
    ])
    users.value = nextUsers
    roles.value = nextRoles
  } catch (err) {
    showError(err, t('setup.users.loadError', 'Failed to load users'))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.email = ''
  form.firstName = ''
  form.lastName = ''
  form.roleId = roles.value[0]?.id ?? null
  form.password = ''
  form.isActive = true
  dialogVisible.value = true
}

function openEdit(user: AppUserAdminDto): void {
  editingId.value = user.id
  form.email = user.email || ''
  form.firstName = user.firstName || ''
  form.lastName = user.lastName || ''
  form.roleId = user.roleId
  form.password = ''
  form.isActive = user.isActive
  dialogVisible.value = true
}

function openPassword(user: AppUserAdminDto): void {
  passwordUserId.value = user.id
  passwordForm.password = ''
  passwordForm.confirm = ''
  passwordDialogVisible.value = true
}

async function save(): Promise<void> {
  if (!form.email.trim()) return
  saving.value = true
  try {
    if (editingId.value) {
      await updateAppUser(editingId.value, {
        email: form.email.trim(),
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        roleId: form.roleId,
        isActive: form.isActive,
      })
    } else {
      if (form.password && form.password.length < 8) {
        throw new Error(
          t('setup.users.passwordTooShort', 'Password must be at least 8 characters'),
        )
      }
      await createAppUser({
        email: form.email.trim(),
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        roleId: form.roleId,
        password: form.password || null,
        isActive: form.isActive,
      })
    }
    dialogVisible.value = false
    toast.add({
      severity: 'success',
      summary: t('setup.users.saved', 'User saved'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.users.saveError', 'Failed to save user'))
  } finally {
    saving.value = false
  }
}

async function savePassword(): Promise<void> {
  if (!passwordUserId.value) return
  if (passwordForm.password.length < 8) {
    showError(
      new Error(
        t('setup.users.passwordTooShort', 'Password must be at least 8 characters'),
      ),
    )
    return
  }
  if (passwordForm.password !== passwordForm.confirm) {
    showError(
      new Error(t('setup.users.passwordMismatch', 'Passwords do not match')),
    )
    return
  }
  saving.value = true
  try {
    await setAppUserPassword(passwordUserId.value, passwordForm.password)
    passwordDialogVisible.value = false
    toast.add({
      severity: 'success',
      summary: t('setup.users.passwordSaved', 'Password updated'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.users.passwordError', 'Failed to update password'))
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-tab-content">
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.users.title', 'Users') }}</h2>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.users.hint',
              'Create and manage app users, roles, and login passwords.',
            )
          }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="includeInactive"
            binary
            input-id="users-include-inactive"
            :disabled="!isAdmin || loading"
            @update:model-value="load()"
          />
          <label for="users-include-inactive">
            {{ t('setup.users.includeInactive', 'Show inactive') }}
          </label>
        </div>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
          />
        </IconField>
        <Button
          :label="t('setup.users.new', 'New user')"
          icon="pi pi-plus"
          :disabled="!isAdmin || loading"
          @click="openCreate"
        />
      </div>
    </div>

    <Message
      v-if="!loading && !isAdmin"
      severity="warn"
      :closable="false"
      class="mb-3"
    >
      {{ t('setup.access.adminRequired', 'Administrator access is required.') }}
    </Message>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.users.loading', 'Loading users...') }}</span>
    </div>

    <DataTable
      v-else-if="isAdmin"
      :value="filteredUsers"
      striped-rows
      table-style="table-layout: fixed; width: 100%"
      :empty-message="t('setup.users.empty', 'No users yet.')"
    >
      <Column
        :header="t('setup.users.columnName', 'Name')"
        sortable
        sort-field="firstName"
        style="width: 14rem"
        header-style="width: 14rem"
      >
        <template #body="{ data }">
          {{ userDisplayName(data) }}
        </template>
      </Column>
      <Column
        field="email"
        :header="t('setup.users.columnEmail', 'Email')"
        sortable
        style="width: 16rem"
        header-style="width: 16rem"
      />
      <Column
        field="roleName"
        :header="t('setup.users.columnRole', 'Role')"
        sortable
        style="width: 10rem"
        header-style="width: 10rem"
      >
        <template #body="{ data }">
          {{ data.roleName || '—' }}
        </template>
      </Column>
      <Column
        field="isActive"
        :header="t('setup.users.columnActive', 'Active')"
        style="width: 6rem"
        header-style="width: 6rem"
      >
        <template #body="{ data }">
          <Tag
            :severity="data.isActive ? 'success' : 'secondary'"
            :value="
              data.isActive
                ? t('setup.users.active', 'Active')
                : t('setup.users.inactive', 'Inactive')
            "
          />
        </template>
      </Column>
      <Column
        field="hasPassword"
        :header="t('setup.users.columnPassword', 'Password')"
        style="width: 7rem"
        header-style="width: 7rem"
      >
        <template #body="{ data }">
          <i
            v-if="data.hasPassword"
            class="pi pi-check"
          />
          <span v-else>—</span>
        </template>
      </Column>
      <Column
        :header="t('setup.columnActions', 'Actions')"
        style="width: 8rem"
        header-style="width: 8rem"
      >
        <template #body="{ data }">
          <Button
            icon="pi pi-pencil"
            text
            rounded
            :aria-label="t('common.edit', 'Edit')"
            @click="openEdit(data)"
          />
          <Button
            icon="pi pi-key"
            text
            rounded
            :aria-label="t('setup.users.setPassword', 'Set password')"
            @click="openPassword(data)"
          />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="
        editingId
          ? t('setup.users.edit', 'Edit user')
          : t('setup.users.new', 'New user')
      "
      :style="{ width: 'min(32rem, 95vw)' }"
      :dismissable-mask="true"
    >
      <div class="flex flex-col gap-3">
        <div class="grid gap-3"
          style="grid-template-columns: 1fr 1fr"
        >
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.users.firstName', 'First name') }}</label>
            <InputText
              v-model="form.firstName"
              class="w-full"
              autocomplete="off"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.users.lastName', 'Last name') }}</label>
            <InputText
              v-model="form.lastName"
              class="w-full"
              autocomplete="off"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.users.columnEmail', 'Email') }}</label>
          <InputText
            v-model="form.email"
            class="w-full"
            type="email"
            autocomplete="off"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.users.columnRole', 'Role') }}</label>
          <Select
            v-model="form.roleId"
            :options="roleOptions"
            option-label="label"
            option-value="value"
            show-clear
            class="w-full"
            :placeholder="t('setup.users.selectRole', 'Select role')"
          />
        </div>
        <div
          v-if="!editingId"
          class="flex flex-col gap-1"
        >
          <label>{{ t('setup.users.password', 'Password') }}</label>
          <Password
            v-model="form.password"
            class="w-full"
            input-class="w-full"
            :feedback="false"
            toggle-mask
            autocomplete="new-password"
          />
          <small class="text-muted-color">
            {{
              t(
                'setup.users.passwordOptional',
                'Optional on create. Minimum 8 characters.',
              )
            }}
          </small>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.isActive"
            binary
            input-id="user-is-active"
          />
          <label for="user-is-active">
            {{ t('setup.users.active', 'Active') }}
          </label>
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
          :disabled="!form.email.trim()"
          @click="save"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="passwordDialogVisible"
      modal
      :header="t('setup.users.setPassword', 'Set password')"
      :style="{ width: 'min(28rem, 95vw)' }"
      :dismissable-mask="true"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.users.password', 'Password') }}</label>
          <Password
            v-model="passwordForm.password"
            class="w-full"
            input-class="w-full"
            :feedback="false"
            toggle-mask
            autocomplete="new-password"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.users.confirmPassword', 'Confirm password') }}</label>
          <Password
            v-model="passwordForm.confirm"
            class="w-full"
            input-class="w-full"
            :feedback="false"
            toggle-mask
            autocomplete="new-password"
          />
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          severity="secondary"
          text
          @click="passwordDialogVisible = false"
        />
        <Button
          :label="t('common.save', 'Save')"
          :loading="saving"
          :disabled="!passwordForm.password"
          @click="savePassword"
        />
      </template>
    </Dialog>
  </section>
</template>
