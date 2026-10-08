import { computed, ref, watch, type Ref } from 'vue'
import type { EntityLayoutSchema, LayoutFieldMetadata } from '@/interfaces'
import { DuplicateRoleScopedLayoutError } from '@/core/settingRoleUtils'
import { useTranslation } from '@/core/translation'
import { buildFormStateFromSchema } from '@/modules/entities/utils/fieldDefaults'
import {
  buildCompactDetailsSchema,
  type CompactRecordDetailsSchema,
  deleteCompactLayout,
  deleteEntityForm,
  DuplicateEntityFormRoleError,
  loadCompactLayoutById,
  loadCompactLayouts,
  loadEntityForms,
  loadEntityLayoutById,
  saveCompactRecordDetailsSetting,
  saveEntityLayoutSetting,
} from '../services/layoutSettings'
import { useRoleScopedLayout } from './useRoleScopedLayout'
import { isEntityBuilderMode, type BuilderMode } from '../types/builderMode'

export function useEntityLayoutBuilder(
  collection: Ref<string>,
  builderMode: Ref<BuilderMode>,
) {
  const { t } = useTranslation()
  const formData = ref<Record<string, unknown>>({})
  const layoutSaving = ref(false)
  const compactSaving = ref(false)
  const layoutStatus = ref<string | null>(null)
  const layoutError = ref<string | null>(null)
  const compactSchema = ref<CompactRecordDetailsSchema>({
    entity: '',
    version: 1,
    fields: [],
    relatedCounts: [],
  })

  const enabled = computed(() => isEntityBuilderMode(builderMode.value))
  const isCompactMode = computed(() => builderMode.value === 'entityCompact')

  function createDefaultLayout(collectionName: string): EntityLayoutSchema {
    return {
      entity: collectionName,
      version: 1,
      actions: [],
      sections: [
        {
          id: 'main',
          title: collectionName
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase()),
          columns: 12,
          groups: [
            {
              id: 'group_general',
              title: t('builder.defaultGroupGeneral', 'General'),
              fields: [],
              collapsed: false,
              inlineLabels: true,
            },
          ],
        },
      ],
    }
  }

  async function loadLayoutsForMode(collectionName: string) {
    return isCompactMode.value
      ? loadCompactLayouts(collectionName)
      : loadEntityForms(collectionName)
  }

  async function loadLayoutByIdForMode(collectionName: string, layoutId: string) {
    return isCompactMode.value
      ? loadCompactLayoutById(collectionName, layoutId)
      : loadEntityLayoutById(collectionName, layoutId)
  }

  const {
    layoutSchema,
    layoutLoading,
    layoutDeleting,
    layouts,
    roleOptions,
    selectedLayoutId,
    layoutName,
    layoutRoleId,
    loadForCollection,
    selectLayout,
    createLayoutDraft,
    getSaveOptions,
    applySavedLayout,
  } = useRoleScopedLayout({
    collection,
    enabled,
    loadLayouts: loadLayoutsForMode,
    loadLayoutById: loadLayoutByIdForMode,
    createDefaultLayout,
  })

  let compactSchemaToken = 0
  watch(
    [collection, layoutSchema],
    async ([collectionName, schema]) => {
      const token = ++compactSchemaToken
      const next = await buildCompactDetailsSchema(collectionName, schema)
      if (token !== compactSchemaToken) return
      compactSchema.value = next
    },
    { deep: true, immediate: true },
  )

  async function saveLayout(): Promise<void> {
    layoutSaving.value = true
    layoutStatus.value = null
    layoutError.value = null
    try {
      const options = getSaveOptions()
      const saved = await saveEntityLayoutSetting(collection.value, layoutSchema.value, {
        layoutId: options.layoutId,
        name: options.name,
        roleId: null,
      })
      const allLayouts = await loadEntityForms(collection.value)
      applySavedLayout(saved, allLayouts)
      layoutStatus.value = t('builder.layoutSaved', 'Layout saved to Setting.')
    } catch (err) {
      layoutError.value =
        err instanceof DuplicateEntityFormRoleError || err instanceof DuplicateRoleScopedLayoutError
          ? t(
              'setup.duplicatePageLayoutName',
              'Another block layout already uses this name. Choose a different name before saving.',
            )
          : err instanceof Error
            ? err.message
            : t('builder.saveLayoutError', 'Failed to save layout.')
    } finally {
      layoutSaving.value = false
    }
  }

  async function deleteSelectedEntityForm(): Promise<void> {
    if (!selectedLayoutId.value) return

    layoutDeleting.value = true
    layoutStatus.value = null
    layoutError.value = null
    try {
      if (isCompactMode.value) {
        await deleteCompactLayout(collection.value, selectedLayoutId.value)
      } else {
        await deleteEntityForm(collection.value, selectedLayoutId.value)
      }
      await loadForCollection(collection.value)
      layoutStatus.value = t('layoutRole.deleted', 'Layout deleted.')
    } catch (err) {
      layoutError.value =
        err instanceof Error
          ? err.message
          : t('layoutRole.deleteError', 'Failed to delete layout.')
    } finally {
      layoutDeleting.value = false
    }
  }

  async function saveCompactDetails(): Promise<void> {
    compactSaving.value = true
    layoutStatus.value = null
    layoutError.value = null
    try {
      const options = getSaveOptions()
      const saved = await saveCompactRecordDetailsSetting(
        collection.value,
        layoutSchema.value,
        options,
      )
      const allLayouts = await loadCompactLayouts(collection.value)
      applySavedLayout(saved, allLayouts)
      compactSchema.value = await buildCompactDetailsSchema(
        collection.value,
        layoutSchema.value,
      )
      layoutStatus.value = t('builder.compactDetailsSaved', 'Compact record details saved to Setting.')
    } catch (err) {
      layoutError.value =
        err instanceof DuplicateEntityFormRoleError || err instanceof DuplicateRoleScopedLayoutError
          ? t(
              'builder.duplicateCompactLayoutRole',
              'Another compact layout already uses this role. Choose a different role before saving.',
            )
          : err instanceof Error
            ? err.message
            : t('builder.saveCompactDetailsError', 'Failed to save compact record details.')
    } finally {
      compactSaving.value = false
    }
  }

  watch(
    layoutSchema,
    (schema) => {
      const fields = schema.sections.reduce<LayoutFieldMetadata[]>(
        (sectionFields, section) => [
          ...sectionFields,
          ...section.groups.reduce<LayoutFieldMetadata[]>(
            (groupFields, group) => [...groupFields, ...group.fields],
            [],
          ),
        ],
        [],
      )
      const rebuilt = buildFormStateFromSchema(fields)
      const merged: Record<string, unknown> = { ...rebuilt }
      for (const key of Object.keys(formData.value)) {
        if (key in merged) {
          merged[key] = formData.value[key]
        }
      }
      formData.value = merged
    },
    { deep: true, immediate: true },
  )

  watch(
    [collection, builderMode],
    ([collectionName, mode]) => {
      if (isEntityBuilderMode(mode)) {
        void loadForCollection(collectionName)
      }
    },
    { immediate: true },
  )

  watch(builderMode, () => {
    layoutStatus.value = null
    layoutError.value = null
  })

  return {
    layoutSchema,
    formData,
    layoutLoading,
    layoutSaving,
    compactSaving,
    formDeleting: layoutDeleting,
    layoutStatus,
    layoutError,
    compactSchema,
    entityForms: layouts,
    roleOptions,
    selectedFormId: selectedLayoutId,
    formName: layoutName,
    formRoleId: layoutRoleId,
    layouts,
    selectedLayoutId,
    layoutName,
    layoutRoleId,
    loadLayoutForCollection: loadForCollection,
    selectEntityForm: selectLayout,
    createEntityForm: createLayoutDraft,
    deleteSelectedEntityForm,
    saveLayout,
    saveCompactDetails,
  }
}

export { buildCompactDetailsSchema }
