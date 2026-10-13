<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import type { MenuItem } from 'openvue/menuitem'
import ConfirmDialog from 'openvue/confirmdialog'
import Toast from 'openvue/toast'
import Message from 'openvue/message'
import { useToast } from 'openvue/usetoast'
import AppSidebar from '@/core/ui-kit/AppSidebar.vue'
import {
  getRolePreviewDisplayLabel,
  isRolePreviewActive,
} from '@/core/rolePreview'
import { canUseBffAuth, logoutWithBff } from '@/core/auth/session'
import { subscribeAutomationToasts } from '@/core/automationToasts'
import { useTranslation } from './core/translation'

const { t } = useTranslation()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const runtimeError = ref<string | null>(null)
const sidebarRef = ref<InstanceType<typeof AppSidebar> | null>(null)
const rolePreviewActive = ref(isRolePreviewActive())
const rolePreviewLabel = ref(getRolePreviewDisplayLabel())
const loggingOut = ref(false)
const showGlobalChrome = computed(() => route.name !== 'login')
const rolePreviewBannerText = computed(() => {
  if (!rolePreviewActive.value) return ''
  return t(
    'app.rolePreviewBanner',
        'Preview mode: layouts, views, and access (including Read) follow role "{role}". API calls still use your admin account.',
    { role: rolePreviewLabel.value },
  )
})

const breadcrumbHome = computed<MenuItem>(() => ({
  icon: 'pi pi-home',
  command: () => {
    void router.push('/')
  },
}))

const breadcrumbItems = computed<MenuItem[]>(() => {
  const metaTitle = route.meta.title
  const label =
    (typeof metaTitle === 'string' && metaTitle) ||
    (typeof route.name === 'string' && route.name) ||
    ''
  return label ? [{ label }] : []
})

function handlePreviewActive(active: boolean): void {
  rolePreviewActive.value = active
  void sidebarRef.value?.reload()
}

function handlePreviewLabel(label: string): void {
  rolePreviewLabel.value = label
}

async function handleLogout(): Promise<void> {
  loggingOut.value = true
  try {
    await logoutWithBff()
    await router.replace({ name: 'login' })
  } finally {
    loggingOut.value = false
  }
}

let unsubscribeAutomationToasts: (() => void) | null = null

onMounted(() => {
  unsubscribeAutomationToasts = subscribeAutomationToasts((messages) => {
    for (const message of messages) {
      toast.add({
        severity: message.severity === 'warn' ? 'warn' : 'info',
        summary:
          message.severity === 'warn'
            ? t('common.warning', 'Warning')
            : t('common.info', 'Info'),
        detail: message.message,
        life: 6000,
      })
    }
  })
})

onUnmounted(() => {
  unsubscribeAutomationToasts?.()
  unsubscribeAutomationToasts = null
})

onErrorCaptured((error) => {
  runtimeError.value =
    error instanceof Error ? error.message : t('app.pageLoadError', 'Failed to load page.')
  return false
})
</script>

<template>
  <div class="app-root flex h-screen flex-row overflow-hidden">
    <ConfirmDialog />
    <Toast />

    <AppSidebar
      v-if="showGlobalChrome"
      ref="sidebarRef"
      @preview-active="handlePreviewActive"
      @preview-label="handlePreviewLabel"
    />

    <div class="app-root__main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header v-if="showGlobalChrome" class="app-chrome">
        <div class="app-chrome__inner flex items-center gap-2 px-3">
          <Breadcrumb :home="breadcrumbHome" :model="breadcrumbItems" class="border-none p-0" />
          <div class="ml-auto">
            <Button
              v-if="canUseBffAuth()"
              :label="t('auth.signOut', 'Sign out')"
              icon="pi pi-sign-out"
              text
              size="small"
              :loading="loggingOut"
              @click="handleLogout"
            />
          </div>
        </div>
      </header>

      <Message
        v-if="rolePreviewActive"
        severity="warn"
        :closable="false"
        class="app-chrome-banner"
      >
        {{ rolePreviewBannerText }}
      </Message>
      <Message
        v-if="runtimeError"
        severity="error"
        :closable="false"
        class="m-4"
      >
        {{ runtimeError }}
      </Message>

      <div class="app-root__content flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RouterView v-slot="{ Component }">
          <component
            :is="Component"
            class="app-route-page min-h-0 flex-1"
          />
        </RouterView>
      </div>
    </div>
  </div>
</template>
