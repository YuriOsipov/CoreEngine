// Registry schema types (GraphQL/REST-shaped payloads from schema mappers).

/** Subset of field metadata used by the layout builder. */
export interface FieldMeta {
  id?: number
  collection?: string
  field?: string
  special?: string[] | null
  interface?: string | null
  /** Field interface configuration, e.g. select-dropdown choices. */
  options?: Record<string, any> | null
  /** Field display configuration, e.g. datetime format. */
  display_options?: Record<string, any> | null
  translations?: Array<{
    language?: string
    translation?: string
  }> | null
  hidden?: boolean
  readonly?: boolean
  required?: boolean
  note?: string | null
  sort?: number | null
  /** Registry unique flag (single-column avoid-duplicates). */
  unique?: boolean | null
  /** Field-level security tier: 0 none, 1 restricted, 2 confidential. */
  sensitivity?: number | null
  /** Current role may not read this field; the BFF never returns its value. */
  restricted?: boolean
  /** Current role may not write this field; the BFF rejects payloads that include it. */
  writeRestricted?: boolean
}

export interface FieldDefinition {
  collection: string
  field: string
  type: string
  meta?: FieldMeta | null
  schema?: {
    is_primary_key?: boolean
    foreign_key_table?: string | null
    foreign_key_column?: string | null
    default_value?: unknown
    defaultValue?: unknown
  } | null
}

export interface RelationDefinition {
  collection: string
  field: string
  related_collection: string | null
  meta?: {
    kind?: string | null
    one_collection?: string | null
    one_field?: string | null
    many_collection?: string | null
    many_field?: string | null
    junction_field?: string | null
    sort_field?: string | null
    one_allowed_collections?: string[] | string | null
  } | null
}

export interface CollectionDefinition {
  collection: string
  meta?: {
    hidden?: boolean
    singleton?: boolean
    icon?: string | null
    note?: string | null
    display_template?: string | null
    /** Optional description (Entity parameters Note / backend_config.note). */
    description?: string | null
    /** Collection folder / group key. */
    group?: string | null
    /** Effective unique groups from registry (composite + is_unique fields). */
    unique_groups?: Array<{ name: string; fields: string[] }> | null
    /** all | activity | null — activity & revision tracking. */
    accountability?: string | null
    /** Platform / internal object — hidden from pickers; Object Manager can opt in. */
    internal?: boolean
    translations?: Array<{
      language?: string
      translation?: string
    }> | null
  } | null
  schema?: { name?: string } | null
}

export interface CollectionSchemaBundle {
  collection: CollectionDefinition | undefined
  fields: FieldDefinition[]
  relations: RelationDefinition[]
}

// PrimeVue component names used in dynamic layout rendering.
// Defined here (not config.ts) to avoid a circular reference:
// DataTableColumnConfig.component needs this type.
export type PrimeVueComponentType =
  | 'InputText'
  | 'Textarea'
  | 'Editor'
  | 'InputNumber'
  | 'Password'
  | 'Select'
  | 'Dropdown'
  | 'MultiSelect'
  | 'DatePicker'
  | 'Calendar'
  | 'Checkbox'
  | 'RadioButton'
  | 'ToggleSwitch'
  | 'SelectButton'
  | 'AutoComplete'
  | 'DataTable'
  | 'CrmTreeTable'
  | 'CrmScheduler'
  | 'Files'
  | 'ChildLookup'
  | 'CrmActivityLog'
  | 'CrmDocEngine'
  | 'M2ABuilder'
  | 'M2MMultiSelect'
  | 'Repeater'
  | 'Address'
  | 'JsonList'
  | 'JsonCode'
  | 'SensitivityMatrix'
  | 'BlockLayout'

export type ActivityLogAction = 'create' | 'update' | 'delete'

export interface ActivityLogSettings {
  maxItems?: number
  actions?: ActivityLogAction[]
  showDeltas?: boolean
}

export const DEFAULT_ACTIVITY_LOG_SETTINGS: Required<ActivityLogSettings> = {
  /** Visible rows on the record page widget (View all opens the full history). */
  maxItems: 5,
  actions: ['create', 'update', 'delete'],
  showDeltas: true,
}

/** Page size for Activity log View-all infinite scroll. */
export const ACTIVITY_LOG_PAGE_SIZE = 25

export function normalizeActivityLogSettings(
  settings?: ActivityLogSettings | null,
): Required<ActivityLogSettings> {
  return {
    maxItems: settings?.maxItems ?? DEFAULT_ACTIVITY_LOG_SETTINGS.maxItems,
    actions:
      settings?.actions && settings.actions.length > 0
        ? settings.actions
        : DEFAULT_ACTIVITY_LOG_SETTINGS.actions,
    showDeltas: settings?.showDeltas ?? DEFAULT_ACTIVITY_LOG_SETTINGS.showDeltas,
  }
}

