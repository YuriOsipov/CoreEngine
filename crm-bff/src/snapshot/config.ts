import { SnapshotHttpError } from './errors.js'
import type { RoleSnapshot } from './permissions.js'
import type { TaskDefinition } from './tasks.js'

export const UI_LAYOUT_GROUPS = [
  'entity',
  'field',
  'RecordPage',
  'list',
  'Tree',
  'Scheduler',
  'app',
] as const

export const REPORT_GROUP = 'report'

export type ConfigSnapshot = {
  kind: 'coreengine-config-snapshot'
  kernelMigrations: string[]
  kernelMigrationId: string | null
  entities: Array<Record<string, unknown>>
  platformEntities: Array<Record<string, unknown>>
  roles: RoleSnapshot[]
  tasks: TaskDefinition[]
  layouts: Array<Record<string, unknown>>
  navigation: Array<Record<string, unknown>>
  dashboards: Array<Record<string, unknown>>
  panels: Array<Record<string, unknown>>
  reports: Array<Record<string, unknown>>
  docTemplates: Array<Record<string, unknown>>
}

/** Deploy refuses business rows. Document templates are configuration and stay on the snapshot. */
export function assertConfigOnly(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SnapshotHttpError(400, 'Snapshot body is required')
  }
  if ('records' in body && (body as { records?: unknown }).records != null) {
    throw new SnapshotHttpError(400, 'Deploy does not change business records.')
  }
}
