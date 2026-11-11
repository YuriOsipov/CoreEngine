import type {
  ActivityLogSettings,
  DataTableSettings,
  PrimeVueComponentType,
  SchedulerSettings,
  TreeTableSettings,
} from './entities'
import type { DocEngineSettings } from './documents'

export type FilesDisplay = 'thumbnail' | 'list' | 'gallery'

/** A single metadata column shown per file in the form renderer. */
export interface FileDisplayColumn {
  /** Field name from file metadata, e.g. 'filename_download', 'type', 'filesize'. */
  field: string
  /** User-visible column header / caption. */
  header: string
}

export interface M2ABlockDisplayField {
  collection: string
  /** Item fields shown when editing a block of this collection type. */
  fields: string[]
}

export interface M2ASettings {
  /** Optional per-collection editable item fields; defaults to title/name/headline when present. */
  blockFields?: M2ABlockDisplayField[]
  /** Max rows shown in embedded M2A block lists; default 5. */
  rowLimit?: number
}

/** Preview footprint for single Image fields in forms / light view. */
export type ImagePreviewSize = 'sm' | 'md' | 'lg' | 'fill'

export interface FilesSettings {
  /** true = O2M multiple files (special: 'files'), false = single file (special: 'file'). */
  multiple: boolean
  /** Visual layout used by the form renderer. */
  display: FilesDisplay
  /**
   * Allowed MIME type prefixes, e.g. ['image/', 'application/pdf']. Empty = all types.
   * For Image fields this is owned by Setup (field meta); layout may mirror it.
   */
  allowedMimeTypes: string[]
  /**
   * Optional max upload size in megabytes. `null` / omitted / `0` = no extra limit
   * (server still enforces its own cap). Owned by Setup for Image fields.
   */
  maxFileSizeMb?: number | null
  /**
   * Layout-only: how large the Image preview renders (Small / Medium / Large / Fill).
   * Defaults to medium.
   */
  previewSize?: ImagePreviewSize | null
  /** Ordered list of metadata columns shown per file item. */
  columns: FileDisplayColumn[]
}

/** Common image formats for Image field settings. */
export const IMAGE_FORMAT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'JPEG', value: 'image/jpeg' },
  { label: 'PNG', value: 'image/png' },
  { label: 'GIF', value: 'image/gif' },
  { label: 'WebP', value: 'image/webp' },
  { label: 'SVG', value: 'image/svg+xml' },
]

export const IMAGE_PREVIEW_SIZE_OPTIONS: Array<{
  label: string
  value: ImagePreviewSize
}> = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
  { label: 'Fill width', value: 'fill' },
]

export const AVAILABLE_FILE_COLUMNS: FileDisplayColumn[] = [
  { field: 'filename_download', header: 'Name' },
  { field: 'title', header: 'Title' },
  { field: 'description', header: 'Description' },
  { field: 'filesize', header: 'Size' },
  { field: 'created_on', header: 'Uploaded' },
  { field: 'type', header: 'Type' },
  { field: 'uploaded_by', header: 'Uploaded By' },
  { field: 'location', header: 'Location' },
  { field: 'tags', header: 'Tags' },
  { field: 'width', header: 'Width' },
  { field: 'height', header: 'Height' },
  { field: 'focal_point_x', header: 'Focal X' },
  { field: 'focal_point_y', header: 'Focal Y' },
]

export type { PrimeVueComponentType }

export interface LayoutFieldChildLookup {
  /**
   * Collection used to populate this field.
   * Bridge mode: a junction collection (e.g. item_variant).
   * Direct mode (M2O picklist): the related entity itself (e.g. variant), filtered via {@link filter}.
   */
  collection: string
  /** Current form field whose value filters the child rows, e.g. item. */
  sourceField: string
  /**
   * Child collection field that points to sourceField, e.g. item.
   * Optional in direct related-entity mode when {@link filter} scopes options (e.g. by `$parent.variant_type`).
   */
  childSourceField: string
  /**
   * Field whose value is saved into this field / used as picklist option values.
   * In direct related-entity mode this is typically the primary key (`id`).
   */
  valueField: string
  /** @deprecated Ignored — labels are derived from {@link valueField}. */
  labelField?: string
  /** Optional source collection field used as fallback when the child query has no unique match. */
  defaultValueField?: string
  /** Optional M2O field on this entity pointing to the parent collection (when multiple exist). */
  parentField?: string
  /** Optional extra list filter. Supports $source.* and $parent.* tokens. */
  filter?: Record<string, unknown> | null
}

