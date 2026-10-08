import { bearerToken, decodeJwtClaims } from '../auth/tokenClaims.js'
import { verifyAccessToken } from '../auth/jwt.js'
import { hasAppUsers, postgresFetchMe, postgresFetchStaticMe, postgresListUsers } from './postgresUsers.js'

export interface MeUser {
  id: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  adminAccess: boolean
  roleId: string | null
  roleName: string | null
  roleAdminAccess: boolean
}

interface ListUsersOptions {
  ids?: string[] | null
  search?: string | null
  fields?: string[] | null
  limit?: number | null
  sort?: string[] | null
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

function bffClaimsFromToken(token: string | null): {
  id: string
  role: string | null
  adminAccess: boolean
} | null {
  if (!token) return null
  try {
    const claims = verifyAccessToken(token)
    if (!claims) return null
    return { id: claims.id, role: claims.role, adminAccess: claims.admin_access }
  } catch {
    return null
  }
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
  }
}

/**
 * Resolve GraphQL `me` from BFF JWT / `app_users` only.
 */
export async function fetchMe(options?: {
  authorization?: string | null
}): Promise<MeUser> {
  try {
    if (!(await hasAppUsers())) return emptyMe()

    const token =
      bearerToken(options?.authorization) ||
      process.env.VITE_DIRECTUS_TOKEN ||
      process.env.DIRECTUS_TOKEN ||
      null
    const bffClaims = bffClaimsFromToken(token)
    const claims = bffClaims ?? decodeJwtClaims(token)
    if (claims?.id) {
      const row = await postgresFetchMe(claims.id)
      if (row) {
        return {
          ...row,
          adminAccess: row.adminAccess || claims.adminAccess,
        }
      }
      if (bffClaims) {
        return {
          id: bffClaims.id,
          firstName: null,
          lastName: null,
          email: null,
          adminAccess: bffClaims.adminAccess,
          roleId: bffClaims.role,
          roleName: null,
          roleAdminAccess: bffClaims.adminAccess,
        }
      }
    }

    const staticTok =
      process.env.VITE_DIRECTUS_TOKEN?.trim() ||
      process.env.DIRECTUS_TOKEN?.trim() ||
      ''
    if (token && staticTok && token === staticTok) {
      const row = await postgresFetchStaticMe()
      if (row) return row
    }
  } catch (error) {
    console.warn('[me] app_users lookup failed', error)
  }
  return emptyMe()
}
