export type PermissionMatrixRow = {
  entityApiName: string
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

export type RoleSnapshot = {
  name: string
  isAdmin: boolean
  canAuthorReports: boolean
  permissions: PermissionMatrixRow[]
}

/** Real matrix. Never the pack flag `full_pack`. */
export function toRoleSnapshot(
  name: string,
  isAdmin: boolean,
  canAuthorReports: boolean,
  permissions: PermissionMatrixRow[],
): RoleSnapshot {
  return {
    name,
    isAdmin,
    canAuthorReports,
    permissions: permissions.map((row) => ({ ...row })),
  }
}
