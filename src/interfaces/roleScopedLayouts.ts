export interface SavedRoleScopedLayout {
  id: string
  name: string
  roleId: string | null
  roleName?: string | null
}

export interface SetupLayoutListItem extends SavedRoleScopedLayout {
  dateCreated?: string | null
  dateUpdated?: string | null
  userCreatedName?: string | null
  userUpdatedName?: string | null
}

export interface RoleLayoutSaveOptions {
  layoutId?: string | null
  name: string
  roleId: string | null
}

export interface AppRoleOption {
  id: string
  name: string
}

export type RoleScopedLayoutMode = 'single' | 'multi'
