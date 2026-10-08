<script lang="ts">
export default {
  name: 'PaletteSkeleton',
}
</script>

<script setup lang="ts">
defineProps<{
  rows?: number
}>()
</script>

<template>
  <div class="flex flex-col gap-[0.55rem]" aria-hidden="true">
    <div
      v-for="n in rows ?? 6"
      :key="n"
      class="flex items-center gap-[0.65rem] py-[0.7rem] px-[0.75rem] bg-surface-0 border border-surface-200 rounded-lg"
    >
      <span class="skeleton-pulse w-8 h-8 shrink-0 rounded-md" />
      <span class="flex-1 flex flex-col gap-[0.35rem]">
        <span class="skeleton-pulse h-[0.65rem] rounded w-[70%]" />
        <span class="skeleton-pulse h-[0.65rem] rounded w-[45%]" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.skeleton-pulse {
  background: linear-gradient(90deg, var(--p-surface-200) 0%, var(--p-surface-100) 50%, var(--p-surface-200) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
</style>
