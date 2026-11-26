<script lang="ts">
export default {
  name: 'NavigationDesignerPage',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTranslation } from '@/core/translation'
import NavigationDesigner from '../components/NavigationDesigner.vue'
import SetupPageHeader from '../components/setup/SetupPageHeader.vue'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()

const isNew = computed(() => route.name === 'setup-navigation-new')
const pageTitle = computed(() =>
  isNew.value
    ? t('navigation.newApp', 'New app')
    : t('navigation.designerTitle', 'Navigation designer'),
)

function backToList(): void {
  void router.push({ name: 'setup-navigation' })
}
</script>

<template>
  <section class="setup-tab-content">
    <SetupPageHeader
      :title="pageTitle"
      :meta="
        t(
          'navigation.designerSubtitle',
          'Build role-scoped navigation apps with folders, links, dashboards, and reports.',
        )
      "
      icon-class="pi pi-sitemap"
    >
      <template #actions>
        <Button
          :label="t('navigation.backToList', 'Back to apps')"
          icon="pi pi-arrow-left"
          size="small"
          text
          @click="backToList"
        />
      </template>
    </SetupPageHeader>

    <div class="bg-panel border border-line rounded-lg p-5">
      <NavigationDesigner />
    </div>
  </section>
</template>
