<script lang="ts">
export default {
  name: 'PanelPreview',
}
</script>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import type { DashboardPanelRecord } from '@/interfaces'
import {
  buildPanelRenderModel,
  type PanelRenderModel,
} from '../services/dashboardSettings'

const props = defineProps<{
  panel: DashboardPanelRecord
}>()

const { t } = useTranslation()
const render = ref<PanelRenderModel | null>(null)
const loading = ref(false)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    render.value = await buildPanelRenderModel(props.panel)
  } catch (err) {
    render.value = {
      kind: 'unsupported',
      reason: err instanceof Error ? err.message : t('dashboard.previewFailed', 'Preview failed.'),
      options: props.panel.options ?? null,
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})

watch(
  () => [
    props.panel.type,
    props.panel.name,
    props.panel.options,
    props.panel.color,
  ],
  () => {
    void refresh()
  },
  { deep: true },
)
</script>

<template>
  <div class="flex h-full min-h-[4rem] flex-col">
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <ProgressSpinner style="width: 2rem; height: 2rem" stroke-width="4" />
    </div>

    <template v-else-if="render?.kind === 'chart'">
      <Chart
        :type="render.chartType"
        :data="render.data"
        :options="render.options"
        class="h-full min-h-[6rem]"
      />
    </template>

    <div
      v-else-if="render?.kind === 'metric'"
      class="flex flex-1 flex-col items-center justify-center text-center"
    >
      <span class="text-gray-500 text-sm">{{ render.label }}</span>
      <strong class="text-2xl leading-none my-1">{{ render.value }}</strong>
      <small v-if="render.detail" class="text-gray-500">{{ render.detail }}</small>
    </div>

    <div
      v-else-if="render?.kind === 'note'"
      class="text-gray-600 text-sm whitespace-pre-wrap"
    >
      {{ render.text || t('dashboard.noPanelText', 'No panel text configured.') }}
    </div>

    <Message v-else severity="warn" :closable="false" class="m-0 text-xs">
      {{ render?.kind === 'unsupported' ? render.reason : t('dashboard.previewEmpty', 'No preview.') }}
    </Message>
  </div>
</template>