// Data-grid and scheduling types

export interface DataTableNumberDisplayOptions {
  prefix?: string
  suffix?: string
  decimalPlaces?: number
  /** When true and no field affix, format with org currency (Intl). */
  useOrgCurrency?: boolean
}

export interface DataTableColumnConfig {
  field: string
  header: string
  component?: PrimeVueComponentType
  relatedCollection?: string
  template?: string
  format?: string
  /** Currency / number display options from field meta (list cells). */
  numberDisplay?: DataTableNumberDisplayOptions | null
  enabled?: boolean
  /** When true, this list / related-list column can be edited inline. Default off. */
  inlineEditable?: boolean
}

export interface DataTableSortConfig {
  field: string
  order: 1 | -1
}

export interface DataTableGroupConfig {
  field: string
  expandable?: boolean
}

/**
 * @deprecated Prefer RecordPageLayoutSchema.listDetailPanel.
 * Legacy collapsible master/detail panel stored on list-view table settings.
 */
export interface ListViewDetailPanel {
  /** When true, list page shows a vertical splitter with a related-records pane. */
  enabled: boolean
  /**
   * Block Layout Setting id whose DataTable (related-list) fields are shown.
   * Preferred over relatedCollection / dataTable — same model as Page Layout Related List.
   */
  blockLayoutId?: string | null
  /**
   * Optional: show only this DataTable field from the Block Layout.
   * Omit to show all related lists (tabs when multiple).
   */
  relatedFieldId?: string | null
  /**
   * @deprecated Prefer blockLayoutId. Kept for legacy configs without a Block Layout.
   * Child collection shown in the detail pane.
   */
  relatedCollection?: string
  /** @deprecated Prefer Block Layout field labels. */
  label?: string
  /** @deprecated Prefer Block Layout DataTable field settings. */
  dataTable?: DataTableSettings
  /** Initial master pane size percent (1–99). Default 60. Persisted via Splitter stateKey. */
  masterSize?: number
  /** Minimum detail pane size percent when expanded. Default 15. */
  detailMinSize?: number
  /** Start with the detail pane collapsed. Remembered in localStorage per collection. */
  defaultCollapsed?: boolean
}

/** Rows fed into a list DocEngine report. */
export type ListViewActionRecordScope = 'filtered' | 'visible'

export type ListViewActionBehavior = 'openDocument' | 'bulkUpdate'

/**
 * Prompt + formula bulk patch for rows in the current list collection
 * (same tokens as record-action bulk update: `{{source}}`, `{{prompt}}`).
 */
export interface ListViewBulkUpdateSettings {
  /** Writable field on list rows to patch (admin-selected). */
  targetField: string
  /** Dotted path on each row for the source number (e.g. item.base_price). */
  sourcePath: string
  /**
   * Arithmetic expression using `{{source}}` and `{{prompt}}`.
   * Example: `{{source}} * (1 - {{prompt}} / 100)`
   */
  formula?: string
  /** Label for the numeric prompt dialog. */
  promptLabel?: string
  confirmBeforeRun?: boolean
  successMessage?: string
}

/**
 * Toolbar action on object / related list tables.
 * - openDocument: DocEngine list report from `{ records: [...] }`
 * - bulkUpdate: prompt + formula patch on filtered / visible rows
 */
export interface ListViewAction {
  id: string
  label: string
  behavior: ListViewActionBehavior
  document?: {
    templateId: string | null
    viewMode?: 'html' | 'pdf'
    /** List reports default to skip fill (direct preview). */
    skipInteractiveFill?: boolean
  }
  bulkUpdate?: ListViewBulkUpdateSettings
  /** Which rows are included. Default: filtered. */
  recordScope?: ListViewActionRecordScope
}

/** What to do after a barcode scan finds record(s). */
export type BarcodeScanMatchMode = 'open' | 'filter' | 'open-or-filter'

/** Per-list barcode / HID wedge scan configuration. */
export interface BarcodeScanSettings {
  /** Show Scan input + Scan mode toggle. Omitted / false = off. */
  enabled: boolean
  /** Field matched with `_eq` (e.g. `id`, `barcode`). */
  field: string
  /** Default: `open-or-filter` (open when unique, filter when many). */
  matchMode?: BarcodeScanMatchMode
  /** Start with document key capture on. */
  defaultScanModeOn?: boolean
  /**
   * After a unique match, patch these fields before open/filter.
   * Tokens: `$NOW`, `$NULL`, `$SCAN` (scanned code).
   */
  setFields?: Record<string, unknown> | null
  /**
   * Optional field written from the Scan toolbar “Value” input.
   * When set, the value input is shown at runtime.
   */
  updateField?: string | null
  /** Confirm before applying setFields / updateField. */
  confirmUpdate?: boolean
}

