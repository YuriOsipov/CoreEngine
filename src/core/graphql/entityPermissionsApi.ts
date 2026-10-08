import { graphqlRequest } from './client'

export interface EntityPermissionDto {
  entityApiName: string
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
}

const MY_ROLE_PERMISSIONS_QUERY = /* GraphQL */ `
  query MyRolePermissions {
    myRolePermissions {
      entityApiName
      canCreate
      canRead
      canUpdate
      canDelete
    }
  }
`

export async function fetchMyRolePermissions(): Promise<EntityPermissionDto[]> {
  const data = await graphqlRequest<{ myRolePermissions: EntityPermissionDto[] }>(
    MY_ROLE_PERMISSIONS_QUERY,
  )
  return data.myRolePermissions ?? []
}
