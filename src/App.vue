<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import ConfirmDialog from 'openvue/confirmdialog'
import Toast from 'openvue/toast'
import Message from 'openvue/message'
import { useToast } from 'openvue/usetoast'
import AppSidebar from '@/core/ui-kit/AppSidebar.vue'
import AppHeaderUtilities from '@/core/ui-kit/AppHeaderUtilities.vue'
import {
  getRolePreviewDisplayLabel,
  isRolePreviewActive,
} from '@/core/rolePreview'
import { subscribeAutomationToasts } from '@/core/automationToasts'
import { useTranslation } from './core/translation'

const { t } = useTranslation()
const toast = useToast()
const route = useRoute()
const runtimeError = ref<string | null>(null)
const sidebarRef = ref<InstanceType<typeof AppSidebar> | null>(null)
const topBarRef = ref<InstanceType<typeof AppHeaderUtilities> | null>(null)
const rolePreviewActive = ref(isRolePreviewActive())
const rolePreviewLabel = ref(getRolePreviewDisplayLabel())
const showGlobalChrome = computed(() => route.name !== 'login')
const rolePreviewBannerText = computed(() => {
  if (!rolePreviewActive.value) return ''
  return t(
    'app.rolePreviewBanner',
        'Preview mode: layouts, views, and access (including Read) follow role "{role}". API calls still use your admin account.',
    { role: rolePreviewLabel.value },
  )
})

function handlePreviewActive(active: boolean): void {
  rolePreviewActive.value = active
  void topBarRef.value?.reload()
  void sidebarRef.value?.reload()
}

function handlePreviewLabel(label: string): void {
  rolePreviewLabel.value = label
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
  <div class="app-root flex h-screen flex-col overflow-hidden">
    <ConfirmDialog />
    <Toast />

    <AppHeaderUtilities
      v-if="showGlobalChrome"
      ref="topBarRef"
      @preview-active="handlePreviewActive"
      @preview-label="handlePreviewLabel"
    />

    <div class="app-root__body flex min-h-0 flex-1 flex-row overflow-hidden">
      <AppSidebar
        v-if="showGlobalChrome"
        ref="sidebarRef"
      />

      <div class="app-root__main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
  </div>
</template>
