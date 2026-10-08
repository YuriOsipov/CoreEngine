<script lang="ts">
export default {
  name: 'PanelPalette',
}
</script>

<script setup lang="ts">
import { useTranslation } from '@/core/translation'
import type { DashboardPanelType } from '@/interfaces'
import { DESIGNER_PANEL_TYPES } from '../services/dashboardDesigner'

const emit = defineEmits<{
  add: [type: DashboardPanelType]
}>()

const { t } = useTranslation()

function labelFor(type: DashboardPanelType): string {
  switch (type) {
    case 'metric':
      return t('dashboard.panelTypeMetric', 'Metric')
    case 'bar-chart':
      return t('dashboard.panelTypeBar', 'Bar chart')
    case 'line-chart':
      return t('dashboard.panelTypeLine', 'Line chart')
    case 'pie-chart':
      return t('dashboard.panelTypePie', 'Pie chart')
    case 'label':
      return t('dashboard.panelTypeLabel', 'Label')
    default:
      return type
  }
}
</script>

<template>
  <aside class="flex flex-col gap-2">
    <h3 class="m-0 text-sm font-semibold text-gray-700">
      {{ t('dashboard.paletteTitle', 'Add panel') }}
    </h3>
    <Button
      v-for="type in DESIGNER_PANEL_TYPES"
      :key="type"
      :label="labelFor(type)"
      size="small"
      severity="secondary"
      outlined
      class="justify-start"
      @click="emit('add', type)"
    />
  </aside>
</template>
