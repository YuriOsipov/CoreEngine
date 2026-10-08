<script lang="ts">

export default {

  name: 'SetupLayoutEditorDialog',

}

</script>



<script setup lang="ts">

import { computed, ref, toRef, watch } from 'vue'
import { useToast } from 'primevue/usetoast'

import EntityBuilderPanel from '../builder/EntityBuilderPanel.vue'

import EntityCompactBuilderPanel from '../builder/EntityCompactBuilderPanel.vue'

import SchedulerBuilderPanel from '../builder/SchedulerBuilderPanel.vue'

import TableBuilderPanel from '../builder/TableBuilderPanel.vue'

import TreeBuilderPanel from '../builder/TreeBuilderPanel.vue'

import DocumentBuilderPanel from '../builder/DocumentBuilderPanel.vue'

import RecordPageBuilderPanel from '../builder/RecordPageBuilderPanel.vue'

import { useEntityLayoutBuilder } from '../../composables/useEntityLayoutBuilder'

import { useTranslation, useTranslatedCollection } from '@/core/translation'
import { pickUnusedRoleId } from '@/core/settingRoleUtils'
import { clearMetadataCache } from '@/modules/entities/services/collectionSchema'

import {

  isEntityBuilderMode,

  type BuilderMode,

} from '../../types/builderMode'

import {

  setupLayoutTypeDefaultLabel,

  setupLayoutTypeLabelKey,

} from '../../types/setupLayoutType'



const props = withDefaults(
  defineProps<{
    visible: boolean
    collection: string
    layoutType: BuilderMode
    layoutId?: string | null
    forceListPayloadSample?: boolean
    listSourceContext?: {
      viewLabel?: string | null
      filter?: Record<string, unknown> | null
      filterConditions?: Array<{
        id: string
        field: string
        operator: string
        value: unknown
        type?: string
        userVisible?: boolean
        fieldWidth?: number
      }> | null
      parentCollection?: string | null
    } | null
  }>(),
  {
    layoutId: null,
    forceListPayloadSample: false,
    listSourceContext: null,
  },
)



const emit = defineEmits<{

  'update:visible': [value: boolean]

  saved: []

}>()



const { t } = useTranslation()
const toast = useToast()

const collectionLabel = useTranslatedCollection(() => props.collection)

const collectionRef = toRef(props, 'collection')

const builderMode = computed(() => props.layoutType)

const tableStatus = ref<string | null>(null)

const tableError = ref<string | null>(null)

const initializing = ref(false)

/** Wait for Dialog enter transition before mounting editor DOM (avoids nextSibling crash). */
const shellReady = ref(false)



const {

  layoutSchema,

  layoutLoading,

  layoutSaving,

  compactSaving,

  formDeleting,

  layoutStatus,

  layoutError,

  entityForms,

  roleOptions,

  selectedFormId,

  formName,

  formRoleId,

  loadLayoutForCollection,

  selectEntityForm,

  createEntityForm,

  deleteSelectedEntityForm,

  saveLayout,

  saveCompactDetails,

} = useEntityLayoutBuilder(collectionRef, builderMode)



/** Compact builders (no canvas) — size to content instead of 95vh. */
const isCompactDialog = computed(
  () => props.layoutType === 'tree' || props.layoutType === 'scheduler',
)

const dialogStyle = computed(() => {
  if (props.layoutType === 'table') {
    return { width: '80vw', height: '88vh' }
  }
  if (!isCompactDialog.value) {
    return { width: '95vw', height: '95vh' }
  }
  // Scheduler needs more width for multi-field rows; tree stays tighter.
  // Fixed height keeps the window stable across scheduler tabs.
  if (props.layoutType === 'scheduler') {
    return {
      width: 'min(1200px, 88vw)',
      height: 'min(860px, 88vh)',
    }
  }
  return { width: 'min(720px, 92vw)' }
})

