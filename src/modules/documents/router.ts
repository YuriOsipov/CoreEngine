import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/object/:collection/:id/documents/fill',
    name: 'document-fill',
    component: () => import('./pages/DocFillPage.vue'),
    props: true,
    meta: { integratedHeader: true },
  },
  {
    path: '/object/:collection/:id/documents/view',
    name: 'document-view',
    component: () => import('./pages/DocViewPage.vue'),
    props: true,
    meta: { integratedHeader: true },
  },
]

export default routes