/**
 * Optional split rule: create N target rows per source row by grouping nested
 * source children (first nested pair) on a field path, e.g. `item.item_type`.
 */
export interface CloneRelatedSplitBy {
  /** Dot path on nested source child rows (or the source row when no nested pair). */
  field: string
  /** Write the group key onto this target field (optional denorm). */
  targetField?: string
  /** Only create targets for these group values. Empty / omitted = all groups. */
  includeValues?: string[]
}

/** One level of related-child clone: source collection rows → target collection rows. */
export interface CloneRelatedChildPair {
  sourceCollection: string
  targetCollection: string
  /**
   * @deprecated Inferred from schema (FK to the M2O source / current record).
   * Kept for older saved layouts; ignored when relations can be resolved.
   */
  sourceParentField?: string
  /**
   * @deprecated Inferred from schema (FK to the current record).
   * Kept for older saved layouts; ignored when relations can be resolved.
   */
  targetParentField?: string
  /**
   * @deprecated Inferred from schema (FK on target pointing at source collection).
   * Kept for older saved layouts; ignored when relations can be resolved.
   */
  sourceLinkField?: string
  /** Extra target fields never copied from source. */
  skipFields?: string[]
  /** targetField → sourceField overrides on top of same-name intersection. */
  fieldMap?: Record<string, string>
  /**
   * Copy values from the clone parent record onto each created target row.
   * Keys are target fields; values are parent record field names
   * (e.g. `{ patient: 'patient', facility: 'facility' }`).
   */
  parentFieldMap?: Record<string, string>
  /**
   * When set, group the first nested pair’s source children by {@link CloneRelatedSplitBy.field}
   * and create one target row per group (items partitioned into that group only).
   */
  splitBy?: CloneRelatedSplitBy
  /** Nested children cloned under each created target row (e.g. stage items). */
  children?: CloneRelatedChildPair[]
}

export interface CloneRelatedFromSettings {
  children: CloneRelatedChildPair[]
}

/** Metadata for a single field within a layout section. */
export interface LayoutFieldMetadata {
  /** Stable identifier for drag-and-drop. */
  id: string
  /** Registry field key bound to v-model. */
  field: string
  /** Human-readable label shown in the form. */
  label: string
  /** PrimeVue component resolved via <component :is="field.component" />. */
  component: PrimeVueComponentType
  /** Grid column span (1–12) when using a responsive layout grid. */
  span?: number
  /** Display/input format for Date and DateTime fields. */
  format?: string
  /** M2O parent collection used by AutoComplete fields. */
  relatedCollection?: string
  /** Optional child-data lookup used to populate this field from another selected field. */
  childLookup?: LayoutFieldChildLookup
  /**
   * When this AutoComplete/M2O field changes, copy values from the selected related
   * record into other form fields. Keys are target form fields; values are source
   * field names on the related record (e.g. `{ base_price: 'base_price' }`).
   */
  relatedCopy?: Record<string, string>
  /**
   * When true, related child rows from the selected M2O record are cloned onto
   * the current record on create, and replaced when this M2O value changes on update.
   */
  cloneRelatedFrom?: boolean
  /** Child collection pairs and field mapping for {@link cloneRelatedFrom}. */
  cloneRelatedFromSettings?: CloneRelatedFromSettings
  /** Optional configuration for DataTable layout fields. */
  dataTable?: DataTableSettings
  /** Optional configuration for CrmTreeTable picker fields. */
  treeTable?: TreeTableSettings
  /** Optional configuration for resource/visit scheduling fields. */
  scheduler?: SchedulerSettings
  /** Optional configuration for file / files attachment fields. */
  files?: FilesSettings
  /** Optional configuration for M2A (many-to-any) builder fields. */
  m2a?: M2ASettings
  /** Optional configuration for read-only activity / revision audit trail. */
  activityLog?: ActivityLogSettings
  /** Optional configuration for DocEngine document list / fill panel. */
  docEngine?: DocEngineSettings
  /** When true, field is read-only in edit/create forms but still shown on detail view. */
  readonly?: boolean
  /**
   * When set, field becomes read-only in edit/create forms if these record-value
   * conditions match. Empty / omitted = no conditional effect (use {@link readonly}).
   */
  readonlyIf?: EntityRecordAutomationCondition[]
  /** How to combine {@link readonlyIf} conditions. Default: `and`. */
  readonlyIfLogic?: 'and' | 'or' | string
  /**
   * Compact / Page Layout: Setting id of a Block Layout (`entity` / `full`)
   * referenced by a `BlockLayout` canvas component.
   */
  blockLayoutId?: string | null
}