export interface DataTableSettings {
  columns: DataTableColumnConfig[]
  sort?: DataTableSortConfig | null
  groupBy?: DataTableGroupConfig | null
  /** Column field used as the record detail link; null/primary key uses auto Id column. */
  recordLinkField?: string | null
  /** Optional batch insert picker for related DataTable fields. */
  relatedTransfer?: RelatedTransferSettings | null
  /** Optional toolbar DocEngine / list actions (collection table meta). */
  actions?: ListViewAction[] | null
  /** Max rows shown in embedded related DataTable fields; default 5. */
  rowLimit?: number
  /** Optional master/detail related panel for object list pages. */
  detailPanel?: ListViewDetailPanel | null
  /**
   * After inline cell save, re-fetch row data so automation/formula side effects appear.
   * Default / omitted = off (only the edited cell is patched locally).
   */
  inlineEditRefresh?: 'off' | 'row' | 'fields'
  /** Field names to merge when `inlineEditRefresh` is `fields`. */
  inlineEditRefreshFields?: string[]
  /** Barcode / Scan mode settings for object lists and related DataTables. */
  barcodeScan?: BarcodeScanSettings | null
}

export type RelatedTransferSourceMode = 'tree' | 'table' | 'list'

export interface RelatedTransferSourceSettings {
  mode: RelatedTransferSourceMode
  /** Tree group collection. Required when mode = tree. */
  groupCollection?: string
  /** Source item collection. */
  itemCollection: string
  groupPrimaryKey?: string
  groupParentField?: string | null
  groupLabelField?: string
  itemPrimaryKey?: string
  /**
   * Field on the source item that links to the tree group.
   * Supports nested paths (e.g. `item.group` when source is Item Price).
   */
  itemGroupField?: string
  itemLabelFields?: string[]
  /** Extra fields to request from source items for mapping/default display. */
  fields?: string[]
  /** List filter. Supports tokens such as $parent.facility. */
  filter?: Record<string, unknown> | null
}

export interface RelatedTransferTotalFormula {
  /** Display label shown in the panel header, e.g. "Total Amount". */
  label: string
  /** Arithmetic expression referencing destination column field names, e.g. "qty * price + 0.5". */
  formula: string
}

export interface RelatedTransferTargetSettings {
  collection: string
  parentField: string
  itemField: string
  duplicateKey?: string
  columns: DataTableColumnConfig[]
  /** Target fields editable for pending rows before submit, e.g. ['Quantity']. */
  editableFields?: string[]
  /** Default values pre-filled for editable destination fields when a source item is added, e.g. { qty: 1 } or { Quantity: '$source.Item.MinQty' }. */
  defaultValues?: Record<string, unknown>
  /** Default values pre-filled into editable fields when a pending row is created, e.g. { qty: 1 }. */
  editableFieldDefaults?: Record<string, unknown>
  /** Formula-based totals shown in the panel header. */
  totalFormulas?: RelatedTransferTotalFormula[]
}

export interface RelatedTransferLookupMapping {
  /** Child lookup collection, e.g. item_price. */
  collection: string
  /** Field copied from the matched child record into the destination field. */
  valueField: string
  /** Optional field shown in a row-level picker when selectable is true. */
  labelField?: string
  /** Optional source collection field whose value preselects a selectable lookup. */
  defaultValueField?: string
  /** true = user chooses one child record per pending source item. */
  selectable?: boolean
  /** Optional extra child fields to request. */
  fields?: string[]
  /** List filter. Supports tokens such as $source.id and $parent.facility.price_group. */
  filter?: Record<string, unknown> | null
}

export interface RelatedTransferMappingSettings {
  defaults?: Record<string, unknown>
  /** targetField -> sourceField */
  copyFromSource?: Record<string, string>
  /** targetField -> static value or token such as $parent.id / $source.id */
  values?: Record<string, unknown>
  /** targetField -> child lookup configuration. */
  lookups?: Record<string, RelatedTransferLookupMapping>
}

export interface RelatedTransferSettings {
  source: RelatedTransferSourceSettings
  target: RelatedTransferTargetSettings
  mapping?: RelatedTransferMappingSettings
}

