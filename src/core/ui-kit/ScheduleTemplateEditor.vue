<script lang="ts">
export default {
  name: 'ScheduleTemplateEditor',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import { formatScheduleRuleSummary, readScheduleRule } from '@/core/scheduleRuleDisplay'
import type { ScheduleRule, ScheduleRuleFrequency, ScheduleWeekParity } from '@/interfaces'

withDefaults(
  defineProps<{
    readonly?: boolean
    disabled?: boolean
  }>(),
  {
    readonly: false,
    disabled: false,
  },
)

const modelValue = defineModel<unknown>({ default: () => null })

const { t } = useTranslation()
const rule = ref<ScheduleRule>(defaultRule())
let isInternalUpdate = false

const frequencyOptions = computed<Array<{ label: string; value: ScheduleRuleFrequency }>>(
  () => [
    { label: t('schedule.frequencyWeekly', 'Weekly'), value: 'weekly' },
    { label: t('schedule.frequencyMonthly', 'Monthly'), value: 'monthly' },
  ],
)

const parityOptions = computed<Array<{ label: string; value: ScheduleWeekParity }>>(() => [
  { label: t('schedule.parityAll', 'Every week'), value: 'all' },
  { label: t('schedule.parityEven', 'Even weeks'), value: 'even' },
  { label: t('schedule.parityOdd', 'Odd weeks'), value: 'odd' },
])

const weekdays = computed<Array<{ label: string; value: number }>>(() => [
  { label: t('schedule.mon', 'Mon'), value: 1 },
  { label: t('schedule.tue', 'Tue'), value: 2 },
  { label: t('schedule.wed', 'Wed'), value: 3 },
  { label: t('schedule.thu', 'Thu'), value: 4 },
  { label: t('schedule.fri', 'Fri'), value: 5 },
  { label: t('schedule.sat', 'Sat'), value: 6 },
  { label: t('schedule.sun', 'Sun'), value: 7 },
])

const monthDayOptions = computed(() =>
  Array.from({ length: 31 }, (_, index) => ({
    label: String(index + 1),
    value: index + 1,
  })),
)

function defaultRule(): ScheduleRule {
  return {
    frequency: 'weekly',
    weekParity: 'all',
    daysOfWeek: [1, 2, 3, 4, 5],
    daysOfMonth: [],
    startTime: '09:00',
    endTime: '17:00',
  }
}

function readRule(value: unknown): ScheduleRule | null {
  return readScheduleRule(value)
}

function toOutput(value: ScheduleRule): ScheduleRule {
  if (value.frequency === 'monthly') {
    return {
      frequency: 'monthly',
      daysOfMonth: [...(value.daysOfMonth ?? [])].sort((a, b) => a - b),
      startTime: value.startTime,
      endTime: value.endTime,
    }
  }
  return {
    frequency: 'weekly',
    weekParity: value.weekParity ?? 'all',
    daysOfWeek: [...(value.daysOfWeek ?? [])].sort((a, b) => a - b),
    startTime: value.startTime,
    endTime: value.endTime,
  }
}

watch(
  modelValue,
  (value) => {
    if (isInternalUpdate) {
      isInternalUpdate = false
      return
    }
    const parsed = readRule(value)
    if (parsed) {
      rule.value = parsed
    } else {
      // New / empty record: seed a usable default and persist it.
      rule.value = defaultRule()
      emit(rule.value)
    }
  },
  { immediate: true, deep: true },
)

function emit(next: ScheduleRule): void {
  isInternalUpdate = true
  modelValue.value = toOutput(next)
}

function update(patch: Partial<ScheduleRule>): void {
  rule.value = { ...rule.value, ...patch }
  emit(rule.value)
}

function toggleWeekday(day: number): void {
  const current = new Set(rule.value.daysOfWeek ?? [])
  if (current.has(day)) current.delete(day)
  else current.add(day)
  update({ daysOfWeek: Array.from(current) })
}

function isWeekdaySelected(day: number): boolean {
  return (rule.value.daysOfWeek ?? []).includes(day)
}

function timeToDate(value: string | undefined): Date | null {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date
}

function dateToTime(value: unknown): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

const summary = computed(() => formatScheduleRuleSummary(toOutput(rule.value)))
</script>

<template>
  <div
    v-if="readonly"
    class="border border-surface-200 rounded-lg bg-surface-50 px-3 py-2 text-sm text-surface-800"
  >
    {{ summary }}
  </div>

  <div v-else class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-4">
      <div class="flex flex-col gap-1">
        <span class="text-[0.8rem] font-medium text-surface-700">
          {{ t('schedule.frequency', 'Frequency') }}
        </span>
        <SelectButton
          :model-value="rule.frequency"
          :options="frequencyOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          :disabled="disabled"
          @update:model-value="update({ frequency: $event as ScheduleRuleFrequency })"
        />
      </div>

      <div v-if="rule.frequency === 'weekly'" class="flex flex-col gap-1">
        <span class="text-[0.8rem] font-medium text-surface-700">
          {{ t('schedule.weekParity', 'Week parity') }}
        </span>
        <SelectButton
          :model-value="rule.weekParity ?? 'all'"
          :options="parityOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          :disabled="disabled"
          @update:model-value="update({ weekParity: $event as ScheduleWeekParity })"
        />
      </div>
    </div>

    <div v-if="rule.frequency === 'weekly'" class="flex flex-col gap-1">
      <span class="text-[0.8rem] font-medium text-surface-700">
        {{ t('schedule.daysOfWeek', 'Days of week') }}
      </span>
      <div class="flex flex-wrap gap-1">
        <Button
          v-for="day in weekdays"
          :key="day.value"
          :label="day.label"
          size="small"
          :severity="isWeekdaySelected(day.value) ? undefined : 'secondary'"
          :outlined="!isWeekdaySelected(day.value)"
          :disabled="disabled"
          @click="toggleWeekday(day.value)"
        />
      </div>
    </div>

    <div v-else class="flex flex-col gap-1">
      <span class="text-[0.8rem] font-medium text-surface-700">
        {{ t('schedule.daysOfMonth', 'Days of month') }}
      </span>
      <MultiSelect
        :model-value="rule.daysOfMonth ?? []"
        :options="monthDayOptions"
        option-label="label"
        option-value="value"
        display="chip"
        filter
        :disabled="disabled"
        :placeholder="t('schedule.selectDays', 'Select days')"
        class="w-full"
        @update:model-value="update({ daysOfMonth: $event })"
      />
    </div>

    <div class="flex flex-wrap gap-4">
      <div class="flex flex-col gap-1">
        <span class="text-[0.8rem] font-medium text-surface-700">
          {{ t('schedule.startTime', 'Start time') }}
        </span>
        <DatePicker
          :model-value="timeToDate(rule.startTime)"
          time-only
          hour-format="24"
          fluid
          :disabled="disabled"
          @update:model-value="update({ startTime: dateToTime($event) })"
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[0.8rem] font-medium text-surface-700">
          {{ t('schedule.endTime', 'End time') }}
        </span>
        <DatePicker
          :model-value="timeToDate(rule.endTime)"
          time-only
          hour-format="24"
          fluid
          :disabled="disabled"
          @update:model-value="update({ endTime: dateToTime($event) })"
        />
      </div>
    </div>
  </div>
</template>
