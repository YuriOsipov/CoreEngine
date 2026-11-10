<script lang="ts">
export default {
  name: 'ReportDrillDownDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { recordDetailRoute } from '@/core/compactRecordRoutes'
import { isNumericFieldDefinition } from '@/core/fieldHelpers'
import { useTranslation } from '@/core/translation'
import type { FieldDefinition } from '@/interfaces'
import { fetchCollectionDisplayTemplate } from '@/modules/entities/services/collectionSchema'
import {
  getPathValue,
  relatedRecordFallbackLabel,
  renderTemplateLabel,
  shouldUseTemplateForRelatedLabel,
  extractTemplateFields,
} from '@/modules/entities/utils/recordDisplay'
import {
  DRILL_DOWN_RECORD_COLUMN,
  drillDownColumnFields,
  resolveDrillDownRows,
} from '../services/reportDrillDown'
import {
  formatReportCellDisplay,
  resolveReportFieldDefinitions,
} from '../services/reportCellDisplay'
import type {
  ReportPivotDrillDown,
  ReportPivotSettings,
} from '../services/reportSettings'

const props = defineProps<{
  visible: boolean
  title: string
  collection: string
  pivot: ReportPivotSettings
  rows: Record<string, unknown>[]
  drillDown: ReportPivotDrillDown | null
  fieldLabels?: Record<string, string>
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const { t } = useTranslation()
const displayTemplate = ref<string | undefined>(undefined)
const fieldDefinitions = ref<Map<string, FieldDefinition>>(new Map())

const visibleModel = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const emptyLabel = computed(() => t('reports.emptyValue', '(empty)'))

watch(
  () => [props.visible, props.collection] as const,
  async ([visible, collection]) => {
    if (!visible || !collection) {
      displayTemplate.value = undefined
      return
    }
    displayTemplate.value = await fetchCollectionDisplayTemplate(collection).catch(() => undefined)
  },
  { immediate: true },
)

watch(
  () => [props.visible, props.collection, props.pivot] as const,
  async ([visible, collection]) => {
    if (!visible || !collection) {
      fieldDefinitions.value = new Map()
      return
    }
    const paths = drillDownColumnFields(props.pivot).filter(
      (field) => field !== DRILL_DOWN_RECORD_COLUMN,
    )
    fieldDefinitions.value = await resolveReportFieldDefinitions(collection, paths).catch(
      () => new Map(),
    )
  },
  { immediate: true, deep: true },
)

const pathChips = computed(() => {
  if (!props.drillDown) return []
  return [...props.drillDown.rowPath, ...props.drillDown.columnPath].map((segment) => ({
    key: `${segment.field}:${segment.value}`,
    label: fieldLabel(segment.field),
    value: segment.value,
  }))
})

const sourceRows = computed(() => {
  if (!props.drillDown) return []
  return resolveDrillDownRows(props.rows, props.drillDown)
})

const columns = computed(() =>
  drillDownColumnFields(props.pivot).map((field) => ({
    field,
    header: fieldLabel(field),
  })),
)

function fieldLabel(field: string): string {
  if (field === DRILL_DOWN_RECORD_COLUMN) {
    return t('reports.record', 'Record')
  }
  return props.fieldLabels?.[field] ?? field
}

function isNumericColumn(field: string): boolean {
  return isNumericFieldDefinition(fieldDefinitions.value.get(field))
}

function cellDisplay(row: Record<string, unknown>, field: string): string {
  if (field === DRILL_DOWN_RECORD_COLUMN) {
    return recordLabel(row)
  }
  return formatReportCellDisplay(
    getPathValue(row, field),
    fieldDefinitions.value.get(field),
    emptyLabel.value,
  )
}

function recordLabel(row: Record<string, unknown>): string {
  const id = recordId(row)
  const template = displayTemplate.value?.trim()
  if (template) {
    const templateFields = extractTemplateFields(template)
    if (shouldUseTemplateForRelatedLabel(template, templateFields)) {
      const label = renderTemplateLabel(template, row).trim()
      if (label && label !== String(id ?? '')) return label
    }
  }
  return relatedRecordFallbackLabel(row, id)
}

function recordId(row: Record<string, unknown>): string | number | null {
  const id = row.id
  if (typeof id === 'string' || typeof id === 'number') return id
  return null
}

function closeDialog(): void {
  visibleModel.value = false
}
</script>

<template>
  <Dialog
    v-model:visible="visibleModel"
    modal
    :header="title"
    :style="{ width: 'min(960px, 96vw)' }"
    :breakpoints="{ '960px': '96vw' }"
  >
    <div class="grid gap-3">
      <p class="text-muted-color text-[0.9rem] m-0">
        {{
          t(
            'reports.drillDownHint',
            'Temporary list of source records that make up this pivot value.',
          )
        }}
      </p>

      <div v-if="pathChips.length" class="flex flex-wrap gap-2">
        <Tag
          v-for="chip in pathChips"
          :key="chip.key"
          severity="secondary"
          :value="`${chip.label} = ${chip.value}`"
        />
      </div>

      <p v-if="sourceRows.length === 0" class="text-muted-color m-0">
        {{ t('reports.drillDownEmpty', 'No source records found for this value.') }}
      </p>

      <DataTable
        v-else
        :value="sourceRows"
        size="small"
        striped-rows
        paginator
        :rows="10"
        :rows-per-page-options="[10, 25, 50]"
      >
        <Column
          v-for="column in columns"
          :key="column.field"
          :field="column.field"
          :header="column.header"
          :align="isNumericColumn(column.field) ? 'right' : undefined"
          :header-class="isNumericColumn(column.field) ? 'text-right!' : undefined"
          :body-class="isNumericColumn(column.field) ? 'text-right! tabular-nums' : undefined"
        >
          <template #body="{ data }">
            <RouterLink
              v-if="column.field === DRILL_DOWN_RECORD_COLUMN && recordId(data) != null"
              class="text-primary no-underline hover:underline"
              :to="recordDetailRoute(collection, recordId(data)!)"
              target="_blank"
            >
              {{ cellDisplay(data, column.field) }}
            </RouterLink>
            <span
              v-else
              :class="isNumericColumn(column.field) ? 'block w-full text-right tabular-nums' : undefined"
            >
              {{ cellDisplay(data, column.field) }}
            </span>
          </template>
        </Column>
      </DataTable>
    </div>

    <template #footer>
      <Button
        :label="t('common.close', 'Close')"
        severity="secondary"
        text
        @click="closeDialog"
      />
    </template>
  </Dialog>
</template>
