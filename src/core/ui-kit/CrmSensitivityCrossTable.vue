<script lang="ts">
export default {
  name: 'CrmSensitivityCrossTable',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { buildSensitivityCrossTable } from '@/core/sensitivityField'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  modelValue?: unknown
}>()

const { t } = useTranslation()

const table = computed(() => buildSensitivityCrossTable(props.modelValue))
const empty = computed(
  () => table.value.pathogens.length === 0 || table.value.pharmacies.length === 0,
)

function cellValue(pharmacy: string, patogen: string): string {
  return table.value.cellMap[pharmacy]?.[patogen] ?? ''
}
</script>

<template>
  <div
    v-if="empty"
    class="text-muted-color text-[0.95rem] leading-[1.35]"
  >
    {{ t('sensitivityField.emptyResults', 'No cross-result rows yet.') }}
  </div>
  <div
    v-else
    class="crm-sensitivity-cross overflow-x-auto w-full"
  >
    <table class="crm-sensitivity-cross__table w-full text-sm border-collapse">
      <thead>
        <tr>
          <th
            class="text-left text-[0.8rem] font-medium text-surface-600 px-2 py-1.5 border border-surface-200 bg-surface-50 sticky left-0 z-[1]"
          >
            {{ t('sensitivityField.pharmacy', 'Pharmacy') }}
          </th>
          <th
            v-for="patogen in table.pathogens"
            :key="patogen"
            class="text-left text-[0.8rem] font-medium text-surface-700 px-2 py-1.5 border border-surface-200 bg-surface-50 min-w-[7rem] align-bottom"
          >
            <div class="break-words">{{ patogen }}</div>
            <div
              v-if="table.notesByPatogen[patogen]"
              class="mt-0.5 text-[0.75rem] font-normal text-muted-color break-words"
            >
              {{ table.notesByPatogen[patogen] }}
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="pharmacy in table.pharmacies"
          :key="pharmacy"
        >
          <th
            class="text-left font-medium text-surface-800 px-2 py-1.5 border border-surface-200 bg-surface-50 sticky left-0 z-[1] break-words"
          >
            {{ pharmacy }}
          </th>
          <td
            v-for="patogen in table.pathogens"
            :key="`${pharmacy}-${patogen}`"
            class="px-2 py-1.5 border border-surface-200 text-surface-900 break-words"
          >
            {{ cellValue(pharmacy, patogen) || '—' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
