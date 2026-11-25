import { PM_PROJECT_TEMPLATE_COLLECTION } from '@/interfaces/projects'

export type SetupNavAccess = {
  adminOnly?: boolean
  reportsAuthor?: boolean
  /** Leaves `/setup` (e.g. Project Templates object list). */
  external?: boolean
  /** Only include when project template entity exists. */
  requiresProjectTemplate?: boolean
}

export type SetupNavItemDef = {
  id: string
  labelKey: string
  defaultLabel: string
  to: string
} & SetupNavAccess

export type SetupNavGroupDef = {
  id: string
  labelKey: string
  defaultLabel: string
  items: SetupNavItemDef[]
}

export const PROJECT_TEMPLATES_PATH = `/object/${PM_PROJECT_TEMPLATE_COLLECTION}`

export const SETUP_NAV_GROUPS: SetupNavGroupDef[] = [
  {
    id: 'company',
    labelKey: 'setup.nav.groupCompany',
    defaultLabel: 'Company Settings',
    items: [
      {
        id: 'general',
        labelKey: 'setup.generalTab',
        defaultLabel: 'General',
        to: '/setup/general',
        adminOnly: true,
      },
      {
        id: 'schedule',
        labelKey: 'setup.scheduleTab',
        defaultLabel: 'Schedule',
        to: '/setup/schedule',
        adminOnly: true,
      },
      {
        id: 'schema-sync',
        labelKey: 'setup.schemaSyncTab',
        defaultLabel: 'Schema sync',
        to: '/setup/schema-sync',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'objects',
    labelKey: 'setup.nav.groupObjects',
    defaultLabel: 'Objects',
    items: [
      {
        id: 'objects',
        labelKey: 'setup.objectManagerTab',
        defaultLabel: 'Object Manager',
        to: '/setup/objects',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'users',
    labelKey: 'setup.nav.groupUsers',
    defaultLabel: 'Users',
    items: [
      {
        id: 'users',
        labelKey: 'setup.usersTab',
        defaultLabel: 'Users',
        to: '/setup/users',
        adminOnly: true,
      },
      {
        id: 'roles',
        labelKey: 'setup.rolesTab',
        defaultLabel: 'Roles',
        to: '/setup/roles',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'ui',
    labelKey: 'setup.nav.groupUi',
    defaultLabel: 'User Interface',
    items: [
      {
        id: 'navigation',
        labelKey: 'setup.navigationTab',
        defaultLabel: 'Navigation',
        to: '/setup/navigation',
        adminOnly: true,
      },
      {
        id: 'documents',
        labelKey: 'setup.documentsTab',
        defaultLabel: 'Document Templates',
        to: '/setup/documents',
        adminOnly: true,
      },
      {
        id: 'dashboards',
        labelKey: 'setup.dashboardsTab',
        defaultLabel: 'Dashboards',
        to: '/setup/dashboards',
        adminOnly: true,
      },
      {
        id: 'reports',
        labelKey: 'setup.reportsTab',
        defaultLabel: 'Reports',
        to: '/setup/reports',
        adminOnly: false,
        reportsAuthor: true,
      },
    ],
  },
  {
    id: 'automation',
    labelKey: 'setup.nav.groupAutomation',
    defaultLabel: 'Automation',
    items: [
      {
        id: 'tasks',
        labelKey: 'setup.tasksTab',
        defaultLabel: 'Tasks',
        to: '/setup/tasks',
        adminOnly: true,
      },
      {
        id: 'connections',
        labelKey: 'setup.flowsTab',
        defaultLabel: 'Connections',
        to: '/setup/connections',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'data',
    labelKey: 'setup.nav.groupData',
    defaultLabel: 'Data',
    items: [
      {
        id: 'archived',
        labelKey: 'setup.archivedTab',
        defaultLabel: 'Archived records',
        to: '/setup/archived',
        adminOnly: true,
      },
      {
        id: 'config-audit',
        labelKey: 'setup.configAuditTab',
        defaultLabel: 'Config audit',
        to: '/setup/config-audit',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'projects',
    labelKey: 'setup.nav.groupProjects',
    defaultLabel: 'Projects',
    items: [
      {
        id: 'projects',
        labelKey: 'setup.projectsTab',
        defaultLabel: 'Project Templates',
        to: PROJECT_TEMPLATES_PATH,
        adminOnly: true,
        external: true,
        requiresProjectTemplate: true,
      },
    ],
  },
]

export type SetupNavItemView = {
  id: string
  label: string
  to: string
  external?: boolean
}

export type SetupNavGroupView = {
  id: string
  label: string
  items: SetupNavItemView[]
}

export function isSetupNavItemActive(path: string, itemTo: string): boolean {
  if (itemTo === '/setup/general') {
    return path === '/setup/general'
  }
  if (itemTo === '/setup/schedule') {
    return path.startsWith('/setup/schedule')
  }
  if (itemTo === '/setup/schema-sync') {
    return path.startsWith('/setup/schema-sync')
  }
  if (itemTo === '/setup/objects') {
    return path === '/setup/objects' || path.startsWith('/setup/objects/')
  }
  if (itemTo === '/setup/documents') {
    return path.startsWith('/setup/documents')
  }
  if (itemTo === '/setup/reports') {
    return path.startsWith('/setup/reports')
  }
  if (itemTo === '/setup/dashboards') {
    return path.startsWith('/setup/dashboards')
  }
  if (itemTo === PROJECT_TEMPLATES_PATH) {
    return path === PROJECT_TEMPLATES_PATH || path.startsWith(`${PROJECT_TEMPLATES_PATH}/`)
  }
  if (itemTo === '/setup/users') {
    return path.startsWith('/setup/users')
  }
  if (itemTo === '/setup/roles') {
    return path.startsWith('/setup/roles')
  }
  if (itemTo === '/setup/navigation') {
    return path.startsWith('/setup/navigation')
  }
  if (itemTo === '/setup/tasks') {
    return path.startsWith('/setup/tasks')
  }
  if (itemTo === '/setup/connections') {
    return path.startsWith('/setup/connections')
  }
  if (itemTo === '/setup/archived') {
    return path.startsWith('/setup/archived')
  }
  if (itemTo === '/setup/config-audit') {
    return path.startsWith('/setup/config-audit')
  }
  return path === itemTo || path.startsWith(`${itemTo}/`)
}

export function filterSetupNavGroups(options: {
  isFullSetupAdmin: boolean
  canAuthorReports: boolean
  projectTemplateExists: boolean
  translate: (key: string, fallback: string) => string
}): SetupNavGroupView[] {
  const { isFullSetupAdmin, canAuthorReports, projectTemplateExists, translate } = options

  return SETUP_NAV_GROUPS.map((group) => {
    const items = group.items
      .filter((item) => {
        if (item.requiresProjectTemplate && !projectTemplateExists) return false
        if (isFullSetupAdmin) return true
        if (canAuthorReports) return Boolean(item.reportsAuthor)
        return false
      })
      .map((item) => ({
        id: item.id,
        label: translate(item.labelKey, item.defaultLabel),
        to: item.to,
        external: item.external,
      }))

    if (!items.length) return null

    return {
      id: group.id,
      label: translate(group.labelKey, group.defaultLabel),
      items,
    }
  }).filter((group): group is SetupNavGroupView => group != null)
}
