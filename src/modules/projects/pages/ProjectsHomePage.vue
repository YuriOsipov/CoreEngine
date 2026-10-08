<script lang="ts">
export default { name: 'ProjectsHomePage' }
</script>

<script setup lang="ts">
/**
 * Projects list uses the standard Object List master/detail (same as Visit).
 * This page only redirects so /projects stays a stable entry URL.
 */
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PM_PROJECT_COLLECTION } from '@/interfaces/projects'

const route = useRoute()
const router = useRouter()

onMounted(() => {
  const query = { ...route.query }
  void router.replace({
    name: 'object-list',
    params: { collection: PM_PROJECT_COLLECTION },
    query,
  })
})
</script>

<template>
  <main class="app-shell pm-page">
    <div class="pm-center">
      <ProgressSpinner />
    </div>
  </main>
</template>

<style scoped>
.pm-center {
  display: flex;
  justify-content: center;
  padding: 2rem;
}
</style>
