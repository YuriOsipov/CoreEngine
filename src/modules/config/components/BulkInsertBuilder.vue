<script lang="ts">
export default {
  name: 'BulkInsertBuilder',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import FilterPairEditor from './FilterPairEditor.vue'
import type {
  DataTableColumnConfig,
  FieldDefinition,
  RelationDefinition,
  RelatedTransferSettings,
  RelatedTransferSourceMode,
  RelatedTransferTotalFormula,
} from '@/interfaces'
import { loadChildLookupFieldSettings } from '@/modules/config/services/layoutSettings'
import { useTranslation } from '@/core/translation'
import {
  getCachedCollectionFields,
  getCachedRelations,
  listUserCollections,
} from '@/modules/entities/services/collectionSchema'
import { humanizeFieldName } from '@/modules/entities/utils/recordDisplay'
import {
  keysEqual,
  relatedCollectionForCollectionField,
  relationField,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import {
  isFieldM2O,
  resolveCollectionKey,
} from '@/modules/entities/utils/relatedTransferSchema'
import {
  filterFromPairs,
  filterPairsFromFilter,
  stripFilterPairs,
  type FilterPair,
} from '@/core/relatedTransferFilterPairs'
import {
  fieldSelectOptions,
  nestedFieldOptions,
  type FieldOption,
} from '@/core/fieldOptions'

type DestinationMappingMode = 'source' | 'fixed'

const props = defineProps<{
  modelValue: RelatedTransferSettings
  targetCollection?: string
  targetParentField?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [settings: RelatedTransferSettings]
  validChange: [valid: boolean]
}>()

const { t } = useTranslation()

const collections = ref<FieldOption[]>([])
const sourceFields = ref<FieldDefinition[]>([])
const sourceNestedFieldsByCollection = ref<Record<string, FieldDefinition[]>>({})
const sourceGroupFields = ref<FieldDefinition[]>([])
const targetFields = ref<FieldDefinition[]>([])
const entityChildLookupFields = ref<Set<string>>(new Set())
const parentFields = ref<FieldDefinition[]>([])
const parentNestedFieldsByCollection = ref<Record<string, FieldDefinition[]>>({})
const relationDefinitions = ref<RelationDefinition[]>([])
const collectionsLoading = ref(false)
const sourceFieldsLoading = ref(false)
const groupFieldsLoading = ref(false)
const targetFieldsLoading = ref(false)
const parentFieldsLoading = ref(false)
const error = ref<string | null>(null)
const sourceFilterPairDrafts = ref<FilterPair[] | null>(null)

const settings = computed(() =>
  normalizeSettings(props.modelValue, props.targetCollection, props.targetParentField),
)
const sourceMode = computed<'tree' | 'table'>(() =>
  settings.value.source.mode === 'tree' ? 'tree' : 'table',
)
const sourceModeOptions = computed<Array<{ label: string; value: 'tree' | 'table' }>>(() => [
  { label: t('bulkInsertBuilder.tree', 'Tree'), value: 'tree' },
  { label: t('bulkInsertBuilder.table', 'Table'), value: 'table' },
])
const sourceNestedFieldOptions = computed(() =>
  nestedFieldOptions(
    sourceFields.value,
    sourceNestedFieldsByCollection.value,
    (field) =>
      relatedCollectionForCollectionField(
        relationDefinitions.value,
        settings.value.source.itemCollection,
        field.field,
      ) || field.schema?.foreign_key_table || '',
  ),
)
const sourceItemGroupFieldOptions = computed(() =>
  m2oFieldOptionsForCollection(
    settings.value.source.itemCollection,
    sourceFields.value,
    settings.value.source.groupCollection ?? '',
    sourceNestedFieldsByCollection.value,
  ),
)
const groupParentFieldOptions = computed(() => [
  { label: t('bulkInsertBuilder.noHierarchy', 'No hierarchy'), value: '' },
  ...m2oFieldOptionsForCollection(
    settings.value.source.groupCollection ?? '',
    sourceGroupFields.value,
    settings.value.source.groupCollection ?? '',
  ),
])
const sourceColumnOptions = computed(() => sourceNestedFieldOptions.value)
const sourceCollectionOptions = computed(() => {
  const targetCollection = settings.value.target.collection
  if (!targetCollection) return []

  // Direct M2O targets on the current object (e.g. visit_item.Item → item).
  const m2oTargets = uniqueFields(
    targetFields.value
      .filter((field) =>
        isFieldM2O(
          targetCollection,
          field.field,
          targetFields.value,
          relationDefinitions.value,
        ),
      )
      .map((field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          targetCollection,
          field.field,
        ) || field.schema?.foreign_key_table || '',
      )
      .filter(Boolean),
  )

  if (m2oTargets.length === 0) return []

  // Also include peer collections that point at the same M2O targets
  // (e.g. item_variant.Item → item).
  const allowedCollections = new Set(m2oTargets)
  for (const relation of relationDefinitions.value) {
    const many = relationManyCollection(relation)
    const one = relationRelatedCollection(relation)
    if (
      !many ||
      !one ||
      keysEqual(many, targetCollection) ||
      !m2oTargets.some((target) => keysEqual(target, one))
    ) {
      continue
    }
    allowedCollections.add(many)
  }

  return collections.value.filter((option) =>
    Array.from(allowedCollections).some((collection) => keysEqual(collection, option.value)),
  )
})
const optionalMappingSourceOptions = computed(() => [
  { label: t('bulkInsertBuilder.noSourceAssignment', 'No source assignment'), value: '' },
  ...sourceNestedFieldOptions.value,
])
const destinationMappingModeOptions = computed<Array<{ label: string; value: DestinationMappingMode }>>(() => [
  { label: t('bulkInsertBuilder.sourceFieldMode', 'Source field'), value: 'source' },
  { label: t('bulkInsertBuilder.fixedValueMode', 'Fixed value'), value: 'fixed' },
])
const sourceGroupFieldOptions = computed(() => fieldSelectOptions(sourceGroupFields.value))
const targetFieldOptions = computed(() => fieldSelectOptions(targetFields.value))
const sourceColumnValues = computed(() =>
  uniqueFields([
    ...(settings.value.source.itemLabelFields ?? []),
    ...(settings.value.source.fields ?? []),
  ]),
)
const destinationColumnValues = computed(() =>
  settings.value.target.columns.map((column) => column.field),
)
const validationErrors = computed(() => validateSettings())
const isValid = computed(() => validationErrors.value.length === 0)

watch(
  () => settings.value.source.itemCollection,
  () => {
    sourceFilterPairDrafts.value = null
  },
)

watch(
  () => [
    settings.value.source.itemCollection,
    relationDefinitions.value.length,
  ],
  ([collection]) => {
    // Drop previous collection fields immediately so the Source filter never
    // briefly (or stuck) shows the target / prior object fields.
    sourceFields.value = []
    sourceNestedFieldsByCollection.value = {}
    void loadSourceFieldsWithNested(String(collection ?? ''))
  },
  { immediate: true },
)

watch(
  () => settings.value.source.groupCollection,
  (collection) => {
    void loadFields(collection ?? '', sourceGroupFields, groupFieldsLoading)
  },
  { immediate: true },
)

watch(
  () => settings.value.target.collection,
  (collection) => {
    void loadFields(collection, targetFields, targetFieldsLoading)
  },
  { immediate: true },
)

watch(
  () => [
    settings.value.target.collection,
    destinationColumnValues.value.join('|'),
  ],
  () => {
    void loadEntityChildLookupFields()
  },
  { immediate: true },
)

watch(
  () => [
    settings.value.target.collection,
    settings.value.target.parentField,
    settings.value.target.itemField,
    props.targetParentField ?? '',
    relationDefinitions.value.length,
  ],
  () => {
    ensureTargetParentField()
    void loadParentFields()
  },
  { immediate: true },
)

watch(
  () => validationErrors.value.join('|'),
  () => {
    emit('validChange', isValid.value)
  },
  { immediate: true },
)

watch(
  () => [
    props.modelValue?.target?.defaultValues,
    props.modelValue?.source?.itemPrimaryKey,
    props.modelValue?.source?.groupPrimaryKey,
  ] as const,
  ([defaultValues, itemPrimaryKey, groupPrimaryKey]) => {
    const hasDefaults = Boolean(defaultValues && Object.keys(defaultValues).length > 0)
    const customPrimaryKey = Boolean(itemPrimaryKey && itemPrimaryKey !== 'id')
      || Boolean(groupPrimaryKey && groupPrimaryKey !== 'id')
    if (!hasDefaults && !customPrimaryKey) return
    emitSettings(props.modelValue)
  },
  { immediate: true },
)

void loadCollections()
void loadRelationDefinitions()

async function loadCollections(): Promise<void> {
  collectionsLoading.value = true
  error.value = null

  try {
    collections.value = await listUserCollections()
  } catch (err) {
    collections.value = []
    error.value =
      err instanceof Error
        ? err.message
        : t('bulkInsertBuilder.loadCollectionsError', 'Failed to load collections.')
  } finally {
    collectionsLoading.value = false
  }
}

async function loadRelationDefinitions(): Promise<void> {
  try {
    relationDefinitions.value = await getCachedRelations() as RelationDefinition[]
  } catch {
    relationDefinitions.value = []
  }
}

async function loadFields(
  collection: string,
  target: typeof sourceFields,
  loading: typeof sourceFieldsLoading,
): Promise<void> {
  if (!collection) {
    target.value = []
    return
  }

  loading.value = true

  try {
    const resolved = await resolveCollectionKey(collection)
    target.value = await getCachedCollectionFields(resolved)
  } catch {
    target.value = []
  } finally {
    loading.value = false
  }
}

async function loadSourceFieldsWithNested(collection: string): Promise<void> {
  if (!collection) {
    sourceFields.value = []
    sourceNestedFieldsByCollection.value = {}
    return
  }

  sourceFieldsLoading.value = true
  try {
    const resolved = await resolveCollectionKey(collection)
    sourceFields.value = await getCachedCollectionFields(resolved)
    const relationFields = sourceFields.value
      .map((field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          resolved,
          field.field,
        ) || field.schema?.foreign_key_table || '',
      )
      .filter(Boolean)
    const nestedEntries = await Promise.all(
      Array.from(new Set(relationFields)).map(async (relatedCollection) => [
        relatedCollection,
        await getCachedCollectionFields(await resolveCollectionKey(relatedCollection)),
      ] as const),
    )
    sourceNestedFieldsByCollection.value = Object.fromEntries(nestedEntries)
  } catch {
    sourceFields.value = []
    sourceNestedFieldsByCollection.value = {}
  } finally {
    sourceFieldsLoading.value = false
  }
}

async function loadEntityChildLookupFields(): Promise<void> {
  const collection = settings.value.target.collection
  const fieldNames = settings.value.target.columns.map((column) => column.field)
  if (!collection || fieldNames.length === 0) {
    entityChildLookupFields.value = new Set()
    return
  }

  try {
    const fieldSettings = await loadChildLookupFieldSettings(collection, fieldNames)
    entityChildLookupFields.value = new Set(Object.keys(fieldSettings))
  } catch {
    entityChildLookupFields.value = new Set()
  }
}

async function loadParentFields(): Promise<void> {
  const collection = parentCollection()
  if (!collection) {
    parentFields.value = []
    parentNestedFieldsByCollection.value = {}
    return
  }

  parentFieldsLoading.value = true
  try {
    const resolved = await resolveCollectionKey(collection)
    parentFields.value = await getCachedCollectionFields(resolved)
    const relationFields = parentFields.value
      .map((field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          resolved,
          field.field,
        ),
      )
      .filter((related): related is string => Boolean(related))
    const nestedEntries = await Promise.all(
      Array.from(new Set(relationFields)).map(async (relatedCollection) => [
        relatedCollection,
        await getCachedCollectionFields(relatedCollection),
      ] as const),
    )
    parentNestedFieldsByCollection.value = Object.fromEntries(nestedEntries)
  } catch {
    parentFields.value = []
    parentNestedFieldsByCollection.value = {}
  } finally {
    parentFieldsLoading.value = false
  }
}

/** Prefer explicit parent field; otherwise infer from target M2O relations. */
function resolveTargetParentField(): string {
  const explicit = (props.targetParentField || settings.value.target.parentField || '').trim()
  if (explicit) return explicit

  const targetCollection = settings.value.target.collection
  if (!targetCollection || relationDefinitions.value.length === 0) return ''

  const itemField = settings.value.target.itemField
  const candidates = relationDefinitions.value.filter((relation) => {
    const many = relationManyCollection(relation)
    const related = relationRelatedCollection(relation)
    const field = relationField(relation)
    return (
      keysEqual(many, targetCollection) &&
      Boolean(related) &&
      (!itemField || !keysEqual(field, itemField))
    )
  })

  if (candidates.length === 0) return ''

  const stem = targetCollection
    .replace(/_items?$/i, '')
    .replace(/items?$/i, '')
  const preferred = candidates.find((relation) => {
    const field = relationField(relation)
    const related = relationRelatedCollection(relation)
    return (
      /^(parent|header|owner)$/i.test(field) ||
      keysEqual(field, stem) ||
      keysEqual(related, stem)
    )
  })

  return relationField(preferred ?? candidates[0]!)
}

function ensureTargetParentField(): void {
  if (settings.value.target.parentField) return
  const inferred = resolveTargetParentField()
  if (!inferred) return
  updateTarget({ parentField: inferred })
}

function updateSource(patch: Partial<RelatedTransferSettings['source']>): void {
  emitSettings({
    ...settings.value,
    source: {
      ...settings.value.source,
      ...patch,
    },
  })
}

function updateTarget(patch: Partial<RelatedTransferSettings['target']>): void {
  emitSettings({
    ...settings.value,
    target: {
      ...settings.value.target,
      ...patch,
    },
  })
}

function updateMapping(patch: Partial<NonNullable<RelatedTransferSettings['mapping']>>): void {
  const { lookups: _ignored, ...rest } = patch
  emitSettings({
    ...settings.value,
    mapping: {
      defaults: settings.value.mapping?.defaults ?? {},
      copyFromSource: settings.value.mapping?.copyFromSource ?? {},
      values: settings.value.mapping?.values ?? {},
      lookups: {},
      ...rest,
    },
  })
}

function updateSourceMode(mode: 'tree' | 'table'): void {
  updateSource({ mode })
}

function updateSourceModeValue(mode: unknown): void {
  if (mode === 'tree' || mode === 'table') {
    updateSourceMode(mode)
  }
}

function updateSourceCollection(collection: string): void {
  updateSource({
    itemCollection: collection,
    itemLabelFields: [],
    fields: [],
    itemGroupField: '',
  })
}

function updateSourceColumns(fields: unknown): void {
  const selected = stringArray(fields)
  updateSource({
    itemLabelFields: selected,
    fields: selected,
  })
}

function matchingSourceFieldName(targetField: string): string | undefined {
  const sourceMatch = sourceFields.value.find((field) => keysEqual(field.field, targetField))
  return sourceMatch?.field
}

function updateDestinationColumns(fields: unknown): void {
  const selected = stringArray(fields)
  const previous = new Map(settings.value.target.columns.map((column) => [column.field, column]))
  const nextColumns = selected.map((field) => {
    const existing = previous.get(field)
    if (existing) return existing

    return {
      field,
      header: fieldLabel(field, targetFields.value),
      enabled: true,
    }
  })
  const selectedSet = new Set(selected)
  const nextMappings = Object.fromEntries(
    Object.entries(settings.value.mapping?.copyFromSource ?? {})
      .filter(([field]) => selectedSet.has(field)),
  )
  // Auto-wire Source field mappings for newly added columns with a same-named source field.
  for (const field of selected) {
    if (entityChildLookupFields.value.has(field)) continue
    if (Object.keys(nextMappings).some((mapped) => keysEqual(mapped, field))) continue
    if (settings.value.target.itemField && keysEqual(field, settings.value.target.itemField)) {
      continue
    }
    const sourceField = matchingSourceFieldName(field)
    if (sourceField) nextMappings[field] = sourceField
  }
  const nextDefaults = Object.fromEntries(
    Object.entries(settings.value.mapping?.defaults ?? {})
      .filter(([field]) => selectedSet.has(field) && !entityChildLookupFields.value.has(field)),
  )

  emitSettings({
    ...settings.value,
    target: {
      ...settings.value.target,
      columns: nextColumns,
      editableFields: (settings.value.target.editableFields ?? [])
        .filter((field) => selectedSet.has(field)),
      defaultValues: undefined,
    },
    mapping: {
      defaults: nextDefaults,
      copyFromSource: nextMappings,
      values: settings.value.mapping?.values ?? {},
      lookups: {},
    },
  })
}

function updateDestinationColumn(
  field: string,
  patch: Partial<DataTableColumnConfig>,
): void {
  updateTarget({
    columns: settings.value.target.columns.map((column) =>
      column.field === field ? { ...column, ...patch } : column,
    ),
  })
}

function reorderDestinationColumns(columns: DataTableColumnConfig[]): void {
  updateTarget({ columns: [...columns] })
}

function updateEditableFields(fields: unknown): void {
  updateTarget({ editableFields: stringArray(fields) })
}

function updateTotalFormulas(formulas: RelatedTransferTotalFormula[]): void {
  updateTarget({ totalFormulas: formulas })
}

function addTotalFormula(): void {
  updateTotalFormulas([...(settings.value.target.totalFormulas ?? []), { label: '', formula: '' }])
}

function updateTotalFormula(index: number, patch: Partial<RelatedTransferTotalFormula>): void {
  const next = (settings.value.target.totalFormulas ?? []).map((f, i) =>
    i === index ? { ...f, ...patch } : f,
  )
  updateTotalFormulas(next)
}

function removeTotalFormula(index: number): void {
  updateTotalFormulas((settings.value.target.totalFormulas ?? []).filter((_, i) => i !== index))
}

function isEntityLookupColumn(field: string): boolean {
  return entityChildLookupFields.value.has(field)
}

function destinationMappingMode(field: string): DestinationMappingMode {
  if (isEntityLookupColumn(field)) return 'source'
  if (Object.prototype.hasOwnProperty.call(settings.value.mapping?.defaults ?? {}, field)) {
    return 'fixed'
  }
  return 'source'
}

function updateDestinationMappingMode(
  targetField: string,
  mode: DestinationMappingMode,
): void {
  if (isEntityLookupColumn(targetField)) return

  const defaults = { ...(settings.value.mapping?.defaults ?? {}) }
  const copyFromSource = { ...(settings.value.mapping?.copyFromSource ?? {}) }

  delete defaults[targetField]
  delete copyFromSource[targetField]

  if (mode === 'fixed') {
    defaults[targetField] = ''
  }

  updateMapping({ defaults, copyFromSource })
}

function updateDestinationMappingModeValue(targetField: string, mode: unknown): void {
  if (mode === 'source' || mode === 'fixed') {
    updateDestinationMappingMode(targetField, mode)
  }
}

function updateSourceAssignment(targetField: string, sourceField: string): void {
  if (isEntityLookupColumn(targetField)) return

  const copyFromSource = { ...(settings.value.mapping?.copyFromSource ?? {}) }
  const defaults = { ...(settings.value.mapping?.defaults ?? {}) }

  if (sourceField) {
    copyFromSource[targetField] = sourceField
  } else {
    delete copyFromSource[targetField]
  }
  delete defaults[targetField]

  updateMapping({ defaults, copyFromSource })
}

function defaultValueText(field: string): string {
  const value = settings.value.mapping?.defaults?.[field]
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function updateDefaultValue(targetField: string, value: string): void {
  if (isEntityLookupColumn(targetField)) return

  const defaults = { ...(settings.value.mapping?.defaults ?? {}) }
  const copyFromSource = { ...(settings.value.mapping?.copyFromSource ?? {}) }
  const trimmed = value.trim()

  if (!trimmed) {
    delete defaults[targetField]
  } else {
    defaults[targetField] = parseFixedValue(trimmed)
  }
  delete copyFromSource[targetField]

  updateMapping({ defaults, copyFromSource })
}

function parseFixedValue(value: string): unknown {
  if (value === 'true' || value === 'false' || value === 'null') {
    return JSON.parse(value) as unknown
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }

  return value
}

function sourceFilterPairs(): FilterPair[] {
  if (sourceFilterPairDrafts.value !== null) return sourceFilterPairDrafts.value
  return filterPairsFromFilter(settings.value.source.filter ?? null)
}

function addSourceFilterPair(): void {
  updateSourceFilterPairs([...sourceFilterPairs(), { sourceField: '', filterField: '' }])
}

function updateSourceFilterPair(index: number, patch: Partial<FilterPair>): void {
  const pairs = sourceFilterPairs()
  pairs[index] = { ...(pairs[index] ?? { sourceField: '', filterField: '' }), ...patch }
  updateSourceFilterPairs(pairs)
}

function removeSourceFilterPair(index: number): void {
  updateSourceFilterPairs(sourceFilterPairs().filter((_, i) => i !== index))
}

function updateSourceFilterPairs(pairs: FilterPair[]): void {
  sourceFilterPairDrafts.value = pairs
  const extra = stripFilterPairs(settings.value.source.filter ?? null)
  const pairFilter = filterFromPairs(pairs)
  const merged = { ...(extra ?? {}), ...(pairFilter ?? {}) }
  updateSource({ filter: Object.keys(merged).length > 0 ? merged : null })
}

const sourceFilterFieldOptions = computed(() => {
  // Options for the left Source filter dropdown: fields of the selected
  // Source collection only (e.g. price_item), not the target object.
  if (!settings.value.source.itemCollection) return []
  return fieldSelectOptions(sourceFields.value)
})

function validateSettings(): string[] {
  const errors: string[] = []

  if (!settings.value.source.itemCollection) {
    errors.push(t('bulkInsertBuilder.sourceCollectionRequired', 'Source collection is required.'))
  }
  if (sourceMode.value === 'tree') {
    if (!settings.value.source.groupCollection) {
      errors.push(t('bulkInsertBuilder.groupCollectionRequired', 'Group collection is required for tree source layout.'))
    }
    if (!settings.value.source.itemGroupField) {
      errors.push(t('bulkInsertBuilder.itemGroupFieldRequired', 'Source group field is required for tree source layout.'))
    }
  }
  if (!settings.value.target.itemField) {
    errors.push(t('bulkInsertBuilder.itemFieldRequired', 'Destination item field is required.'))
  }
  if (settings.value.target.columns.length === 0) {
    errors.push(t('bulkInsertBuilder.destinationColumnsRequired', 'Add at least one destination column.'))
  }

  return errors
}

function emitSettings(next: RelatedTransferSettings): void {
  emit('update:modelValue', normalizeSettings(next, props.targetCollection, props.targetParentField))
}

function normalizeSettings(
  value: RelatedTransferSettings,
  targetCollection = '',
  targetParentField = '',
): RelatedTransferSettings {
  const source = value.source ?? {
    mode: 'tree' as RelatedTransferSourceMode,
    itemCollection: '',
  }
  const target = value.target ?? {
    collection: targetCollection,
    parentField: '',
    itemField: '',
    columns: [],
  }
  const folded = foldDefaultValuesIntoMapping(
    target.defaultValues,
    value.mapping?.copyFromSource ?? {},
    value.mapping?.defaults ?? {},
  )

  return {
    source: {
      mode: source.mode ?? 'tree',
      groupCollection: source.groupCollection ?? '',
      itemCollection: source.itemCollection ?? '',
      groupPrimaryKey: 'id',
      groupParentField: source.groupParentField ?? null,
      groupLabelField: source.groupLabelField || 'name',
      itemPrimaryKey: 'id',
      itemGroupField: source.itemGroupField ?? '',
      itemLabelFields: source.itemLabelFields ?? [],
      fields: source.fields ?? [],
      filter: source.filter ?? null,
    },
    target: {
      collection: targetCollection || target.collection,
      parentField: targetParentField || target.parentField || '',
      itemField: target.itemField ?? '',
      duplicateKey: target.duplicateKey ?? target.itemField ?? '',
      columns: target.columns ?? [],
      editableFields: target.editableFields ?? [],
      totalFormulas: target.totalFormulas ?? [],
    },
    mapping: {
      defaults: folded.defaults,
      copyFromSource: folded.copyFromSource,
      values: value.mapping?.values ?? {},
      lookups: {},
    },
  }
}

function foldDefaultValuesIntoMapping(
  defaultValues: Record<string, unknown> | undefined,
  copyFromSource: Record<string, string>,
  defaults: Record<string, unknown>,
): { copyFromSource: Record<string, string>; defaults: Record<string, unknown> } {
  const nextCopy = { ...copyFromSource }
  const nextDefaults = { ...defaults }

  for (const [field, value] of Object.entries(defaultValues ?? {})) {
    const mapped = Object.entries(nextCopy).some(
      ([key, sourceField]) => keysEqual(key, field) && Boolean(sourceField),
    )
    const fixed = Object.keys(nextDefaults).some((key) => keysEqual(key, field))
    if (mapped || fixed) continue

    if (typeof value === 'string') {
      const match = /^\$source\.([A-Za-z0-9_.]+)$/.exec(value.trim())
      if (match?.[1]) {
        nextCopy[field] = match[1]
        continue
      }
    }

    if (value === undefined || value === null || value === '') continue
    nextDefaults[field] = value
  }

  return { copyFromSource: nextCopy, defaults: nextDefaults }
}

function relatedCollectionOf(collection: string, field: FieldDefinition): string {
  return relatedCollectionForCollectionField(
    relationDefinitions.value,
    collection,
    field.field,
  ) || field.schema?.foreign_key_table || ''
}

function m2oFieldsPointingAt(
  collection: string,
  fields: FieldDefinition[],
  targetCollection: string,
): FieldDefinition[] {
  if (!collection || !targetCollection) return []
  return fields.filter((field) => {
    if (!isFieldM2O(collection, field.field, fields, relationDefinitions.value)) return false
    return keysEqual(relatedCollectionOf(collection, field), targetCollection)
  })
}

/** Direct and one-hop M2O fields whose related collection is `targetCollection`. */
function m2oFieldOptionsForCollection(
  collection: string,
  fields: FieldDefinition[],
  targetCollection: string,
  nestedFieldsByCollection: Record<string, FieldDefinition[]> = {},
): FieldOption[] {
  if (!collection || !targetCollection) return []

  const direct = fieldSelectOptions(m2oFieldsPointingAt(collection, fields, targetCollection))
  const nested = fields.flatMap((field) => {
    if (!isFieldM2O(collection, field.field, fields, relationDefinitions.value)) return []
    const relatedCollection = relatedCollectionOf(collection, field)
    if (!relatedCollection || keysEqual(relatedCollection, targetCollection)) return []
    const [base] = fieldSelectOptions([field])
    if (!base) return []
    const nestedFields = nestedFieldsByCollection[relatedCollection] ?? []
    return fieldSelectOptions(m2oFieldsPointingAt(relatedCollection, nestedFields, targetCollection))
      .map((nestedField) => ({
        label: `${base.label} / ${nestedField.label}`,
        value: `${field.field}.${nestedField.value}`,
      }))
  })

  return [...direct, ...nested]
}

function parentFilterFieldOptions(): FieldOption[] {
  return nestedFieldOptions(
    parentFields.value,
    parentNestedFieldsByCollection.value,
    (field) =>
      relatedCollectionForCollectionField(
        relationDefinitions.value,
        parentCollection(),
        field.field,
      ) || field.schema?.foreign_key_table || ''
  )
}

function parentCollection(): string {
  const parentField = resolveTargetParentField()
  if (!parentField) return ''

  const field = targetFields.value.find((item) =>
    keysEqual(item.field, parentField),
  )
  return relatedCollectionForCollectionField(
    relationDefinitions.value,
    settings.value.target.collection,
    parentField,
  ) || field?.schema?.foreign_key_table || ''
}

function fieldLabel(field: string, fields: FieldDefinition[]): string {
  const definition = fields.find((item) => item.field === field)
  return definition?.meta?.note?.trim() || humanizeFieldName(field)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((field): field is string => typeof field === 'string' && field.length > 0)
    : []
}

function uniqueFields(fields: string[]): string[] {
  return Array.from(new Set(fields.filter(Boolean)))
}
</script>

<template>
  <div class="bulk-insert-builder grid gap-3">
    <Message
      v-if="error"
      severity="error"
      :closable="false"
    >
      {{ error }}
    </Message>

    <Message
      v-if="validationErrors.length > 0"
      severity="warn"
      :closable="false"
    >
      <ul class="m-0 pl-4">
        <li v-for="item in validationErrors" :key="item">
          {{ item }}
        </li>
      </ul>
    </Message>

    <div class="grid gap-3">
      <section class="bulk-insert-panel">
        <h2 class="bulk-insert-panel__title">
          {{ t('bulkInsertBuilder.sourcePanel', 'Source') }}
        </h2>

        <div class="grid gap-3">
          <div class="grid gap-3 grid-cols-[minmax(160px,1.2fr)_auto_minmax(200px,1.6fr)] items-end max-[900px]:grid-cols-1">
            <label class="bulk-insert-field">
              {{ t('bulkInsertBuilder.sourceCollection', 'Source collection') }}
              <Select
                :model-value="settings.source.itemCollection"
                :options="sourceCollectionOptions"
                option-label="label"
                option-value="value"
                :loading="collectionsLoading || targetFieldsLoading"
                filter
                fluid
                @update:model-value="updateSourceCollection(String($event ?? ''))"
              />
            </label>

            <label class="bulk-insert-field">
              {{ t('bulkInsertBuilder.sourceLayout', 'Source layout') }}
              <SelectButton
                :model-value="sourceMode"
                :options="sourceModeOptions"
                option-label="label"
                option-value="value"
                @update:model-value="updateSourceModeValue"
              />
            </label>

            <label class="bulk-insert-field">
              {{ t('bulkInsertBuilder.visibleSourceColumns', 'Visible source columns') }}
              <MultiSelect
                :model-value="sourceColumnValues"
                :options="sourceColumnOptions"
                option-label="label"
                option-value="value"
                display="chip"
                :loading="sourceFieldsLoading"
                filter
                fluid
                @update:model-value="updateSourceColumns"
              />
            </label>
          </div>

          <section
            v-if="sourceMode === 'tree'"
            class="bulk-insert-subpanel grid gap-3"
          >
            <h3 class="bulk-insert-subpanel__title m-0">{{ t('bulkInsertBuilder.treeSettings', 'Tree settings') }}</h3>
            <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
              <label class="bulk-insert-field">
                {{ t('bulkInsertBuilder.groupCollection', 'Group collection') }}
                <Select
                  :model-value="settings.source.groupCollection"
                  :options="collections"
                  option-label="label"
                  option-value="value"
                  :loading="collectionsLoading"
                  filter
                  fluid
                  @update:model-value="updateSource({ groupCollection: String($event ?? '') })"
                />
              </label>

              <label class="bulk-insert-field">
                {{ t('bulkInsertBuilder.groupLabelField', 'Group label field') }}
                <Select
                  :model-value="settings.source.groupLabelField"
                  :options="sourceGroupFieldOptions"
                  option-label="label"
                  option-value="value"
                  :loading="groupFieldsLoading"
                  filter
                  fluid
                  @update:model-value="updateSource({ groupLabelField: String($event ?? '') })"
                />
              </label>

              <label class="bulk-insert-field">
                {{ t('bulkInsertBuilder.groupParentField', 'Group parent field') }}
                <Select
                  :model-value="settings.source.groupParentField ?? ''"
                  :options="groupParentFieldOptions"
                  option-label="label"
                  option-value="value"
                  :loading="groupFieldsLoading"
                  filter
                  fluid
                  @update:model-value="updateSource({ groupParentField: $event ? String($event) : null })"
                />
              </label>

              <label class="bulk-insert-field">
                {{ t('bulkInsertBuilder.itemGroupField', 'Source group field') }}
                <Select
                  :model-value="settings.source.itemGroupField"
                  :options="sourceItemGroupFieldOptions"
                  option-label="label"
                  option-value="value"
                  :loading="sourceFieldsLoading"
                  filter
                  fluid
                  @update:model-value="updateSource({ itemGroupField: String($event ?? '') })"
                />
              </label>
            </div>
          </section>

          <section class="grid gap-2">
            <h3 class="bulk-insert-subpanel__title m-0">{{ t('bulkInsertBuilder.sourceFilter', 'Source filter') }}</h3>
            <FilterPairEditor
              :pairs="sourceFilterPairs()"
              :source-options="sourceFilterFieldOptions"
              :filter-options="parentFilterFieldOptions()"
              :source-placeholder="t('bulkInsertBuilder.sourceCollectionField', 'Source collection field')"
              :filter-placeholder="t('bulkInsertBuilder.parentFilterField', 'Parent field')"
              :add-label="t('bulkInsertBuilder.addSourceFilterPair', 'Add filter condition')"
              :source-loading="sourceFieldsLoading"
              :filter-loading="parentFieldsLoading"
              @add="addSourceFilterPair"
              @update-pair="updateSourceFilterPair"
              @remove="removeSourceFilterPair"
            />
          </section>
        </div>
      </section>

      <section class="bulk-insert-panel">
        <h2 class="bulk-insert-panel__title">
          {{ t('bulkInsertBuilder.destinationPanel', 'Destination') }}
        </h2>

        <div class="grid gap-3">
          <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            <label class="bulk-insert-field">
              {{ t('bulkInsertBuilder.itemField', 'Item field') }}
              <Select
                :model-value="settings.target.itemField"
                :options="targetFieldOptions"
                option-label="label"
                option-value="value"
                :loading="targetFieldsLoading"
                filter
                fluid
                @update:model-value="updateTarget({
                  itemField: String($event ?? ''),
                  duplicateKey: String($event ?? ''),
                })"
              />
            </label>
          </div>

          <label class="bulk-insert-field">
            {{ t('bulkInsertBuilder.destinationColumns', 'Destination columns') }}
            <MultiSelect
              :model-value="destinationColumnValues"
              :options="targetFieldOptions"
              option-label="label"
              option-value="value"
              display="chip"
              :loading="targetFieldsLoading"
              filter
              fluid
              @update:model-value="updateDestinationColumns"
            />
          </label>

          <label class="bulk-insert-field">
            {{ t('bulkInsertBuilder.editableDestinationFields', 'Editable destination fields') }}
            <MultiSelect
              :model-value="settings.target.editableFields ?? []"
              :options="settings.target.columns"
              option-label="header"
              option-value="field"
              display="chip"
              fluid
              @update:model-value="updateEditableFields"
            />
          </label>

          <section class="grid gap-2">
            <div class="flex items-center justify-between gap-2">
              <span class="bulk-insert-subpanel__title">
                {{ t('bulkInsertBuilder.totalFormulas', 'Total formulas') }}
              </span>
              <Button
                :label="t('bulkInsertBuilder.addTotalFormula', 'Add formula')"
                size="small"
                severity="secondary"
                text
                icon="pi pi-plus"
                @click="addTotalFormula"
              />
            </div>
            <div
              v-for="(formula, idx) in settings.target.totalFormulas ?? []"
              :key="idx"
              class="bulk-insert-card grid grid-cols-[1fr_1fr_auto] gap-2 items-start"
            >
              <label class="bulk-insert-field">
                {{ t('bulkInsertBuilder.formulaLabel', 'Label') }}
                <InputText
                  :model-value="formula.label"
                  size="small"
                  fluid
                  :placeholder="t('bulkInsertBuilder.formulaLabelPlaceholder', 'e.g. Total Amount')"
                  @update:model-value="updateTotalFormula(idx, { label: String($event ?? '') })"
                />
              </label>
              <label class="bulk-insert-field">
                {{ t('bulkInsertBuilder.formulaExpression', 'Formula') }}
                <InputText
                  :model-value="formula.formula"
                  size="small"
                  fluid
                  :placeholder="t('bulkInsertBuilder.formulaExpressionPlaceholder', 'e.g. qty * price + 0.5')"
                  @update:model-value="updateTotalFormula(idx, { formula: String($event ?? '') })"
                />
                <span class="bulk-insert-hint">
                  {{ t('bulkInsertBuilder.formulaHint', 'Fields:') }}
                  <span
                    v-for="col in settings.target.columns"
                    :key="col.field"
                    class="bulk-insert-chip"
                  >{{ col.field }}</span>
                </span>
              </label>
              <Button
                icon="pi pi-times"
                size="small"
                text
                rounded
                severity="danger"
                class="mt-5"
                :aria-label="t('common.remove', 'Remove')"
                @click="removeTotalFormula(idx)"
              />
            </div>
          </section>

          <section class="grid gap-2">
            <div class="bulk-insert-mapping-header grid grid-cols-[auto_minmax(110px,1fr)_minmax(80px,0.5fr)_minmax(120px,0.8fr)_minmax(150px,1fr)] gap-2 px-2">
              <span aria-hidden="true"></span>
              <span>{{ t('bulkInsertBuilder.destinationHeader', 'Destination') }}</span>
              <span>{{ t('common.field', 'Field') }}</span>
              <span>{{ t('bulkInsertBuilder.mappingMode', 'Mode') }}</span>
              <span>{{ t('bulkInsertBuilder.mappingValue', 'Mapping') }}</span>
            </div>

            <VueDraggableNext
              :list="settings.target.columns"
              item-key="field"
              handle=".bulk-insert-drag"
              tag="div"
              class="grid gap-2"
              ghost-class="opacity-50"
              @change="reorderDestinationColumns(settings.target.columns)"
            >
              <div
                v-for="column in settings.target.columns"
                :key="column.field"
                class="bulk-insert-card grid items-center gap-2 grid-cols-[auto_minmax(110px,1fr)_minmax(80px,0.5fr)_minmax(120px,0.8fr)_minmax(150px,1fr)]"
              >
                <button
                  type="button"
                  class="bulk-insert-drag inline-flex items-center justify-center border-0 bg-transparent px-0.5 py-0.5 text-surface-300 cursor-grab select-none tracking-[-0.15em] leading-none active:cursor-grabbing"
                  :aria-label="t('bulkInsertBuilder.reorderColumn', 'Drag to reorder')"
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <InputText
                  :model-value="column.header"
                  class="w-full"
                  @update:model-value="updateDestinationColumn(column.field, { header: String($event ?? '') })"
                />
                <span class="bulk-insert-hint truncate">
                  {{ fieldLabel(column.field, targetFields) }}
                </span>
                <Select
                  v-if="!isEntityLookupColumn(column.field)"
                  :model-value="destinationMappingMode(column.field)"
                  :options="destinationMappingModeOptions"
                  option-label="label"
                  option-value="value"
                  fluid
                  @update:model-value="updateDestinationMappingModeValue(column.field, $event)"
                />
                <Tag
                  v-else
                  :value="t('bulkInsertBuilder.entityLookupMode', 'Entity lookup')"
                  severity="info"
                />
                <InputText
                  v-if="!isEntityLookupColumn(column.field) && destinationMappingMode(column.field) === 'fixed'"
                  :model-value="defaultValueText(column.field)"
                  class="w-full"
                  :placeholder="t('bulkInsertBuilder.defaultValuePlaceholder', 'Fixed value')"
                  @update:model-value="updateDefaultValue(column.field, String($event ?? ''))"
                />
                <Select
                  v-else-if="!isEntityLookupColumn(column.field) && destinationMappingMode(column.field) === 'source'"
                  :model-value="settings.mapping?.copyFromSource?.[column.field] ?? ''"
                  :options="optionalMappingSourceOptions"
                  option-label="label"
                  option-value="value"
                  :loading="sourceFieldsLoading"
                  show-clear
                  filter
                  fluid
                  @update:model-value="updateSourceAssignment(column.field, String($event ?? ''))"
                />
                <span v-else-if="isEntityLookupColumn(column.field)" />
              </div>
            </VueDraggableNext>

            <p
              v-if="settings.target.columns.length === 0"
              class="bulk-insert-hint m-0"
            >
              {{ t('bulkInsertBuilder.noDestinationColumns', 'Add destination columns to configure mappings.') }}
            </p>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.bulk-insert-builder {
  --bulk-wash: #edf3f4;
  --bulk-ink: #37352f;
  font-family: Inter, system-ui, sans-serif;
  color: var(--bulk-ink);
}

.bulk-insert-panel {
  border-radius: 8px;
  background: var(--bulk-wash);
  padding: 0.75rem 0.75rem 0.85rem;
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.bulk-insert-panel__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: #111;
}

.bulk-insert-subpanel {
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  padding: 0.65rem 0.7rem;
}

.bulk-insert-subpanel__title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #111;
}

.bulk-insert-field {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.bulk-insert-card {
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  background: #fff;
}

.bulk-insert-mapping-header {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.45);
}

.bulk-insert-hint {
  font-size: 0.75rem;
  font-weight: 400;
  color: rgba(55, 53, 47, 0.45);
}

.bulk-insert-chip {
  display: inline-block;
  margin-right: 0.25rem;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  background: rgba(55, 53, 47, 0.06);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  color: var(--bulk-ink);
}
</style>
