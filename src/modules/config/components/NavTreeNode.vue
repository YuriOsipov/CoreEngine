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

const props = defineProps<{
  item: NavItem
  depth: number
}>()

const emit = defineEmits<{
  edit: [item: NavItem]
  remove: [item: NavItem]
}>()

const { t } = useTranslation()

const folder = computed<NavFolder | null>(() =>
  props.item.type === 'folder' ? props.item : null,
)
const canNestFolder = computed(() => props.depth < NAV_MAX_DEPTH)

function removeChild(child: NavItem): void {
  const current = folder.value
  if (!current) return
  current.children = current.children.filter((entry) => entry.id !== child.id)
}

function addLink(): void {
  const current = folder.value
  if (!current) return
  const link = createNavLink()
  current.children.push(link)
  emit('edit', link)
}

function addFolder(): void {
  const current = folder.value
  if (!current) return
  const child = createNavFolder()
  current.children.push(child)
  emit('edit', child)
}
</script>

<template>
  <div class="nav-node">
    <div class="nav-node__row">
      <i
        class="pi pi-bars nav-node__handle"
        :aria-label="t('navigation.dragToReorder', 'Drag to reorder')"
      />
      <i :class="item.type === 'folder' ? 'pi pi-folder' : 'pi pi-link'" />
      <span class="nav-node__label">
        {{ item.label || t('navigation.untitledItem', 'Untitled') }}
      </span>
      <Button
        icon="pi pi-pencil"
        text
        rounded
        size="small"
        :aria-label="t('common.edit', 'Edit')"
        @click="emit('edit', item)"
      />
      <Button
        icon="pi pi-trash"
        text
        rounded
        severity="danger"
        size="small"
        :aria-label="t('common.delete', 'Delete')"
        @click="emit('remove', item)"
      />
    </div>

    <div v-if="folder" class="nav-node__children">
      <VueDraggableNext
        :list="folder.children"
        :group="{ name: 'nav' }"
        handle=".nav-node__handle"
        item-key="id"
        class="nav-node__dropzone"
      >
        <NavTreeNode
          v-for="child in folder.children"
          :key="child.id"
          :item="child"
          :depth="depth + 1"
          @edit="emit('edit', $event)"
          @remove="removeChild($event)"
        />
      </VueDraggableNext>

      <div class="nav-node__add">
        <Button
          icon="pi pi-plus"
          :label="t('navigation.addLink', 'Add link')"
          text
          size="small"
          @click="addLink"
        />
        <Button
          v-if="canNestFolder"
          icon="pi pi-folder-plus"
          :label="t('navigation.addFolder', 'Add folder')"
          text
          size="small"
          @click="addFolder"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.nav-node__dropzone {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0.5rem;
}

.nav-node__add {
  display: flex;
  gap: 0.5rem;
}
</style>
