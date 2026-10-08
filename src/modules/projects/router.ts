import type { RouteRecordRaw } from 'vue-router'
import { PM_PROJECT_TEMPLATE_COLLECTION } from '@/interfaces/projects'

const routes: RouteRecordRaw[] = [
  {
    path: '/projects',
    name: 'projects',
    component: () => import('./pages/ProjectsHomePage.vue'),
    meta: { title: 'Projects' },
  },
  {
    path: '/projects/templates',
    name: 'project-templates',
    redirect: (to) => ({
      name: 'object-list',
      params: { collection: PM_PROJECT_TEMPLATE_COLLECTION },
      query: to.query,
    }),
  },
  {
    path: '/projects/templates/:templateId',
    name: 'project-template-detail',
    redirect: (to) => ({
      name: 'record-details',
      params: {
        collection: PM_PROJECT_TEMPLATE_COLLECTION,
        id: String(to.params.templateId),
      },
      query: to.query,
    }),
  },
  {
    path: '/projects/:projectId',
    name: 'project-workspace',
    component: () => import('./pages/ProjectWorkspacePage.vue'),
    props: true,
    meta: { title: 'Project' },
  },
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/projects',
          name: 'dev-projects',
          component: () => import('./views/Sandbox.vue'),
        },
      ]
    : []),
]

export default routes
