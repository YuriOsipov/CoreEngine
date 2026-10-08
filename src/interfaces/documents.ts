import type { SetupLayoutListItem } from './roleScopedLayouts'



export const DOC_TEMPLATE_COLLECTION = 'doc_template'

export const DOC_TEMPLATE_SNAPSHOT_COLLECTION = 'doc_template_snapshot'

export const DOC_VALUE_COLLECTION = 'doc_value'

export const DOC_VALUE_SET_COLLECTION = 'doc_value_set'

export const DOC_ARCHIVED_FIELD = 'archived'

export const DOC_TEMPLATE_BODY_FIELD = 'body'



/** Fill lifecycle status on `doc_value` (not the CRM envelope `status`). */

export type DocDocumentStatus = 'draft' | 'completed'



export const DOC_DOCUMENT_STATUS_DRAFT: DocDocumentStatus = 'draft'

export const DOC_DOCUMENT_STATUS_COMPLETED: DocDocumentStatus = 'completed'



/** M2O field on `doc_value` for a given parent object collection. */

export const DOC_VALUE_PARENT_M2O_FIELDS: Record<string, string> = {

  visit: 'visit',

}



/** All `doc_value` fields used by the app (system fields included for permissions). */

export const DOC_VALUE_FIELDS = [

  'id',

  'archived',

  'template',

  'template_snapshot',

  'visit',

  'parent_collection',

  'parent_id',

  'values',

  'document_status',

  'completed_date',

  'output_file',

  'date_created',

  'date_updated',

  'user_created',

  'user_updated',

] as const



/** All `doc_template` fields used by the app (system fields included for permissions). */

export const DOC_TEMPLATE_FIELDS = [
  'id',
  'archived',
  'sort',
  'user_created',
  'date_created',
  'user_updated',
  'date_updated',
  'name',
  'description',
  'collection',
  'body',
  'field_mapping',
  'role',
  'is_active',
  'output_format',
  'hide_empty',
  'attach_file',
] as const



export const DOC_TEMPLATE_SNAPSHOT_FIELDS = [

  'id',

  'archived',

  'template',

  'version',

  'body',

  'field_mapping',

  'date_created',

  'date_updated',

  'user_created',

  'user_updated',

] as const



export interface DocTemplateRecord {
  id: string
  name: string
  description?: string | null
  collection: string
  body: Record<string, unknown>
  field_mapping?: Record<string, unknown> | null
  role?: string | { id?: string | number; name?: string | null } | null
  is_active?: boolean | null
  output_format?: DocEngineExportMode | string | null
  hide_empty?: boolean | null
  /** When true, finish attaches an export file (PDF/HTML) to the parent record. */
  attach_file?: boolean | null
  archived?: boolean | null
  sort?: number | null
  date_created?: string | null
  date_updated?: string | null
  user_created?: { first_name?: string; last_name?: string } | string | null
  user_updated?: { first_name?: string; last_name?: string } | string | null
}



export interface DocTemplateSnapshotRecord {

  id: string

  template: string | DocTemplateRecord | null

  version: number

  body: Record<string, unknown>

  field_mapping?: Record<string, unknown> | null

  archived?: boolean | null

  date_created?: string | null

  date_updated?: string | null

  user_created?: { first_name?: string; last_name?: string } | string | null

  user_updated?: { first_name?: string; last_name?: string } | string | null

}



export interface DocTemplateListItem extends SetupLayoutListItem {

  description?: string | null

  /** Source object api_name (doc_template.collection). */

  collection?: string | null

}



export interface DocTemplateSaveInput {
  name: string
  description?: string | null
  collection: string
  body: Record<string, unknown>
  field_mapping?: Record<string, unknown> | null
  sort?: number | null
  roleId?: string | null
  isActive?: boolean
  /** When true, finish attaches an export file to the parent record. */
  attachFile?: boolean
  outputFormat?: DocEngineExportMode
  hideEmpty?: boolean
}



export interface DocValueRecord {

  id: string

