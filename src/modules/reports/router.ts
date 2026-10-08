import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/reports',
    name: 'reports',
    component: () => import('./pages/ReportPage.vue'),
  },
  ...(import.meta.env.DEV
    ? [{ path: '/dev/reports', name: 'dev-reports', component: () => import('./views/Sandbox.vue') }]
    : []),
]

export default routes
