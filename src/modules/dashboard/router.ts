import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/dashboards',
    name: 'dashboards',
    component: () => import('./pages/DashboardPage.vue'),
  },
  {
    path: '/dashboards/design',
    name: 'dashboard-design',
    component: () => import('./pages/DashboardDesignerPage.vue'),
  },
  ...(import.meta.env.DEV
    ? [{ path: '/dev/dashboard', name: 'dev-dashboard', component: () => import('./views/Sandbox.vue') }]
    : []),
]

export default routes
