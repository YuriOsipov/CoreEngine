<script lang="ts">
export default {
  name: 'DocEditorHost',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useAttrs, watch } from 'vue'
import { createEditor } from '@docengine/editor'
import { createDatePickerCallbacks } from '@docengine/field-date'
import '@/core/docengine/registerDocEngineFields'
import '@docengine/editor/styles.css'
import '@docengine/editor/themes/bridge.css'
import '@docengine/editor/themes/prime.css'
import '@/core/styles/doc-editor-theme.css'
import type { ImageValue } from '@/core/fileImageValue'
import type { FieldMappingSpec } from '@/modules/documents/services/docFieldMapping'
import {
  loadRemoteListCollectionCatalog,
  listRemoteListLabelFields,
  resolveDocRemoteListItems,
} from '@/modules/documents/services/docRemoteListItems'
import { openDocImagePicker } from '@/modules/documents/composables/useDocImagePicker'
import DocImagePickerDialog from '@/modules/documents/components/DocImagePickerDialog.vue'

type DocEditorInstance = ReturnType<typeof createEditor>

const datePickers = createDatePickerCallbacks()

const props = withDefaults(
  defineProps<{
    designMode?: boolean
    initialData?: Record<string, unknown> | null
    catalogs?: Record<string, unknown>
    showDocumentActions?: boolean
    collection?: string
    recordId?: string
  }>(),
  {
    designMode: false,
    initialData: null,
    catalogs: () => ({ lists: {}, trees: {} }),
    showDocumentActions: true,
    collection: '',
    recordId: '',
  },
)

const attrs = useAttrs()
const mountEl = ref<HTMLElement | null>(null)
const editorInstance = shallowRef<DocEditorInstance | null>(null)
const ready = ref(false)
let designModeSwitchSeq = 0
let mountGeneration = 0

function clearMount(): void {
  const mount = mountEl.value
  if (mount) mount.replaceChildren()
}

/**
 * createEditor resolves modal parents via `[role="dialog"]`. PrimeVue Dialog
 * matches that and is Vue-owned — mounting overlays into it crashes VDOM
 * patching (`nextSibling` of null). Temporarily clear roles during create.
 */
function withoutDialogRoles<T>(from: HTMLElement, run: () => T): T {
  const restored: Array<{ el: Element; role: string }> = []
  let el: Element | null = from
  while (el) {
    const role = el.getAttribute('role')
    if (role === 'dialog' || role === 'alertdialog') {
      restored.push({ el, role })
      el.removeAttribute('role')
    }
    el = el.parentElement
  }
  try {
    return run()
  } finally {
    for (const entry of restored) {
      entry.el.setAttribute('role', entry.role)
    }
  }
}

async function mountEditor(): Promise<void> {
  const mount = mountEl.value
  if (!mount) return

  const generation = ++mountGeneration
  editorInstance.value?.destroy()
  editorInstance.value = null
  ready.value = false
  clearMount()

  await nextTick()
  if (generation !== mountGeneration || !mountEl.value) return

  // Imperative holder so Vue never reconciles nodes that createEditor relocates.
  const holder = document.createElement('div')
  holder.className =
    'editor-holder flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-surface-200'
  mountEl.value.appendChild(holder)

  const editor = withoutDialogRoles(holder, () =>
    createEditor({
      holder,
      designMode: props.designMode,
      catalogs: props.catalogs as never,
      remoteListCollections: loadRemoteListCollectionCatalog,
      remoteListLabelFields: listRemoteListLabelFields,
      resolveListItems: resolveDocRemoteListItems,
      pickers: {
        ...datePickers,
        openImagePicker: (opts: { title: string; value: ImageValue }) =>
          openDocImagePicker({
            title: opts.title,
            value: opts.value,
            collection: props.collection || undefined,
            recordId: props.recordId || undefined,
          }),
      },
      ui: {
        designLayout: 'panels',
        documentActions: props.showDocumentActions,
      },
      data: props.initialData
        ? (props.initialData as never)
        : {
            time: Date.now(),
            fieldSchemas: {},
            blocks: [],
          },
    }),
  )

  if (generation !== mountGeneration) {
    editor.destroy()
    return
  }

  editorInstance.value = editor
  await editor.ready
  if (generation !== mountGeneration || editorInstance.value !== editor) return
  ready.value = true
}

onMounted(() => {
  void mountEditor()
})

onBeforeUnmount(() => {
  mountGeneration += 1
  designModeSwitchSeq += 1
  document.body.classList.remove('design-mode', 'design-mode--panels')
  editorInstance.value?.destroy()
  editorInstance.value = null
  clearMount()
})

watch(
  () => props.designMode,
  async (enabled) => {
    const editor = editorInstance.value
    if (!editor) return

    const seq = ++designModeSwitchSeq
    try {
      await editor.ready
      if (seq !== designModeSwitchSeq || editorInstance.value !== editor) return
      await editor.setDesignMode(enabled)
    } catch {
      // Ignore aborted / mid-destroy switches.
    }
  },
)

async function whenReady(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (editorInstance.value) {
      await editorInstance.value.ready
      ready.value = true
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Editor is not ready.')
}

async function load(data: Record<string, unknown>): Promise<void> {
  await whenReady()
  await editorInstance.value!.load(data as never)
}

async function exportTemplate(): Promise<Record<string, unknown>> {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  return (await editorInstance.value.exportTemplate()) as unknown as Record<string, unknown>
}

async function exportFields(options?: {
  omitMappedFields?: boolean
  hideEmptyValues?: boolean
}): Promise<Record<string, unknown>> {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  return (await editorInstance.value.exportFields(options ?? {})) as unknown as Record<string, unknown>
}

async function exportDoc(): Promise<Record<string, unknown>> {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  return (await editorInstance.value.exportDoc()) as unknown as Record<string, unknown>
}

async function validate(): Promise<{ valid: boolean; missing: Array<{ fieldId: string; label: string }> }> {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  return editorInstance.value.validate()
}

async function exportPdf(filename?: string): Promise<void> {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  await editorInstance.value.exportPdf({ filename: filename ?? 'document.pdf' })
}

async function preview(options?: { hideEmptyValues?: boolean }): Promise<void> {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  await editorInstance.value.preview(options)
}

function getFieldMapping(): FieldMappingSpec | null {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  return editorInstance.value.getFieldMapping() as FieldMappingSpec | null
}

function setFieldMapping(spec: FieldMappingSpec | null): void {
  if (!editorInstance.value) {
    throw new Error('Editor is not ready.')
  }
  editorInstance.value.setFieldMapping(spec)
}

async function openFieldMapping(
  options?: { spec?: FieldMappingSpec },
): Promise<FieldMappingSpec> {
  await whenReady()
  return (await editorInstance.value!.openFieldMapping(options)) as FieldMappingSpec
}

defineExpose({
  load,
  exportTemplate,
  exportFields,
  exportDoc,
  validate,
  exportPdf,
  preview,
  getFieldMapping,
  setFieldMapping,
  openFieldMapping,
  whenReady,
  ready,
})
</script>

<template>
  <div
    class="doc-editor-host flex min-h-0 flex-1 flex-col overflow-hidden"
    v-bind="attrs"
  >
    <div
      ref="mountEl"
      class="doc-editor-host__mount flex min-h-0 flex-1 flex-col overflow-hidden"
    />
    <DocImagePickerDialog />
  </div>
</template>
