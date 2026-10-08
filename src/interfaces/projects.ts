/** Project Management platform collections (internal / pm_schema). */

export const PM_PROJECT_TEMPLATE_COLLECTION = 'pm_project_template'
export const PM_PROJECT_TEMPLATE_STAGE_COLLECTION = 'pm_project_template_stage'
export const PM_PROJECT_TEMPLATE_STAGE_ITEM_COLLECTION = 'pm_project_template_stage_item'
export const PM_PROJECT_COLLECTION = 'pm_project'
export const PM_STAGE_COLLECTION = 'pm_stage'
export const PM_STAGE_ITEM_COLLECTION = 'pm_stage_item'

export type PmProjectLifecycle =
  | 'planned'
  | 'active'
  | 'on_hold'
  | 'done'
  | 'cancelled'

export type PmTaskStatusKey =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'skipped'
  | string

export type PmTaskItemStatus =
  | 'planned'
  | 'confirmed'
  | 'delivered'
  | 'cancelled'

export interface PmStatusDefinition {
  key: string
  label: string
  color: string
}

export const PM_DEFAULT_STATUSES: PmStatusDefinition[] = [
  { key: 'todo', label: 'To do', color: '#64748b' },
  { key: 'in_progress', label: 'In progress', color: '#2563eb' },
  { key: 'blocked', label: 'Blocked', color: '#dc2626' },
  { key: 'done', label: 'Done', color: '#16a34a' },
  { key: 'skipped', label: 'Skipped', color: '#94a3b8' },
]

export type PmWorkspaceView = 'list' | 'board' | 'gantt'

export interface PmProjectTemplateRecord {
  id: string
  name: string
  description?: string | null
  version?: number | null
  default_duration_days?: number | null
  default_statuses?: PmStatusDefinition[] | null
  archived?: boolean | null
  status?: string | null
}

export interface PmProjectTemplateTaskRecord {
  id: string
  name: string
  description?: string | null
  template?: string | { id?: string } | null
  parent?: string | { id?: string } | null
  offset_days?: number | null
  duration_days?: number | null
  depends_on?: string[] | null
  default_stage_status?: string | null
  is_milestone?: boolean | null
  is_optional?: boolean | null
  base_price?: number | null
  pm_cost?: number | null
  sort?: number | null
}

export interface PmProjectTemplateTaskItemRecord {
  id: string
  name?: string | null
  template_stage?: string | { id?: string } | null
  item?: string | { id?: string; name?: string | null; base_price?: number | null } | null
  variant?: string | { id?: string; name?: string | null } | null
  quantity?: number | null
  price?: number | null
  base_price?: number | null
  total?: number | null
  is_required?: boolean | null
  sort?: number | null
}

export interface PmProjectRecord {
  id: string
  name: string
  description?: string | null
  patient?: string | { id?: string; long_name?: string | null; name?: string | null } | null
  facility?: string | { id?: string; name?: string | null } | null
  template?: string | { id?: string; name?: string | null } | null
  template_version?: number | null
  date_start?: string | null
  date_end?: string | null
  progress?: number | null
  base_price?: number | null
  pm_cost?: number | null
  owner?: string | null
  notes?: string | null
  statuses?: PmStatusDefinition[] | null
  lifecycle?: PmProjectLifecycle | null
  status?: string | null
}

export interface PmTaskRecord {
  id: string
  name: string
  description?: string | null
  project?: string | { id?: string } | null
  parent?: string | { id?: string } | null
  template_stage?: string | { id?: string } | null
  offset_days?: number | null
  duration_days?: number | null
  date_start?: string | null
  date_end?: string | null
  stage_status?: PmTaskStatusKey | null
  progress?: number | null
  base_price?: number | null
  pm_cost?: number | null
  assignee?: string | { id?: string; name?: string | null } | null
  depends_on?: string[] | null
  is_milestone?: boolean | null
  is_custom?: boolean | null
  sort?: number | null
}

export interface PmTaskItemRecord {
  id: string
  name?: string | null
  stage?: string | { id?: string } | null
  item?: string | { id?: string; name?: string | null; base_price?: number | null } | null
  variant?: string | { id?: string; name?: string | null } | null
  quantity?: number | null
  price?: number | null
  base_price?: number | null
  total?: number | null
  is_required?: boolean | null
  item_status?: PmTaskItemStatus | null
  notes?: string | null
  sort?: number | null
}

export interface PmApplyTemplateInput {
  templateId: string
  patientId: string
  dateStart: string
  facilityId?: string | null
  projectName?: string | null
}

export interface PmApplyTemplateResult {
  projectId: string
  stageIds: string[]
}

export interface PmTemplateSaveInput {
  name: string
  description?: string | null
  default_duration_days?: number | null
  default_statuses?: PmStatusDefinition[] | null
  version?: number | null
  archived?: boolean | null
}

export interface PmTemplateTaskSaveInput {
  name: string
  description?: string | null
  template: string
  parent?: string | null
  offset_days?: number | null
  duration_days?: number | null
  depends_on?: string[] | null
  default_stage_status?: string | null
  is_milestone?: boolean | null
  is_optional?: boolean | null
  base_price?: number | null
  pm_cost?: number | null
  sort?: number | null
}
