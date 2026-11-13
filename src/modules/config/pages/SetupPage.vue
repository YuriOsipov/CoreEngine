<script lang="ts">
export default {
  name: 'SetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useTranslation } from '@/core/translation'
import { PM_PROJECT_TEMPLATE_COLLECTION } from '@/interfaces/projects'
import { collectionExistsInRegistry } from '@/modules/entities/services/collectionSchema'

const route = useRoute()
const { t } = useTranslation()

const projectTemplatesPath = `/object/${PM_PROJECT_TEMPLATE_COLLECTION}`
const projectTemplateExists = ref(false)

const tabs = computed(() => [
  {
    label: t('setup.generalTab', 'General'),
    to: '/setup/general',
  },
  {
    label: t('setup.schemaSyncTab', 'Schema sync'),
    to: '/setup/schema-sync',
  },
  {
    label: t('setup.objectManagerTab', 'Object Manager'),
    to: '/setup/objects',
  },
  {
    label: t('setup.documentsTab', 'Document Templates'),
    to: '/setup/documents',
  },
  {
    label: t('setup.reportsTab', 'Reports'),
    to: '/setup/reports',
  },
  {
    label: t('setup.dashboardsTab', 'Dashboards'),
    to: '/setup/dashboards',
  },
  ...(projectTemplateExists.value
    ? [
        {
          label: t('setup.projectsTab', 'Project Templates'),
          to: projectTemplatesPath,
        },
      ]
    : []),
  {
    label: t('setup.usersTab', 'Users'),
    to: '/setup/users',
  },
  {
    label: t('setup.rolesTab', 'Roles'),
    to: '/setup/roles',
  },
  {
    label: t('setup.navigationTab', 'Navigation'),
    to: '/setup/navigation',
  },
  {
    label: t('setup.tasksTab', 'Tasks'),
    to: '/setup/tasks',
  },
  {
    label: t('setup.flowsTab', 'Flows'),
    to: '/setup/flows',
  },
  {
    label: t('setup.archivedTab', 'Archived records'),
    to: '/setup/archived',
  },
])

onMounted(() => {
  void collectionExistsInRegistry(PM_PROJECT_TEMPLATE_COLLECTION).then(
    (exists) => {
      projectTemplateExists.value = exists
    },
  )
})

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

    <RouterView />
  </main>
</template>
