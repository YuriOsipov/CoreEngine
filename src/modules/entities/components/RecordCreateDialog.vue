<script lang="ts">
export default {
  name: 'RecordCreateDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import FormRenderer from './FormRenderer.vue'
import type { EntityLayoutSchema, FieldDefinition } from '@/interfaces'
import { createObjectRecord } from '../services/recordDetails'
import {
  createLayoutSchema,
  isCreateDialogField,
  buildDefaultDraft,
  applyParentFieldDefaults,
  collectDefaultFromParentSources,
  enrichParentRecordForFieldDefaults,
  resolveDefaultFromParentDefinitions,
} from '@/core/entityLayoutUtils'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import { buildWritableFormPayload } from '@/core/entityFormPayload'
import {
  useTranslatedCollection,
  useTranslation,
} from '@/core/translation'

const props = defineProps<{
  visible: boolean
  collection: string
  parentField?: string
  parentId?: string | number
  parentCollection?: string
  parentRecord?: Record<string, unknown>
  initialValues?: Record<string, unknown>
  readonlyFields?: string[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  created: [record: Record<string, unknown>]
}>()

const { t } = useTranslation()
const toast = useToast()
const layoutSchema = ref<EntityLayoutSchema | null>(null)
const formDraft = ref<Record<string, unknown>>({})
const formRendererRef = ref<{ validateRequired: () => { valid: boolean; missingLabels: string[] } } | null>(
  null,
)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
let loadToken = 0
const collectionLabel = useTranslatedCollection(() => props.collection)

const editLayoutSchema = computed<EntityLayoutSchema | null>(() => {
  if (!layoutSchema.value) return null

  return {
    ...layoutSchema.value,
    sections: layoutSchema.value.sections.map((section) => ({
      ...section,
      groups: section.groups
        .map((group) => ({
          ...group,
          fields: group.fields.filter(isCreateDialogField),
        }))
        .filter((group) => group.fields.length > 0),
    })),
  }
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    void prepareDialog()
  },
  { immediate: true },
)

async function prepareDialog(): Promise<void> {
  const token = ++loadToken
  loading.value = true
  saving.value = false
  error.value = null
  layoutSchema.value = null
  formDraft.value = initialDefaults()

  const collection = props.collection?.trim()
  if (!collection) {
    error.value = t(
      'recordCreate.noSavedDetailLayout',
      'No saved detail layout found for "{collection}".',
      { collection: collectionLabel.value || '—' },
    )
    loading.value = false
    return
  }

  try {
    const { blockLayout: schema } = await resolvePreferredBlockLayoutForCurrentUser(
      collection,
    )
    if (token !== loadToken) return

    if (!schema?.sections?.length) {
      error.value = t(
        'recordCreate.noSavedDetailLayout',
        'No saved detail layout found for "{collection}".',
        { collection: collectionLabel.value },
      )
      return
    }

    const createSchema = createLayoutSchema(schema)
    const definitions = await resolveDefaultFromParentDefinitions(
      collection,
      (await getCachedCollectionFields(collection)) as unknown as FieldDefinition[],
    )
    // Parent defaults only on create (this dialog), never on edit.
    const parentForDefaults = await enrichParentRecordForFieldDefaults(
      props.parentRecord,
      {
        parentCollection: props.parentCollection,
        parentId: props.parentId,
        sourceFields: collectDefaultFromParentSources(
          definitions,
          props.parentField,
        ),
      },
    )
    formDraft.value = applyParentFieldDefaults(
      definitions,
      parentForDefaults,
      {
        ...(await buildDefaultDraft(createSchema, collection)),
        ...initialDefaults(),
        ...parentDefaults(),
      },
      createSchema,
      props.parentField,
    )
    layoutSchema.value = createSchema
  } catch (err) {
    if (token !== loadToken) return
    error.value =
      err instanceof Error
        ? err.message
        : t('recordCreate.failedLoad', 'Failed to load create form.')
  } finally {
    if (token === loadToken) {
      loading.value = false
    }
  }
}

function updateVisible(visible: boolean): void {
  if (saving.value && !visible) return
  emit('update:visible', visible)
  if (!visible) {
    error.value = null
  }
}

async function saveRecord(): Promise<void> {
  if (!editLayoutSchema.value) return

  const validation = formRendererRef.value?.validateRequired()
  if (validation && !validation.valid) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: t('formRenderer.missingRequiredFields', 'Required fields are missing: {fields}', {
        fields: validation.missingLabels.join(', '),
      }),
      life: 5000,
    })
    return
  }

  saving.value = true
  error.value = null

  try {
    const created = await createObjectRecord(
      props.collection,
      {
        ...initialDefaults(),
        ...parentDefaults(),
        ...(await buildWritableFormPayload(
          props.collection,
          editLayoutSchema.value,
          formDraft.value,
        )),
      },
    )
    emit('created', created)
    emit('update:visible', false)
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('recordCreate.failedCreate', 'Failed to create record.')
  } finally {
    saving.value = false
  }
}

function initialDefaults(): Record<string, unknown> {
  return props.initialValues ? { ...props.initialValues } : {}
}

function parentDefaults(): Record<string, unknown> {
  if (
    !props.parentField ||
    props.parentId === undefined ||
    props.parentId === null
  ) {
    return {}
  }

  return {
    [props.parentField]: props.parentId,
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    append-to="body"
    :header="t('recordCreate.header', 'New {collection}', { collection: collectionLabel })"
    :style="{ width: 'min(960px, 95vw)' }"
    @update:visible="updateVisible"
  >
    <div v-if="loading" class="page-loading">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('recordCreate.loading', 'Loading create form...') }}</span>
    </div>

    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="collections-message"
    >
      {{ error }}
    </Message>

    <FormRenderer
      v-if="editLayoutSchema && !loading"
      ref="formRendererRef"
      v-model="formDraft"
      :schema="editLayoutSchema"
      :parent-id="parentId"
      :parent-name="parentField"
      :parent-collection="parentCollection"
      :parent-record="parentRecord"
      :readonly-fields="readonlyFields"
    />

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        :disabled="saving"
        @click="updateVisible(false)"
      />
      <Button
        :label="t('common.save', 'Save')"
        :loading="saving"
        :disabled="loading || !editLayoutSchema"
        @click="saveRecord"
      />
    </template>
  </Dialog>
</template>
