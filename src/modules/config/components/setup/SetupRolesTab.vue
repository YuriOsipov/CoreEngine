<script lang="ts">
export default {
  name: 'SetupRolesTab',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  createAppRole,
  deleteAppRole,
  fetchAppRolesAdmin,
  fetchPermissionEntities,
  fetchRolePermissions,
  replaceRolePermissions,
  updateAppRole,
  type AppRoleAdminDto,
  type PermissionEntityDto,
  type RolePermissionDto,
} from '@/core/graphql/userAdminApi'
import { readCurrentUserBridge } from '@/core/graphql/currentUserApi'
import {
  clampSensitivity,
  editSensitivityOptions,
  sensitivityOptions,
  SENSITIVITY_NONE,
} from '@/core/fieldSensitivity'

type PermissionFlag =
  | 'canCreate'
  | 'canRead'
  | 'canUpdate'
  | 'canDelete'
  | 'canImport'
  | 'canExport'
  | 'canViewAll'
  | 'canModifyAll'

interface PermissionMatrixRow {
  entityApiName: string
  label: string
  hidden: boolean
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
  canViewAll: boolean
  canModifyAll: boolean
  maxReadSensitivity: number
  maxEditSensitivity: number
}

const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()

const loading = ref(false)
const saving = ref(false)
const isAdmin = ref(false)
const roles = ref<AppRoleAdminDto[]>([])
const entities = ref<PermissionEntityDto[]>([])
const searchQuery = ref('')
const permissionFilter = ref('')
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const matrix = ref<PermissionMatrixRow[]>([])

const form = reactive({
  name: '',
  isAdmin: false,
})

const filteredRoles = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return roles.value
  return roles.value.filter((role) => role.name.toLowerCase().includes(q))
})

const filteredMatrix = computed(() => {
  const q = permissionFilter.value.trim().toLowerCase()
  if (!q) return matrix.value
  return matrix.value.filter(
    (row) =>
      row.label.toLowerCase().includes(q)
      || row.entityApiName.toLowerCase().includes(q),
  )
})

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: err instanceof Error ? err.message : String(err),
    life: 6000,
  })
}

function buildMatrix(
  entityList: PermissionEntityDto[],
  permissions: RolePermissionDto[],
): PermissionMatrixRow[] {
  const byEntity = new Map(
    permissions.map((row) => [row.entityApiName, row] as const),
  )
  return entityList.map((entity) => {
    const granted = byEntity.get(entity.apiName)
    return {
      entityApiName: entity.apiName,
      label: entity.label,
      hidden: entity.hidden,
      canCreate: Boolean(granted?.canCreate),
      canRead: Boolean(granted?.canRead),
      canUpdate: Boolean(granted?.canUpdate),
      canDelete: Boolean(granted?.canDelete),
      canImport: Boolean(granted?.canImport),
      canExport: Boolean(granted?.canExport),
      canViewAll: Boolean(granted?.canViewAll || granted?.canModifyAll),
      canModifyAll: Boolean(granted?.canModifyAll),
      maxReadSensitivity: clampSensitivity(granted?.maxReadSensitivity),
      maxEditSensitivity: clampSensitivity(granted?.maxEditSensitivity),
    }
  })
}

function setModifyAll(row: PermissionMatrixRow, value: boolean): void {
  row.canModifyAll = value
  if (value) row.canViewAll = true
}

