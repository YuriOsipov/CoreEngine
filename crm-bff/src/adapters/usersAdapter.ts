import { bearerToken } from '../auth/tokenClaims.js'
import { verifyAccessToken } from '../auth/jwt.js'
import {
  hasAppUsers,
  postgresFetchMe,
  postgresListUsers,
  postgresUpdateUserProfile,
} from './postgresUsers.js'

export interface MeUser {
  id: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  adminAccess: boolean
  roleId: string | null
  roleName: string | null
  roleAdminAccess: boolean
  /** From app_user_credentials — blocks API until changed (except change-password / me). */
  mustChangePassword: boolean
}

interface ListUsersOptions {
  ids?: string[] | null
  search?: string | null
  fields?: string[] | null
  limit?: number | null
  sort?: string[] | null
  /** Admins only — non-admins never receive email in list projections. */
  includeEmail?: boolean
  /** Detail-by-id may include inactive users. */
  includeInactive?: boolean
}

/**
 * `app_users` only (legacy users fallback retired in the live BFF).
 */
export async function listUsers(
  options: ListUsersOptions,
): Promise<Record<string, unknown>[]> {
  if (!(await hasAppUsers())) return []
  return postgresListUsers(options)
}

/** Profile/layout fields only — role / is_active / passwords stay on Setup → Users. */
export async function updateUserProfile(
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!(await hasAppUsers())) throw new Error(`User not found: ${id}`)
  return postgresUpdateUserProfile(id, data)
}

function emptyMe(): MeUser {
  return {
    id: null,
    firstName: null,
    lastName: null,
    email: null,
    adminAccess: false,
    roleId: null,
    roleName: null,
    roleAdminAccess: false,
    mustChangePassword: false,
  }
}

/**
 * Resolve GraphQL `me` from a **verified** BFF JWT + `app_users` only.
 * No env / Directus static-token fallbacks — missing Authorization is anonymous.
 * Admin / role flags come from the database only (never JWT claims).
 * Deleted or inactive users → empty me even if the JWT is still unexpired.
 */
export async function fetchMe(options?: {
  authorization?: string | null
}): Promise<MeUser> {
  try {
    if (!(await hasAppUsers())) return emptyMe()

    const token = bearerToken(options?.authorization)
    if (!token) return emptyMe()

    const claims = verifyAccessToken(token)
    if (!claims?.id) return emptyMe()

    // No claim-built identity when the DB row is missing / inactive.
    return (await postgresFetchMe(claims.id, { iat: claims.iat, jti: claims.jti })) ?? emptyMe()
  } catch (error) {
    console.warn('[me] app_users lookup failed', error)
  }
  return emptyMe()
}
