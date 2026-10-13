<script lang="ts">
export default {
  name: 'CrmBarcodeScanToolbar',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BarcodeScanSettings } from '@/interfaces'
import { normalizeBarcodeScanSettings } from '@/core/barcodeScan'
import { useBarcodeScanCapture } from '@/core/useBarcodeScanCapture'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    settings: BarcodeScanSettings | null | undefined
    busy?: boolean
    /** When true, only render the Scan mode toggle button. */
    toggleOnly?: boolean
    /** When true, hide the built-in toggle (parent renders it elsewhere). */
    hideToggle?: boolean
  }>(),
  {
    busy: false,
    toggleOnly: false,
    hideToggle: false,
  },
)

const emit = defineEmits<{
  submit: [payload: { code: string; value: string }]
  'clear-filter': []
}>()

const scanModeOn = defineModel<boolean>('scanMode', { default: false })

const { t } = useTranslation()

const normalized = computed(() => normalizeBarcodeScanSettings(props.settings))
const featureEnabled = computed(() => Boolean(normalized.value))

const scanValue = ref('')
const updateValue = ref('')
const filterActive = ref(false)
const defaultsApplied = ref(false)

watch(
  normalized,
  (settings) => {
    if (!defaultsApplied.value && settings) {
      scanModeOn.value = Boolean(settings.defaultScanModeOn)
      defaultsApplied.value = true
    }
  },
  { immediate: true },
)

watch(scanModeOn, (on, wasOn) => {
  if (wasOn && !on) {
    scanValue.value = ''
    updateValue.value = ''
    if (filterActive.value || !props.toggleOnly) {
      filterActive.value = false
      emit('clear-filter')
    }
  }
})

const showValueInput = computed(() => Boolean(normalized.value?.updateField))
const showPanel = computed(
  () => featureEnabled.value && scanModeOn.value && !props.toggleOnly,
)
const showToggle = computed(
  () => featureEnabled.value && (props.toggleOnly || !props.hideToggle),
)

useBarcodeScanCapture({
  // Toggle-only instances share mode state but must not register a second key listener.
  enabled: computed(
    () => featureEnabled.value && scanModeOn.value && !props.toggleOnly,
  ),
  scanValue,
  onSubmit: submitScan,
})

function submitScan(): void {
  if (!scanModeOn.value) return
  const code = scanValue.value.trim()
  if (!code || props.busy) return
  emit('submit', { code, value: updateValue.value })
}

function clearScan(): void {
  scanValue.value = ''
  updateValue.value = ''
  if (filterActive.value) {
    filterActive.value = false
    emit('clear-filter')
  }
}

function exitScanMode(): void {
  scanModeOn.value = false
}

function toggleScanMode(): void {
  scanModeOn.value = !scanModeOn.value
}

function markFilterActive(active: boolean): void {
  filterActive.value = active
}

defineExpose({
  exitScanMode,
  clearScan,
  markFilterActive,
  toggleScanMode,
  scanValue,
  updateValue,
  scanModeOn,
})
</script>

<template>
  <Button
    v-if="showToggle"
    :label="
      scanModeOn
        ? t('barcodeScan.scanModeOn', 'Scan mode: On')
        : t('barcodeScan.scanModeOff', 'Scan mode')
    "
    icon="pi pi-qrcode"
    size="small"
    :severity="scanModeOn ? 'success' : 'secondary'"
    :outlined="!scanModeOn"
    :disabled="busy"
    @click="toggleScanMode"
  />

  <div
    v-if="showPanel"
    class="crm-barcode-scan-toolbar flex flex-wrap items-end gap-2 min-w-0"
  >
    <div class="flex flex-col gap-0.5 min-w-[10rem] flex-1" style="max-width: 16rem">
      <label class="text-[0.75rem] text-muted-color">
        {{ t('barcodeScan.scanInput', 'Barcode') }}
      </label>
      <InputText
        v-model="scanValue"
        data-barcode-scan-input
        class="w-full"
        size="small"
        :disabled="busy"
        :placeholder="t('barcodeScan.scanPlaceholder', 'Scan or type barcode')"
        @keydown.enter.prevent="submitScan"
      />
    </div>

    <div
      v-if="showValueInput"
      class="flex flex-col gap-0.5 min-w-[8rem] flex-1"
      style="max-width: 12rem"
    >
      <label class="text-[0.75rem] text-muted-color">
        {{ t('barcodeScan.valueInput', 'Value') }}
      </label>
      <InputText
        v-model="updateValue"
        data-barcode-scan-input
        class="w-full"
        size="small"
        :disabled="busy"
        :placeholder="t('barcodeScan.valuePlaceholder', 'Value to set')"
        @keydown.enter.prevent="submitScan"
      />
    </div>

    <Button
      :label="t('barcodeScan.find', 'Find')"
      icon="pi pi-search"
      size="small"
      :loading="busy"
      :disabled="!scanValue.trim()"
      @click="submitScan"
    />

    <Button
      v-if="scanValue || updateValue || filterActive"
      :label="t('barcodeScan.clear', 'Clear')"
      icon="pi pi-times"
      size="small"
      severity="secondary"
      text
      :disabled="busy"
      @click="clearScan"
    />

    <Tag
      severity="success"
      :value="t('barcodeScan.listening', 'Listening for scanner…')"
    />
  </div>
</template>
