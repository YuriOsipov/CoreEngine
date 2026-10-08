import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { BUILDER_MODES, type BuilderMode } from './builderMode'
import {
  DEFAULT_SETUP_LAYOUT_TYPE,
  SETUP_LAYOUT_TYPES,
  type SetupLayoutType,
  type SetupLayoutTypeDef,
} from './setupLayoutType'

export type SetupMetaSection = 'fields' | 'parameters' | 'unique' | 'automations'
export type SetupCollectionSection = SetupMetaSection | SetupLayoutType

const META_SECTIONS = new Set<string>(['fields', 'parameters', 'unique', 'automations'])
/** Layout types still reachable via legacy URL, but not in object nav. */
const LEGACY_LAYOUT_SECTIONS = new Set<string>(['document'])

export interface SetupCollectionNavItem {
  id: SetupCollectionSection
  labelKey: string
  defaultLabel: string
  group?: 'fields' | 'layouts'
}

export const SETUP_COLLECTION_NAV: SetupCollectionNavItem[] = [
  {
    id: 'fields',
    labelKey: 'setup.fieldsAndRelationships',
    defaultLabel: 'Fields & Relationships',
    group: 'fields',
  },
  {
    id: 'parameters',
    labelKey: 'setup.entityParameters.title',
    defaultLabel: 'Entity parameters',
    group: 'fields',
  },
  {
    id: 'automations',
    labelKey: 'setup.automations.title',
    defaultLabel: 'Automations',
    group: 'fields',
  },
  ...SETUP_LAYOUT_TYPES.map(
    (entry: SetupLayoutTypeDef): SetupCollectionNavItem => ({
      id: entry.id,
      labelKey: entry.labelKey,
      defaultLabel: entry.defaultLabel,
      group: 'layouts',
    }),
  ),
]

export const DEFAULT_SETUP_SECTION: SetupCollectionSection = 'fields'

function parseSectionToken(value: string): SetupCollectionSection | null {
  if (!value) return null
  // Legacy Unique tab → Entity parameters (includes duplication)
  if (value === 'unique') return 'parameters'
  if (META_SECTIONS.has(value)) return value as SetupMetaSection
  if (value === 'entity-compact') return 'entityCompact'
  if (LEGACY_LAYOUT_SECTIONS.has(value)) return value as SetupLayoutType
  if (
    BUILDER_MODES.includes(value as BuilderMode)
    && SETUP_LAYOUT_TYPES.some((entry) => entry.id === value)
  ) {
    return value as SetupLayoutType
  }
  return null
}

export function routeQueryCollectionSection(
  route: RouteLocationNormalizedLoaded,
): SetupCollectionSection {
  const sectionRaw = route.query.section
  if (typeof sectionRaw === 'string') {
    const parsed = parseSectionToken(sectionRaw.trim())
    if (parsed) return parsed
  }

  const raw = route.query.layoutType ?? route.query.mode
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) {
    // Empty query (and unknown section tokens) stay on Fields.
    return DEFAULT_SETUP_SECTION
  }

  const parsedLayout = parseSectionToken(value)
  if (parsedLayout && !META_SECTIONS.has(parsedLayout)) {
    return parsedLayout
  }
  return DEFAULT_SETUP_LAYOUT_TYPE
}

export function isSetupMetaSection(
  section: SetupCollectionSection,
): section is SetupMetaSection {
  return META_SECTIONS.has(section)
}

export function isSetupLayoutSection(
  section: SetupCollectionSection,
): section is SetupLayoutType {
  return !isSetupMetaSection(section)
}
