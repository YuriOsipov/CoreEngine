import { readDashboardsBridge } from '@/core/graphql/dashboardsApi'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
import { readSettingRecords } from '@/core/graphql/settingRecordsBridge'
import { loadListViews } from '@/modules/config/services/listViewSettings'

export interface NavPickerOption {
  label: string
  value: string
}

/** User (non-system, non-hidden) collections available as object nav targets. */
export async function listNavCollections(): Promise<NavPickerOption[]> {
  return listUserCollections()
}

export async function listNavDashboards(): Promise<NavPickerOption[]> {
  const records = (await readDashboardsBridge({
    fields: ['id', 'name'],
    sort: ['name'],
    limit: -1,
  })) as Array<{ id?: string | number; name?: string | null }>

  return records
    .filter((record) => record.id !== undefined && record.id !== null)
    .map((record) => ({
      label: record.name?.trim() || String(record.id),
      value: String(record.id),
    }))
}

export async function listNavReports(): Promise<NavPickerOption[]> {
  const records = await readSettingRecords({
    groups: ['report'],
    subGroup: 'full',
    limit: -1,
  })

  return records.map((record) => {
    let title = record.name?.trim() || String(record.id)
    const body =
      typeof record.body === 'string'
        ? safeParse(record.body)
        : (record.body as Record<string, unknown> | null)
    if (body && typeof body.title === 'string' && body.title.trim()) {
      title = body.title.trim()
    }
    return { label: title, value: String(record.id) }
  })
}

export async function listNavListViews(collection: string): Promise<NavPickerOption[]> {
  const views = await loadListViews(collection)
  return views.map((view) => ({
    label: view.name,
    value: view.id,
  }))
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
