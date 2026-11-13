import { readDashboardsBridge } from '@/core/graphql/dashboardsApi'
import { listUserCollections } from '@/modules/entities/services/collectionSchema'
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
  const { listReportsForCurrentRole } = await import(
    '@/modules/reports/services/reportSettings'
  )
  const reports = await listReportsForCurrentRole()
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
