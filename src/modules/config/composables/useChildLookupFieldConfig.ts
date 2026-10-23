import { computed, ref, watch, type Ref } from 'vue'
import type { FieldDefinition, LayoutFieldChildLookup, RelationDefinition } from '@/interfaces'
import {
  filterFromPairs,
  filterPairsFromFilter,
  type FilterPair,
} from '@/core/relatedTransferFilterPairs'
import {
  childCollectionHasRelationTo,
  keysEqual,
  relatedCollectionForCollectionField,
  relationField,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { nestedFieldOptions } from '@/core/fieldOptions'
import { useTranslation } from '@/core/translation'
import {
  getCachedCollectionFields,
  getCachedRelations,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import { findRelationForField } from '@/modules/entities/utils/fieldMapper'
import { humanizeFieldName } from '@/modules/entities/utils/recordDisplay'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import {
  loadChildLookupFieldSettings,
  saveChildLookupFieldSetting,
} from '@/modules/config/services/layoutSettings'

type FieldOption = { label: string; value: string }
type ParentRelationOption = { label: string; field: string; collection: string }

function emptySettings(sourceField = ''): LayoutFieldChildLookup {
  return {
    collection: '',
    sourceField,
    childSourceField: '',
    valueField: '',
    defaultValueField: '',
    parentField: '',
    filter: null,
  }
}

/**
 * Field-config editor state for Child value lookup (entity-global, not layout-scoped).
 */
export function useChildLookupFieldConfig(options: {
  collection: Ref<string> | (() => string)
  fieldApiName: Ref<string> | (() => string)
  fieldLabel: Ref<string> | (() => string)
  relatedEntity: Ref<string | null> | (() => string | null)
  isM2O: Ref<boolean> | (() => boolean)
}) {
  const { t } = useTranslation()

  const collectionOf = () =>
    typeof options.collection === 'function' ? options.collection() : options.collection.value
  const fieldApiNameOf = () =>
    typeof options.fieldApiName === 'function' ? options.fieldApiName() : options.fieldApiName.value
  const fieldLabelOf = () =>
    typeof options.fieldLabel === 'function' ? options.fieldLabel() : options.fieldLabel.value
  const relatedEntityOf = () =>
    typeof options.relatedEntity === 'function' ? options.relatedEntity() : options.relatedEntity.value
  const isM2OOf = () =>
    typeof options.isM2O === 'function' ? options.isM2O() : options.isM2O.value

  const enabled = ref(false)
  const dialogVisible = ref(false)
  const draft = ref<LayoutFieldChildLookup>(emptySettings())
  const filterPairDrafts = ref<FilterPair[] | null>(null)

  const entityFields = ref<FieldDefinition[]>([])
  const relationDefinitions = ref<RelationDefinition[]>([])
  const collectionOptions = ref<FieldOption[]>([])
  const childFields = ref<FieldDefinition[]>([])
  const sourceFields = ref<FieldDefinition[]>([])
  const parentFields = ref<FieldDefinition[]>([])
  const parentNestedFieldsByCollection = ref<Record<string, FieldDefinition[]>>({})
  const childFieldsLoading = ref(false)
  const sourceFieldsLoading = ref(false)
  const parentFieldsLoading = ref(false)

  const sourceFieldOptions = computed<FieldOption[]>(() => {
    const self = fieldApiNameOf()
    return entityFields.value
      .filter((field) => {
        if (field.field === self) return false
        return isFieldM2O(
          collectionOf(),
          field.field,
          entityFields.value,
          relationDefinitions.value,
        )
      })
      .map((field) => ({
        label: field.meta?.note?.trim() || humanizeFieldName(field.field),
        value: field.field,
      }))
  })

  const sourceField = computed(
    () => draft.value.sourceField || sourceFieldOptions.value[0]?.value || '',
  )

  const sourceCollection = computed(() => {
    const name = sourceField.value
    if (!name) return ''
    const definition = entityFields.value.find((field) => field.field === name)
    if (!definition) return ''
    const relation = findRelationForField(definition, relationDefinitions.value)
    return relation ? relationRelatedCollection(relation) : ''
  })

  const filteredCollectionOptions = computed(() => {
    const source = sourceCollection.value
    const valueCollection = relatedEntityOf() ?? ''
    const bridgeOptions = !source
      ? []
      : collectionOptions.value.filter(
          (collection) =>
            !keysEqual(collection.value, collectionOf()) &&
            !keysEqual(collection.value, valueCollection) &&
            childCollectionHasRelationTo(relationDefinitions.value, collection.value, source) &&
            (!valueCollection ||
              childCollectionHasRelationTo(
                relationDefinitions.value,
                collection.value,
                valueCollection,
              )),
        )

    // M2O picklists may query the related entity directly and filter via Lookup filter
    // (e.g. variant where variant_type = $parent.variant_type).
    if (isM2OOf() && valueCollection) {
      const relatedOption =
        collectionOptions.value.find((collection) =>
          keysEqual(collection.value, valueCollection),
        ) ?? {
          label: humanizeFieldName(valueCollection),
          value: valueCollection,
        }
      return [relatedOption, ...bridgeOptions]
    }

    return bridgeOptions
  })

  const childFieldOptions = computed<FieldOption[]>(() =>
    childFields.value
      .filter((field) => field.type !== 'alias')
      .map((field) => ({
        label: field.meta?.note?.trim() || field.field,
        value: field.field,
      })),
  )

  const defaultFieldOptions = computed<FieldOption[]>(() => [
    { label: t('formBuilder.noDefaultValue', 'No default value'), value: '' },
    ...sourceFields.value
      .filter((field) => field.type !== 'alias')
      .map((field) => ({
        label: field.meta?.note?.trim() || field.field,
        value: field.field,
      })),
  ])

  const parentRelationOptions = computed<ParentRelationOption[]>(() =>
    relationDefinitions.value
      .filter(
        (relation) =>
          keysEqual(relationManyCollection(relation), collectionOf()) &&
          Boolean(relationRelatedCollection(relation)),
      )
      .map((relation) => ({
        label: `${humanizeFieldName(relationField(relation))} (${relationRelatedCollection(relation)})`,
        field: relationField(relation),
        collection: relationRelatedCollection(relation),
      })),
  )

  const parentRelationField = computed(() => {
    const configured = draft.value.parentField
    if (!configured) return ''
    return (
      parentRelationOptions.value.find((item) => item.field === configured)?.field ?? configured
    )
  })

  const parentCollection = computed(() => {
    const relation = parentRelationOptions.value.find(
      (item) => item.field === parentRelationField.value,
    )
    return relation?.collection ?? ''
  })

  const showParentCollectionSelector = computed(() => parentRelationOptions.value.length > 0)
  const isPicklist = computed(() => isM2OOf())

  const defaultMode = computed<'sourceField' | 'lookupQuery'>(() => {
    if (isPicklist.value) return 'lookupQuery'
    return draft.value.collection ? 'lookupQuery' : 'sourceField'
  })

  const defaultModeOptions = computed(() => [
    {
      label: t('formBuilder.childLookupDefaultFromSource', 'From source field'),
      value: 'sourceField' as const,
    },
    {
      label: t('formBuilder.childLookupDefaultFromLookup', 'From lookup query'),
      value: 'lookupQuery' as const,
    },
  ])

  const sourceTokenFieldOptions = computed<FieldOption[]>(() => {
    const self = fieldApiNameOf()
    return entityFields.value
      .filter((field) => field.field !== self && field.type !== 'alias')
      .map((field) => ({
        label: field.meta?.note?.trim() || humanizeFieldName(field.field),
        value: field.field,
      }))
  })

  const parentFilterFieldOptions = computed(() =>
    nestedFieldOptions(
      parentFields.value,
      parentNestedFieldsByCollection.value,
      (field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          parentCollection.value,
          field.field,
        ) ||
        field.schema?.foreign_key_table ||
        '',
    ),
  )

  const filterPairs = computed<FilterPair[]>(() => {
    if (filterPairDrafts.value !== null) return filterPairDrafts.value
    return filterPairsFromFilter(draft.value.filter ?? null)
  })

  const settingsSummary = computed(() => {
    if (!enabled.value) return ''
    const settings = draft.value
    const parts: string[] = []
    if (settings.sourceField) {
      parts.push(
        t('formBuilder.childLookupSummarySource', 'Source: {field}', {
          field: settings.sourceField,
        }),
      )
    }
    if ((isPicklist.value || defaultMode.value === 'lookupQuery') && settings.collection) {
      parts.push(settings.collection)
      if (settings.valueField) {
        parts.push(
          t('formBuilder.childLookupSummaryValue', 'Value: {field}', {
            field: settings.valueField,
          }),
        )
      }
      const filterCount = filterPairs.value.filter((pair) => pair.sourceField).length
      if (filterCount > 0) {
        parts.push(
          t('formBuilder.childLookupSummaryFilters', '{count} filters', {
            count: filterCount,
          }),
        )
      }
    } else if (settings.defaultValueField) {
      parts.push(
        t('formBuilder.childLookupSummaryDefault', 'Default: {field}', {
          field: settings.defaultValueField,
        }),
      )
    }
    return parts.join(' · ')
  })

  async function loadEntityContext(): Promise<void> {
    const collection = collectionOf()
    if (!collection) {
      entityFields.value = []
      relationDefinitions.value = []
      collectionOptions.value = []
      return
    }
    try {
      const [fields, relations, collections] = await Promise.all([
        getCachedCollectionFields(collection),
        getCachedRelations(),
        listUserCollections(),
      ])
      entityFields.value = fields
      relationDefinitions.value = relations as RelationDefinition[]
      collectionOptions.value = collections
    } catch {
      entityFields.value = []
      relationDefinitions.value = []
      collectionOptions.value = []
    }
  }

  async function loadChildFields(): Promise<void> {
    const collection = draft.value.collection
    if (!collection) {
      childFields.value = []
      return
    }
    childFieldsLoading.value = true
    try {
      childFields.value = await getCachedCollectionFields(collection)
    } catch {
      childFields.value = []
    } finally {
      childFieldsLoading.value = false
    }
  }

  async function loadSourceFields(): Promise<void> {
    const collection = sourceCollection.value
    if (!collection) {
      sourceFields.value = []
      return
    }
    sourceFieldsLoading.value = true
    try {
      sourceFields.value = await getCachedCollectionFields(collection)
    } catch {
      sourceFields.value = []
    } finally {
      sourceFieldsLoading.value = false
    }
  }

  async function loadParentFields(): Promise<void> {
    const collection = parentCollection.value
    if (!collection) {
      parentFields.value = []
      parentNestedFieldsByCollection.value = {}
      return
    }
    parentFieldsLoading.value = true
    try {
      parentFields.value = await getCachedCollectionFields(collection)
      const relationFields = parentFields.value
        .map((field) =>
          relatedCollectionForCollectionField(
            relationDefinitions.value,
            collection,
            field.field,
          ),
        )
        .filter((related): related is string => Boolean(related))
      const nestedEntries = await Promise.all(
        Array.from(new Set(relationFields)).map(
          async (relatedCollection) =>
            [relatedCollection, await getCachedCollectionFields(relatedCollection)] as const,
        ),
      )
      parentNestedFieldsByCollection.value = Object.fromEntries(nestedEntries)
    } catch {
      parentFields.value = []
      parentNestedFieldsByCollection.value = {}
    } finally {
      parentFieldsLoading.value = false
    }
  }

  async function inferSettings(
    settings: LayoutFieldChildLookup,
  ): Promise<LayoutFieldChildLookup> {
    const valueCollection = relatedEntityOf() ?? ''
    const inferredSourceName =
      settings.sourceField || sourceFieldOptions.value[0]?.value || ''
    if (!settings.collection) {
      return {
        ...settings,
        sourceField: inferredSourceName,
      }
    }

    const relations =
      relationDefinitions.value.length > 0
        ? relationDefinitions.value
        : ((await getCachedRelations()) as RelationDefinition[])

    // Direct related-entity mode: child collection is the M2O target itself.
    if (valueCollection && keysEqual(settings.collection, valueCollection)) {
      const childDefs = await getCachedCollectionFields(settings.collection)
      const primaryKey =
        childDefs.find((field) => field.schema?.is_primary_key)?.field ?? 'id'
      const preferredParent =
        settings.parentField ||
        (inferredSourceName &&
        parentRelationOptions.value.some((item) => item.field === inferredSourceName)
          ? inferredSourceName
          : parentRelationOptions.value[0]?.field ?? '')
      return {
        ...settings,
        sourceField: inferredSourceName || settings.sourceField,
        childSourceField: '',
        valueField: settings.valueField || primaryKey,
        parentField: preferredParent,
      }
    }

    const childRelations = relations.filter((relation) =>
      keysEqual(relationManyCollection(relation), settings.collection),
    )
    const valueRelation = childRelations.find((relation) =>
      valueCollection
        ? keysEqual(relationRelatedCollection(relation), valueCollection)
        : false,
    )
    const sourceDef = entityFields.value.find((field) => field.field === inferredSourceName)
    const sourceRel = sourceDef
      ? findRelationForField(sourceDef, relations)
      : undefined
    const sourceColl = sourceRel ? relationRelatedCollection(sourceRel) : ''
    const sourceRelation = sourceColl
      ? childRelations.find(
          (relation) =>
            relation !== valueRelation &&
            keysEqual(relationRelatedCollection(relation), sourceColl),
        )
      : childRelations.find((relation) => {
          if (relation === valueRelation) return false
          const related = relationRelatedCollection(relation)
          return sourceFieldOptions.value.some((option) => {
            const def = entityFields.value.find((field) => field.field === option.value)
            if (!def) return false
            const rel = findRelationForField(def, relations)
            return rel ? keysEqual(relationRelatedCollection(rel), related) : false
          })
        })

    const resolvedSourceField = sourceRelation
      ? sourceFieldOptions.value.find((option) => {
          const def = entityFields.value.find((field) => field.field === option.value)
          if (!def) return false
          const rel = findRelationForField(def, relations)
          return rel
            ? keysEqual(
                relationRelatedCollection(rel),
                relationRelatedCollection(sourceRelation),
              )
            : false
        })?.value
      : undefined

    const valueField = valueRelation ? relationField(valueRelation) : settings.valueField
    const defaultValueRelation =
      sourceColl && valueCollection
        ? relations.find(
            (relation) =>
              keysEqual(relationManyCollection(relation), sourceColl) &&
              keysEqual(relationRelatedCollection(relation), valueCollection),
          )
        : undefined

    return {
      ...settings,
      sourceField: resolvedSourceField ?? (inferredSourceName || settings.sourceField),
      childSourceField: sourceRelation
        ? relationField(sourceRelation)
        : settings.childSourceField,
      valueField,
      defaultValueField:
        settings.defaultValueField ||
        (defaultValueRelation ? relationField(defaultValueRelation) : ''),
    }
  }

  async function inferNonM2OSettings(
    settings: LayoutFieldChildLookup,
  ): Promise<LayoutFieldChildLookup> {
    const source = settings.sourceField || sourceFieldOptions.value[0]?.value || ''
    const sourceColl = (() => {
      const def = entityFields.value.find((field) => field.field === source)
      if (!def) return ''
      const rel = findRelationForField(def, relationDefinitions.value)
      return rel ? relationRelatedCollection(rel) : ''
    })()
    const valueCollection = relatedEntityOf() ?? ''
    const options = sourceColl
      ? collectionOptions.value.filter(
          (collection) =>
            !keysEqual(collection.value, collectionOf()) &&
            childCollectionHasRelationTo(
              relationDefinitions.value,
              collection.value,
              sourceColl,
            ) &&
            (!valueCollection ||
              childCollectionHasRelationTo(
                relationDefinitions.value,
                collection.value,
                valueCollection,
              )),
        )
      : []
    const preferredCollection =
      settings.collection && options.some((option) => keysEqual(option.value, settings.collection))
        ? settings.collection
        : options[0]?.value ?? ''

    const inferred = await inferSettings({
      ...settings,
      sourceField: source,
      collection: preferredCollection,
      parentField: '',
      filter: null,
    })

    let valueField = inferred.valueField
    if (preferredCollection) {
      const childDefs = await getCachedCollectionFields(preferredCollection)
      const names = new Set(childDefs.map((field) => field.field))
      if (valueField && !names.has(valueField)) valueField = ''
      if (!valueField) {
        const targetName = fieldApiNameOf()
        const label = fieldLabelOf()
        const exact = childDefs.find((field) => keysEqual(field.field, targetName))
        const byNote = childDefs.find((field) =>
          keysEqual(field.meta?.note?.trim() || '', label || ''),
        )
        valueField = exact?.field ?? byNote?.field ?? settings.valueField ?? ''
      }
    }

    return {
      ...inferred,
      valueField,
      parentField: '',
      filter: null,
    }
  }

  async function resetFromStored(): Promise<void> {
    filterPairDrafts.value = null
    dialogVisible.value = false
    await loadEntityContext()
    const fieldName = fieldApiNameOf()
    if (!fieldName) {
      enabled.value = false
      draft.value = emptySettings()
      return
    }
    const loaded = await loadChildLookupFieldSettings(collectionOf(), [fieldName], null)
    const existing = loaded[fieldName] ?? null
    if (existing) {
      enabled.value = true
      draft.value = { ...emptySettings(), ...existing }
      await Promise.all([loadChildFields(), loadSourceFields(), loadParentFields()])
      return
    }
    enabled.value = false
    draft.value = emptySettings(sourceFieldOptions.value[0]?.value ?? '')
  }

  async function setEnabled(next: boolean): Promise<void> {
    enabled.value = next
    if (!next) {
      draft.value = emptySettings()
      filterPairDrafts.value = null
      dialogVisible.value = false
      return
    }
    const base = emptySettings(sourceFieldOptions.value[0]?.value ?? '')
    if (isM2OOf()) {
      // Prefer direct related-entity mode so Lookup filter can scope the picklist
      // (e.g. Variants filtered by Item.variant_type) without a bridge table.
      const related = relatedEntityOf() ?? ''
      draft.value = await inferSettings({
        ...base,
        collection: related || base.collection,
      })
    } else {
      draft.value = await inferNonM2OSettings(base)
    }
    await Promise.all([loadChildFields(), loadSourceFields(), loadParentFields()])
  }

  async function updateSettings(patch: Partial<LayoutFieldChildLookup>): Promise<void> {
    draft.value = { ...draft.value, ...patch }
  }

  async function updateSourceField(next: string): Promise<void> {
    const base = { ...draft.value, sourceField: next }
    draft.value = isM2OOf()
      ? await inferSettings(base)
      : await inferNonM2OSettings(base)
    await Promise.all([loadChildFields(), loadSourceFields()])
  }

  async function updateCollection(collection: string): Promise<void> {
    const base = {
      ...draft.value,
      collection,
      childSourceField: '',
      valueField: '',
      defaultValueField: '',
    }
    draft.value = await inferSettings(base)
    filterPairDrafts.value = null
    await loadChildFields()
  }

  async function setDefaultMode(mode: 'sourceField' | 'lookupQuery'): Promise<void> {
    if (isPicklist.value) return
    if (mode === 'sourceField') {
      filterPairDrafts.value = null
      await updateSettings({
        collection: '',
        childSourceField: '',
        valueField: '',
        filter: null,
        parentField: '',
      })
      return
    }
    draft.value = await inferNonM2OSettings({
      ...draft.value,
      collection: draft.value.collection || '',
    })
    filterPairDrafts.value = null
    await loadChildFields()
  }

  function updateParentField(parentField: string): void {
    filterPairDrafts.value = null
    void updateSettings({ parentField })
  }

  function persistFilter(pairs: FilterPair[]): void {
    void updateSettings({ filter: filterFromPairs(pairs) })
  }

  function addFilterPair(): void {
    filterPairDrafts.value = [
      ...filterPairs.value,
      {
        sourceField: '',
        filterField: '',
        operator: '_eq',
        valueKind: 'parent',
        literalValue: '',
      },
    ]
  }

  function updateFilterPair(index: number, patch: Partial<FilterPair>): void {
    const pairs = filterPairs.value.map((pair, pairIndex) =>
      pairIndex === index ? { ...pair, ...patch } : pair,
    )
    filterPairDrafts.value = pairs
    persistFilter(pairs)
  }

  function removeFilterPair(index: number): void {
    const pairs = filterPairs.value.filter((_, pairIndex) => pairIndex !== index)
    filterPairDrafts.value = pairs
    persistFilter(pairs)
  }

  function currentSettings(): LayoutFieldChildLookup {
    return {
      ...draft.value,
      sourceField: draft.value.sourceField || sourceField.value,
      // Prefer live filter-pair drafts so incomplete→complete edits survive Save.
      filter: filterFromPairs(filterPairs.value),
    }
  }

  async function persist(fieldApiName: string): Promise<void> {
    const name = fieldApiName.trim()
    if (!name) return
    if (!enabled.value) {
      await saveChildLookupFieldSetting(collectionOf(), name, null, null)
      return
    }
    await saveChildLookupFieldSetting(collectionOf(), name, currentSettings(), null)
  }

  watch(
    () => draft.value.collection,
    () => {
      void loadChildFields()
    },
  )

  watch(sourceCollection, () => {
    void loadSourceFields()
  })

  watch(parentCollection, () => {
    void loadParentFields()
  })

  watch(
    () => [parentCollection.value, draft.value.collection] as const,
    ([nextParent, nextCollection], previous) => {
      if (!previous) return
      if (nextParent === previous[0] && nextCollection === previous[1]) return
      // Only reset drafts when parent/child collection actually changes —
      // draft object identity changes on every settings patch and must not wipe in-progress filters.
      filterPairDrafts.value = null
    },
  )

  return {
    enabled,
    dialogVisible,
    draft,
    settingsSummary,
    isPicklist,
    defaultMode,
    defaultModeOptions,
    sourceFieldOptions,
    filteredCollectionOptions,
    childFieldOptions,
    defaultFieldOptions,
    parentRelationOptions,
    parentRelationField,
    showParentCollectionSelector,
    parentFilterFieldOptions,
    sourceTokenFieldOptions,
    filterPairs,
    childFieldsLoading,
    sourceFieldsLoading,
    parentFieldsLoading,
    resetFromStored,
    setEnabled,
    updateSettings,
    updateSourceField,
    updateCollection,
    setDefaultMode,
    updateParentField,
    addFilterPair,
    updateFilterPair,
    removeFilterPair,
    currentSettings,
    persist,
  }
}