/** Auto-rendered Created By / Last Modified By block on detail view. */
export interface LayoutSystemInfoSettings {
  /** Show system audit block on detail view. Default: true. */
  enabled?: boolean
  /** Initial collapsed state for the block header. */
  collapsed?: boolean
}

export type EntityActionDisplayType = 'detailButton' | 'detailLink' | 'document'

/** Canonical action behavior after layout normalize. */
export type EntityActionBehavior =
  | 'flow'
  | 'openDocument'
  | 'cloneRelated'
  | 'bulkUpdateRelated'

export interface EntityActionFlowSettings {
  /** Flow trigger key or `/flows/trigger/{key}` path (BFF local or proxied). */
  webhook: string
  method: 'POST'
  confirmBeforeRun?: boolean
  successMessage?: string
  refreshRecordAfterRun?: boolean
}

/**
 * Layout action that runs configurator-driven structure clone from the current
 * record onto itself (e.g. project stages → visits / appointments).
 */
export interface EntityActionCloneRelatedSettings extends CloneRelatedFromSettings {
  confirmBeforeRun?: boolean
  successMessage?: string
  refreshRecordAfterRun?: boolean
  /** Soft-delete existing target rows for configured pairs before cloning. */
  replaceExisting?: boolean
}

/**
 * Prompt for a number, then set targetField from sourcePath + prompt on every
 * related row for the current parent record (e.g. item_price.new_price ← item.base_price × n).
 *
 * When {@link sourceCollection} + {@link sourceLinkField} are set, loads source
 * rows (optionally active only), upserts related rows for the parent, then
 * applies the formula — sourcePath is resolved on each source record.
 */
export interface EntityActionBulkUpdateRelatedSettings {
  /** Related / child collection api_name (e.g. item_price). */
  relatedCollection: string
  /** Writable field on related rows to patch (admin-selected). */
  targetField: string
  /**
   * Dotted path for the source number.
   * Update-only: on each related row (e.g. item.base_price).
   * Upsert mode: on each source row (e.g. base_price).
   */
  sourcePath: string
  /**
   * Optional peer collection to upsert from (e.g. item). When set with
   * {@link sourceLinkField}, creates missing related rows then updates.
   */
  sourceCollection?: string
  /** M2O on related pointing at source (e.g. item on item_price). Required with sourceCollection. */
  sourceLinkField?: string
  /** When sourceCollection is set, filter source with is_active = true. Default true. */
  activeSourcesOnly?: boolean
  /**
   * Arithmetic expression using `{{source}}` and `{{prompt}}`.
   * Example: `{{source}} * (1 - {{prompt}} / 100)`
   * Legacy presets `multiply` / `percentOff` are still accepted and expanded.
   */
  formula?: string
  /** Label for the multiplier / discount prompt dialog. */
  promptLabel?: string
  confirmBeforeRun?: boolean
  successMessage?: string
  refreshRecordAfterRun?: boolean
}

export interface EntityActionPayloadSettings {
  includeCollection?: boolean
  includeRecordId?: boolean
  includeRecord?: boolean
}

export type EntityActionDocumentViewMode = 'html' | 'pdf'

/** Optional pre-selected doc_template. Null = user picks at runtime. */
export interface EntityActionDocumentSettings {
  templateId?: string | null
  /** When true, skip DocFillPage and render populated document directly. */
  skipInteractiveFill?: boolean
  /** Output format when skipInteractiveFill is enabled. */
  viewMode?: EntityActionDocumentViewMode
  /** Persist generated values to doc_value after population. */
  autoSave?: boolean
  /** Upload the generated PDF/HTML export to the record Attachments. */
  attachFile?: boolean
}

/** Configurable button/link shown on entity record pages. */
export interface EntityAction {
  id: string
  name: string
  label: string
  displayType: EntityActionDisplayType
  behavior: EntityActionBehavior
  flow?: EntityActionFlowSettings
  payload?: EntityActionPayloadSettings
  document?: EntityActionDocumentSettings
  /** Present when {@link behavior} is `cloneRelated`. */
  cloneRelated?: EntityActionCloneRelatedSettings
  /** Present when {@link behavior} is `bulkUpdateRelated`. */
  bulkUpdateRelated?: EntityActionBulkUpdateRelatedSettings
}

/** Admin rule: on create/update/delete, when conditions match, set fields / actions (BFF). */
export interface EntityRecordAutomationCondition {
  field: string
  operator: string
  value?: unknown
  /** literal (default) | field — compare to another field on the same record */
  valueSource?: 'literal' | 'field' | string
  compareField?: string | null
}

