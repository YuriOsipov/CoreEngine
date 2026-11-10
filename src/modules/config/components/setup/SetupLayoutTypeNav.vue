<script lang="ts">
export default {
  name: 'SetupLayoutTypeNav',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useTranslation } from '@/core/translation'
import { scheduleFeatureAvailable } from '../../services/scheduleFeature'
import { SETUP_LAYOUT_TYPES, type SetupLayoutType } from '../../types/setupLayoutType'

const props = defineProps<{
  modelValue: SetupLayoutType
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SetupLayoutType]
}>()

const { t } = useTranslation()
const scheduleAvailable = ref(false)

onMounted(() => {
  void scheduleFeatureAvailable().then((available) => {
    scheduleAvailable.value = available
  })
})

const items = computed(() =>
  SETUP_LAYOUT_TYPES
    .filter((entry) => entry.id !== 'scheduler' || scheduleAvailable.value)
    .map((entry) => ({
      id: entry.id,
      label: t(entry.labelKey, entry.defaultLabel),
    })),
)

function selectLayoutType(id: SetupLayoutType): void {
  if (id !== props.modelValue) {
    emit('update:modelValue', id)
  }
}
</script>

<template>
  <nav
    class="setup-layout-nav"
    :aria-label="t('setup.layoutTypesNav', 'Layout types')"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="setup-layout-nav__item"
      :class="{ 'setup-layout-nav__item--active': item.id === modelValue }"
      @click="selectLayoutType(item.id)"
    >
      {{ item.label }}
    </button>
  </nav>
</template>
