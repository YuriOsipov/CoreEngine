import { createRouter, createWebHistory } from 'vue-router'
import configRoutes from '@/core/configRoutes'
import entityRoutes from '@/modules/entities/router'
import documentRoutes from '@/modules/documents/router'
import dashboardRoutes from '@/modules/dashboard/router'
import reportRoutes from '@/modules/reports/router'
import projectRoutes from '@/modules/projects/router'
import {
  canUseBffAuth,
  hasAuthSession,
  mustChangePasswordPending,
} from '@/core/auth/session'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    ...configRoutes,
    ...entityRoutes,
    ...documentRoutes,
    ...dashboardRoutes,
    ...reportRoutes,
    ...projectRoutes,
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/modules/config/pages/NotFoundPage.vue'),
      meta: { title: 'Page not found' },
    },
  ],
})

router.beforeEach((to) => {
  if (!canUseBffAuth()) return true
  if (to.meta.public === true) return true
  if (!hasAuthSession()) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
    }
  }
  if (mustChangePasswordPending() && to.name !== 'login') {
    return {
      name: 'login',
      query: { redirect: to.fullPath, changePassword: '1' },
    }
  }
  return true
})

router.onError((error) => {
  console.error('Router failed to load a page:', error)
})
