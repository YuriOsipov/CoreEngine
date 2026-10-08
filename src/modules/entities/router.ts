import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/object/:collection',
    name: 'object-list',
    component: () => import('./pages/ObjectListPage.vue'),
    props: true,
  },
  {
    path: '/object/:collection/view/:filter_id',
    name: 'object-list-filter',
    component: () => import('./pages/ObjectListPage.vue'),
    props: true,
  },
  {
    path: '/object/:collection/filter/:filterName',
    name: 'object-list-filter-name',
    component: () => import('./pages/ObjectListPage.vue'),
    props: true,
  },
  {
    path: '/object/:collection/:id/:related_collection/:related_id',
    name: 'related-record-details',
    component: () => import('./pages/RecordDetailsPage.vue'),
    props: true,
    meta: { integratedHeader: true },
  },
  {
    // Handles arbitrary-depth nesting beyond 2 levels:
    // /object/patient/2/visit/47/lab_result/5/...
    // `:rest` captures everything after the first id segment.
    path: '/object/:collection/:id/:rest(\\S+/\\S.*)',
    name: 'deep-record-details',
    component: () => import('./pages/RecordDetailsPage.vue'),
    props: true,
    meta: { integratedHeader: true },
  },
  {
    path: '/object/:collection/:id/:related_collection',
    name: 'related-record-list',
    component: () => import('./pages/RelatedRecordsPage.vue'),
    props: true,
  },
  {
    path: '/object/:collection/:id',
    name: 'record-details',
    component: () => import('./pages/RecordDetailsPage.vue'),
    props: true,
    meta: { integratedHeader: true },
  },
  ...(import.meta.env.DEV
    ? [{ path: '/dev/entities', name: 'dev-entities', component: () => import('./views/Sandbox.vue') }]
    : []),
]

export default routes
