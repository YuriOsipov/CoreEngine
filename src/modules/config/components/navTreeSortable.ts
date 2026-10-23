/**
 * Sortable options for nested navigation lists.
 *
 * - Direct Sortable children must be plain DOM nodes (not Vue components).
 * - `filter: .nav-node__children` stops a parent row drag when the pointer
 *   starts inside a nested list; `preventOnFilter: false` lets the nested
 *   Sortable still handle the event.
 * - `forceFallback` + `dragoverBubble` are required for nested lists inside
 *   scrollable app shells (HTML5 DnD otherwise fails to hit nested targets).
 * - `group` must be a fresh object per list instance (Sortable mutates it).
 */
export function createNavTreeSortableAttrs() {
  return {
    group: { name: 'nav' },
    handle: '.nav-node__handle',
    filter: '.nav-node__children',
    preventOnFilter: false,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 3,
    dragoverBubble: true,
    swapThreshold: 0.65,
    emptyInsertThreshold: 12,
    animation: 200,
    ghostClass: 'nav-node--ghost',
    dragClass: 'nav-node--drag',
  }
}

export function onNavTreeDragStart(): void {
  document.body.classList.add('builder-sortable-dragging')
  window.getSelection()?.removeAllRanges()
}

export function onNavTreeDragEnd(): void {
  document.body.classList.remove('builder-sortable-dragging')
  window.getSelection()?.removeAllRanges()
}
