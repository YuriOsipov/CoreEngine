<script lang="ts">
export default {
  name: 'CrmSensitivityMatrixField',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  loadSensitivityLists,
  normalizeSensitivityNotes,
  normalizeSensitivityResults,
  normalizeSensitivityValue,
  type SensitivityLists,
  type SensitivityNoteRow,
  type SensitivityRow,
  type SensitivitySource,
  type SensitivityValue,
} from '@/core/sensitivityField'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    modelValue?: unknown
    sensitivitySource: SensitivitySource
    entityCollection: string
    sourceRecord: Record<string, unknown>
    disabled?: boolean
    readonly?: boolean
    inputId?: string
  }>(),
  {
    disabled: false,
    readonly: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: SensitivityValue]
}>()

const { t } = useTranslation()

const loading = ref(false)
const lists = ref<SensitivityLists>({ patogen: [], pharmacy: [], resistance: [] })
const selectedPatogen = ref<string | null>(null)
/** Local note drafts so typing does not emit form updates on every keystroke. */
const noteDrafts = ref<Record<string, string>>({})
const dirtyNotes = ref(new Set<string>())
let requestId = 0

const locked = computed(() => props.disabled || props.readonly)

const payload = computed(() => normalizeSensitivityValue(props.modelValue))
const rows = computed(() => payload.value.results)
const notes = computed(() => payload.value.notes)

const relationId = computed(() =>
  extractRelationFieldId(props.sourceRecord?.[props.sensitivitySource.relationField]),
)

/** Catalog lists plus names already stored on this field (so edits work if Item is missing). */
const effectiveLists = computed((): SensitivityLists => {
  const patogen = new Set(lists.value.patogen)
  const pharmacy = new Set(lists.value.pharmacy)
  const resistance = new Set(lists.value.resistance)
  for (const row of rows.value) {
    if (row.patogen) patogen.add(row.patogen)
    if (row.pharmacy) pharmacy.add(row.pharmacy)
    if (row.resistance) resistance.add(row.resistance)
  }
  for (const note of notes.value) {
    if (note.patogen) patogen.add(note.patogen)
  }
  return {
    patogen: Array.from(patogen),
    pharmacy: Array.from(pharmacy),
    resistance: Array.from(resistance),
  }
})

const resistanceOptions = computed(() =>
  effectiveLists.value.resistance.map((name) => ({ label: name, value: name })),
)

const patogenItems = computed(() =>
  effectiveLists.value.patogen.map((name) => ({
    name,
    note: noteDrafts.value[name] ?? '',
    filled: rows.value.filter((row) => row.patogen === name).length,
  })),
)

const pharmacyRows = computed(() => {
  const patogen = selectedPatogen.value
  if (!patogen) return [] as Array<{ pharmacy: string; resistance: string | null }>
  return effectiveLists.value.pharmacy.map((pharmacy) => {
    const match = rows.value.find(
      (row) => row.patogen === patogen && row.pharmacy === pharmacy,
    )
    return {
      pharmacy,
      resistance: match?.resistance ?? null,
    }
  })
})

const emptyPatogenMessage = computed(() => {
  if (relationId.value === null) {
    const field = props.sensitivitySource.relationField || 'item'
    return t(
      'sensitivityField.missingRelation',
      'Select a value for "{field}" first (Main result). Pathogen lists come from that related record.',
      { field },
    )
  }
  return t(
    'sensitivityField.emptyPatogens',
    'No pathogens in the related list field.',
  )
})

watch(
  () => [
    props.entityCollection,
    props.sensitivitySource.relationField,
    props.sensitivitySource.patogenField,
    props.sensitivitySource.pharmacyField,
    props.sensitivitySource.resistanceField,
    props.sensitivitySource.valueColumn,
    extractRelationFieldId(props.sourceRecord?.id),
    extractRelationFieldId(props.sourceRecord?.[props.sensitivitySource.relationField]),
    embeddedListsToken(),
  ],
  () => {
    void refresh()
  },
  { immediate: true },
)

watch(
  () => effectiveLists.value.patogen,
  (patogens) => {
    if (selectedPatogen.value && patogens.includes(selectedPatogen.value)) return
    selectedPatogen.value = patogens[0] ?? null
  },
)

