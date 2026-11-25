<script lang="ts">
export default {
  name: 'NavTreeNode',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import { useTranslation } from '@/core/translation'
import { NAV_MAX_DEPTH, type NavFolder, type NavItem } from '@/interfaces'
import { createNavFolder, createNavLink } from './navigationItemFactory'
import {
  createNavTreeSortableAttrs,
  onNavTreeDragEnd,
  onNavTreeDragStart,
} from './navTreeSortable'

const props = defineProps<{
  /** Mutable list owned by the parent (root app.items or a folder.children). */
  items: NavItem[]
  depth: number
}>()

const emit = defineEmits<{
  edit: [item: NavItem]
}>()

const { t } = useTranslation()

const sortableAttrs = createNavTreeSortableAttrs()
const canNestFolder = computed(() => props.depth < NAV_MAX_DEPTH)

function removeItem(item: NavItem): void {
  const index = props.items.findIndex((entry) => entry.id === item.id)
  if (index >= 0) props.items.splice(index, 1)
}

function moveItem(item: NavItem, delta: -1 | 1): void {
  const from = props.items.findIndex((entry) => entry.id === item.id)
  if (from < 0) return
  const to = from + delta
  if (to < 0 || to >= props.items.length) return
  const [moved] = props.items.splice(from, 1)
  props.items.splice(to, 0, moved)
}

function addLink(folder: NavFolder): void {
  const link = createNavLink()
  folder.children.push(link)
  // Defer so Sortable finishes its pointer cycle before the dialog opens.
  queueMicrotask(() => emit('edit', link))
}

function addFolder(folder: NavFolder): void {
  const child = createNavFolder()
  folder.children.push(child)
  queueMicrotask(() => emit('edit', child))
}

/** Prefer pointerdown — Sortable forceFallback can swallow click. */
function onEdit(event: Event, item: NavItem): void {
  event.preventDefault()
  event.stopPropagation()
  emit('edit', item)
}

function onMove(event: Event, item: NavItem, delta: -1 | 1): void {
  event.preventDefault()
  event.stopPropagation()
  moveItem(item, delta)
}

function onRemove(event: Event, item: NavItem): void {
  event.preventDefault()
  event.stopPropagation()
  removeItem(item)
}

function onAddLink(event: Event, folder: NavFolder): void {
  event.preventDefault()
  event.stopPropagation()
  addLink(folder)
}

function onAddFolder(event: Event, folder: NavFolder): void {
  event.preventDefault()
  event.stopPropagation()
  addFolder(folder)
}
</script>

<template>
  <!--
    Direct children of VueDraggableNext MUST be plain DOM nodes.
    Recursive Vue components as Sortable children break reorder in vue-draggable-next.
  -->
  <VueDraggableNext
    :list="items"
    v-bind="sortableAttrs"
    class="nav-tree-list"
    @start="onNavTreeDragStart"
    @end="onNavTreeDragEnd"
  >
    <div
      v-for="(element, index) in items"
      :key="element.id"
      class="nav-node"
    >
      <div class="nav-node__row">
        <i
          class="pi pi-bars nav-node__handle"
          :aria-label="t('navigation.dragToReorder', 'Drag to reorder')"
        />
        <i :class="element.type === 'folder' ? 'pi pi-folder' : 'pi pi-link'" />
        <button
          type="button"
          class="nav-node__label"
          :title="t('common.edit', 'Edit')"
          @pointerdown.stop.prevent="onEdit($event, element)"
        >
          {{ element.label || t('navigation.untitledItem', 'Untitled') }}
        </button>
        <div
          class="nav-node__actions"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="nav-node__action"
            :disabled="index === 0"
            :aria-label="t('navigation.moveUp', 'Move up')"
            @pointerdown.stop.prevent="onMove($event, element, -1)"
          >
            <i class="pi pi-arrow-up" />
          </button>
          <button
            type="button"
            class="nav-node__action"
            :disabled="index >= items.length - 1"
            :aria-label="t('navigation.moveDown', 'Move down')"
            @pointerdown.stop.prevent="onMove($event, element, 1)"
          >
            <i class="pi pi-arrow-down" />
          </button>
          <button
            type="button"
            class="nav-node__action"
            :aria-label="t('common.edit', 'Edit')"
            @pointerdown.stop.prevent="onEdit($event, element)"
          >
            <i class="pi pi-pencil" />
          </button>
          <button
            type="button"
            class="nav-node__action nav-node__action--danger"
            :aria-label="t('common.delete', 'Delete')"
            @pointerdown.stop.prevent="onRemove($event, element)"
          >
            <i class="pi pi-trash" />
          </button>
        </div>
      </div>

      <div
        v-if="element.type === 'folder'"
        class="nav-node__children"
      >
        <NavTreeNode
          :items="element.children"
          :depth="depth + 1"
          @edit="emit('edit', $event)"
        />

        <div
          class="nav-node__add"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="nav-node__add-btn"
            @pointerdown.stop.prevent="onAddLink($event, element)"
          >
            <i class="pi pi-plus" />
            {{ t('navigation.addLink', 'Add link') }}
          </button>
          <button
            v-if="canNestFolder"
            type="button"
            class="nav-node__add-btn"
            @pointerdown.stop.prevent="onAddFolder($event, element)"
          >
            <i class="pi pi-folder-plus" />
            {{ t('navigation.addFolder', 'Add folder') }}
          </button>
        </div>
      </div>
    </div>
  </VueDraggableNext>
</template>

<style scoped>
.nav-tree-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0.5rem;
}

.nav-node {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.nav-node__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--app-border, var(--p-content-border-color, #e5e7eb));
  border-radius: 6px;
  background: var(--app-panel, var(--p-content-background, #fff));
  color: var(--app-text, var(--p-text-color));
  min-width: 0;
}

.nav-node__handle {
  flex: 0 0 auto;
  cursor: grab;
  color: var(--p-text-muted-color, #9ca3af);
  touch-action: none;
}

.nav-node__handle:active {
  cursor: grabbing;
}

.nav-node__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.nav-node__label:hover {
  color: var(--p-primary-color, #10b981);
}

.nav-node__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.1rem;
  margin-left: auto;
}

.nav-node__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--p-text-muted-color, #6b7280);
  cursor: pointer;
}

.nav-node__action:hover:not(:disabled) {
  background: var(--p-surface-100, #f3f4f6);
  color: var(--p-text-color, #1f2937);
}

.nav-node__action:disabled {
  opacity: 0.35;
  cursor: default;
}

.nav-node__action--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 12%, transparent);
  color: var(--p-red-500, #ef4444);
}

.nav-node__children {
  margin-left: 1.25rem;
  padding-left: 0.75rem;
  border-left: 1px dashed var(--p-surface-300, #d1d5db);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.nav-node__add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.nav-node__add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: none;
  background: transparent;
  color: var(--p-primary-color, #10b981);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.15rem 0.25rem;
}

.nav-node__add-btn:hover {
  text-decoration: underline;
}

:deep(.nav-node--ghost) {
  opacity: 0.45;
}

:deep(.nav-node--drag) {
  opacity: 0.95;
}
</style>
