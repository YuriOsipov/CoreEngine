<script lang="ts">
export default {
  name: 'SetupPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { getEffectiveSetupAccess } from '@/core/setupAccess'
import { useTranslation } from '@/core/translation'
import { PM_PROJECT_TEMPLATE_COLLECTION } from '@/interfaces/projects'
import { collectionExistsInRegistry } from '@/modules/entities/services/collectionSchema'
import SetupSidebar from '@/modules/config/components/setup/SetupSidebar.vue'
import { filterSetupNavGroups } from '@/modules/config/components/setup/setupNavItems'

const route = useRoute()
const router = useRouter()
const { t } = useTranslation()

const projectTemplateExists = ref(false)
const isFullSetupAdmin = ref(false)
const canAuthorReports = ref(false)
const canOpenSetup = ref(false)
const accessLoaded = ref(false)

const navGroups = computed(() => {
  if (!accessLoaded.value || !canOpenSetup.value) return []
  return filterSetupNavGroups({
    isFullSetupAdmin: isFullSetupAdmin.value,
    canAuthorReports: canAuthorReports.value,
    projectTemplateExists: projectTemplateExists.value,
    translate: t,
  })
})

function isReportsPath(path: string): boolean {
  return path === '/setup/reports' || path.startsWith('/setup/reports/')
}

async function loadAccess(): Promise<void> {
  const access = await getEffectiveSetupAccess()
  isFullSetupAdmin.value = access.isFullSetupAdmin
  canAuthorReports.value = access.canAuthorReports
  canOpenSetup.value = access.canOpenSetup
  accessLoaded.value = true
  enforceSetupAccess()
}

function enforceSetupAccess(): void {
  if (!accessLoaded.value) return
  if (!canOpenSetup.value) {
    void router.replace({ name: 'home' })
    return
  }
  if (isFullSetupAdmin.value) return
  if (canAuthorReports.value && !isReportsPath(route.path)) {
    void router.replace('/setup/reports')
  }
}

onMounted(() => {
  void loadAccess()
  void collectionExistsInRegistry(PM_PROJECT_TEMPLATE_COLLECTION).then(
    (exists) => {
      projectTemplateExists.value = exists
    },
  )
})

watch(
  () => route.path,
  () => {
    enforceSetupAccess()
  },
)
</script>

<template>
  <main class="app-shell setup-page">
    <div class="setup-page__body">
      <SetupSidebar
        v-if="accessLoaded && canOpenSetup"
        :groups="navGroups"
      />
      <div class="setup-page__main">
        <RouterView v-if="accessLoaded && canOpenSetup" />
      </div>
    </div>
  </main>
</template>
