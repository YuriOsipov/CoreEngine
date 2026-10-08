<script lang="ts">
export default {
  name: 'DashboardCanvas',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useTranslation } from '@/core/translation'
import {
  GRID_COLUMNS,
  clampPanelGeometry,
  panelGridStyle,
  type DesignerPanelDraft,
} from '../services/dashboardDesigner'
import PanelPreview from './PanelPreview.vue'

const props = defineProps<{
  panels: DesignerPanelDraft[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string | null]
  update: [panel: DesignerPanelDraft]
  remove: [id: string]
}>()

const { t } = useTranslation()
const canvasEl = ref<HTMLElement | null>(null)

type DragMode = 'move' | 'resize'
interface DragState {
  mode: DragMode
  panelId: string
  startX: number
  startY: number
  originX: number
  originY: number
  originW: number
  originH: number
  cellW: number
  cellH: number
}

const drag = ref<DragState | null>(null)

const sortedPanels = computed(() =>
  [...props.panels].sort((a, b) => {
    const ay = a.position_y ?? 1
    const by = b.position_y ?? 1
    if (ay !== by) return ay - by
    return (a.position_x ?? 1) - (b.position_x ?? 1)
  }),
)

function cellMetrics(): { cellW: number; cellH: number } {
  const el = canvasEl.value
  if (!el) return { cellW: 16, cellH: 18 }
  const rect = el.getBoundingClientRect()
  return {
    cellW: Math.max(4, rect.width / GRID_COLUMNS),
    cellH: 18,
  }
}

function onPanelPointerDown(event: PointerEvent, panel: DesignerPanelDraft): void {
  if ((event.target as HTMLElement).closest('[data-resize-handle]')) return
  if ((event.target as HTMLElement).closest('[data-panel-actions]')) return
  emit('select', panel.id)
  beginDrag(event, panel, 'move')
}

function onResizePointerDown(event: PointerEvent, panel: DesignerPanelDraft): void {
  event.stopPropagation()
  emit('select', panel.id)
  beginDrag(event, panel, 'resize')
}

function beginDrag(
  event: PointerEvent,
  panel: DesignerPanelDraft,
  mode: DragMode,
): void {
  event.preventDefault()
  const { cellW, cellH } = cellMetrics()
  drag.value = {
    mode,
    panelId: panel.id,
    startX: event.clientX,
    startY: event.clientY,
    originX: panel.position_x ?? 1,
    originY: panel.position_y ?? 1,
    originW: panel.width ?? 10,
    originH: panel.height ?? 8,
    cellW,
    cellH,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  const state = drag.value
  if (!state) return
  const panel = props.panels.find((p) => p.id === state.panelId)
  if (!panel) return

  const dx = Math.round((event.clientX - state.startX) / state.cellW)
  const dy = Math.round((event.clientY - state.startY) / state.cellH)

  if (state.mode === 'move') {
    emit(
      'update',
      clampPanelGeometry({
        ...panel,
        position_x: state.originX + dx,
        position_y: Math.max(1, state.originY + dy),
      }),
    )
  } else {
    emit(
      'update',
      clampPanelGeometry({
        ...panel,
        width: state.originW + dx,
        height: state.originH + dy,
      }),
    )
  }
}

function onPointerUp(): void {
  drag.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

function panelTitle(panel: DesignerPanelDraft): string {
  return panel.name || panel.note || panel.type || t('dashboard.untitledPanel', 'Untitled panel')
}
</script>

<template>
  <div
    ref="canvasEl"
    class="relative min-h-[24rem] rounded border border-dashed border-[#d0d5dd] bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[length:calc(100%/60)_18px] p-1"
    @click.self="emit('select', null)"
  >
    <div
      class="grid gap-0 [grid-auto-rows:18px] grid-cols-[repeat(60,minmax(0,1fr))] min-h-[22rem]"
    >
      <article
        v-for="panel in sortedPanels"
        :key="panel.id"
        class="relative flex min-h-0 min-w-0 cursor-move flex-col overflow-hidden rounded border bg-surface-0 p-2 shadow-sm"
        :class="
          selectedId === panel.id
            ? 'border-primary z-10 ring-1 ring-primary'
            : 'border-[#eef0f4]'
        "
        :style="panelGridStyle(panel)"
        @pointerdown="onPanelPointerDown($event, panel)"
      >
        <header
          v-if="panel.show_header !== false"
          class="mb-1 flex items-start justify-between gap-2"
        >
          <div class="min-w-0">
            <h4 class="m-0 truncate text-sm">{{ panelTitle(panel) }}</h4>
            <p v-if="panel.note" class="m-0 truncate text-xs text-gray-500">
              {{ panel.note }}
            </p>
          </div>
          <div data-panel-actions class="flex shrink-0 items-center gap-1">
            <Tag :value="panel.type" severity="secondary" class="text-[0.65rem]" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              size="small"
              :aria-label="t('common.delete', 'Delete')"
              @pointerdown.stop
              @click.stop="emit('remove', panel.id)"
            />
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-hidden pointer-events-none">
          <PanelPreview :panel="panel" />
        </div>

        <div
          data-resize-handle
          class="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
          @pointerdown="onResizePointerDown($event, panel)"
        >
          <span
            class="absolute bottom-1 right-1 block h-2 w-2 border-b-2 border-r-2 border-gray-400"
          />
        </div>
      </article>
    </div>

    <Message
      v-if="panels.length === 0"
      severity="info"
      :closable="false"
      class="absolute left-1/2 top-1/2 m-0 -translate-x-1/2 -translate-y-1/2"
    >
      {{ t('dashboard.canvasEmpty', 'Add a panel from the palette to start designing.') }}
    </Message>
  </div>
</template>