watch(
  () => [notes.value, effectiveLists.value.patogen] as const,
  () => {
    const next: Record<string, string> = { ...noteDrafts.value }
    const known = new Set(effectiveLists.value.patogen)
    for (const key of Object.keys(next)) {
      if (!known.has(key)) {
        delete next[key]
        dirtyNotes.value.delete(key)
      }
    }
    for (const name of effectiveLists.value.patogen) {
      if (dirtyNotes.value.has(name)) continue
      next[name] = notes.value.find((row) => row.patogen === name)?.note ?? ''
    }
    noteDrafts.value = next
  },
  { immediate: true },
)

function embeddedListsToken(): string {
  const raw = props.sourceRecord?.[props.sensitivitySource.relationField]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const related = raw as Record<string, unknown>
  const src = props.sensitivitySource
  try {
    return JSON.stringify({
      patogen: related[src.patogenField],
      pharmacy: related[src.pharmacyField],
      resistance: related[src.resistanceField],
    })
  } catch {
    return ''
  }
}

async function refresh(): Promise<void> {
  const current = ++requestId
  loading.value = true
  try {
    const next = await loadSensitivityLists(
      props.entityCollection,
      props.sensitivitySource,
      props.sourceRecord ?? {},
    )
    if (current !== requestId) return
    lists.value = next
  } finally {
    if (current === requestId) loading.value = false
  }
}

function emitValue(next: {
  results?: SensitivityRow[]
  notes?: SensitivityNoteRow[]
}): void {
  if (locked.value) return
  emit(
    'update:modelValue',
    normalizeSensitivityValue({
      results: next.results ?? rows.value,
      notes: next.notes ?? notes.value,
    }),
  )
}

function setResistance(pharmacy: string, resistance: string | null | undefined): void {
  if (locked.value) return
  const patogen = selectedPatogen.value
  if (!patogen) return

  const trimmed = resistance == null ? '' : String(resistance).trim()
  const without = rows.value.filter(
    (row) => !(row.patogen === patogen && row.pharmacy === pharmacy),
  )
  const results = trimmed
    ? normalizeSensitivityResults([...without, { patogen, pharmacy, resistance: trimmed }])
    : normalizeSensitivityResults(without)
  emitValue({ results })
}

function onNoteInput(patogen: string, note: string | null | undefined): void {
  if (locked.value) return
  dirtyNotes.value.add(patogen)
  noteDrafts.value = {
    ...noteDrafts.value,
    [patogen]: note == null ? '' : String(note),
  }
}

function commitNote(patogen: string): void {
  if (locked.value) return
  const trimmed = String(noteDrafts.value[patogen] ?? '').trim()
  noteDrafts.value = { ...noteDrafts.value, [patogen]: trimmed }
  dirtyNotes.value.delete(patogen)
  const saved = notes.value.find((row) => row.patogen === patogen)?.note ?? ''
  if (trimmed === saved) return

  const without = notes.value.filter((row) => row.patogen !== patogen)
  const nextNotes = trimmed
    ? normalizeSensitivityNotes([...without, { patogen, note: trimmed }])
    : normalizeSensitivityNotes(without)
  emitValue({ notes: nextNotes })
}

function selectPatogen(name: string): void {
  selectedPatogen.value = name
}
</script>