export type EntityRecordAutomationAction =
  | {
      type: 'notify'
      severity: 'info' | 'warn'
      message: string
    }
  | { type: 'break' }
  | {
      type: 'trigger_flow'
      /** Local app_flow_triggers key (or /flows/trigger/{key}). */
      flowKey: string
    }

export interface EntityRecordAutomation {
  id: string
  name: string
  enabled: boolean
  /** Lower runs first. */
  sort?: number
  triggers: Array<'create' | 'update' | 'delete' | string>
  logic: 'and' | 'or' | string
  conditions: EntityRecordAutomationCondition[]
  requireChanged: string[]
  /** Field → value. Special tokens: $NOW, $NULL, or {{DATE_ADD_DAYS(...)}} templates */
  setFields: Record<string, unknown>
  actions?: EntityRecordAutomationAction[]
}

/** Toggleable field group inside a layout tab. */
export interface LayoutGroup {
  id: string
  title: string
  fields: LayoutFieldMetadata[]
  collapsed?: boolean
  /** When true, field labels sit beside values (Salesforce-style). Default: stacked. */
  inlineLabels?: boolean
  /**
   * When set, the group is shown only if these record-value conditions match.
   * Empty / omitted = always show.
   */
  showIf?: EntityRecordAutomationCondition[]
  /** How to combine {@link showIf} conditions. Default: `and`. */
  showIfLogic?: 'and' | 'or' | string
}

/** A layout tab containing its own field canvas. */
export interface LayoutSection {
  id: string
  title?: string
  description?: string
  /** Default column count for the section grid. */
  columns?: number
  groups: LayoutGroup[]
  sort?: number
  /**
   * When set, the tab is shown only if these record-value conditions match.
   * Empty / omitted = always show.
   */
  showIf?: EntityRecordAutomationCondition[]
  /** How to combine {@link showIf} conditions. Default: `and`. */
  showIfLogic?: 'and' | 'or' | string
}

/**
 * Top-level layout schema for an entity detail form.
 * Stored in layout settings and consumed by the dynamic form renderer.
 */
export interface EntityLayoutSchema {
  /** Collection / entity slug (e.g. "contacts"). */
  entity: string
  /** Schema version for migrations and cache invalidation. */
  version: number
  /** Configurable record-level actions rendered as buttons or links. */
  actions: EntityAction[]
  sections: LayoutSection[]
  /** Optional system audit block (Created By / Last Modified By) on detail view. */
  systemInfo?: LayoutSystemInfoSettings
}

/** Placeable component types on a Lightning-style record page. */
export type RecordPageComponentType =
  | 'highlights'
  | 'detail'
  | 'relatedList'
  | 'files'
  | 'activityLog'
  | 'tabs'
  /** @deprecated Actions live on Highlights; kept for legacy saved layouts. */
  | 'actions'
  | 'field'
  | 'fieldGroup'
  /** Chevron stage path bound to a picklist field. */
  | 'path'

/** Default count of Highlights action buttons shown before the overflow menu. */
export const DEFAULT_VISIBLE_ACTION_BUTTONS = 5

export interface RecordPageComponent {
  id: string
  type: RecordPageComponentType
  label?: string
  /** Block Layout Setting id used by `detail` and `relatedList` components. */
  pageLayoutId?: string | null
  /** Compact Layout Setting id used by `highlights` components. */
  compactLayoutId?: string | null
  /**
   * Block Layout Setting id whose `actions[]` supply custom Highlights buttons.
   * Also used by legacy `actions` components.
   */
  actionLayoutId?: string | null
  /**
   * Highlights only: how many action buttons show before the overflow menu.
   * Standard (Edit/Delete) + custom Block Layout actions are listed automatically.
   */
  visibleActionButtons?: number
  /** Optional Block Layout section ids to render (empty = all). */
  sectionIds?: string[]
  /** Related collection slug — junction for `files`; legacy Related List collection. */
  relatedCollection?: string
  /** @deprecated Related List renders all DataTable fields from the Block Layout. */
  relatedFieldId?: string | null
  /** Registry field key for `field`, `files`, and `path` components. */
  field?: string
  /**
   * Path only: optional picklist for terminal outcomes (Won / Lost / Cancel).
   * Open stages stay on `field`; closed outcomes write here.
   */
  terminalField?: string
  /**
   * Path only: terminal picklist values styled as success (green).
   * Other terminal values are styled as failure (red).
   */
  successTerminalValues?: string[]
  /**
   * Path only: always read-only (stage clicks disabled), same semantics as
   * Block Layout field {@link LayoutFieldMetadata.readonly}.
   */
  readonly?: boolean
  /**
   * Path only: become read-only when these record-value conditions match.
   * Empty / omitted = no conditional effect (use {@link readonly}).
   */
  readonlyIf?: EntityRecordAutomationCondition[]
  /** How to combine {@link readonlyIf} conditions. Default: `and`. */
  readonlyIfLogic?: 'and' | 'or' | string
  /** PrimeVue component for `field` components. */
  fieldComponent?: PrimeVueComponentType
  /** Grid column span (1–12) for `field` components. */
  span?: number
  /** Display/input format for date `field` components. */
  format?: string
  /** Default active tab id for `tabs` components. */
  defaultTabId?: string | null
  /** Nested tab panes for `tabs` components. */
  tabs?: Array<{
    id: string
    title: string
    components: RecordPageComponent[]
  }>
  /** Child components for `fieldGroup` (typically `field` items). */
  components?: RecordPageComponent[]
  /** Column count for `fieldGroup` (1 or 2). */
  columns?: 1 | 2
  /** Show labels beside values for `fieldGroup` / `field` components. */
  inlineLabels?: boolean
  /** Initial collapsed state for `fieldGroup` (like Block Layout groups). */
  collapsed?: boolean
  /** Settings for `activityLog` components. */
  activityLog?: ActivityLogSettings
}