const dialogContentStyle = computed(() => {
  if (props.layoutType === 'table') {
    return {
      height: 'calc(88vh - 3.5rem)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
      paddingTop: '0.25rem',
    }
  }
  if (!isCompactDialog.value) {
    return {
      height: 'calc(95vh - 3.5rem)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
      paddingTop: '0.25rem',
    }
  }
  if (props.layoutType === 'scheduler') {
    return {
      height: 'calc(min(860px, 88vh) - 3.5rem)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
      paddingTop: '0.25rem',
    }
  }
  return {
    overflowX: 'hidden',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    paddingTop: '0.25rem',
    maxHeight: 'calc(90vh - 3.5rem)',
  }
})

const dialogTitle = computed(() =>
  t(
    setupLayoutTypeLabelKey(props.layoutType),
    setupLayoutTypeDefaultLabel(props.layoutType),
  ),
)

const entityLayoutLabel = computed(() =>
  props.layoutType === 'entityCompact'
    ? t('layoutRole.entityCompactLayout', 'Entity compact layout')
    : t('layoutRole.entityLayout', 'Block layout'),
)

/** Single-line dialog heading: layout kind + object, e.g. "Block layout (Visit)". */
const dialogHeading = computed(() => {
  const layoutPart = isEntityBuilderMode(props.layoutType)
    ? entityLayoutLabel.value
    : singularLayoutLabel(dialogTitle.value)
  const objectPart = collectionLabel.value || props.collection
  return t('setup.editorHeading', '{layout} ({object})', {
    layout: layoutPart,
    object: objectPart,
  })
})

function singularLayoutLabel(label: string): string {
  return label
    .replace(/\s+Layouts$/i, ' layout')
    .replace(/\s+Views$/i, ' view')
    .replace(/\s+Templates$/i, ' template')
}
const feedbackError = computed(() => {

  if (['table', 'tree', 'scheduler', 'document', 'recordPage'].includes(props.layoutType)) return tableError.value

  if (isEntityBuilderMode(props.layoutType)) return layoutError.value

  return null

})



const feedbackStatus = computed(() => {

  if (['table', 'tree', 'scheduler', 'document', 'recordPage'].includes(props.layoutType)) return tableStatus.value

  if (isEntityBuilderMode(props.layoutType)) return layoutStatus.value

  return null

})

watch(
  [feedbackStatus, feedbackError],
  ([status, error]) => {
    if (error) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: error,
        life: 6000,
      })
    } else if (status) {
      toast.add({
        severity: 'success',
        summary: status,
        life: 3500,
      })
    } else {
      return
    }
    tableStatus.value = null
    tableError.value = null
    layoutStatus.value = null
    layoutError.value = null
  },
)



const panelKey = computed(

  () => `${props.collection}-${props.layoutType}-${props.layoutId ?? 'new'}`,

)



async function initializeEditorState(): Promise<void> {

  if (!props.visible || !props.collection) return

  clearMetadataCache()

  initializing.value = true

  tableStatus.value = null

  tableError.value = null



  try {

    if (isEntityBuilderMode(props.layoutType)) {

      layoutError.value = null

      await loadLayoutForCollection(props.collection)



      if (props.layoutId) {

        await selectEntityForm(props.layoutId)

      } else {

        createEntityForm()

        layoutError.value = null

        formRoleId.value = props.layoutType === 'entity'
          ? null
          : pickUnusedRoleId(entityForms.value, roleOptions.value)

      }

    }

  } finally {

    initializing.value = false

  }

}



watch(

  () => [props.visible, props.collection, props.layoutType, props.layoutId] as const,

  () => {

    if (props.visible) {

      void initializeEditorState()

    } else {

      shellReady.value = false

    }

  },

)



function handleDialogShow(): void {

  shellReady.value = true

}



function closeDialog(): void {

  emit('update:visible', false)

}



async function handleEntitySave(): Promise<void> {

  if (props.layoutType === 'entityCompact') {

    await saveCompactDetails()

  } else {

    await saveLayout()

  }



  if (!layoutError.value) {

    emit('saved')

    closeDialog()

  }

}



function handleTableStatus(message: string | null): void {

  tableStatus.value = message

  if (message) {

    emit('saved')

    if (props.layoutType !== 'document') {

      closeDialog()

    }

  }

}

function handleDocumentSaved(): void {

  emit('saved')

}



function handleTableError(message: string | null): void {

  tableError.value = message

}

