<script lang="ts">
export default {
  name: 'DashboardPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  loadDashboardsWithPanels,
  type DashboardPanel,
  type DashboardWithPanels,
  type PanelRenderModel,
} from '../services/dashboardSettings'
import { useTranslation } from '@/core/translation'

type ChartRender = Extract<PanelRenderModel, { kind: 'chart' }>
type MetricRender = Extract<PanelRenderModel, { kind: 'metric' }>
type NoteRender = Extract<PanelRenderModel, { kind: 'note' }>
type UnsupportedRender = Extract<PanelRenderModel, { kind: 'unsupported' }>

const dashboards = ref<DashboardWithPanels[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const { t } = useTranslation()
const route = useRoute()

const visibleDashboards = computed(() => {
  const id = typeof route.query.id === 'string' ? route.query.id : null
  if (!id) return dashboards.value
  const filtered = dashboards.value.filter((dashboard) => dashboard.id === id)
  return filtered.length > 0 ? filtered : dashboards.value
})

onMounted(() => {
  void loadDashboards()
})

async function loadDashboards(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    dashboards.value = await loadDashboardsWithPanels()
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('dashboard.failedLoad', 'Failed to load dashboards.')
  } finally {
    loading.value = false
  }
}

function panelTitle(panel: DashboardPanel): string {
  return panel.name || panel.note || panel.type || t('dashboard.untitledPanel', 'Untitled panel')
}

function panelGridStyle(panel: DashboardPanel): Record<string, string> {
  const column = Math.max(1, panel.position_x ?? 1)
  const row = Math.max(1, panel.position_y ?? 1)
  const width = Math.max(1, panel.width ?? 4)
  const height = Math.max(1, panel.height ?? 4)

  return {
    gridColumn: `${column} / span ${width}`,
    gridRow: `${row} / span ${height}`,
  }
}

function chartRender(panel: DashboardPanel): ChartRender | null {
  return panel.render.kind === 'chart' ? panel.render : null
}

function metricRender(panel: DashboardPanel): MetricRender | null {
  return panel.render.kind === 'metric' ? panel.render : null
}

function noteRender(panel: DashboardPanel): NoteRender | null {
  return panel.render.kind === 'note' ? panel.render : null
}

function unsupportedRender(panel: DashboardPanel): UnsupportedRender | null {
  return panel.render.kind === 'unsupported' ? panel.render : null
}

function formattedPanelOptions(panel: DashboardPanel): string {
  const render = unsupportedRender(panel)
  if (!render?.options) return '{}'

  return JSON.stringify(render.options, null, 2)
}
</script>

<template>
  <main class="app-shell dashboard-page">
    <header class="app-header">
      <div class="app-header__row">
        <div>
          <h1>{{ t('dashboard.title', 'Dashboards') }}</h1>
          <p>{{ t('dashboard.subtitle', 'Dashboards with their related panels and live diagrams.') }}</p>
        </div>

        <div class="flex items-center gap-3 max-[900px]:flex-col max-[900px]:items-start">
          <RouterLink
            :to="{ name: 'dashboard-design', query: typeof route.query.id === 'string' ? { id: route.query.id } : {} }"
            class="nav-link"
          >
            {{ t('dashboard.design', 'Design') }}
          </RouterLink>
          <Button
            :label="t('common.refresh', 'Refresh')"
            size="small"
            :loading="loading"
            @click="loadDashboards"
          />
          <RouterLink to="/" class="nav-link">{{ t('common.allCollections', 'All collections') }}</RouterLink>
        </div>
      </div>
    </header>

    <section v-if="loading" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('dashboard.loading', 'Loading dashboards...') }}</span>
    </section>

    <Message
      v-else-if="error"
      severity="error"
      :closable="false"
      class="mt-4"
    >
      {{ error }}
    </Message>

    <Message
      v-else-if="visibleDashboards.length === 0"
      severity="warn"
      :closable="false"
      class="mt-4"
    >
      {{ t('dashboard.noDashboards', 'No dashboards are available for this role.') }}
    </Message>

    <section v-else class="grid gap-6">
      <article
        v-for="dashboard in visibleDashboards"
        :key="dashboard.id"
        class="bg-surface-0 border border-[#eef0f4] rounded-md p-4"
      >
        <header class="flex items-start gap-4 justify-between mb-4 max-[900px]:flex-col">
          <div>
            <h2 class="m-0">{{ dashboard.name }}</h2>
            <p v-if="dashboard.note" class="text-gray-500 mt-1 mb-0">{{ dashboard.note }}</p>
          </div>
          <span class="bg-gray-100 rounded-full text-gray-600 shrink-0 text-[0.8rem] px-[0.6rem] py-1">
            {{ dashboard.panels.length === 1
              ? t('dashboard.panelCount', '{count} panel', { count: dashboard.panels.length })
              : t('dashboard.panelCountPlural', '{count} panels', { count: dashboard.panels.length })
            }}
          </span>
        </header>

        <Message
          v-if="dashboard.panels.length === 0"
          severity="info"
          :closable="false"
        >
          {{ t('dashboard.noPanels', 'This dashboard has no panels.') }}
        </Message>

        <div v-else class="grid gap-3 [grid-auto-rows:18px] grid-cols-[repeat(60,minmax(0,1fr))] max-[900px]:block">
          <article
            v-for="panel in dashboard.panels"
            :key="panel.id"
            class="bg-surface-0 border border-[#eef0f4] rounded flex flex-col min-h-[10rem] min-w-0 p-3 max-[900px]:mb-4"
            :style="panelGridStyle(panel)"
          >
            <header
              v-if="panel.show_header !== false"
              class="flex items-start gap-3 justify-between mb-2"
            >
              <div>
                <h3 class="m-0">{{ panelTitle(panel) }}</h3>
                <p v-if="panel.note" class="text-gray-500 mt-1 mb-0">{{ panel.note }}</p>
              </div>
              <span class="bg-gray-100 rounded-full text-gray-600 shrink-0 text-[0.8rem] px-[0.6rem] py-1">{{ panel.type }}</span>
            </header>

            <div v-if="chartRender(panel)" class="flex-1 min-h-[8rem]">
              <Chart
                :type="chartRender(panel)?.chartType"
                :data="chartRender(panel)?.data"
                :options="chartRender(panel)?.options"
                class="h-full"
              />
            </div>

            <div v-else-if="metricRender(panel)" class="flex flex-1 flex-col items-center justify-center text-center">
              <span class="text-gray-500 text-[0.9rem]">
                {{ metricRender(panel)?.label }}
              </span>
              <strong class="text-gray-900 text-[clamp(2rem,8vw,4rem)] leading-none my-2">{{ metricRender(panel)?.value }}</strong>
              <small v-if="metricRender(panel)?.detail" class="text-gray-500">
                {{ metricRender(panel)?.detail }}
              </small>
            </div>

            <div v-else-if="noteRender(panel)" class="text-gray-500 text-base leading-[1.6] whitespace-pre-wrap">
              {{ noteRender(panel)?.text || t('dashboard.noPanelText', 'No panel text configured.') }}
            </div>

            <div v-else class="grid gap-3">
              <Message severity="warn" :closable="false">
                {{ unsupportedRender(panel)?.reason }}
              </Message>
              <pre class="bg-gray-900 rounded-[10px] text-gray-50 text-[0.8rem] m-0 max-h-[16rem] overflow-auto p-3">{{ formattedPanelOptions(panel) }}</pre>
            </div>
          </article>
        </div>
      </article>
    </section>
  </main>
</template>

