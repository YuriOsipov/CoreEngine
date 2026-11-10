import type { RouteRecordRaw } from 'vue-router'
import { PM_PROJECT_TEMPLATE_COLLECTION } from '@/interfaces/projects'

const configRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/modules/config/pages/LoginPage.vue'),
    meta: { public: true, title: 'Sign in' },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/modules/config/pages/MainPage.vue'),
  },
  {
    path: '/setup',
    component: () => import('@/modules/config/pages/SetupPage.vue'),
    redirect: '/setup/objects',
    children: [
      {
        path: 'general',
        name: 'setup-general',
        component: () => import('@/modules/config/components/setup/SetupGeneralTab.vue'),
      },
      {
        path: 'schema-sync',
        name: 'setup-schema-sync',
        component: () =>
          import('@/modules/config/components/setup/SetupSchemaSyncTab.vue'),
      },
      {
        path: 'objects',
        name: 'setup-objects',
        component: () => import('@/modules/config/components/setup/CollectionManagerTab.vue'),
      },
      {
        path: 'objects/:collection',
        name: 'setup-collection',
        component: () => import('@/modules/config/pages/CollectionSetupPage.vue'),
      },
      {
        path: 'schedule',
        name: 'setup-schedule',
        component: () => import('@/modules/config/pages/ScheduleSetupPage.vue'),
      },
      {
        path: 'tasks',
        name: 'setup-tasks',
        component: () => import('@/modules/config/pages/TaskSchedulerSetupPage.vue'),
      },
      {
        path: 'flows',
        name: 'setup-flows',
        component: () => import('@/modules/config/pages/FlowTriggersSetupPage.vue'),
      },
      {
        path: 'archived',
        name: 'setup-archived',
        component: () => import('@/modules/config/pages/ArchivedRecordsSetupPage.vue'),
      },
      {
        path: 'users',
        name: 'setup-users',
        component: () => import('@/modules/config/components/setup/SetupUsersTab.vue'),
      },
      {
        path: 'roles',
        name: 'setup-roles',
        component: () => import('@/modules/config/components/setup/SetupRolesTab.vue'),
      },
      {
        path: 'navigation',
        name: 'setup-navigation',
        component: () => import('@/modules/config/pages/NavigationSetupPage.vue'),
      },
      {
        path: 'documents',
        name: 'setup-documents',
        component: () =>
          import('@/modules/config/pages/DocumentTemplatesSetupPage.vue'),
      },
      {
        path: 'reports',
        name: 'setup-reports',
        component: () => import('@/modules/config/pages/ReportsSetupPage.vue'),
      },
      {
        path: 'reports/new',
        name: 'setup-report-new',
        component: () => import('@/modules/reports/pages/ReportDesignerPage.vue'),
      },
      {
        path: 'reports/:settingId',
        name: 'setup-report-edit',
        component: () => import('@/modules/reports/pages/ReportDesignerPage.vue'),
      },
      {
        path: 'dashboards',
        name: 'setup-dashboards',
        component: () => import('@/modules/config/pages/DashboardsSetupPage.vue'),
      },
      {
        path: 'projects',
        name: 'setup-projects',
        redirect: { path: `/object/${PM_PROJECT_TEMPLATE_COLLECTION}` },
      },
    ],
  },
  ...(import.meta.env.DEV
    ? [{
        path: '/dev/config',
        name: 'dev-config',
        component: () => import('@/modules/config/views/Sandbox.vue'),
      }]
    : []),
]

export default configRoutes
