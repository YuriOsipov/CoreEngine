<script lang="ts">
export default {
  name: 'CrmJsonListField',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import {
  createEmptyJsonListRow,
  normalizeJsonListValue,
  type JsonListColumn,
  type JsonListRow,
} from '@/core/jsonField'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    modelValue?: unknown
    columns?: JsonListColumn[]
    disabled?: boolean
    readonly?: boolean
    inputId?: string
  }>(),
  {
    modelValue: null,
    columns: () => [],
    disabled: false,
    readonly: false,
    inputId: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: JsonListRow[]]
}>()

const { t } = useTranslation()

const columns = computed(() =>
  (props.columns ?? []).filter((col) => Boolean(col?.name?.trim())),
)

const rows = computed(() =>
  normalizeJsonListValue(props.modelValue, columns.value),
)

const locked = computed(() => props.disabled || props.readonly)

function emitRows(next: JsonListRow[]): void {
  if (locked.value) return
  emit('update:modelValue', normalizeJsonListValue(next, columns.value))
}

function updateCell(
  rowIndex: number,
  columnName: string,
  value: unknown,
): void {
  if (locked.value) return
  const next = rows.value.map((row, i) =>
    i === rowIndex ? { ...row, [columnName]: value } : { ...row },
  )
  emitRows(next)
}

function addRow(): void {
  if (locked.value || columns.value.length === 0) return
  emitRows([...rows.value, createEmptyJsonListRow(columns.value)])
}

function removeRow(index: number): void {
  if (locked.value) return
  emitRows(rows.value.filter((_, i) => i !== index))
}
</script>

<template>
  <div class="crm-json-list-field flex flex-col gap-2 w-full">
    <small
      v-if="columns.length === 0"
      class="text-muted-color"
    >
      {{
        t(
          'jsonField.noColumns',
          'No columns configured for this JSON List field.',
        )
      }}
    </small>

    <template v-else>
      <div class="crm-json-list-field__table overflow-x-auto">
        <table class="crm-json-list-field__grid w-full">
          <thead>
            <tr>
              <th
                v-for="col in columns"
                :key="col.name"
                class="text-left text-[0.8rem] text-surface-600 font-medium pb-1 pr-2"
              >
                {{ col.name }}
              </th>
              <th class="w-10" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in rows"
              :key="rowIndex"
            >
              <td
                v-for="col in columns"
                :key="col.name"
                class="pr-2 pb-2 align-middle"
              >
                <InputNumber
                  v-if="col.type === 'number'"
                  :model-value="
                    typeof row[col.name] === 'number' ? row[col.name] : null
                  "
                  fluid
                  :disabled="locked"
                  :input-id="
                    inputId
                      ? `${inputId}_${rowIndex}_${col.name}`
                      : undefined
                  "
                  @update:model-value="updateCell(rowIndex, col.name, $event)"
                />
                <Checkbox
                  v-else-if="col.type === 'boolean'"
                  :model-value="Boolean(row[col.name])"
                  binary
                  :disabled="locked"
                  :input-id="
                    inputId
                      ? `${inputId}_${rowIndex}_${col.name}`
                      : undefined
                  "
                  @update:model-value="updateCell(rowIndex, col.name, $event)"
                />
                <InputText
                  v-else
                  :model-value="
                    row[col.name] == null ? '' : String(row[col.name])
                  "
                  fluid
                  :disabled="locked"
                  :readonly="readonly"
                  autocomplete="off"
                  :id="
                    inputId
                      ? `${inputId}_${rowIndex}_${col.name}`
                      : undefined
                  "
                  @update:model-value="updateCell(rowIndex, col.name, $event)"
                />
              </td>
              <td class="pb-2 align-middle">
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  severity="danger"
                  :disabled="locked"
                  :aria-label="t('jsonField.removeRow', 'Remove row')"
                  @click="removeRow(rowIndex)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <Button
          :label="t('jsonField.addRow', 'Add row')"
          icon="pi pi-plus"
          size="small"
          severity="secondary"
          outlined
          :disabled="locked"
          @click="addRow"
        />
      </div>
    </template>
  </div>
</template>
