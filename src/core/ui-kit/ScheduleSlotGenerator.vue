<script lang="ts">
export default {
  name: 'ScheduleSlotGenerator',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import {
  generateScheduleSlots,
  type GenerateScheduleResult,
} from '@/core/scheduleGeneration'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  generated: [result: GenerateScheduleResult]
}>()

const { t } = useTranslation()

const rangeStart = ref<Date | null>(null)
const rangeEnd = ref<Date | null>(null)
const running = ref(false)
const error = ref<string | null>(null)
const result = ref<GenerateScheduleResult | null>(null)

const isVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const canRun = computed(
  () =>
    !running.value &&
    rangeStart.value instanceof Date &&
    rangeEnd.value instanceof Date &&
    rangeEnd.value >= rangeStart.value,
)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      error.value = null
      result.value = null
      if (!rangeStart.value) {
        rangeStart.value = startOfNextMonth()
        rangeEnd.value = endOfNextMonth()
      }
    }
  },
)

function startOfNextMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 1)
}

function endOfNextMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 2, 0)
}

async function run(): Promise<void> {
  if (!canRun.value || !rangeStart.value || !rangeEnd.value) return
  running.value = true
  error.value = null
  result.value = null
  try {
    const generated = await generateScheduleSlots({
      rangeStart: rangeStart.value,
      rangeEnd: rangeEnd.value,
    })
    result.value = generated
    emit('generated', generated)
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('schedule.generateError', 'Failed to generate slots.')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="t('schedule.generateTitle', 'Generate schedule slots')"
    :style="{ width: 'min(460px, 95vw)' }"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-sm text-muted-color">
        {{
          t(
            'schedule.generateHint',
            'Expands published templates into real slots for the selected period. Existing slots are kept.',
          )
        }}
      </p>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="schedule-range-start">
          {{ t('schedule.rangeStart', 'From') }}
        </label>
        <DatePicker
          id="schedule-range-start"
          v-model="rangeStart"
          date-format="yy-mm-dd"
          show-icon
          :disabled="running"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="schedule-range-end">
          {{ t('schedule.rangeEnd', 'To') }}
        </label>
        <DatePicker
          id="schedule-range-end"
          v-model="rangeEnd"
          date-format="yy-mm-dd"
          show-icon
          :disabled="running"
        />
      </div>

      <Message v-if="error" severity="error" :closable="false">
        {{ error }}
      </Message>

      <Message v-else-if="result" severity="success" :closable="false">
        {{
          t(
            'schedule.generateResult',
            'Created {created} slot(s), skipped {skipped} existing, from {templates} template(s).',
            {
              created: result.created,
              skipped: result.skipped,
              templates: result.templatesProcessed,
            },
          )
        }}
      </Message>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <Button
          :label="t('common.close', 'Close')"
          severity="secondary"
          text
          :disabled="running"
          @click="isVisible = false"
        />
        <Button
          :label="t('schedule.generate', 'Generate')"
          icon="pi pi-calendar-plus"
          :loading="running"
          :disabled="!canRun"
          @click="run"
        />
      </div>
    </template>
  </Dialog>
</template>
