<script lang="ts">
export default {
  name: 'SetupCollectionNav',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslation } from '@/core/translation'
import {
  SETUP_COLLECTION_NAV,
  type SetupCollectionSection,
} from '../../types/setupCollectionSection'

const props = defineProps<{
  modelValue: SetupCollectionSection
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SetupCollectionSection]
}>()

const { t } = useTranslation()

const items = computed(() =>
  SETUP_COLLECTION_NAV.map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey, entry.defaultLabel),
    group: entry.group,
  })),
)

function select(id: SetupCollectionSection): void {
  if (id !== props.modelValue) {
    emit('update:modelValue', id)
  }
}
</script>

<template>
  <nav
    class="setup-layout-nav"
    :aria-label="t('setup.collectionNav', 'Object settings')"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="setup-layout-nav__item"
      :class="{ 'setup-layout-nav__item--active': item.id === modelValue }"
      @click="select(item.id)"
    >
      {{ item.label }}
    </button>
  </nav>
</template>
