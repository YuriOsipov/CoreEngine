<script lang="ts">
export default {
  name: 'NotFoundPage',
}
</script>

<script setup lang="ts">
import CrmNotFoundState from '@/core/ui-kit/CrmNotFoundState.vue'
import { useTranslation } from '@/core/translation'

const { t } = useTranslation()
</script>

<template>
  <main class="app-shell not-found-page">
    <CrmNotFoundState
      :title="t('app.notFoundTitle', 'Page not found')"
      :detail="
        t(
          'app.notFoundDetail',
          'This page does not exist or the link is incorrect.',
        )
      "
      :back-label="t('app.backHome', 'Back to home')"
      back-to="/"
    />
  </main>
</template>

<style scoped>
.not-found-page {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
</style>
