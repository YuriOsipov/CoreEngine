import type {
  AppRoleOption,
  RoleLayoutSaveOptions,
  SavedRoleScopedLayout,
} from './roleScopedLayouts'

export type SavedEntityForm = SavedRoleScopedLayout
export type EntityRoleOption = AppRoleOption

export interface EntityFormSaveOptions extends RoleLayoutSaveOptions {
  /** @deprecated Use layoutId */
  formId?: string | null
}
