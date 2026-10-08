import { computed, ref, watch, type Ref } from 'vue'
import type { LayoutFieldChildLookup, LayoutFieldMetadata } from '@/interfaces'
import {
  fetchChildLookupPicklistOptions,
  resolveChildLookupScalarValue,
  resolveChildLookupSourceId,
} from '@/core/childLookupRows'
import { getCachedCollectionFields, getCachedRelations } from '@/modules/entities/services/collectionSchema'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import { collectSourceTokenFields } from '@/modules/entities/utils/relatedTransferFilters'

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
    if (!lookup?.collection) {
      loadKey.value = ''
      fetchedOptions.value = []
      return
    }

    if (sourceValue.value === null) {
      loadKey.value = ''
      fetchedOptions.value = []
      lastSyncedSourceValue.value = null
      clearValue()
      return
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
    if (loadKey.value === key) return
    loadKey.value = key
    loading.value = true

    try {
      if (resolvedMode.value === 'picklist') {
        await syncPicklistState(lookup, sourceValue.value, key)
      } else {
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
    source: string | number,
    key: string,
  ): Promise<void> {
    if (options.preloadedOptions?.value !== undefined) {
      const nextOptions = options.preloadedOptions.value
      if (loadKey.value !== key) return
      if (!nextOptions.some((option) => option.value === options.modelValue.value)) {
        const defaultValue = await resolveChildLookupScalarValue(lookup, source, fetchContext.value)
        if (
          loadKey.value === key &&
          defaultValue !== undefined &&
          nextOptions.some((option) => option.value === defaultValue)
        ) {
          updateValue(defaultValue)
        } else if (loadKey.value === key) {
          clearValue()
        }
      }
      return
    }

    const nextOptions = await fetchChildLookupPicklistOptions(lookup, source, fetchContext.value)
    if (loadKey.value !== key) return
    fetchedOptions.value = nextOptions
    if (!nextOptions.some((option) => option.value === options.modelValue.value)) {
      const defaultValue = await resolveChildLookupScalarValue(lookup, source, fetchContext.value)
      if (
        loadKey.value === key &&
        defaultValue !== undefined &&
        nextOptions.some((option) => option.value === defaultValue)
      ) {
        updateValue(defaultValue)
      } else if (loadKey.value === key) {
        clearValue()
      }
    }
  }

  async function syncValueState(
    lookup: LayoutFieldChildLookup,
    source: string | number,
    key: string,
  ): Promise<void> {
    const hadPreviousSource = lastSyncedSourceValue.value !== null
    const sourceChanged =
      hadPreviousSource && source !== lastSyncedSourceValue.value
    const resolved = await resolveChildLookupScalarValue(lookup, source, fetchContext.value)
    if (loadKey.value !== key) return

    lastSyncedSourceValue.value = source

    if (resolved !== undefined) {
      if (sourceChanged || isEmptyLookupValue(options.modelValue.value)) {
        updateValue(resolved)
      }
      return
    }

    if (sourceChanged) {
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
