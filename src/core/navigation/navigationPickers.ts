import { readDashboardsBridge } from '@/core/graphql/dashboardsApi'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
import { loadListViews } from '@/modules/config/services/listViewSettings'

export interface NavPickerOption {
  label: string
  value: string
  /** Icon from object config. Present on collection options. */
  icon?: string | null
}

/** User (non-system, non-hidden) collections available as object nav targets. */
export async function listNavCollections(): Promise<NavPickerOption[]> {
  const rows = await listUserCollections()
  return rows.map((row) => ({
    label: row.label,
    value: row.value,
    icon: row.icon,
  }))
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

/** Setup picker: all reports (role visibility is applied at runtime in the menu). */
export async function listNavReports(): Promise<NavPickerOption[]> {
  const { listReports } = await import('@/modules/reports/services/reportSettings')
  const reports = await listReports()
  return reports.map((report) => ({
    label: report.title || report.name,
    value: String(report.settingId),
  }))
}

export async function listNavListViews(collection: string): Promise<NavPickerOption[]> {
  const views = await loadListViews(collection)
  return views.map((view) => ({
    label: view.name,
    value: view.id,
  }))
}
