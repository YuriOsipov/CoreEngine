<script lang="ts">
export default {
  name: 'CrmRegistryIcon',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { isPrimeIconClass } from '@/core/primeIcons'

const props = withDefaults(
  defineProps<{
    icon?: string | null
    /** Extra classes on the rendered icon element. */
    iconClass?: string
  }>(),
  {
    icon: null,
    iconClass: '',
  },
)

const trimmed = computed(() => (props.icon ?? '').trim())
const isPrime = computed(() => isPrimeIconClass(trimmed.value))
</script>

<template>
  <i
    v-if="trimmed && isPrime"
    :class="[trimmed, iconClass]"
    aria-hidden="true"
  />
  <span
    v-else-if="trimmed"
    class="material-icons"
    :class="iconClass"
    aria-hidden="true"
  >{{ trimmed }}</span>
</template>
