import {
  hasAppDashboards,
  postgresDeleteDashboard,
  postgresDeletePanel,
  postgresListDashboards,
  postgresListPanels,
  postgresUpsertDashboard,
  postgresUpsertPanel,
  type DashboardUpsertInput,
  type PanelUpsertInput,
} from './postgresDashboards.js'

/**
 * Supabase `app_dashboards` / `app_panels` only
 * (legacy HTTP fallback retired in the live BFF).
 */
export async function listDashboards(options: {
  fields?: string[] | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  if (!(await hasAppDashboards())) return []
  return postgresListDashboards(options)
}

export async function listPanels(options: {
  fields?: string[] | null
  filter?: Record<string, unknown> | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  if (!(await hasAppDashboards())) return []
  return postgresListPanels(options)
}

export async function upsertDashboard(
  input: DashboardUpsertInput,
): Promise<Record<string, unknown>> {
  return postgresUpsertDashboard(input)
}

export async function deleteDashboard(id: string): Promise<boolean> {
  return postgresDeleteDashboard(id)
}

export async function upsertPanel(
  input: PanelUpsertInput,
): Promise<Record<string, unknown>> {
  return postgresUpsertPanel(input)
}

export async function deletePanel(id: string): Promise<boolean> {
  return postgresDeletePanel(id)
}
