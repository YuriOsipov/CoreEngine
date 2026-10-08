<script lang="ts">
export default {
  name: 'PanelFilterEditor',
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import {
  buildDirectusFilterFromRows,
  createEmptyFilterRow,
  operatorNeedsValue,
  panelFilterOperatorOptions,
  parseDirectusFilter,
  type PanelFilterLogic,
  type PanelFilterRow,
} from '../services/panelFilter'

const props = defineProps<{
  filter: Record<string, unknown> | null | undefined
  fieldOptions: { label: string; value: string }[]
}>()

const emit = defineEmits<{
  update: [filter: Record<string, unknown>]
}>()

const { t } = useTranslation()

const logic = ref<PanelFilterLogic>('and')
const rows = ref<PanelFilterRow[]>([])
const syncing = ref(false)

const logicOptions = [
  { label: 'AND', value: 'and' },
  { label: 'OR', value: 'or' },
]

const operatorOptions = panelFilterOperatorOptions()

const fieldSelectOptions = () =>
  props.fieldOptions.filter((f) => f.value !== '*')

watch(
  () => props.filter,
  (filter) => {
    if (syncing.value) return
    const parsed = parseDirectusFilter(filter ?? {})
    const next = buildDirectusFilterFromRows(parsed.rows, parsed.logic)
    const current = buildDirectusFilterFromRows(rows.value, logic.value)
    if (JSON.stringify(next) === JSON.stringify(current)) return
    syncing.value = true
    logic.value = parsed.logic
    rows.value = parsed.rows
    syncing.value = false
  },
  { immediate: true, deep: true },
)

function emitFilter(): void {
  if (syncing.value) return
  emit('update', buildDirectusFilterFromRows(rows.value, logic.value))
}

function onLogicChange(value: string | null | undefined): void {
  logic.value = value === 'or' ? 'or' : 'and'
  emitFilter()
}

function addRow(): void {
  rows.value = [...rows.value, createEmptyFilterRow()]
}

function removeRow(id: string): void {
  rows.value = rows.value.filter((row) => row.id !== id)
  emitFilter()
}

function patchRow(id: string, patch: Partial<PanelFilterRow>): void {
  rows.value = rows.value.map((row) =>
    row.id === id ? { ...row, ...patch } : row,
  )
  emitFilter()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <label class="text-xs text-gray-500">{{ t('dashboard.filter', 'Filter') }}</label>
      <Select
        :model-value="logic"
        :options="logicOptions"
        option-label="label"
        option-value="value"
        class="w-24"
        size="small"
        :disabled="rows.length < 2"
        @update:model-value="onLogicChange"
      />
    </div>

    <div
      v-for="row in rows"
      :key="row.id"
      class="grid grid-cols-[1fr_auto] gap-1 rounded border border-[#eef0f4] p-2"
    >
      <div class="grid gap-1">
        <Select
          :model-value="row.field || null"
          :options="fieldSelectOptions()"
          option-label="label"
          option-value="value"
          filter
          show-clear
          class="w-full"
          size="small"
          :placeholder="t('dashboard.filterField', 'Field')"
          @update:model-value="patchRow(row.id, { field: String($event || '') })"
        />
        <Select
          :model-value="row.operator"
          :options="operatorOptions"
          option-label="label"
          option-value="value"
          class="w-full"
          size="small"
          @update:model-value="patchRow(row.id, { operator: String($event || '_eq') })"
        />
        <InputText
          v-if="operatorNeedsValue(row.operator)"
          :model-value="row.value"
          class="w-full"
          size="small"
          :placeholder="t('dashboard.filterValue', 'Value')"
          @update:model-value="patchRow(row.id, { value: String($event || '') })"
        />
      </div>
      <Button
        icon="pi pi-trash"
        severity="danger"
        text
        rounded
        size="small"
        :aria-label="t('common.remove', 'Remove')"
        @click="removeRow(row.id)"
      />
    </div>

    <Button
      :label="t('dashboard.addFilter', 'Add condition')"
      icon="pi pi-plus"
      size="small"
      outlined
      class="justify-self-start"
      @click="addRow"
    />

    <small v-if="rows.length === 0" class="text-gray-500">
      {{ t('dashboard.filterEmpty', 'No filter — all records are included.') }}
    </small>
  </div>
</template>
