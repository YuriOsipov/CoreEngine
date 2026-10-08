/** Shared Sortable options for builders inside PrimeVue Dialog (transform breaks HTML5 DnD). */
export const DIALOG_SORTABLE_ATTRS = {
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 3,
  swapThreshold: 0.65,
  /** No list animation — easing makes the forceFallback clone lag behind a fast cursor. */
  animation: 0,
  onStart() {
    document.body.classList.add('builder-sortable-dragging')
    window.getSelection()?.removeAllRanges()
  },
  onEnd() {
    document.body.classList.remove('builder-sortable-dragging')
    window.getSelection()?.removeAllRanges()
  },
} as const
