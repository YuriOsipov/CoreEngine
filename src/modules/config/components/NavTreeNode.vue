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
  emit('edit', link)
}

function addFolder(folder: NavFolder): void {
  const child = createNavFolder()
  folder.children.push(child)
  emit('edit', child)
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
        <span class="nav-node__label">
          {{ element.label || t('navigation.untitledItem', 'Untitled') }}
        </span>
        <Button
          icon="pi pi-arrow-up"
          text
          rounded
          size="small"
          :disabled="index === 0"
          :aria-label="t('navigation.moveUp', 'Move up')"
          @click="moveItem(element, -1)"
        />
        <Button
          icon="pi pi-arrow-down"
          text
          rounded
          size="small"
          :disabled="index >= items.length - 1"
          :aria-label="t('navigation.moveDown', 'Move down')"
          @click="moveItem(element, 1)"
        />
        <Button
          icon="pi pi-pencil"
          text
          rounded
          size="small"
          :aria-label="t('common.edit', 'Edit')"
          @click="emit('edit', element)"
        />
        <Button
          icon="pi pi-trash"
          text
          rounded
          severity="danger"
          size="small"
          :aria-label="t('common.delete', 'Delete')"
          @click="removeItem(element)"
        />
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

        <div class="nav-node__add">
          <Button
            icon="pi pi-plus"
            :label="t('navigation.addLink', 'Add link')"
            text
            size="small"
            @click="addLink(element)"
          />
          <Button
            v-if="canNestFolder"
            icon="pi pi-folder-plus"
            :label="t('navigation.addFolder', 'Add folder')"
            text
            size="small"
            @click="addFolder(element)"
          />
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
  border: 1px solid var(--p-surface-200, #e5e7eb);
  border-radius: 6px;
  background: var(--p-surface-0, #fff);
}

.nav-node__handle {
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
  gap: 0.5rem;
}

:deep(.nav-node--ghost) {
  opacity: 0.45;
}

:deep(.nav-node--drag) {
  opacity: 0.95;
}
</style>
