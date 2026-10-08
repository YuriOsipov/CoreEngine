<script lang="ts">
export default { name: 'ProjectsSandbox' }
</script>

<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <main class="app-shell" style="padding: 1rem">
    <h1>Projects sandbox</h1>
    <Button label="Open projects" @click="router.push('/projects')" />
  </main>
</template>