function setReadSensitivity(row: PermissionMatrixRow, value: number): void {
  row.maxReadSensitivity = clampSensitivity(value)
  if (row.maxEditSensitivity > row.maxReadSensitivity) {
    row.maxEditSensitivity = row.maxReadSensitivity
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const me = await readCurrentUserBridge()
    isAdmin.value = Boolean(me.adminAccess || me.roleAdminAccess)
    if (!isAdmin.value) {
      roles.value = []
      entities.value = []
      return
    }
    const [nextRoles, nextEntities] = await Promise.all([
      fetchAppRolesAdmin(),
      fetchPermissionEntities(),
    ])
    roles.value = nextRoles
    entities.value = nextEntities
  } catch (err) {
    showError(err, t('setup.roles.loadError', 'Failed to load roles'))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.isAdmin = false
  permissionFilter.value = ''
  matrix.value = buildMatrix(entities.value, [])
  // New roles get full access by default (matches BFF seed on create).
  for (const row of matrix.value) {
    row.canCreate = true
    row.canRead = true
    row.canUpdate = true
    row.canDelete = true
    row.canImport = true
    row.canExport = true
    row.canViewAll = false
    row.canModifyAll = false
  }
  dialogVisible.value = true
}

async function openEdit(role: AppRoleAdminDto): Promise<void> {
  editingId.value = role.id
  form.name = role.name
  form.isAdmin = role.isAdmin
  permissionFilter.value = ''
  dialogVisible.value = true
  saving.value = true
  try {
    const permissions = await fetchRolePermissions(role.id)
    matrix.value = buildMatrix(entities.value, permissions)
  } catch (err) {
    showError(err, t('setup.roles.permissionsLoadError', 'Failed to load permissions'))
    matrix.value = buildMatrix(entities.value, [])
  } finally {
    saving.value = false
  }
}

function setAll(action: 'all' | 'none' | 'read'): void {
  for (const row of matrix.value) {
    if (action === 'all') {
      row.canCreate = true
      row.canRead = true
      row.canUpdate = true
      row.canDelete = true
      row.canImport = true
      row.canExport = true
      // View/Modify All stay off — managers opt in per object for owner RLS.
      row.canViewAll = false
      row.canModifyAll = false
    } else if (action === 'none') {
      row.canCreate = false
      row.canRead = false
      row.canUpdate = false
      row.canDelete = false
      row.canImport = false
      row.canExport = false
      row.canViewAll = false
      row.canModifyAll = false
      row.maxReadSensitivity = SENSITIVITY_NONE
      row.maxEditSensitivity = SENSITIVITY_NONE
    } else {
      row.canCreate = false
      row.canRead = true
      row.canUpdate = false
      row.canDelete = false
      row.canImport = false
      row.canExport = false
      row.canViewAll = false
      row.canModifyAll = false
      row.maxEditSensitivity = SENSITIVITY_NONE
    }
  }
}

/** True when every visible (filtered) row has this flag on. */
function columnAllEnabled(flag: PermissionFlag): boolean {
  const rows = filteredMatrix.value
  return rows.length > 0 && rows.every((row) => row[flag])
}

/**
 * Toggle one permission column for all currently visible rows.
 * If all are on → turn off; otherwise turn all on.
 */
function toggleColumn(flag: PermissionFlag): void {
  const enable = !columnAllEnabled(flag)
  for (const row of filteredMatrix.value) {
    if (flag === 'canModifyAll') {
      setModifyAll(row, enable)
    } else {
      row[flag] = enable
      if (flag === 'canViewAll' && !enable) {
        row.canModifyAll = false
      }
    }
  }
}

async function save(): Promise<void> {
  if (!form.name.trim()) return
  saving.value = true
  try {
    let roleId = editingId.value
    if (roleId) {
      await updateAppRole(roleId, {
        name: form.name.trim(),
        isAdmin: form.isAdmin,
      })
    } else {
      const created = await createAppRole({
        name: form.name.trim(),
        isAdmin: form.isAdmin,
      })
      roleId = created.id
    }

    if (!form.isAdmin && roleId) {
      await replaceRolePermissions(
        roleId,
        matrix.value.map((row) => ({
          entityApiName: row.entityApiName,
          canCreate: row.canCreate,
          canRead: row.canRead,
          canUpdate: row.canUpdate,
          canDelete: row.canDelete,
          canImport: row.canImport,
          canExport: row.canExport,
          canViewAll: row.canModifyAll || row.canViewAll,
          canModifyAll: row.canModifyAll,
          maxReadSensitivity: row.maxReadSensitivity,
          maxEditSensitivity: Math.min(row.maxEditSensitivity, row.maxReadSensitivity),
        })),
      )
    }

    dialogVisible.value = false
    toast.add({
      severity: 'success',
      summary: t('setup.roles.saved', 'Role saved'),
      life: 3000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.roles.saveError', 'Failed to save role'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(role: AppRoleAdminDto): void {
  confirm.require({
    message: t(
      'setup.roles.deleteMessage',
      'Delete role "{name}"? Users must be unassigned first.',
      { name: role.name },
    ),
    header: t('setup.roles.deleteHeader', 'Delete role'),
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => {
      void (async () => {
        try {
          await deleteAppRole(role.id)
          toast.add({
            severity: 'success',
            summary: t('setup.roles.deleted', 'Role deleted'),
            life: 3000,
          })
          await load()
        } catch (err) {
          showError(err, t('setup.roles.deleteError', 'Failed to delete role'))
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
        <h2>{{ t('setup.roles.title', 'Roles') }}</h2>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.roles.hint',
              'User groups with object CRUD, Import / Export, field sensitivity, and optional View All / Modify All for owner row security.',
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
            class="setup-quick-find"
          />
        </IconField>
        <Button
          :label="t('setup.roles.new', 'New role')"
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
      <span>{{ t('setup.roles.loading', 'Loading roles...') }}</span>
    </div>

    <DataTable
      v-else-if="isAdmin"
      :value="filteredRoles"
      striped-rows
      table-style="table-layout: fixed; width: 100%"
      :empty-message="t('setup.roles.empty', 'No roles yet.')"
    >
      <Column
        field="name"
        :header="t('setup.roles.columnName', 'Name')"
        sortable
        style="width: 16rem"
        header-style="width: 16rem"
      >
        <template #body="{ data }">
          <button
            type="button"
            class="setup-link setup-link--button"
            @click="openEdit(data)"
          >
            {{ data.name }}
          </button>
        </template>
      </Column>
      <Column
        field="isAdmin"
        :header="t('setup.roles.columnAdmin', 'Admin')"
        style="width: 8rem"
        header-style="width: 8rem"
      >
        <template #body="{ data }">
          <i
            v-if="data.isAdmin"
            class="pi pi-check"
          />
        </template>
      </Column>
      <Column
        field="userCount"
        :header="t('setup.roles.columnUsers', 'Users')"
        sortable
        style="width: 8rem"
        header-style="width: 8rem"
      />
      <Column
        :header="t('setup.columnActions', 'Actions')"
        style="width: 5rem"
        header-style="width: 5rem"
      >
        <template #body="{ data }">
          <Button
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            :disabled="data.userCount > 0"
            :aria-label="t('common.delete', 'Delete')"
            @click="confirmDelete(data)"
          />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="
        editingId
          ? t('setup.roles.edit', 'Edit role')
          : t('setup.roles.new', 'New role')
      "
      :style="{ width: 'min(96rem, 98vw)' }"
      :dismissable-mask="true"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.roles.columnName', 'Name') }}</label>
          <InputText
            v-model="form.name"
            class="w-full"
            autocomplete="off"
          />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.isAdmin"
            binary
            input-id="role-is-admin"
          />
          <label for="role-is-admin">
            {{ t('setup.roles.isAdmin', 'Administrator') }}
          </label>
        </div>

        <Message
          v-if="form.isAdmin"
          severity="info"
          :closable="false"
        >
          {{
            t(
              'setup.roles.adminBypass',
              'Administrators bypass the permission matrix and have full access.',
            )
          }}
        </Message>

        <template v-else>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="font-semibold">
              {{ t('setup.roles.permissions', 'Permissions') }}
            </label>
            <div class="flex flex-wrap gap-2">
              <IconField>
                <InputIcon class="pi pi-search" />
                <InputText
                  v-model="permissionFilter"
                  :placeholder="t('setup.roles.filterEntities', 'Filter objects…')"
                />
              </IconField>
              <Button
                :label="t('setup.roles.allowAll', 'Allow all')"
                size="small"
                severity="secondary"
                outlined
                @click="setAll('all')"
              />
              <Button
                :label="t('setup.roles.readOnly', 'Read only')"
                size="small"
                severity="secondary"
                outlined
                @click="setAll('read')"
              />
              <Button
                :label="t('setup.roles.denyAll', 'Deny all')"
                size="small"
                severity="secondary"
                outlined
                @click="setAll('none')"
              />
            </div>
          </div>

          <DataTable
            :value="filteredMatrix"
            striped-rows
            size="small"
            scrollable
            scroll-height="22rem"
            :empty-message="t('setup.roles.noEntities', 'No objects found.')"
          >
            <Column
              field="label"
              :header="t('setup.roles.columnCollection', 'Collection')"
              sortable
            >
              <template #body="{ data }">
                <div class="flex flex-col">
                  <span>{{ data.label }}</span>
                  <small class="text-muted-color">{{ data.entityApiName }}</small>
                </div>
              </template>
            </Column>
            <Column style="width: 5.5rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="t('setup.roles.toggleColumnHint', 'Click to toggle this column for all filtered objects')"
                  @click="toggleColumn('canCreate')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canCreate')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canCreate', 'Create') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  v-model="data.canCreate"
                  binary
                />
              </template>
            </Column>
            <Column style="width: 5.5rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="t('setup.roles.toggleColumnHint', 'Click to toggle this column for all filtered objects')"
                  @click="toggleColumn('canRead')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canRead')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canRead', 'Read') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  v-model="data.canRead"
                  binary
                />
              </template>
            </Column>
            <Column style="width: 5.5rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="t('setup.roles.toggleColumnHint', 'Click to toggle this column for all filtered objects')"
                  @click="toggleColumn('canUpdate')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canUpdate')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canUpdate', 'Update') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  v-model="data.canUpdate"
                  binary
                />
              </template>
            </Column>
            <Column style="width: 5.5rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="t('setup.roles.toggleColumnHint', 'Click to toggle this column for all filtered objects')"
                  @click="toggleColumn('canDelete')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canDelete')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canDelete', 'Delete') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  v-model="data.canDelete"
                  binary
                />
              </template>
            </Column>
            <Column style="width: 5.5rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="t('setup.roles.toggleColumnHint', 'Click to toggle this column for all filtered objects')"
                  @click="toggleColumn('canImport')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canImport')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canImport', 'Import') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  v-model="data.canImport"
                  binary
                />
              </template>
            </Column>
            <Column style="width: 5.5rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="t('setup.roles.toggleColumnHint', 'Click to toggle this column for all filtered objects')"
                  @click="toggleColumn('canExport')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canExport')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canExport', 'Export') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  v-model="data.canExport"
                  binary
                />
              </template>
            </Column>
            <Column style="width: 5.75rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="
                    t(
                      'setup.roles.canViewAllHint',
                      'See every row on objects with Owner row security (not only Created By = me). Still needs Read. For sales managers / team leads.',
                    )
                  "
                  @click="toggleColumn('canViewAll')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canViewAll')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canViewAll', 'View all') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  :model-value="data.canViewAll"
                  binary
                  :disabled="data.canModifyAll"
                  @update:model-value="
                    (v: boolean) => {
                      data.canViewAll = Boolean(v)
                      if (!v) data.canModifyAll = false
                    }
                  "
                />
              </template>
            </Column>
            <Column style="width: 6.25rem; text-align: center">
              <template #header>
                <button
                  type="button"
                  class="setup-roles-col-toggle"
                  v-tooltip.bottom="
                    t(
                      'setup.roles.canModifyAllHint',
                      'Edit or delete any row on objects with Owner row security. Implies View all. Still needs Update / Delete.',
                    )
                  "
                  @click="toggleColumn('canModifyAll')"
                >
                  <Checkbox
                    :model-value="columnAllEnabled('canModifyAll')"
                    binary
                    readonly
                  />
                  <span>{{ t('setup.roles.canModifyAll', 'Modify all') }}</span>
                </button>
              </template>
              <template #body="{ data }">
                <Checkbox
                  :model-value="data.canModifyAll"
                  binary
                  @update:model-value="setModifyAll(data, Boolean($event))"
                />
              </template>
            </Column>
            <Column style="width: 9.5rem">
              <template #header>
                <span
                  class="inline-flex items-center gap-1"
                  v-tooltip.bottom="t('setup.roles.sensitiveReadHint', 'Highest field sensitivity this role can see on the object. Fields above it are never returned by the API.')"
                >
                  {{ t('setup.roles.sensitiveRead', 'Sensitive read') }}
                  <i class="pi pi-info-circle text-xs" />
                </span>
              </template>
              <template #body="{ data }">
                <Select
                  :model-value="data.maxReadSensitivity"
                  :options="sensitivityOptions()"
                  option-label="label"
                  option-value="value"
                  size="small"
                  class="w-full"
                  :disabled="!data.canRead"
                  @update:model-value="setReadSensitivity(data, $event)"
                />
              </template>
            </Column>
            <Column style="width: 9.5rem">
              <template #header>
                <span
                  class="inline-flex items-center gap-1"
                  v-tooltip.bottom="t('setup.roles.sensitiveEditHint', 'Highest field sensitivity this role can change. Cannot exceed Sensitive read.')"
                >
                  {{ t('setup.roles.sensitiveEdit', 'Sensitive edit') }}
                  <i class="pi pi-info-circle text-xs" />
                </span>
              </template>
              <template #body="{ data }">
                <Select
                  v-model="data.maxEditSensitivity"
                  :options="editSensitivityOptions(data.maxReadSensitivity)"
                  option-label="label"
                  option-value="value"
                  size="small"
                  class="w-full"
                  :disabled="!data.canUpdate && !data.canCreate"
                />
              </template>
            </Column>
          </DataTable>
        </template>
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
          :disabled="!form.name.trim()"
          @click="save"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.setup-roles-col-toggle {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  margin: 0;
  padding: 0.15rem 0.25rem;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  line-height: 1.1;
}

.setup-roles-col-toggle:hover {
  color: var(--p-primary-color, #3b82f6);
}

.setup-roles-col-toggle :deep(.p-checkbox) {
  pointer-events: none;
}
</style>
