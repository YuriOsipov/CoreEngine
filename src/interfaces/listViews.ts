import type {
  DataTableColumnConfig,
  DataTableGroupConfig,
  DataTableSortConfig,
  ListViewAction,
  ListViewDetailPanel,
  RelatedTransferSettings,
} from '@/interfaces/entities'
import type {
  FilterLogic,
  ListFilterCondition,
} from '@/modules/config/services/listFilterSettings'
import { ALL_RECORDS_FILTER_ID } from '@/modules/config/services/listFilterSettings'
import { RECENTLY_VIEWED_FILTER_ID } from '@/modules/dashboard/services/recentRecords'

export type PredefinedListViewId =
  | typeof ALL_RECORDS_FILTER_ID
  | typeof RECENTLY_VIEWED_FILTER_ID

export interface PredefinedListViewTableSettings {
  columns: DataTableColumnConfig[]
  sort?: DataTableSortConfig | null
  groupBy?: DataTableGroupConfig | null
  recordLinkField?: string | null
}

export interface ListViewBody {
  logic: FilterLogic
  conditions: ListFilterCondition[]
  columns: DataTableColumnConfig[]
  sort?: DataTableSortConfig | null
  groupBy?: DataTableGroupConfig | null
  recordLinkField?: string | null
}

export interface SavedListView {
  id: string
  name: string
  roleId: string | null
  roleName?: string | null
  logic: FilterLogic
  conditions: ListFilterCondition[]
  columns: DataTableColumnConfig[]
  sort?: DataTableSortConfig | null
  groupBy?: DataTableGroupConfig | null
  recordLinkField?: string | null
}

export interface ListViewTableMeta {
  relatedTransfer?: RelatedTransferSettings | null
  /** Toolbar DocEngine list actions (shared across views for the collection). */
  actions?: ListViewAction[] | null
  /** Master/detail related panel for the object list page. */
  detailPanel?: ListViewDetailPanel | null
  /**
   * After inline cell save, re-fetch row data so automation/formula side effects appear.
   * Default / omitted = off.
   */
  inlineEditRefresh?: 'off' | 'row' | 'fields'
  /** Field names to merge when `inlineEditRefresh` is `fields`. */
  inlineEditRefreshFields?: string[]
  predefinedViews?: Partial<Record<PredefinedListViewId, PredefinedListViewTableSettings>>
}

export function isPredefinedListViewId(viewId: string): viewId is PredefinedListViewId {
  return viewId === ALL_RECORDS_FILTER_ID || viewId === RECENTLY_VIEWED_FILTER_ID
}
