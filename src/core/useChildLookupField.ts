import { computed, ref, watch, type Ref } from 'vue'
import type { LayoutFieldChildLookup, LayoutFieldMetadata } from '@/interfaces'
import {
  childLookupOptionMatchesValue,
  fetchChildLookupOptionByValue,
  fetchChildLookupPicklistOptions,
  resolveChildLookupScalarValue,
  resolveChildLookupSourceId,
} from '@/core/childLookupRows'
import { getCachedCollectionFields, getCachedRelations } from '@/modules/entities/services/collectionSchema'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import { collectSourceTokenFields } from '@/modules/entities/utils/relatedTransferFilters'
import { extractRelationFieldId, scalarId } from '@/modules/entities/utils/recordDisplay'

export type ChildLookupFieldMode = 'picklist' | 'value' | 'auto'

export interface UseChildLookupFieldOptions {
  modelValue: Ref<unknown>
  settings: Ref<LayoutFieldChildLookup | undefined>
  sourceRecord: Ref<Record<string, unknown>>
  mode: Ref<ChildLookupFieldMode>
  targetField?: Ref<string | undefined>
  entityCollection?: Ref<string | undefined>
  fields?: Ref<LayoutFieldMetadata[] | undefined>
  sourceCollection?: Ref<string | undefined>
  sourceIdField?: Ref<string | undefined>
  parentCollection?: Ref<string | undefined>
  parentId?: Ref<string | number | undefined>
  parentName?: Ref<string | undefined>
  parentRecord?: Ref<Record<string, unknown> | undefined>
  preferPicklist?: Ref<boolean | undefined>
  preloadedOptions?: Ref<Array<{ label: string; value: unknown }> | undefined>
  /**
   * Edit forms only: keep a stored scalar on first hydrate.
   * Create forms must always refresh when Item (source) changes — otherwise
   * Price/Main price keep a prior Item's value after clear/reselect.
   */
  preserveDraftOnHydrate?: Ref<boolean | undefined>
  onUpdate: (value: unknown) => void
}

function buildSourceRecordDependency(
  record: Record<string, unknown>,
  settings: LayoutFieldChildLookup | undefined,
  sourceIdField?: string,
): string {
  const fields = new Set<string>()
  if (settings?.sourceField) {
    fields.add(settings.sourceField)
  }
  if (settings?.parentField) {
    fields.add(settings.parentField)
  }
  if (sourceIdField) {
    fields.add(sourceIdField)
  }
  if (settings?.filter) {
    collectSourceTokenFields(settings.filter, fields)
  }

  const snapshot: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in record) {
      snapshot[field] = record[field]
    }
  }
  return JSON.stringify(snapshot)
}

function isEmptyLookupValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

