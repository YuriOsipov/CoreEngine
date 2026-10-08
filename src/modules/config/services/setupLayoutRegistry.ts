import { readSettingRecords } from '@/core/graphql/settingRecordsBridge'
import {
  loadAppRoles,
  normalizeSetupLayoutListItem,
  sortRoleScopedLayouts,
  type SettingRecordWithRole,
} from '@/core/settingRoleUtils'
import type { SetupLayoutListItem } from '@/interfaces'
import { deleteTreeTableLayout } from '@/modules/entities/services/treeTableSettings'
import type { BuilderMode } from '../types/builderMode'
import {
  deleteCompactLayout,
  deleteEntityForm,
} from './layoutSettings'
import { deleteListView } from './listViewSettings'
import { deleteRecordPageLayout } from './recordPageSettings'
import { deleteSchedulerLayout } from './schedulerSettings'
import {
  deleteDocTemplate,
  loadDocTemplateListItems,
} from '@/modules/documents/services/docTemplateService'

interface SetupLayoutRegistryEntry {
  group: string | string[]
  subGroup: string
  deleteItem: (collection: string, layoutId: string) => Promise<void>
}

const SETUP_LAYOUT_REGISTRY: Record<BuilderMode, SetupLayoutRegistryEntry> = {
  recordPage: {
    group: 'RecordPage',
    subGroup: 'full',
    deleteItem: deleteRecordPageLayout,
  },
  entity: {
    group: ['entity', 'enity'],
    subGroup: 'full',
    deleteItem: deleteEntityForm,
  },
  entityCompact: {
    group: ['entity', 'entoty'],
    subGroup: 'compact',
    deleteItem: deleteCompactLayout,
  },
  table: {
    group: 'list',
    subGroup: 'table',
    deleteItem: deleteListView,
  },
  tree: {
    group: 'Tree',
    subGroup: 'full',
    deleteItem: deleteTreeTableLayout,
  },
  scheduler: {
    group: 'Scheduler',
    subGroup: 'full',
    deleteItem: deleteSchedulerLayout,
  },
  document: {
    group: 'Document',
    subGroup: 'template',
    deleteItem: async (_collection, layoutId) => {
      await deleteDocTemplate(layoutId)
    },
  },
}

export async function loadSetupLayoutList(
  collection: string,
  layoutType: BuilderMode,
): Promise<SetupLayoutListItem[]> {
  if (layoutType === 'document') {
    return loadDocTemplateListItems(collection)
  }

  const entry = SETUP_LAYOUT_REGISTRY[layoutType]
  const groups = Array.isArray(entry.group) ? entry.group : [entry.group]
  const records = await readSettingRecords<SettingRecordWithRole>({
    collection,
    groups,
    subGroup: entry.subGroup,
  })

  const roles = await loadAppRoles()
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]))

  const layouts = sortRoleScopedLayouts(
    records.map((record) => normalizeSetupLayoutListItem(record)),
  )

  return layouts.map((layout) => ({
    ...layout,
    roleName:
      layout.roleName
      ?? (layout.roleId ? roleNameById.get(layout.roleId) ?? null : null),
  }))
}

export async function deleteSetupLayout(
  collection: string,
  layoutType: BuilderMode,
  layoutId: string,
): Promise<void> {
  if (layoutType === 'document') {
    await deleteDocTemplate(layoutId)
    return
  }
  await SETUP_LAYOUT_REGISTRY[layoutType].deleteItem(collection, layoutId)
}
