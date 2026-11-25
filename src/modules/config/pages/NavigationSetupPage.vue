<script lang="ts">
export default {
  name: 'NavigationSetupPage',
}
</script>

<script setup lang="ts">
import { useTranslation } from '@/core/translation'
import NavigationDesigner from '../components/NavigationDesigner.vue'
import SetupPageHeader from '../components/setup/SetupPageHeader.vue'

const { t } = useTranslation()
</script>

<template>
  <section class="setup-tab-content">
    <SetupPageHeader
      :title="t('navigation.designerTitle', 'Navigation designer')"
      :meta="
        t(
          'navigation.designerSubtitle',
          'Build role-scoped navigation apps with folders, links, dashboards, and reports.',
        )
      "
      icon-class="pi pi-sitemap"
    />

    <div class="bg-panel border border-line rounded-lg p-5">
      <NavigationDesigner />
    </div>
  </section>
</template>
