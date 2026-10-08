<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useTranslation } from '@/core/translation'

const { t } = useTranslation()
</script>

<template>
  <main class="app-shell p-4">
    <h1>{{ t('dashboard.sandboxTitle', 'Dashboard sandbox') }}</h1>
    <p class="text-gray-500">
      {{
        t(
          'dashboard.sandboxHint',
          'Use the designer to create Directus-compatible dashboards and panels.',
        )
      }}
    </p>
    <div class="mt-4 flex flex-wrap gap-3">
      <RouterLink class="nav-link" :to="{ name: 'dashboard-design' }">
        {{ t('dashboard.designerTitle', 'Dashboard designer') }}
      </RouterLink>
      <RouterLink class="nav-link" :to="{ name: 'dashboards' }">
        {{ t('dashboard.title', 'Dashboards') }}
      </RouterLink>
    </div>
  </main>
</template>