export function useChildLookupField(options: UseChildLookupFieldOptions) {
  const loading = ref(false)
  const loadKey = ref('')
  const fetchedOptions = ref<Array<{ label: string; value: unknown }>>([])
  const fieldIsM2O = ref<boolean | undefined>(undefined)
  const lastSyncedSourceValue = ref<string | number | null>(null)
  const lastSyncedPicklistContext = ref<string | null>(null)

  const sourceValue = computed(() =>
    resolveChildLookupSourceId(
      options.sourceRecord.value,
      options.settings.value,
      options.sourceIdField?.value,
    ),
  )

  const resolvedSourceCollection = computed(() => {
    if (options.sourceCollection?.value) return options.sourceCollection.value
    const sourceField = options.settings.value?.sourceField
    if (!sourceField) return ''
    return options.fields?.value?.find((field) => field.field === sourceField)?.relatedCollection ?? ''
  })

  const resolvedMode = computed<'picklist' | 'value'>(() => {
    if (options.mode.value === 'picklist') return 'picklist'
    if (options.mode.value === 'value') return 'value'
    if (fieldIsM2O.value === true) return 'picklist'
    if (fieldIsM2O.value === false) return 'value'
    return options.preferPicklist?.value ? 'picklist' : 'value'
  })

  const selectOptions = computed(() => {
    if (options.preloadedOptions?.value !== undefined) {
      return options.preloadedOptions.value
    }
    return fetchedOptions.value
  })

  const numericModelValue = computed(() => {
    const value = options.modelValue.value
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  })

  const fetchContext = computed(() => ({
    entityCollection: options.entityCollection?.value,
    sourceRecord: options.sourceRecord.value,
    parentCollection: options.parentCollection?.value,
    parentId: options.parentId?.value,
    parentName: options.parentName?.value,
    parentRecord: options.parentRecord?.value,
    sourceCollection: resolvedSourceCollection.value,
  }))

  const sourceRecordDependency = computed(() =>
    buildSourceRecordDependency(
      options.sourceRecord.value,
      options.settings.value,
      options.sourceIdField?.value,
    ),
  )

  watch(
    () => [
      options.settings.value,
      options.entityCollection?.value ?? '',
      options.targetField?.value ?? '',
      options.mode.value,
    ] as const,
    () => {
      void syncFieldM2O()
    },
    { immediate: true },
  )

  watch(
    () => [
      options.settings.value,
      sourceValue.value,
      sourceRecordDependency.value,
      options.entityCollection?.value ?? '',
      options.parentCollection?.value ?? '',
      options.parentId?.value ?? '',
      options.parentName?.value ?? '',
      JSON.stringify(options.parentRecord?.value ?? {}),
      options.sourceIdField?.value ?? '',
      resolvedMode.value,
      options.preloadedOptions?.value,
      // Re-seed when the stored value arrives after the first options fetch.
      extractRelationFieldId(options.modelValue.value) ?? scalarId(options.modelValue.value),
    ] as const,
    () => {
      void syncFieldState()
    },
    { immediate: true },
  )

  async function syncFieldM2O(): Promise<void> {
    const collection = options.entityCollection?.value
    const fieldName = options.targetField?.value
    if (!collection || !fieldName || options.mode.value !== 'auto') {
      fieldIsM2O.value = undefined
      return
    }

    const [definitions, relations] = await Promise.all([
      getCachedCollectionFields(collection),
      getCachedRelations(),
    ])
    fieldIsM2O.value = isFieldM2O(collection, fieldName, definitions, relations)
  }

  async function syncFieldState(): Promise<void> {
    const lookup = options.settings.value
    if (!lookup?.collection || !lookup.valueField) {
      loadKey.value = ''
      fetchedOptions.value = []
      return
    }

    const requiresSourcePin = Boolean(lookup.childSourceField?.trim())
    if (sourceValue.value === null) {
      // Value mode (Price / Main price): always clear when Source field (Item) is
      // empty. Filter-only configs used to keep the stale price whenever the
      // Opportunity parent was still present — Item clear left Price at 26.63.
      if (resolvedMode.value === 'value') {
        loadKey.value = ''
        fetchedOptions.value = []
        const hadSource = lastSyncedSourceValue.value !== null
        lastSyncedSourceValue.value = null
        lastSyncedPicklistContext.value = null
        if (hadSource || !isEmptyLookupValue(options.modelValue.value)) {
          clearValue()
        }
        return
      }

      if (requiresSourcePin) {
        loadKey.value = ''
        fetchedOptions.value = []
        lastSyncedSourceValue.value = null
        lastSyncedPicklistContext.value = null
        // Picklist: keep stored option visible until a new source is chosen (edit forms).
        void seedStoredPicklistOption(lookup)
        return
      }

      // Picklist filter-only mode may still resolve options from $parent.* alone.
      const parentField = lookup.parentField?.trim()
      const parentFromRecord = parentField
        ? options.sourceRecord.value[parentField]
        : undefined
      const hasParent =
        options.parentId?.value !== undefined &&
        options.parentId?.value !== null &&
        options.parentId?.value !== ''
      const hasParentOnRecord =
        parentFromRecord !== undefined &&
        parentFromRecord !== null &&
        parentFromRecord !== ''
      if (!hasParent && !hasParentOnRecord) {
        loadKey.value = ''
        fetchedOptions.value = []
        lastSyncedSourceValue.value = null
        lastSyncedPicklistContext.value = null
        void seedStoredPicklistOption(lookup)
        return
      }
    }

    const key = JSON.stringify([
      lookup,
      sourceValue.value,
      options.entityCollection?.value ?? '',
      options.parentCollection?.value ?? '',
      options.parentId?.value ?? '',
      options.parentName?.value ?? '',
      JSON.stringify(options.parentRecord?.value ?? {}),
      options.sourceIdField?.value ?? '',
      sourceRecordDependency.value,
      resolvedMode.value,
      options.preloadedOptions?.value,
    ])
    if (loadKey.value === key) {
      // Same filter context — only make sure a late-arriving stored value has an option.
      if (resolvedMode.value === 'picklist') {
        const seeded = await ensureCurrentPicklistOption(lookup, fetchedOptions.value)
        if (seeded !== fetchedOptions.value) {
          fetchedOptions.value = seeded
        }
      }
      return
    }
    loadKey.value = key
    loading.value = true

    try {
      if (resolvedMode.value === 'picklist') {
        await syncPicklistState(lookup, sourceValue.value, key)
      } else if (sourceValue.value !== null) {
        await syncValueState(lookup, sourceValue.value, key)
      }
    } finally {
      if (loadKey.value === key) {
        loading.value = false
      }
    }
  }

  async function syncPicklistState(
    lookup: LayoutFieldChildLookup,
    source: string | number | null,
    key: string,
  ): Promise<void> {
    const picklistContext = JSON.stringify([
      source,
      lookup.parentField ?? '',
      options.parentId?.value ?? '',
      sourceRecordDependency.value,
    ])
    const contextChanged =
      lastSyncedPicklistContext.value !== null &&
      lastSyncedPicklistContext.value !== picklistContext

    if (options.preloadedOptions?.value !== undefined) {
      const nextOptions = await ensureCurrentPicklistOption(
        lookup,
        options.preloadedOptions.value,
      )
      if (loadKey.value !== key) return
      await reconcilePicklistSelection(lookup, source, nextOptions, contextChanged, key)
      if (loadKey.value === key) {
        lastSyncedPicklistContext.value = picklistContext
      }
      return
    }

    const fetched = await fetchChildLookupPicklistOptions(lookup, source, fetchContext.value)
    if (loadKey.value !== key) return
    const nextOptions = await ensureCurrentPicklistOption(lookup, fetched)
    if (loadKey.value !== key) return
    fetchedOptions.value = nextOptions
    await reconcilePicklistSelection(lookup, source, nextOptions, contextChanged, key)
    if (loadKey.value === key) {
      lastSyncedPicklistContext.value = picklistContext
    }
  }

  async function seedStoredPicklistOption(
    lookup: LayoutFieldChildLookup,
  ): Promise<void> {
    if (resolvedMode.value !== 'picklist') return
    const seeded = await ensureCurrentPicklistOption(lookup, [])
    if (seeded.length > 0) {
      fetchedOptions.value = seeded
    }
  }

  async function ensureCurrentPicklistOption(
    lookup: LayoutFieldChildLookup,
    optionsList: Array<{ label: string; value: unknown }>,
  ): Promise<Array<{ label: string; value: unknown }>> {
    const current = options.modelValue.value
    if (isEmptyLookupValue(current)) return optionsList
    if (optionsList.some((option) => childLookupOptionMatchesValue(option.value, current))) {
      return optionsList
    }

    const currentId = extractRelationFieldId(current) ?? scalarId(current)
    if (currentId === null) return optionsList

    const ensured = await fetchChildLookupOptionByValue(lookup, currentId)
    if (!ensured) {
      // Keep Select able to bind the stored id even if label fetch fails.
      return [{ value: currentId, label: String(currentId) }, ...optionsList]
    }
    return [ensured, ...optionsList]
  }

  async function reconcilePicklistSelection(
    lookup: LayoutFieldChildLookup,
    source: string | number | null,
    nextOptions: Array<{ label: string; value: unknown }>,
    contextChanged: boolean,
    key: string,
  ): Promise<void> {
    const current = options.modelValue.value
    if (nextOptions.some((option) => childLookupOptionMatchesValue(option.value, current))) {
      return
    }

    // Initial open: never wipe a stored value — option ensure already ran above.
    if (!contextChanged) return

    const defaultValue = await resolveChildLookupScalarValue(lookup, source, fetchContext.value)
    if (loadKey.value !== key) return
    if (
      defaultValue !== undefined &&
      nextOptions.some((option) => childLookupOptionMatchesValue(option.value, defaultValue))
    ) {
      updateValue(defaultValue)
      return
    }
    clearValue()
  }

  async function syncValueState(
    lookup: LayoutFieldChildLookup,
    source: string | number,
    key: string,
  ): Promise<void> {
    const previousSource = lastSyncedSourceValue.value
    const sourceChanged =
      previousSource === null || String(previousSource) !== String(source)
    // Edit open only: keep stored Price until the user changes Item.
    // Create must always write — leftover values look like "hydration" and stick
    // (Price stayed 26.63 while Main price / Base price refreshed).
    const preserveDraft =
      Boolean(options.preserveDraftOnHydrate?.value) &&
      previousSource === null &&
      !isEmptyLookupValue(options.modelValue.value)
    const resolved = await resolveChildLookupScalarValue(lookup, source, fetchContext.value)
    if (loadKey.value !== key) return

    lastSyncedSourceValue.value = source

    if (resolved !== undefined) {
      if (!preserveDraft && sourceChanged) {
        updateValue(resolved)
      } else if (!preserveDraft && isEmptyLookupValue(options.modelValue.value)) {
        updateValue(resolved)
      }
      return
    }

    if (!preserveDraft && sourceChanged) {
      clearValue()
    }
  }

  function updateValue(value: unknown): void {
    options.onUpdate(value ?? null)
  }

  function clearValue(): void {
    const value = options.modelValue.value
    if (value === null || value === undefined) return
    options.onUpdate(null)
  }

  return {
    loading,
    resolvedMode,
    selectOptions,
    numericModelValue,
    updateValue,
  }
}
