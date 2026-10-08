<script lang="ts">
export default { name: 'TaskGanttView' }
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getTranslationLanguage, useTranslation } from '@/core/translation'
import type { PmStatusDefinition, PmTaskRecord } from '@/interfaces/projects'
import { addDaysIso, daysBetween } from '../services/pmUtils'

const props = defineProps<{
  tasks: PmTaskRecord[]
  statuses: PmStatusDefinition[]
  rangeStart?: string | null
  rangeEnd?: string | null
}>()

const emit = defineEmits<{
  open: [task: PmTaskRecord]
  move: [payload: { task: PmTaskRecord; dateStart: string; dateEnd: string }]
}>()

const { t, i18n } = useTranslation()

const DAY_PX = 28
const MIN_DURATION_DAYS = 1

type GanttDragMode = 'move' | 'resize-start' | 'resize-end'

const dragging = ref<{
  taskId: string
  mode: GanttDragMode
  startX: number
  originStart: string
  originEnd: string
  previewStart: string
  previewEnd: string
  deltaDays: number
  moved: boolean
} | null>(null)

const statusColor = computed(() => {
  const map = new Map(props.statuses.map((status) => [status.key, status.color]))
  return (key?: string | null) => map.get(key || 'todo') || '#64748b'
})

const bounds = computed(() => {
  const starts = props.tasks
    .map((task) => (task.date_start ? new Date(task.date_start).getTime() : NaN))
    .filter((value) => !Number.isNaN(value))
  const ends = props.tasks
    .map((task) => (task.date_end ? new Date(task.date_end).getTime() : NaN))
    .filter((value) => !Number.isNaN(value))
  const drag = dragging.value
  if (drag) {
    const previewStart = new Date(drag.previewStart).getTime()
    const previewEnd = new Date(drag.previewEnd).getTime()
    if (!Number.isNaN(previewStart)) starts.push(previewStart)
    if (!Number.isNaN(previewEnd)) ends.push(previewEnd)
  }
  let min = props.rangeStart
    ? new Date(props.rangeStart).getTime()
    : starts.length
      ? Math.min(...starts)
      : Date.now()
  let max = props.rangeEnd
    ? new Date(props.rangeEnd).getTime()
    : ends.length
      ? Math.max(...ends)
      : min + 14 * 86_400_000
  if (starts.length) min = Math.min(min, ...starts)
  if (ends.length) max = Math.max(max, ...ends)
  const start = new Date(min)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(Math.max(max, min + 7 * 86_400_000))
  end.setUTCHours(0, 0, 0, 0)
  return { start, end }
})

const dayCount = computed(() => Math.max(1, daysBetween(bounds.value.start.toISOString(), bounds.value.end.toISOString()) + 1))

const dayHeaders = computed(() => {
  const days: Date[] = []
  for (let i = 0; i < dayCount.value; i += 1) {
    const date = new Date(bounds.value.start)
    date.setUTCDate(date.getUTCDate() + i)
    days.push(date)
  }
  return days
})

const monthBands = computed(() => {
  void i18n.language.value
  const locale = getTranslationLanguage()
  const bands: { key: string; date: Date; days: number }[] = []
  for (const day of dayHeaders.value) {
    const key = `${day.getUTCFullYear()}-${day.getUTCMonth()}`
    const last = bands[bands.length - 1]
    if (last?.key === key) {
      last.days += 1
      continue
    }
    bands.push({ key, date: day, days: 1 })
  }
  return bands.map((band) => ({
    key: band.key,
    days: band.days,
    width: `${band.days * DAY_PX}px`,
    label: new Intl.DateTimeFormat(locale, {
      month: band.days >= 8 ? 'long' : 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(band.date),
  }))
})

const legendItems = computed(() =>
  (props.statuses.length ? props.statuses : []).map((status) => ({
    key: status.key,
    label: status.label,
    color: status.color || '#64748b',
  })),
)

const rows = computed(() =>
  [...props.tasks].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)),
)

function earlierIso(a: string, b: string): string {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b
}

function laterIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function previewDates(
  originStart: string,
  originEnd: string,
  mode: GanttDragMode,
  deltaDays: number,
): { start: string; end: string } {
  if (mode === 'move') {
    return {
      start: addDaysIso(originStart, deltaDays),
      end: addDaysIso(originEnd, deltaDays),
    }
  }
  if (mode === 'resize-start') {
    return {
      start: earlierIso(addDaysIso(originStart, deltaDays), addDaysIso(originEnd, -MIN_DURATION_DAYS)),
      end: originEnd,
    }
  }
  return {
    start: originStart,
    end: laterIso(addDaysIso(originEnd, deltaDays), addDaysIso(originStart, MIN_DURATION_DAYS)),
  }
}

