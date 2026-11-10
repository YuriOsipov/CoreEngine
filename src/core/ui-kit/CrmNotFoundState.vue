<script lang="ts">
export default {
  name: 'CrmNotFoundState',
}
</script>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{
  title: string
  detail: string
  backLabel: string
  backTo: string
}>()

const router = useRouter()

function goBack(): void {
  void router.push(props.backTo)
}
</script>

<template>
  <div class="crm-not-found-state">
    <i class="pi pi-search crm-not-found-state__icon" aria-hidden="true" />
    <h2 class="crm-not-found-state__title">{{ title }}</h2>
    <p class="crm-not-found-state__detail">{{ detail }}</p>
    <Button
      :label="backLabel"
      size="small"
      icon="pi pi-arrow-left"
      @click="goBack"
    />
  </div>
</template>

<style scoped>
.crm-not-found-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  padding: 2.5rem 1rem;
  min-height: 12rem;
}

.crm-not-found-state__icon {
  font-size: 1.75rem;
  color: var(--p-text-muted-color, #64748b);
  margin-bottom: 0.25rem;
}

.crm-not-found-state__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--p-text-color, #0f172a);
}

.crm-not-found-state__detail {
  margin: 0 0 0.75rem;
  max-width: 28rem;
  font-size: 0.9rem;
  color: var(--p-text-muted-color, #64748b);
}
</style>
