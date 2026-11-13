<script lang="ts">
export default {
  name: 'MainPage',
}
</script>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import CrmNotFoundState from '@/core/ui-kit/CrmNotFoundState.vue'
import { resolveAppHomeRoute } from '@/core/navigation/resolveAppHomeRoute'
import { useTranslation } from '@/core/translation'

const router = useRouter()
const { t } = useTranslation()
const loading = ref(true)
const showEmpty = ref(false)

onMounted(async () => {
  loading.value = true
  showEmpty.value = false
  try {
    const homeRoute = await resolveAppHomeRoute()
    if (homeRoute) {
      await router.replace(homeRoute)
      return
    }
    showEmpty.value = true
  } catch {
    showEmpty.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="app-shell main-page">
    <section v-if="loading" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('mainPage.resolvingHome', 'Opening home...') }}</span>
    </section>

    <CrmNotFoundState
      v-else-if="showEmpty"
      :title="t('app.notFoundTitle', 'Page not found')"
      :detail="
        t(
          'mainPage.homeNotConfigured',
          'Home page is not configured for this app.',
        )
      "
    />
  </main>
</template>

<style scoped>
.main-page {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.page-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
</style>