  template: string | DocTemplateRecord | null

  template_snapshot?: string | DocTemplateSnapshotRecord | null

  visit?: string | number | null

  parent_collection?: string | null

  parent_id?: string | null

  /** Draft = full exportDoc(); Completed = exportFields(). */

  values: Record<string, unknown>

  document_status?: DocDocumentStatus | string | null

  completed_date?: string | null

  output_file?: string | { id?: string } | null

  archived?: boolean | null

  date_created?: string | null

  date_updated?: string | null

  user_created?: { first_name?: string; last_name?: string } | string | null

  user_updated?: { first_name?: string; last_name?: string } | string | null

}



export interface DocValueListItem {

  id: string

  label: string

  templateId: string | null

  documentStatus: DocDocumentStatus

  completedDate: string | null

  outputFileId: string | null

  dateCreated: string | null

  dateUpdated: string | null

  userCreatedName: string | null

  userUpdatedName: string | null

}



export interface DocValueSaveInput {

  templateId: string

  parentCollection: string

  parentId: string

  values: Record<string, unknown>

  documentStatus: DocDocumentStatus

  templateSnapshotId?: string | null

  completedDate?: string | null

  outputFileId?: string | null

}



export interface DocTemplateOption {

  id: string

  name: string

  description?: string | null

}



/** Host-side mirrors of `@docengine/editor` remote-list DTOs (no longer type-exported). */

export interface DocListItem {

  id: string

  label: string

  code?: string

}



export interface DocRemoteListCollectionOption {

  id: string

  label: string

}



export interface DocRemoteListCollectionTreeNode {

  id: string

  label: string

  kind: 'folder' | 'collection' | 'preset'

  collectionId?: string

  presetId?: string

  children?: DocRemoteListCollectionTreeNode[]

}



export interface DocRemoteListCollectionCatalog {

  bookmarks?: DocRemoteListCollectionOption[]

  tree: DocRemoteListCollectionTreeNode[]

}



export interface DocRemoteListLabelFieldOption {

  id: string

  label: string

}



export interface DocResolveListItemsContext {

  fieldName: string

  schema: Record<string, unknown>

  fieldValues: Record<string, unknown>

  query: string

  selected: string[]

}



export type DocEngineExportMode = 'html' | 'pdf'

export function normalizeDocTemplateOutputFormat(
  value: unknown,
): DocEngineExportMode {
  return value === 'html' ? 'html' : 'pdf'
}



export interface DocEngineSettings {
  /** Optional template id — New skips multi-template picker when set. Null = all templates. */
  templateId?: string | null
}

export const DEFAULT_DOC_ENGINE_SETTINGS: Required<DocEngineSettings> = {
  templateId: null,
}

export function normalizeDocEngineSettings(
  settings?: DocEngineSettings | null,
): Required<DocEngineSettings> {
  const templateId =
    typeof settings?.templateId === 'string' && settings.templateId.trim()
      ? settings.templateId.trim()
      : null
  return {
    templateId,
  }
}



export function normalizeDocDocumentStatus(

  value: unknown,

): DocDocumentStatus {

  return value === 'completed' ? 'completed' : 'draft'

}



export function resolveDocOutputFileId(

  value: DocValueRecord['output_file'],

): string | null {

  if (!value) return null

  if (typeof value === 'string') return value.trim() || null

  if (typeof value === 'object' && value.id != null) {

    const id = String(value.id).trim()

    return id || null

  }

  return null

}

/** Reusable fill answers for one template (`kind: "field"`, mapped CRM fields omitted). */
export interface DocValueSetRecord {
  id: string
  name: string
  description?: string | null
  template: string | { id?: string } | null
  values: Record<string, unknown>
  archived?: boolean | null
  date_created?: string | null
  date_updated?: string | null
}

export interface DocValueSetListItem {
  id: string
  name: string
  description: string | null
}

export interface DocValueSetSaveInput {
  templateId: string
  name: string
  values: Record<string, unknown>
  description?: string | null
}