export type RecordPageRegionKey = 'header' | 'main' | 'sidebar'

export interface RecordPageRegion {
  id: string
  key: RecordPageRegionKey
  title?: string
  components: RecordPageComponent[]
}

/** Which Block Layouts feed the object-list Detail panel related tabs. */
export type RecordPageListDetailRelatedSource = 'all' | 'block'

/** What the object-list detail pane shows for the selected row. */
export type RecordPageListDetailContentMode = 'relatedLists' | 'fullPageLayout'

/**
 * How master/detail panes are arranged on the object list.
 * - `stacked` (default): list above, detail below (OpenVue Splitter `layout="vertical"`).
 * - `sideBySide`: list left, detail right (OpenVue Splitter `layout="horizontal"`).
 */
export type RecordPageListDetailOrientation = 'stacked' | 'sideBySide'

/**
 * Collapsible master/detail panel on object list views.
 * Content is either related-list tabs or the full Page Layout for the selected record.
 */
export interface RecordPageListDetailPanel {
  /** When true, object list shows a splitter with a detail pane. */
  enabled: boolean
  /**
   * `relatedLists` (default): related tabs from this Page Layout.
   * `fullPageLayout`: full Page Layout for the selected record.
   * Forced to `fullPageLayout` when `orientation` is `sideBySide`.
   */
  contentMode?: RecordPageListDetailContentMode
  /**
   * `stacked` (default): list above, detail below (content mode configurable).
   * `sideBySide`: list left, detail right — always shows the full Page Layout.
   */
  orientation?: RecordPageListDetailOrientation
  /** Initial master pane size percent (1–99). Default 60. */
  masterSize?: number
  /** Minimum detail pane size percent when expanded. Default 15. */
  detailMinSize?: number
  /** Start with the detail pane collapsed. Remembered in localStorage per collection. */
  defaultCollapsed?: boolean
  /**
   * `all` (default): every Related List / Files / Detail-related field on the page.
   * `block`: only related fields from the Block Layout in `relatedListsBlockId`.
   * Used only when `contentMode` is `relatedLists`.
   */
  relatedListsSource?: RecordPageListDetailRelatedSource
  /**
   * Block Layout Setting id when `relatedListsSource` is `block`.
   * Related tabs come from DataTable / Files / M2A fields on that layout.
   */
  relatedListsBlockId?: string | null
}

/**
 * Role-assigned page composition (Page Layout) that references reusable Block Layouts.
 * Stored in layout settings (group RecordPage).
 */
export interface RecordPageLayoutSchema {
  entity: string
  version: number
  /** Default Block Layout for detail regions when a component omits pageLayoutId. */
  pageLayoutId?: string | null
  /**
   * When false, the Sidebar region is hidden and Main spans the full width.
   * Default true (Sidebar visible).
   */
  sidebarEnabled?: boolean
  /**
   * Main pane size percent when Sidebar is enabled (20–80). Default 50.
   * Sidebar uses the remaining percent.
   */
  mainSize?: number
  /**
   * Object-list master/detail panel. Related tabs are derived from Related List,
   * Files, and related fields on Block Layouts placed on this page.
   */
  listDetailPanel?: RecordPageListDetailPanel | null
  regions: RecordPageRegion[]
}
