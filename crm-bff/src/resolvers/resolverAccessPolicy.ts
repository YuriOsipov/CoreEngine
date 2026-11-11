/**
 * Classification of every GraphQL Query / Mutation root field.
 * CI iterates `resolvers.Query` / `resolvers.Mutation` and fails if a field
 * is missing from these sets or its handler body lacks the expected guard.
 */

/** No auth — health + i18n bootstrap only. */
export const PUBLIC_QUERIES = new Set([
  'health',
  'languages',
  'translations',
  'translate',
])

export const PUBLIC_MUTATIONS = new Set<string>([])

/** Any valid Bearer JWT (`requireAuthenticatedUser` / `requireSelfOrAdmin`). */
export const AUTHENTICATED_QUERIES = new Set([
  'entities',
  'entity',
  'entitySchema',
  'registrySnapshot',
  'layoutSettings',
  'userSetting',
  'orgSetting',
  'recentRecordViews',
  'myRolePermissions',
  'me',
  'presets',
  'dashboards',
  'panels',
  'file',
  'files',
])

export const AUTHENTICATED_MUTATIONS = new Set([
  'upsertUserSetting',
  'upsertRecentRecordView',
  'generateDocument',
])

/** `requireAdminAccess` — Setup / registry / admin ops. */
export const ADMIN_QUERIES = new Set([
  'schemaDrift',
  'entitySyncStates',
  'syncJobs',
  'appRolesAdmin',
  'appUsersAdmin',
  'rolePermissions',
  'permissionEntities',
  'scheduledTasks',
  'scheduledTaskRuns',
  'flowTriggers',
])

export const ADMIN_MUTATIONS = new Set([
  'upsertDashboard',
  'deleteDashboard',
  'upsertPanel',
  'deletePanel',
  'upsertLayoutSetting',
  'deleteLayoutSetting',
  'runSchemaDriftCheck',
  'runSchemaSync',
  'upsertEntityUniqueGroups',
  'upsertEntityAutomations',
  'updateEntityMeta',
  'createRegistryEntity',
  'deleteRegistryEntity',
  'createAppRole',
  'updateAppRole',
  'deleteAppRole',
  'createAppUser',
  'updateAppUser',
  'setAppUserPassword',
  'replaceRolePermissions',
  'setFieldIsUnique',
  'createRegistryField',
  'updateRegistryField',
  'deleteRegistryField',
  'upsertOrgSetting',
  'upsertScheduledTask',
  'deleteScheduledTask',
  'runScheduledTask',
  'upsertFlowTrigger',
  'deleteFlowTrigger',
  'deleteRecord',
])

/** `assertEntityPermission` (object CRUD / aggregate / bulk / schedule). */
export const ENTITY_PERMISSION_QUERIES = new Set([
  'record',
  'records',
  'recordActivities',
  'recordRevisions',
  'recordFiles',
  'roles',
  'users',
  'aggregateRecords',
  'itemGroupPriceTree',
])

export const ENTITY_PERMISSION_MUTATIONS = new Set([
  'createRecord',
  'updateRecord',
  'softDeleteRecord',
  'restoreRecord',
  'generateScheduleSlots',
  'bulkUpdateRelatedFromAction',
  'bulkUpdateFilteredFromAction',
])

const GUARD_PATTERNS: Record<
  'public' | 'authenticated' | 'admin' | 'entity',
  RegExp | null
> = {
  public: null,
  authenticated: /requireAuthenticatedUser|requireSelfOrAdmin/,
  admin: /requireAdminAccess/,
  entity: /assertEntityPermission/,
}

export type ResolverAccessKind = 'public' | 'authenticated' | 'admin' | 'entity'

export function classifyQuery(name: string): ResolverAccessKind | null {
  if (PUBLIC_QUERIES.has(name)) return 'public'
  if (AUTHENTICATED_QUERIES.has(name)) return 'authenticated'
  if (ADMIN_QUERIES.has(name)) return 'admin'
  if (ENTITY_PERMISSION_QUERIES.has(name)) return 'entity'
  return null
}

export function classifyMutation(name: string): ResolverAccessKind | null {
  if (PUBLIC_MUTATIONS.has(name)) return 'public'
  if (AUTHENTICATED_MUTATIONS.has(name)) return 'authenticated'
  if (ADMIN_MUTATIONS.has(name)) return 'admin'
  if (ENTITY_PERMISSION_MUTATIONS.has(name)) return 'entity'
  return null
}

export function assertHandlerMatchesKind(
  name: string,
  kind: ResolverAccessKind,
  handler: (...args: never[]) => unknown,
): void {
  const pattern = GUARD_PATTERNS[kind]
  if (!pattern) return
  const source = Function.prototype.toString.call(handler)
  if (!pattern.test(source)) {
    throw new Error(
      `Resolver ${name} is classified as ${kind} but its handler body does not call the expected guard`,
    )
  }
}
