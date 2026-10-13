import {
  onBeforeUnmount,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'

const DEFAULT_INTER_KEY_MS = 50

/**
 * HID wedge capture while Scan mode is on.
 * Appends characters into `scanValue` and calls `onSubmit` on Enter.
 */
export function useBarcodeScanCapture(options: {
  enabled: MaybeRefOrGetter<boolean>
  scanValue: Ref<string>
  onSubmit: () => void
  interKeyMs?: number
}) {
  const interKeyMs = options.interKeyMs ?? DEFAULT_INTER_KEY_MS
  let lastKeyAt = 0

  function onKeydown(event: KeyboardEvent): void {
    if (!toValue(options.enabled)) return
    if (event.isComposing) return
    if (event.ctrlKey || event.altKey || event.metaKey) return

    const target = event.target as HTMLElement | null
    const typingInScanInput = Boolean(target?.closest?.('[data-barcode-scan-input]'))

    if (event.key === 'Enter') {
      if (!typingInScanInput) {
        event.preventDefault()
        event.stopPropagation()
      } else {
        // InputText also handles Enter; still submit once from capture to keep one path.
        event.preventDefault()
        event.stopPropagation()
      }
      options.onSubmit()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      options.scanValue.value = ''
      return
    }

    if (event.key.length !== 1) return

    // Focused Scan / Value inputs use normal v-model typing.
    if (typingInScanInput) return

    const now = Date.now()
    // New wedge burst after a pause — replace buffer instead of appending.
    if (now - lastKeyAt > interKeyMs) {
      options.scanValue.value = ''
    }
    lastKeyAt = now

    event.preventDefault()
    event.stopPropagation()
    options.scanValue.value += event.key
  }

  function attach(): void {
    document.addEventListener('keydown', onKeydown, true)
  }

  function detach(): void {
    document.removeEventListener('keydown', onKeydown, true)
  }

  watch(
    () => toValue(options.enabled),
    (on) => {
      detach()
      if (on) attach()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    detach()
  })
}

export function useScanModeToggle(defaultOn: boolean) {
  const scanModeOn = ref(defaultOn)

  function exitScanMode(): void {
    scanModeOn.value = false
  }

  function enterScanMode(): void {
    scanModeOn.value = true
  }

  return { scanModeOn, exitScanMode, enterScanMode }
}
