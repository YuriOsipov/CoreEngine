<script lang="ts">
export default {
  name: 'NavigationSetupPage',
}
</script>

<script setup lang="ts">
import { useTranslation } from '@/core/translation'
import NavigationDesigner from '../components/NavigationDesigner.vue'

const { t } = useTranslation()
</script>

<template>
  <section class="bg-surface-0 border border-surface-200 rounded-lg mt-6 p-5">
    <header class="mb-4">
      <h2 class="m-0">{{ t('navigation.designerTitle', 'Navigation designer') }}</h2>
      <p class="text-muted-color mt-1 mb-0">
        {{ t('navigation.designerSubtitle', 'Build role-scoped navigation apps with folders, links, dashboards, and reports.') }}
      </p>
    </header>

    <NavigationDesigner />
  </section>
</template>