export interface TreeTableSettings {
  group: {
    collection: string
    primaryKey: string
    parentField?: string | null
    labelField: string
  }
  main: {
    collection: string
    groupField: string
    primaryKey: string
    labelField?: string
    labelFields: string[]
    /** Default sort for the items pane. */
    sort?: DataTableSortConfig | null
  }
  destination: {
    collection: string
    key: string
  }
}

export type SchedulerViewMode = 'resourceCalendar' | 'timelineScheduler'

export interface SchedulerResourceSettings {
  title: string
  collection: string
  primaryKey: string
  labelField: string
  eventField?: string
}

export interface SchedulerResourceTreeSettings {
  enabled: boolean
  collection: string
  fields: string[]
}

export interface SchedulerFilterLevel {
  groupField: string
  title: string
}

export type SchedulerEventClickAction = 'openDetails' | 'openEditDialog'

export interface SchedulerResourceFilterSettings {
  enabled: boolean
  title: string
  collection: string
  /** Legacy single-level group field. Kept in sync with `levels[0]` for backward compatibility. */
  groupField: string
  /** Ordered list of cascading filter levels (supersedes `groupField`). */
  levels: SchedulerFilterLevel[]
  resourceField: string
  /**
   * Optional hierarchical tree for one filter level (typically Facility).
   * Uses a self-FK `parentField` on the related collection of that level's groupField.
   */
  tree?: SchedulerFilterTreeSettings | null
}

/** Tree presentation for a scheduler filter level. */
export interface SchedulerFilterTreeSettings {
  enabled: boolean
  /** Index into `levels` that renders as a tree. Defaults to 0. */
  levelIndex?: number
  /** Self-referential parent field on the related collection of that level. */
  parentField: string
}

export interface SchedulerSettings {
  viewMode: SchedulerViewMode
  resource: SchedulerResourceSettings & {
    tree?: SchedulerResourceTreeSettings
    filter?: SchedulerResourceFilterSettings
  }
  event: {
    collection: string
    primaryKey: string
    titleField: string
    titleFields?: string[]
    startField: string
    endField: string
    resourceField: string
    resourceFields?: string[]
    statusField?: string | null
    statusColors?: Record<string, string>
    colorField?: string | null
    defaultTitle?: string
    /** What happens when a scheduler event is clicked. */
    clickAction?: SchedulerEventClickAction
    /** Show a delete control on each event and allow removing records from the scheduler. */
    allowDelete?: boolean
    /**
     * Optional work-time availability guard. When enabled, new events may only
     * be created inside an intake window and never overlapping a block window,
     * cross-checked against the availability (crm_schedule) collection.
     */
    availability?: SchedulerAvailabilitySettings | null
    /**
     * 'direct'            – default: records are mapped 1-to-1 to events via startField/endField.
     * 'templateExpansion' – records hold a recurrence rule JSON; virtual events are generated
     *                       for the visible range, bounded by startField/endField per record.
     */
    sourceMode?: 'direct' | 'templateExpansion'
    /** Field holding the recurrence rule JSON (used when sourceMode = 'templateExpansion'). */
    ruleField?: string
  }
}

/**
 * Availability rules used by the scheduler create flow to block booking a visit
 * outside a provider's intake windows or inside a block window.
 */
export interface SchedulerAvailabilitySettings {
  enabled?: boolean
  /** Collection holding materialized availability slots (e.g. `crm_schedule`). */
  collection: string
  /** M2O field on the slot collection pointing at the resource (e.g. `provider`). */
  resourceField: string
  /** Slot start datetime field (e.g. `date_start`). */
  startField: string
  /** Slot end datetime field (e.g. `date_end`). */
  endField: string
  /** Field discriminating slot type (e.g. `type`). */
  typeField: string
  /** Value marking an intake (bookable) slot. */
  intakeValue: string
  /** Value marking a block (unavailable) slot. */
  blockValue: string
}

// Work-time scheduler template (crm_schedule_template) types

export type ScheduleRuleFrequency = 'weekly' | 'monthly'
export type ScheduleWeekParity = 'all' | 'even' | 'odd'

/** A single recurrence rule stored inside a template's `template` JSON field. */
export interface ScheduleRule {
  frequency: ScheduleRuleFrequency
  /** Week parity for weekly rules; ignored for monthly. */
  weekParity?: ScheduleWeekParity
  /** ISO weekday numbers (1=Mon … 7=Sun) for weekly rules. */
  daysOfWeek?: number[]
  /** Day-of-month numbers (1..31) for monthly rules. */
  daysOfMonth?: number[]
  /** Working window start, local wall-clock 'HH:mm'. */
  startTime: string
  /** Working window end, local wall-clock 'HH:mm'. */
  endTime: string
}