</script>



<template>

  <Dialog

    :visible="visible"

    modal

    maximizable

    class="setup-editor-dialog"
    :class="{
      'setup-editor-dialog--compact': isCompactDialog,
      'setup-editor-dialog--fixed': layoutType === 'scheduler' || layoutType === 'table',
    }"
    :style="dialogStyle"
    :content-style="dialogContentStyle"
    @show="handleDialogShow"
    @update:visible="emit('update:visible', $event)"
  >

    <template #header>
      <div class="setup-editor-dialog__header">
        <h2 class="setup-editor-dialog__title">
          {{ dialogHeading }}
        </h2>
      </div>
    </template>


    <div

      v-if="!shellReady || (initializing && isEntityBuilderMode(layoutType))"

      class="page-loading"

    >

      <ProgressSpinner stroke-width="4" />

      <span>{{ t('setup.loadingEditor', 'Loading editor...') }}</span>

    </div>



    <div

      v-else

      class="setup-editor-dialog__workspace"

    >

      <section class="setup-editor-dialog__builder">

        <RecordPageBuilderPanel

          v-if="layoutType === 'recordPage'"

          :key="panelKey"

          :collection="collection"

          :initial-layout-id="layoutId"

          :create-new="!layoutId"

          setup-mode

          @status="handleTableStatus"

          @error="handleTableError"

        />



        <EntityBuilderPanel

          v-else-if="layoutType === 'entity'"

          :key="panelKey"

          v-model:schema="layoutSchema"

          v-model:layout-name="formName"

          v-model:layout-role-id="formRoleId"

          :collection="collection"

          :layout-label="entityLayoutLabel"

          :loading="layoutLoading"

          :saving="layoutSaving"

          :deleting="formDeleting"

          :layouts="entityForms"

          :selected-layout-id="selectedFormId"

          :role-options="roleOptions"

          setup-mode

          @layout-selected="selectEntityForm"

          @new-layout="createEntityForm"

          @save-layout="handleEntitySave"

          @delete-layout="deleteSelectedEntityForm"

        />



        <EntityCompactBuilderPanel

          v-else-if="layoutType === 'entityCompact'"

          :key="panelKey"

          v-model:schema="layoutSchema"

          v-model:layout-name="formName"

          v-model:layout-role-id="formRoleId"

          :collection="collection"

          :layout-label="entityLayoutLabel"

          :loading="layoutLoading"

          :saving="compactSaving"

          :deleting="formDeleting"

          :layouts="entityForms"

          :selected-layout-id="selectedFormId"

          :role-options="roleOptions"

          setup-mode

          @layout-selected="selectEntityForm"

          @new-layout="createEntityForm"

          @save-layout="handleEntitySave"

          @delete-layout="deleteSelectedEntityForm"

        />



        <TableBuilderPanel

          v-else-if="layoutType === 'table'"

          :key="panelKey"

          :collection="collection"

          :initial-view-id="layoutId"

          :create-new="!layoutId"

          setup-mode

          @status="handleTableStatus"

          @error="handleTableError"

        />



        <TreeBuilderPanel

          v-else-if="layoutType === 'tree'"

          :key="panelKey"

          :collection="collection"

          :initial-layout-id="layoutId"

          :create-new="!layoutId"

          setup-mode

          @status="handleTableStatus"

          @error="handleTableError"

        />



        <SchedulerBuilderPanel

          v-else-if="layoutType === 'scheduler'"

          :key="panelKey"

          :collection="collection"

          :initial-layout-id="layoutId"

          :create-new="!layoutId"

          setup-mode

          @status="handleTableStatus"

          @error="handleTableError"

        />



        <DocumentBuilderPanel
          v-else-if="layoutType === 'document'"
          :key="panelKey"
          :collection="collection"
          :initial-layout-id="layoutId"
          :create-new="!layoutId"
          setup-mode
          :force-list-payload-sample="props.forceListPayloadSample"
          :list-source-context="props.listSourceContext"
          @status="handleTableStatus"
          @error="handleTableError"
          @saved="handleDocumentSaved"
        />

      </section>

    </div>

  </Dialog>

</template>