<template>
  <div
    class="crm-sensitivity-matrix flex flex-col gap-2 w-full"
    :id="inputId"
  >
    <small
      v-if="
        !sensitivitySource.relationField ||
        !sensitivitySource.patogenField ||
        !sensitivitySource.pharmacyField ||
        !sensitivitySource.resistanceField
      "
      class="text-muted-color"
    >
      {{
        t(
          'sensitivityField.noSource',
          'Configure related patogen, pharmacy, and resistance list fields.',
        )
      }}
    </small>

    <div
      v-else
      class="crm-sensitivity-matrix__panels flex flex-col md:flex-row gap-3 min-h-[16rem]"
    >
      <div
        class="crm-sensitivity-matrix__left flex flex-col gap-1 md:w-[46%] md:min-w-[14rem] border border-surface-200 rounded-md overflow-hidden"
      >
        <div
          class="px-2 py-1.5 text-[0.8rem] font-medium text-surface-600 bg-surface-50 border-b border-surface-200"
        >
          {{ t('sensitivityField.patogen', 'Pathogen') }}
        </div>
        <div class="flex-1 overflow-auto max-h-[22rem]">
          <div
            v-if="loading && patogenItems.length === 0"
            class="p-3 text-sm text-muted-color"
          >
            {{ t('sensitivityField.loading', 'Loading…') }}
          </div>
          <div
            v-else-if="patogenItems.length === 0"
            class="p-3 text-sm text-muted-color"
          >
            {{ emptyPatogenMessage }}
          </div>
          <table
            v-else
            class="w-full text-sm"
          >
            <thead>
              <tr class="text-left text-[0.8rem] text-surface-600">
                <th class="px-2 py-1.5 font-medium">
                  {{ t('sensitivityField.patogenName', 'Name') }}
                </th>
                <th class="px-2 py-1.5 font-medium w-[40%]">
                  {{ t('sensitivityField.note', 'Note') }}
                </th>
                <th class="w-8" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in patogenItems"
                :key="item.name"
                class="border-t border-surface-100 cursor-pointer"
                :class="
                  selectedPatogen === item.name
                    ? 'bg-primary-50'
                    : 'hover:bg-surface-50'
                "
                @click="selectPatogen(item.name)"
              >
                <td
                  class="px-2 py-1.5 align-middle break-words"
                  :class="selectedPatogen === item.name ? 'text-primary-800' : ''"
                >
                  {{ item.name }}
                </td>
                <td
                  class="px-2 py-1.5 align-middle"
                  @click.stop
                >
                  <InputText
                    :model-value="item.note"
                    :data-sensitivity-note="item.name"
                    fluid
                    size="small"
                    :disabled="locked"
                    :readonly="readonly"
                    autocomplete="off"
                    :placeholder="t('sensitivityField.notePlaceholder', 'Note')"
                    @update:model-value="onNoteInput(item.name, $event)"
                    @blur="commitNote(item.name)"
                  />
                </td>
                <td class="px-1 py-1.5 align-middle">
                  <Tag
                    v-if="item.filled > 0"
                    :value="String(item.filled)"
                    severity="success"
                    class="text-[0.7rem]"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        class="crm-sensitivity-matrix__right flex flex-col gap-1 flex-1 min-w-0 border border-surface-200 rounded-md overflow-hidden"
      >
        <div
          class="px-2 py-1.5 text-[0.8rem] font-medium text-surface-600 bg-surface-50 border-b border-surface-200"
        >
          {{
            selectedPatogen
              ? t(
                  'sensitivityField.pharmacyFor',
                  'Pharmacy · {patogen}',
                  { patogen: selectedPatogen },
                )
              : t('sensitivityField.pharmacy', 'Pharmacy')
          }}
        </div>
        <div class="flex-1 overflow-auto max-h-[22rem]">
          <div
            v-if="!selectedPatogen"
            class="p-3 text-sm text-muted-color"
          >
            {{ t('sensitivityField.selectPatogen', 'Select a pathogen on the left.') }}
          </div>
          <div
            v-else-if="pharmacyRows.length === 0"
            class="p-3 text-sm text-muted-color"
          >
            {{ t('sensitivityField.emptyPharmacy', 'No pharmacy items in the related list field.') }}
          </div>
          <table
            v-else
            class="w-full text-sm"
          >
            <thead>
              <tr class="text-left text-[0.8rem] text-surface-600">
                <th class="px-2 py-1.5 font-medium">
                  {{ t('sensitivityField.pharmacy', 'Pharmacy') }}
                </th>
                <th class="px-2 py-1.5 font-medium w-[12rem]">
                  {{ t('sensitivityField.resistance', 'Resistance') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in pharmacyRows"
                :key="row.pharmacy"
                class="border-t border-surface-100"
              >
                <td class="px-2 py-1.5 align-middle break-words">
                  {{ row.pharmacy }}
                </td>
                <td class="px-2 py-1.5 align-middle">
                  <Select
                    :model-value="row.resistance"
                    :options="resistanceOptions"
                    option-label="label"
                    option-value="value"
                    show-clear
                    fluid
                    size="small"
                    :disabled="locked"
                    :placeholder="t('sensitivityField.selectResistance', 'Select…')"
                    @update:model-value="setResistance(row.pharmacy, $event as string | null)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
