<script lang="ts">
export default {
  name: 'SetupPageHeader',
}
</script>

<script setup lang="ts">
import { useTranslation } from '@/core/translation'

defineProps<{
  title: string
  meta?: string
  iconClass?: string
}>()

const { t } = useTranslation()
</script>

<template>
  <header class="setup-page-header">
    <div class="setup-page-header__main">
      <div
        v-if="iconClass || $slots.icon"
        class="setup-page-header__icon"
        aria-hidden="true"
      >
        <slot name="icon">
          <i v-if="iconClass" :class="iconClass" />
        </slot>
      </div>
      <div class="setup-page-header__text">
        <p class="setup-page-header__eyebrow">
          {{ t('setup.eyebrow', 'Setup') }}
        </p>
        <h2 class="setup-page-header__title">{{ title }}</h2>
        <p v-if="meta" class="setup-page-header__meta">{{ meta }}</p>
        <slot name="meta" />
      </div>
    </div>
    <div v-if="$slots.actions" class="setup-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>