function taskDates(task: PmTaskRecord): { start: string | null; end: string | null } {
  const drag = dragging.value
  if (drag && drag.taskId === task.id) {
    return {
      start: drag.previewStart,
      end: drag.previewEnd,
    }
  }
  return {
    start: task.date_start ?? null,
    end: task.date_end ?? null,
  }
}

function barStyle(task: PmTaskRecord): Record<string, string> {
  const { start, end } = taskDates(task)
  if (!start || !end) {
    return { display: 'none' }
  }
  const offset = daysBetween(bounds.value.start.toISOString(), start)
  const widthDays = Math.max(1, daysBetween(start, end) || 1)
  return {
    left: `${offset * DAY_PX}px`,
    width: `${widthDays * DAY_PX}px`,
    background: statusColor.value(task.stage_status),
  }
}

function onBarPointerDown(event: PointerEvent, task: PmTaskRecord, mode: GanttDragMode): void {
  if (event.button !== 0 || !task.date_start || !task.date_end) return
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragging.value = {
    taskId: task.id,
    mode,
    startX: event.clientX,
    originStart: task.date_start,
    originEnd: task.date_end,
    previewStart: task.date_start,
    previewEnd: task.date_end,
    deltaDays: 0,
    moved: false,
  }
}

function onBarPointerMove(event: PointerEvent): void {
  const drag = dragging.value
  if (!drag) return
  const deltaDays = Math.round((event.clientX - drag.startX) / DAY_PX)
  if (deltaDays === drag.deltaDays) return
  const preview = previewDates(drag.originStart, drag.originEnd, drag.mode, deltaDays)
  dragging.value = {
    ...drag,
    deltaDays,
    previewStart: preview.start,
    previewEnd: preview.end,
    moved:
      drag.moved ||
      preview.start !== drag.originStart ||
      preview.end !== drag.originEnd,
  }
}

function onBarPointerUp(event: PointerEvent): void {
  const drag = dragging.value
  if (!drag) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  dragging.value = null
  const task = props.tasks.find((row) => row.id === drag.taskId)
  if (!task) return
  if (!drag.moved) {
    if (drag.mode === 'move') emit('open', task)
    return
  }
  emit('move', {
    task,
    dateStart: drag.previewStart,
    dateEnd: drag.previewEnd,
  })
}

const timelineWidth = computed(() => `${dayCount.value * DAY_PX}px`)
</script>

