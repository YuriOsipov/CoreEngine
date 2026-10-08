import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { BUILDER_MODES, type BuilderMode } from './builderMode'

export type SetupLayoutType = BuilderMode

export interface SetupLayoutTypeDef {
  id: SetupLayoutType
  labelKey: string
  defaultLabel: string
}

export const SETUP_LAYOUT_TYPES: SetupLayoutTypeDef[] = [
  {
    id: 'recordPage',
    labelKey: 'setup.layoutType.pageLayouts',
    defaultLabel: 'Page Layouts',
  },
  {
    id: 'entity',
    labelKey: 'setup.layoutType.blockLayouts',
    defaultLabel: 'Block Layouts',
  },
  {
    id: 'entityCompact',
    labelKey: 'setup.layoutType.compactLayouts',
    defaultLabel: 'Compact Layouts',
  },
  {
    id: 'table',
    labelKey: 'setup.layoutType.listViews',
    defaultLabel: 'List Views',
  },
  {
    id: 'tree',
    labelKey: 'setup.layoutType.treeLayouts',
    defaultLabel: 'Tree Layouts',
  },
  {
    id: 'scheduler',
    labelKey: 'setup.layoutType.schedulerLayouts',
    defaultLabel: 'Scheduler Layouts',
  },
]

export const DEFAULT_SETUP_LAYOUT_TYPE: SetupLayoutType = 'recordPage'

export function routeQueryLayoutType(route: RouteLocationNormalizedLoaded): SetupLayoutType {
  const raw = route.query.layoutType ?? route.query.mode
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return DEFAULT_SETUP_LAYOUT_TYPE

  if (BUILDER_MODES.includes(value as BuilderMode)) {
    return value as SetupLayoutType
  }

  if (value === 'entity-compact') {
    return 'entityCompact'
  }

  return DEFAULT_SETUP_LAYOUT_TYPE
}

export function setupLayoutTypeLabelKey(layoutType: SetupLayoutType): string {
  if (layoutType === 'document') return 'setup.layoutType.documentTemplates'
  return SETUP_LAYOUT_TYPES.find((entry) => entry.id === layoutType)?.labelKey
    ?? 'setup.layoutType.pageLayouts'
}

export function setupLayoutTypeDefaultLabel(layoutType: SetupLayoutType): string {
  if (layoutType === 'document') return 'Document Templates'
  return SETUP_LAYOUT_TYPES.find((entry) => entry.id === layoutType)?.defaultLabel
    ?? 'Page Layouts'
}
