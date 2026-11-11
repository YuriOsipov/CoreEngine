import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface AppRoleAdminDto {
  id: string
  name: string
  isAdmin: boolean
  backendRoleId: string | null
  userCount: number
}

export interface AppUserAdminDto {
  id: string
  backendUserId: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
  roleId: string | null
  roleName: string | null
  isActive: boolean
  hasPassword: boolean
}

export interface CreateAppRoleInput {
  name: string
  isAdmin?: boolean
}

export interface UpdateAppRoleInput {
  name?: string | null
  isAdmin?: boolean | null
}

export interface CreateAppUserInput {
  email: string
  firstName?: string | null
  lastName?: string | null
  roleId?: string | null
  password?: string | null
  isActive?: boolean | null
}

export interface UpdateAppUserInput {
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  roleId?: string | null
  isActive?: boolean | null
}

const APP_ROLES_ADMIN_QUERY = /* GraphQL */ `
  query AppRolesAdmin {
    appRolesAdmin {
      id
      name
      isAdmin
      backendRoleId
      userCount
    }
  }
`

const APP_USERS_ADMIN_QUERY = /* GraphQL */ `
  query AppUsersAdmin($search: String, $includeInactive: Boolean) {
    appUsersAdmin(search: $search, includeInactive: $includeInactive) {
      id
      backendUserId
      email
      firstName
      lastName
      roleId
      roleName
      isActive
      hasPassword
    }
  }
`

const CREATE_APP_ROLE = /* GraphQL */ `
  mutation CreateAppRole($input: CreateAppRoleInput!) {
    createAppRole(input: $input) {
      id
      name
      isAdmin
      backendRoleId
      userCount
    }
  }
`

const UPDATE_APP_ROLE = /* GraphQL */ `
  mutation UpdateAppRole($id: ID!, $input: UpdateAppRoleInput!) {
    updateAppRole(id: $id, input: $input) {
      id
      name
      isAdmin
      backendRoleId
      userCount
    }
  }
`

const DELETE_APP_ROLE = /* GraphQL */ `
  mutation DeleteAppRole($id: ID!) {
    deleteAppRole(id: $id)
  }
`

const CREATE_APP_USER = /* GraphQL */ `
  mutation CreateAppUser($input: CreateAppUserInput!) {
    createAppUser(input: $input) {
      id
      backendUserId
      email
      firstName
      lastName
      roleId
      roleName
      isActive
      hasPassword
    }
  }
`

const UPDATE_APP_USER = /* GraphQL */ `
  mutation UpdateAppUser($id: ID!, $input: UpdateAppUserInput!) {
    updateAppUser(id: $id, input: $input) {
      id
      backendUserId
      email
      firstName
      lastName
      roleId
      roleName
      isActive
      hasPassword
    }
  }
`

const SET_APP_USER_PASSWORD = /* GraphQL */ `
  mutation SetAppUserPassword($id: ID!, $password: String!) {
    setAppUserPassword(id: $id, password: $password)
  }
`

function ensureGraphQl(): void {
  if (!featureFlags.schemaFromGraphQL && !featureFlags.recordsFromGraphQL) {
    refuseLegacyFallback('userAdminApi')
  }
}

export async function fetchAppRolesAdmin(): Promise<AppRoleAdminDto[]> {
  ensureGraphQl()
  const data = await graphqlRequest<{ appRolesAdmin: AppRoleAdminDto[] }>(
    APP_ROLES_ADMIN_QUERY,
  )
  return data.appRolesAdmin ?? []
}

export async function fetchAppUsersAdmin(options?: {
  search?: string | null
  includeInactive?: boolean
}): Promise<AppUserAdminDto[]> {
  ensureGraphQl()
  const data = await graphqlRequest<{ appUsersAdmin: AppUserAdminDto[] }>(
    APP_USERS_ADMIN_QUERY,
    {
      search: options?.search ?? null,
      includeInactive: options?.includeInactive ?? true,
    },
  )
  return data.appUsersAdmin ?? []
}

