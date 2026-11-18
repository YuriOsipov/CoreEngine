import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** Default: tablet portrait / large phone landscape and below. */
export const NARROW_VIEWPORT_MAX_WIDTH = 960

/**
 * Reactive match for phone / tablet-narrow chrome (overlay nav, stacked panes).
 */
export function useNarrowViewport(
  maxWidthPx: number = NARROW_VIEWPORT_MAX_WIDTH,
): { isNarrow: Ref<boolean> } {
  const isNarrow = ref(false)
  let media: MediaQueryList | null = null

  function sync(): void {
    isNarrow.value = media?.matches ?? false
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    media = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    sync()
    media.addEventListener('change', sync)
  })

  onUnmounted(() => {
    media?.removeEventListener('change', sync)
    media = null
  })

  return { isNarrow }
}
