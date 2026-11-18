<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref, watch } from 'vue'
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
import { useNarrowViewport } from '@/core/useNarrowViewport'
import { useTranslation } from './core/translation'

const { t } = useTranslation()
const toast = useToast()
const route = useRoute()
const { isNarrow } = useNarrowViewport()
const runtimeError = ref<string | null>(null)
const sidebarRef = ref<InstanceType<typeof AppSidebar> | null>(null)
const topBarRef = ref<InstanceType<typeof AppHeaderUtilities> | null>(null)
const navOpen = ref(false)
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

function toggleNav(): void {
  navOpen.value = !navOpen.value
}

function closeNav(): void {
  navOpen.value = false
}

watch(isNarrow, (narrow) => {
  if (!narrow) navOpen.value = false
})

watch(
  () => route.fullPath,
  () => {
    navOpen.value = false
  },
)

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
      :show-nav-toggle="isNarrow"
      :nav-open="navOpen"
      @toggle-nav="toggleNav"
      @preview-active="handlePreviewActive"
      @preview-label="handlePreviewLabel"
    />

    <div class="app-root__body flex min-h-0 flex-1 flex-row overflow-hidden">
      <div
        v-if="showGlobalChrome && isNarrow && navOpen"
        class="app-root__nav-backdrop"
        aria-hidden="true"
        @click="closeNav"
      />

      <AppSidebar
        v-if="showGlobalChrome"
        ref="sidebarRef"
        :overlay="isNarrow"
        :open="navOpen"
        @close="closeNav"
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

        <div
          class="app-root__content flex min-h-0 flex-1 flex-col"
          :class="route.name === 'reports' ? 'overflow-hidden' : 'overflow-y-auto'"
        >
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

<style scoped>
.app-root__nav-backdrop {
  background: rgba(15, 23, 42, 0.42);
  inset: 2.75rem 0 0;
  position: fixed;
  z-index: 44;
}
</style>