export async function createAppRole(
  input: CreateAppRoleInput,
): Promise<AppRoleAdminDto> {
  ensureGraphQl()
  const data = await graphqlRequest<{ createAppRole: AppRoleAdminDto }>(
    CREATE_APP_ROLE,
    { input },
  )
  return data.createAppRole
}

export async function updateAppRole(
  id: string,
  input: UpdateAppRoleInput,
): Promise<AppRoleAdminDto> {
  ensureGraphQl()
  const data = await graphqlRequest<{ updateAppRole: AppRoleAdminDto }>(
    UPDATE_APP_ROLE,
    { id, input },
  )
  return data.updateAppRole
}

export async function deleteAppRole(id: string): Promise<boolean> {
  ensureGraphQl()
  const data = await graphqlRequest<{ deleteAppRole: boolean }>(DELETE_APP_ROLE, {
    id,
  })
  return Boolean(data.deleteAppRole)
}

export async function createAppUser(
  input: CreateAppUserInput,
): Promise<AppUserAdminDto> {
  ensureGraphQl()
  const data = await graphqlRequest<{ createAppUser: AppUserAdminDto }>(
    CREATE_APP_USER,
    { input },
  )
  return data.createAppUser
}

export async function updateAppUser(
  id: string,
  input: UpdateAppUserInput,
): Promise<AppUserAdminDto> {
  ensureGraphQl()
  const data = await graphqlRequest<{ updateAppUser: AppUserAdminDto }>(
    UPDATE_APP_USER,
    { id, input },
  )
  return data.updateAppUser
}

export async function setAppUserPassword(
  id: string,
  password: string,
): Promise<boolean> {
  ensureGraphQl()
  const data = await graphqlRequest<{ setAppUserPassword: boolean }>(
    SET_APP_USER_PASSWORD,
    { id, password },
  )
  return Boolean(data.setAppUserPassword)
}

export interface RolePermissionDto {
  entityApiName: string
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
  /** Highest field sensitivity tier readable (0 none, 1 restricted, 2 confidential). */
  maxReadSensitivity: number
  /** Highest field sensitivity tier editable; never above read. */
  maxEditSensitivity: number
}

export interface PermissionEntityDto {
  apiName: string
  label: string
  hidden: boolean
}

const ROLE_PERMISSIONS_QUERY = /* GraphQL */ `
  query RolePermissions($roleId: ID!) {
    rolePermissions(roleId: $roleId) {
      entityApiName
      canCreate
      canRead
      canUpdate
      canDelete
      canImport
      canExport
      maxReadSensitivity
      maxEditSensitivity
    }
  }
`

const PERMISSION_ENTITIES_QUERY = /* GraphQL */ `
  query PermissionEntities {
    permissionEntities {
      apiName
      label
      hidden
    }
  }
`

const REPLACE_ROLE_PERMISSIONS = /* GraphQL */ `
  mutation ReplaceRolePermissions(
    $roleId: ID!
    $permissions: [RolePermissionInput!]!
  ) {
    replaceRolePermissions(roleId: $roleId, permissions: $permissions) {
      entityApiName
      canCreate
      canRead
      canUpdate
      canDelete
      canImport
      canExport
      maxReadSensitivity
      maxEditSensitivity
    }
  }
`

export async function fetchRolePermissions(
  roleId: string,
): Promise<RolePermissionDto[]> {
  ensureGraphQl()
  const data = await graphqlRequest<{ rolePermissions: RolePermissionDto[] }>(
    ROLE_PERMISSIONS_QUERY,
    { roleId },
  )
  return data.rolePermissions ?? []
}

export async function fetchPermissionEntities(): Promise<PermissionEntityDto[]> {
  ensureGraphQl()
  const data = await graphqlRequest<{
    permissionEntities: PermissionEntityDto[]
  }>(PERMISSION_ENTITIES_QUERY)
  return data.permissionEntities ?? []
}

export async function replaceRolePermissions(
  roleId: string,
  permissions: RolePermissionDto[],
): Promise<RolePermissionDto[]> {
  ensureGraphQl()
  const data = await graphqlRequest<{
    replaceRolePermissions: RolePermissionDto[]
  }>(REPLACE_ROLE_PERMISSIONS, { roleId, permissions })
  return data.replaceRolePermissions ?? []
}