<template>
  <div class="pm-gantt-block">
    <div
      class="pm-gantt"
      :class="{
        'pm-gantt--dragging': Boolean(dragging),
        'pm-gantt--resizing': dragging?.mode === 'resize-start' || dragging?.mode === 'resize-end',
      }"
    >
      <div class="pm-gantt__labels">
        <div class="pm-gantt__month-corner" />
        <div class="pm-gantt__corner">{{ t('projects.taskName', 'Name') }}</div>
        <button
          v-for="task in rows"
          :key="task.id"
          type="button"
          class="pm-gantt__label"
          @click="emit('open', task)"
        >
          {{ task.name }}
        </button>
      </div>
      <div class="pm-gantt__timeline-wrap">
        <div class="pm-gantt__timeline" :style="{ width: timelineWidth }">
          <div class="pm-gantt__months">
            <div
              v-for="band in monthBands"
              :key="band.key"
              class="pm-gantt__month"
              :style="{ width: band.width }"
              :title="band.label"
            >
              {{ band.label }}
            </div>
          </div>
          <div class="pm-gantt__head">
            <div
              v-for="day in dayHeaders"
              :key="day.toISOString()"
              class="pm-gantt__day"
              :style="{ width: `${DAY_PX}px` }"
            >
              {{ day.getUTCDate() }}
            </div>
          </div>
          <div
            v-for="task in rows"
            :key="task.id"
            class="pm-gantt__row"
            @click="emit('open', task)"
          >
            <div
              class="pm-gantt__bar"
              :class="{ 'pm-gantt__bar--dragging': dragging?.taskId === task.id }"
              :style="barStyle(task)"
              @pointerdown="onBarPointerDown($event, task, 'move')"
              @pointermove="onBarPointerMove"
              @pointerup="onBarPointerUp"
              @pointercancel="onBarPointerUp"
              @click.stop
            >
              <span
                class="pm-gantt__handle pm-gantt__handle--start"
                :title="t('projects.ganttResizeStart', 'Resize start')"
                @pointerdown.stop="onBarPointerDown($event, task, 'resize-start')"
                @pointermove="onBarPointerMove"
                @pointerup="onBarPointerUp"
                @pointercancel="onBarPointerUp"
              />
              <span v-if="task.is_milestone" class="pi pi-flag" />
              <span class="pm-gantt__bar-label">{{ task.progress ?? 0 }}%</span>
              <span
                class="pm-gantt__handle pm-gantt__handle--end"
                :title="t('projects.ganttResizeEnd', 'Resize end')"
                @pointerdown.stop="onBarPointerDown($event, task, 'resize-end')"
                @pointermove="onBarPointerMove"
                @pointerup="onBarPointerUp"
                @pointercancel="onBarPointerUp"
              />
            </div>
            <svg
              v-if="(task.depends_on?.length ?? 0) > 0"
              class="pm-gantt__deps"
              :width="dayCount * DAY_PX"
              height="36"
            >
              <template v-for="depId in task.depends_on || []" :key="depId">
                <!-- dependency hint ticks only; full bezier graph can come later -->
              </template>
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div v-if="legendItems.length" class="pm-gantt__legend">
      <span class="pm-gantt__legend-title">{{ t('projects.ganttLegend', 'Legend') }}</span>
      <span
        v-for="status in legendItems"
        :key="status.key"
        class="pm-gantt__legend-item"
      >
        <span class="pm-gantt__legend-swatch" :style="{ background: status.color }" />
        {{ status.label }}
      </span>
      <span class="pm-gantt__legend-item">
        <i class="pi pi-flag pm-gantt__legend-flag" />
        {{ t('projects.milestone', 'Milestone') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.pm-gantt-block {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.pm-gantt {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 10px;
  overflow: hidden;
  min-height: 280px;
  background: #fff;
}
.pm-gantt--dragging {
  user-select: none;
}
.pm-gantt--resizing {
  cursor: ew-resize;
}
.pm-gantt__labels {
  border-right: 1px solid var(--p-content-border-color, #e5e7eb);
}
.pm-gantt__month-corner,
.pm-gantt__corner,
.pm-gantt__label {
  display: flex;
  align-items: center;
  padding: 0 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
  font-size: 0.85rem;
}
.pm-gantt__month-corner {
  height: 28px;
  background: var(--p-surface-50, #f8fafc);
}
.pm-gantt__corner,
.pm-gantt__label {
  height: 36px;
}
.pm-gantt__corner {
  font-weight: 600;
  background: var(--p-surface-50, #f8fafc);
}
.pm-gantt__label {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.pm-gantt__timeline-wrap {
  overflow-x: auto;
}
.pm-gantt__months,
.pm-gantt__head {
  display: flex;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
}
.pm-gantt__months {
  height: 28px;
}
.pm-gantt__month {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-color, #334155);
  border-right: 1px solid var(--p-content-border-color, #e5e7eb);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0.35rem;
}
.pm-gantt__head {
  height: 36px;
}
.pm-gantt__day {
  flex: 0 0 auto;
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid rgb(226 232 240 / 0.8);
  color: var(--p-text-muted-color, #6b7280);
}
.pm-gantt__row {
  position: relative;
  height: 36px;
  border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
  background-image: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent 27px,
    rgb(226 232 240 / 0.7) 27px,
    rgb(226 232 240 / 0.7) 28px
  );
  cursor: pointer;
}
.pm-gantt__bar {
  position: absolute;
  top: 8px;
  height: 20px;
  border-radius: 6px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.55rem;
  font-size: 0.7rem;
  min-width: 28px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.pm-gantt__handle {
  position: absolute;
  top: 0;
  width: 7px;
  height: 100%;
  cursor: ew-resize;
  touch-action: none;
  z-index: 3;
}
.pm-gantt__handle--start {
  left: 0;
  border-radius: 6px 0 0 6px;
}
.pm-gantt__handle--end {
  right: 0;
  border-radius: 0 6px 6px 0;
}
.pm-gantt__bar:hover .pm-gantt__handle,
.pm-gantt__bar--dragging .pm-gantt__handle {
  background: rgb(255 255 255 / 0.35);
}
.pm-gantt__bar--dragging {
  cursor: grabbing;
  opacity: 0.92;
  box-shadow: 0 4px 10px rgb(15 23 42 / 0.18);
  z-index: 2;
}
.pm-gantt--resizing .pm-gantt__bar--dragging {
  cursor: ew-resize;
}
.pm-gantt__bar-label {
  opacity: 0.95;
}
.pm-gantt__deps {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.pm-gantt__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.15rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 10px;
  background: var(--p-surface-50, #f8fafc);
}
.pm-gantt__legend-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #6b7280);
  margin-right: 0.15rem;
}
.pm-gantt__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-text-color, #334155);
}
.pm-gantt__legend-swatch {
  width: 14px;
  height: 10px;
  border-radius: 4px;
  flex: 0 0 auto;
}
.pm-gantt__legend-flag {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #6b7280);
}
</style>
