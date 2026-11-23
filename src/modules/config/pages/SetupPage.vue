<script lang="ts">
export default {
  name: 'SetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { getEffectiveSetupAccess } from '@/core/setupAccess'
import { useTranslation } from '@/core/translation'
import { PM_PROJECT_TEMPLATE_COLLECTION } from '@/interfaces/projects'
import { collectionExistsInRegistry } from '@/modules/entities/services/collectionSchema'

const route = useRoute()
const router = useRouter()
const { t } = useTranslation()

const projectTemplatesPath = `/object/${PM_PROJECT_TEMPLATE_COLLECTION}`
const projectTemplateExists = ref(false)
const isFullSetupAdmin = ref(false)
const canAuthorReports = ref(false)
const canOpenSetup = ref(false)
const accessLoaded = ref(false)

const allTabs = computed(() => [
  {
    label: t('setup.generalTab', 'General'),
    to: '/setup/general',
    adminOnly: true,
  },
  {
    label: t('setup.schemaSyncTab', 'Schema sync'),
    to: '/setup/schema-sync',
    adminOnly: true,
  },
  {
    label: t('setup.objectManagerTab', 'Object Manager'),
    to: '/setup/objects',
    adminOnly: true,
  },
  {
    label: t('setup.documentsTab', 'Document Templates'),
    to: '/setup/documents',
    adminOnly: true,
  },
  {
    label: t('setup.reportsTab', 'Reports'),
    to: '/setup/reports',
    adminOnly: false,
    reportsAuthor: true,
  },
  {
    label: t('setup.dashboardsTab', 'Dashboards'),
    to: '/setup/dashboards',
    adminOnly: true,
  },
  ...(projectTemplateExists.value
    ? [
        {
          label: t('setup.projectsTab', 'Project Templates'),
          to: projectTemplatesPath,
          adminOnly: true,
        },
      ]
    : []),
  {
    label: t('setup.usersTab', 'Users'),
    to: '/setup/users',
    adminOnly: true,
  },
  {
    label: t('setup.rolesTab', 'Roles'),
    to: '/setup/roles',
    adminOnly: true,
  },
  {
    label: t('setup.navigationTab', 'Navigation'),
    to: '/setup/navigation',
    adminOnly: true,
  },
  {
    label: t('setup.tasksTab', 'Tasks'),
    to: '/setup/tasks',
    adminOnly: true,
  },
  {
    label: t('setup.flowsTab', 'Flows'),
    to: '/setup/flows',
    adminOnly: true,
  },
  {
    label: t('setup.archivedTab', 'Archived records'),
    to: '/setup/archived',
    adminOnly: true,
  },
  {
    label: t('setup.configAuditTab', 'Config audit'),
    to: '/setup/config-audit',
    adminOnly: true,
  },
])

const tabs = computed(() => {
  if (!accessLoaded.value || !canOpenSetup.value) return []
  if (isFullSetupAdmin.value) return allTabs.value
  if (canAuthorReports.value) {
    return allTabs.value.filter((tab) => tab.reportsAuthor)
  }
  return []
})

function isReportsPath(path: string): boolean {
  return path === '/setup/reports' || path.startsWith('/setup/reports/')
}

async function loadAccess(): Promise<void> {
  const access = await getEffectiveSetupAccess()
  isFullSetupAdmin.value = access.isFullSetupAdmin
  canAuthorReports.value = access.canAuthorReports
  canOpenSetup.value = access.canOpenSetup
  accessLoaded.value = true
  enforceSetupAccess()
}

function enforceSetupAccess(): void {
  if (!accessLoaded.value) return
  if (!canOpenSetup.value) {
    void router.replace({ name: 'home' })
    return
  }
  if (isFullSetupAdmin.value) return
  if (canAuthorReports.value && !isReportsPath(route.path)) {
    void router.replace('/setup/reports')
  }
}

onMounted(() => {
  void loadAccess()
  void collectionExistsInRegistry(PM_PROJECT_TEMPLATE_COLLECTION).then(
    (exists) => {
      projectTemplateExists.value = exists
    },
  )
})

watch(
  () => route.path,
  () => {
    enforceSetupAccess()
  },
)

function isTabActive(path: string): boolean {
  if (path === '/setup/general') {
    return route.path === '/setup/general'
  }
  if (path === '/setup/schema-sync') {
    return route.path.startsWith('/setup/schema-sync')
  }
  if (path === '/setup/objects') {
    return (
      route.path === '/setup/objects' ||
      route.path.startsWith('/setup/objects/')
    )
  }
  if (path === '/setup/documents') {
    return route.path.startsWith('/setup/documents')
  }
  if (path === '/setup/reports') {
    return route.path.startsWith('/setup/reports')
  }
  if (path === '/setup/dashboards') {
    return route.path.startsWith('/setup/dashboards')
  }
  if (path === projectTemplatesPath) {
    return (
      route.path === projectTemplatesPath ||
      route.path.startsWith(`${projectTemplatesPath}/`)
    )
  }
  if (path === '/setup/users') {
    return route.path.startsWith('/setup/users')
  }
  if (path === '/setup/roles') {
    return route.path.startsWith('/setup/roles')
  }
  if (path === '/setup/navigation') {
    return route.path.startsWith('/setup/navigation')
  }
  if (path === '/setup/tasks') {
    return route.path.startsWith('/setup/tasks')
  }
  if (path === '/setup/flows') {
    return route.path.startsWith('/setup/flows')
  }
  if (path === '/setup/archived') {
    return route.path.startsWith('/setup/archived')
  }
  if (path === '/setup/config-audit') {
    return route.path.startsWith('/setup/config-audit')
  }
  return false
}
</script>

<template>
  <main class="app-shell setup-page">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <h1>{{ t('setup.title', 'Setup') }}</h1>
          <p>{{ t('setup.subtitle', 'Configure collections, layouts, and system settings.') }}</p>
        </div>
      </div>
    </header>

    <nav
      class="setup-tab-menu"
      :aria-label="t('setup.tabsNav', 'Setup sections')"
    >
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="setup-tab-menu__link"
        :class="{ 'setup-tab-menu__link--active': isTabActive(tab.to) }"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <RouterView v-if="accessLoaded && canOpenSetup" />
  </main>
</template>
