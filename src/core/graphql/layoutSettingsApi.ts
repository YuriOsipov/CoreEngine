import { graphqlRequest } from './client'
import { featureFlags } from './featureFlags'

export interface GraphQlLayoutSetting {
  id: string
  entityApiName: string
  groupKey: string
  subGroup: string | null
  roleId: string | null
  payload: Record<string, unknown>
  createdAt?: string | null
  updatedAt?: string | null
}

/** Shape expected by existing Setting-based layout services. */
export interface LayoutSettingRecordLike {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: unknown
  date_created?: string | null
  date_updated?: string | null
}

const LAYOUT_SETTINGS_QUERY = /* GraphQL */ `
  query LayoutSettings($entity: String, $groupKey: String, $subGroup: String) {
    layoutSettings(entity: $entity, groupKey: $groupKey, subGroup: $subGroup) {
      id
      entityApiName
      groupKey
      subGroup
      roleId
      payload
      createdAt
      updatedAt
    }
  }
`

let snapshotCache: Promise<LayoutSettingRecordLike[]> | null = null

export function clearLayoutSettingsGraphQlCache(): void {
  snapshotCache = null
}

function stripPayloadMeta(payload: Record<string, unknown>): {
  name: string | null
  role: string | null
  settingId: string | null
  body: unknown
} {
  const rawMeta =
    payload.__meta && typeof payload.__meta === 'object'
      ? (payload.__meta as Record<string, unknown>)
      : null

  const {
    __meta: _meta,
    __directus: _ignoredLegacy,
    name: payloadName,
    ...body
  } = payload

  const name =
    typeof payloadName === 'string'
      ? payloadName
      : typeof rawMeta?.name === 'string'
        ? rawMeta.name
        : null

  const role =
    rawMeta?.role === undefined || rawMeta?.role === null
      ? null
      : String(rawMeta.role)

  const settingId =
    rawMeta?.settingId === undefined || rawMeta?.settingId === null
      ? null
      : String(rawMeta.settingId)

  return { name, role, settingId, body }
}

export function mapGraphQlLayoutToSettingRecord(
  row: GraphQlLayoutSetting,
): LayoutSettingRecordLike {
  const payload =
    row.payload && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : {}
  const { name, role, settingId, body } = stripPayloadMeta(payload)

  return {
    id: settingId ?? row.id,
    collection: row.entityApiName,
    group: row.groupKey,
    name,
    sub_group: row.subGroup ?? '',
    role: role ?? row.roleId,
    body,
    date_created: row.createdAt ?? null,
    date_updated: row.updatedAt ?? null,
  }
}

export async function fetchLayoutSettingsFromGraphQL(filters?: {
  entity?: string
  groupKey?: string
  subGroup?: string
}): Promise<LayoutSettingRecordLike[]> {
  const data = await graphqlRequest<{
    layoutSettings: GraphQlLayoutSetting[]
  }>(LAYOUT_SETTINGS_QUERY, {
    entity: filters?.entity ?? null,
    groupKey: filters?.groupKey ?? null,
    subGroup: filters?.subGroup ?? null,
  })
  return (data.layoutSettings ?? []).map(mapGraphQlLayoutToSettingRecord)
}

async function loadAllLayoutSettings(): Promise<LayoutSettingRecordLike[]> {
  if (!snapshotCache) {
    snapshotCache = fetchLayoutSettingsFromGraphQL()
  }
  return snapshotCache
}

export function canUseLayoutSettingsGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

function roleMatches(
  record: LayoutSettingRecordLike,
  roleId: string | null,
): boolean {
  const raw = record.role
  const recordRole =
    raw === undefined || raw === null
      ? null
      : typeof raw === 'string'
        ? raw || null
        : raw.id === undefined || raw.id === null
          ? null
          : String(raw.id)
  return recordRole === roleId
}

export async function queryLayoutSettings(options: {
  collection?: string
  groups?: string[]
  subGroup?: string | string[]
  roleId?: string | null
  id?: string
  name?: string
  limit?: number
}): Promise<LayoutSettingRecordLike[]> {
  const all = await loadAllLayoutSettings()
  const groups = options.groups
  const subGroups = Array.isArray(options.subGroup)
    ? options.subGroup
    : options.subGroup
      ? [options.subGroup]
      : null

  let rows = all.filter((row) => {
    if (options.collection && row.collection !== options.collection) return false
    if (groups && !groups.includes(row.group)) return false
    if (subGroups && !subGroups.includes(row.sub_group)) return false
    if (options.id !== undefined && String(row.id) !== String(options.id)) {
      return false
    }
    if (options.name !== undefined && String(row.name ?? '') !== options.name) {
      return false
    }
    if (options.roleId !== undefined && !roleMatches(row, options.roleId)) {
      return false
    }
    return true
  })

  rows = [...rows].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  // Directus/BFF convention: limit < 0 means “no limit”.
  // slice(0, -1) would drop the last row (and empty a 1-row result).
  if (options.limit !== undefined && options.limit >= 0) {
    rows = rows.slice(0, options.limit)
  }
  return rows
}

const UPSERT_LAYOUT_MUTATION = /* GraphQL */ `
  mutation UpsertLayoutSetting($input: UpsertLayoutSettingInput!) {
    upsertLayoutSetting(input: $input) {
      id
      entityApiName
      groupKey
      subGroup
    }
  }
`

const DELETE_LAYOUT_MUTATION = /* GraphQL */ `
  mutation DeleteLayoutSetting($settingId: String!) {
    deleteLayoutSetting(settingId: $settingId)
  }
`

export async function upsertLayoutSettingToGraphQL(input: {
  settingId?: string | null
  entityApiName: string
  groupKey: string
  subGroup?: string | null
  roleId?: string | null
  name?: string | null
  body: Record<string, unknown>
}): Promise<{ id: string }> {
  const data = await graphqlRequest<{
    upsertLayoutSetting: { id: string }
  }>(UPSERT_LAYOUT_MUTATION, { input })
  clearLayoutSettingsGraphQlCache()
  return { id: String(data.upsertLayoutSetting.id) }
}

export async function deleteLayoutSettingFromGraphQL(
  settingId: string,
): Promise<void> {
  await graphqlRequest(DELETE_LAYOUT_MUTATION, { settingId })
  clearLayoutSettingsGraphQlCache()
}
