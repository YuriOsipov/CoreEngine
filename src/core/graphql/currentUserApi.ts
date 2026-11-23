import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface CurrentUserGql {
  id: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  adminAccess: boolean
  roleId: string | null
  roleName: string | null
  roleAdminAccess: boolean
  canAuthorReports: boolean
  /** Effective Owner-RLS / $CURRENT_USER actor while View-as-role is active. */
  rolePreviewActorId?: string | null
}

const ME_QUERY = /* GraphQL */ `
  query Me {
    me {
      id
      firstName
      lastName
      email
      adminAccess
      roleId
      roleName
      roleAdminAccess
      canAuthorReports
      rolePreviewActorId
    }
  }
`

export async function fetchCurrentUserFromGraphQL(): Promise<CurrentUserGql> {
  const data = await graphqlRequest<{ me: CurrentUserGql }>(ME_QUERY)
  return data.me
}

export function canUseCurrentUserGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

/** Current user (`me`) — GraphQL only. */
export async function readCurrentUserBridge(): Promise<CurrentUserGql> {
  if (!canUseCurrentUserGraphQL()) {
    refuseLegacyFallback('readCurrentUserBridge')
  }
  return fetchCurrentUserFromGraphQL()
}
