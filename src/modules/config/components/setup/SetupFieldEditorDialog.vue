<script lang="ts">
export default {
  name: 'SetupFieldEditorDialog',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { LayoutFieldChildLookup } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import { fetchEntityMeta } from '@/core/graphql/entityMetaApi'
import {
  fetchEntityFieldsAndRelations,
  type RegistryFieldInputDto,
  type RegistryFieldListRow,
} from '@/core/graphql/fieldsApi'
import { normalizeFieldInterface } from '@/core/graphql/schemaMapper'
import { parseDynamicPicklistSource } from '@/core/dynamicPicklist'
import {
  defaultSensitivitySource,
  parseSensitivitySource,
} from '@/core/sensitivityField'
import { getCachedRelations } from '@/modules/entities/services/collectionSchema'
import {
  keysEqual,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { useChildLookupFieldConfig } from '@/modules/config/composables/useChildLookupFieldConfig'
import ChildLookupSettingsDialog from '@/modules/config/components/ChildLookupSettingsDialog.vue'
import FilterPairEditor from '@/modules/config/components/FilterPairEditor.vue'
import {
  filterFromPairs,
  filterPairsFromFilter,
  type FilterPair,
} from '@/core/relatedTransferFilterPairs'
import { isOrgCurrencyPlaceholderAffix } from '@/core/orgLocale'
import { FILES_ASSET_COLLECTION } from '@/core/filesField'
import { clampSensitivity, sensitivityOptions } from '@/core/fieldSensitivity'

const DEFAULT_IMAGE_FILES_OPTIONS = {
  multiple: false,
  display: 'thumbnail' as const,
  allowedMimeTypes: ['image/'] as string[],
  columns: [] as string[],
}

function isFileImageInterface(iface: string | null | undefined): boolean {
  const value = normalizeFieldInterface(iface || '').toLowerCase()
  return (
    value === 'file' ||
    value === 'file-image' ||
    value.includes('file-image')
  )
}

interface ChoiceRow {
  text: string
  value: string
}

interface JsonColumnRow {
  name: string
  type: 'string' | 'number' | 'boolean'
}

type ComputeMode = 'none' | 'formula' | 'rollup' | 'autoNumber'

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  field: RegistryFieldListRow | null
  collection: string
  entityOptions: Array<{ label: string; value: string }>
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [
    payload: {
      input: RegistryFieldInputDto
      applyDdl: boolean
      childLookup?: {
        enabled: boolean
        settings: LayoutFieldChildLookup | null
      }
    },
  ]
}>()

const { t } = useTranslation()

function hintTooltip(value: string) {
  return { value, class: 'property-hint-tooltip' }
}

const form = reactive({
  apiName: '',
  label: '',
  /** UI type; FORMULA / ROLLUP map to storage type via resultType. */
  type: 'STRING',
  resultType: 'FLOAT',
  interface: 'input',
  required: false,
  readonly: false,
  hidden: false,
  isUnique: false,
  isIndexed: false,
  /** Field-level security tier (0 none, 1 restricted, 2 confidential). */
  sensitivity: 0,
  /** M2O only: include related Display Template in list search. */
  useInSearch: false,
  sort: 0,
  isLookup: false,
  /** none | M2O | M2M */
  relationKind: 'none' as 'none' | 'M2O' | 'M2M',
  relatedEntity: null as string | null,
  /** M2O FK ON DELETE — default RESTRICT. */
  onDelete: 'RESTRICT' as 'CASCADE' | 'SET NULL' | 'RESTRICT',
  applyDdl: true,
  defaultValue: null as string | number | boolean | null,
  /** `item.base_price` path (or legacy bare name) copied on create when source M2O / parent is set. */
  defaultFromParent: '',
  choices: [] as ChoiceRow[],
  dateFormat: 'short',
  dateFormatCustom: '',
  currencySuffix: '',
  /** NUMERIC Size (precision); Decimals = scale. */
  numericPrecision: 18,
  decimalPlaces: 2,
  jsonColumns: [] as JsonColumnRow[],
  picklistMode: 'static' as 'static' | 'dynamic',
  dynamicRelationField: '',
  dynamicJsonField: '',
  dynamicValueColumn: '',
  sensitivityRelationField: '',
  sensitivityPatogenField: 'patogen',
  sensitivityPharmacyField: 'pharmacy',
  sensitivityResistanceField: 'resistance',
  sensitivityValueColumn: 'name',
  formulaTemplate: '',
  rollupChildEntity: null as string | null,
  rollupParentField: null as string | null,
  rollupValueField: null as string | null,
  rollupOp: 'SUM' as string,
  /** Virtual = on-read ALIAS; Physical = stored numeric column. */
  rollupStorage: 'virtual' as 'virtual' | 'physical',
  displayFormat: '{0000}',
  startingNumber: 1,
})

const childFieldOptions = ref<Array<{ label: string; value: string }>>([])
const childLookupFieldOptions = ref<Array<{ label: string; value: string }>>([])
const childFieldsLoading = ref(false)
const relatedChildEntityOptions = ref<Array<{ label: string; value: string }>>([])
const relatedChildrenLoading = ref(false)
const parentDefaultFieldOptions = ref<Array<{ label: string; value: string }>>([])
const parentDefaultFieldsLoading = ref(false)
const apiNameTouched = ref(false)
/** Literal child-record filters for live rollups (e.g. status = Draft). */
const rollupFilterPairs = ref<FilterPair[]>([])

function toApiName(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

const resolvedApiName = computed(
  () => form.apiName.trim() || toApiName(form.label),
)

const rollupOpOptions = computed(() => [
  { label: 'SUM', value: 'SUM' },
  { label: 'COUNT', value: 'COUNT' },
  { label: 'AVG', value: 'AVG' },
  { label: 'MIN', value: 'MIN' },
  { label: 'MAX', value: 'MAX' },
])

const rollupStorageOptions = computed(() => [
  {
    label: t('setup.fields.rollupStorageVirtual', 'Virtual (on the fly)'),
    value: 'virtual' as const,
  },
  {
    label: t('setup.fields.rollupStoragePhysical', 'Physical (stored)'),
    value: 'physical' as const,
  },
])

const rollupHintText = computed(() =>
  form.rollupStorage === 'physical'
    ? t(
        'setup.fields.rollupHintPhysical',
        'Stored on this object. Recalculated when child records change.',
      )
    : t(
        'setup.fields.rollupHintVirtual',
        'Computed on the fly when reading records. Not stored on this object.',
      ),
)

const isVirtualRollup = computed(
  () => isRollupType.value && form.rollupStorage === 'virtual',
)

/** Mustache example kept out of the template so Vue does not parse nested `{{`. */
const FORMULA_EXAMPLE = '{{ MULTIPLY(price, quantity) }}'
const formulaHintText = computed(() =>
  t(
    'setup.fields.formulaHint',
    `Same-record template. Example: ${FORMULA_EXAMPLE}`,
  ),
)

const isFormulaType = computed(() => form.type === 'FORMULA')
const isRollupType = computed(() => form.type === 'ROLLUP')
const isAutoNumberType = computed(() => form.type === 'AUTO_NUMBER')
const isAddressType = computed(() => form.type === 'ADDRESS')
const isImageType = computed(() => form.type === 'IMAGE')
const isJsonType = computed(() => form.type === 'JSON')
const isJsonList = computed(
  () => isJsonType.value && normalizeFieldInterface(form.interface) === 'json-list',
)
const isJsonSensitivity = computed(
  () =>
    isJsonType.value &&
    normalizeFieldInterface(form.interface) === 'json-sensitivity',
)
const isComputed = computed(
  () => isFormulaType.value || isRollupType.value || isAutoNumberType.value,
)
const computeMode = computed<ComputeMode>(() => {
  if (isFormulaType.value) return 'formula'
  if (isRollupType.value) return 'rollup'
  if (isAutoNumberType.value) return 'autoNumber'
  return 'none'
})
const storageType = computed(() => {
  if (isAutoNumberType.value) return 'STRING'
  if (isAddressType.value) return 'JSON'
  if (isImageType.value) return 'UUID'
  return isComputed.value ? form.resultType : form.type
})

const autoNumberPreview = computed(() => {
  const format = form.displayFormat.trim() || '{0000}'
  const sequence = Number.isFinite(form.startingNumber)
    ? Math.max(0, Math.trunc(form.startingNumber))
    : 1
  const now = new Date()
  const withSequence = format.replace(/\{(0+)\}/g, (_m, zeros: string) => {
    const width = Math.min(10, Math.max(1, zeros.length))
    const raw = String(sequence)
    return width <= 1 ? raw : raw.padStart(width, '0')
  })
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return withSequence
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{MM\}/g, month)
    .replace(/\{DD\}/g, day)
})

const relationKindOptions = computed(() => [
  { label: t('setup.fields.relationNone', 'None'), value: 'none' },
  {
    label: t('setup.fields.lookupM2O', 'Lookup (Many-to-One)'),
    value: 'M2O',
  },
  {
    label: t('setup.fields.relationM2M', 'Many-to-Many'),
    value: 'M2M',
  },
])

const onDeleteOptions = computed(() => [
  {
    label: t(
      'setup.fields.onDeleteRestrict',
      'Restrict (block archive / delete)',
    ),
    value: 'RESTRICT',
  },
  {
    label: t(
      'setup.fields.onDeleteCascade',
      'Cascade (archive & restore children)',
    ),
    value: 'CASCADE',
  },
  {
    label: t('setup.fields.onDeleteSetNull', 'Set Null'),
    value: 'SET NULL',
  },
])

const isRelationField = computed(
  () => form.relationKind === 'M2O' || form.relationKind === 'M2M',
)
const isM2ORelation = computed(() => form.relationKind === 'M2O')
const isM2MRelation = computed(() => form.relationKind === 'M2M')
const relationKindLocked = computed(
  () =>
    props.mode === 'edit' &&
    (props.field?.relationKind === 'M2O' || props.field?.relationKind === 'M2M'),
)
const supportsChildLookup = computed(
  () =>
    !isM2MRelation.value &&
    !isComputed.value &&
    !isAddressType.value &&
    !isImageType.value &&
    !isJsonType.value,
)

const {
  enabled: childLookupEnabled,
  dialogVisible: childLookupDialogVisible,
  draft: childLookupDraft,
  settingsSummary: childLookupSettingsSummary,
  isPicklist: childLookupIsPicklist,
  defaultMode: childLookupDefaultMode,
  defaultModeOptions: childLookupDefaultModeOptions,
  sourceFieldOptions: childLookupSourceFieldOptions,
  filteredCollectionOptions: childLookupCollectionOptions,
  childFieldOptions: childLookupChildFieldOptions,
  defaultFieldOptions: childLookupDefaultFieldOptions,
  parentRelationOptions: childLookupParentRelationOptions,
  parentRelationField: childLookupParentRelationField,
  showParentCollectionSelector: childLookupShowParentSelector,
  parentFilterFieldOptions: childLookupParentFilterFieldOptions,
  sourceTokenFieldOptions: childLookupSourceTokenFieldOptions,
  filterPairs: childLookupFilterPairs,
  childFieldsLoading: childLookupFieldsLoading,
  sourceFieldsLoading: childLookupSourceFieldsLoading,
  parentFieldsLoading: childLookupParentFieldsLoading,
  resetFromStored: resetChildLookupFromStored,
  setEnabled: setChildLookupEnabled,
  updateSettings: updateChildLookupSettings,
  updateSourceField: updateChildLookupSourceField,
  updateCollection: updateChildLookupCollection,
  setDefaultMode: setChildLookupDefaultMode,
  updateParentField: updateChildLookupParentField,
  addFilterPair: addChildLookupFilterPair,
  updateFilterPair: updateChildLookupFilterPair,
  removeFilterPair: removeChildLookupFilterPair,
  currentSettings: currentChildLookupSettings,
} = useChildLookupFieldConfig({
  collection: () => props.collection,
  fieldApiName: () =>
    props.mode === 'edit' && props.field?.apiName
      ? props.field.apiName
      : resolvedApiName.value,
  fieldLabel: () => form.label,
  relatedEntity: () => form.relatedEntity,
  isM2O: () => isM2ORelation.value,
})

watch(
  () => form.relationKind,
  (kind) => {
    form.isLookup = kind === 'M2O' || kind === 'M2M'
    if (kind === 'none') {
      form.relatedEntity = null
    }
    if (kind === 'M2O' && !form.onDelete) {
      form.onDelete = 'RESTRICT'
    }
  },
)

/** SET NULL cannot keep a Required lookup populated after parent delete. */
watch(
  () => [form.onDelete, form.required, form.relationKind] as const,
  ([onDelete, required, kind]) => {
    if (kind !== 'M2O') return
    if (onDelete === 'SET NULL' && required) {
      form.required = false
    }
  },
)

const isNameField = computed(
  () =>
    form.apiName === 'name' ||
    (props.mode === 'edit' && props.field?.apiName === 'name'),
)

const typeOptions = computed(() => {
  if (isNameField.value) {
    return [
      {
        label: t('setup.fields.typeAutoNumber', 'Auto Number'),
        value: 'AUTO_NUMBER',
      },
      { label: t('setup.fields.typeString', 'Text'), value: 'STRING' },
    ]
  }
  return [
    { label: t('setup.fields.typeString', 'Text'), value: 'STRING' },
    { label: t('setup.fields.typeInteger', 'Integer'), value: 'INTEGER' },
    { label: t('setup.fields.typeFloat', 'Number'), value: 'FLOAT' },
    { label: t('setup.fields.typeBoolean', 'Checkbox'), value: 'BOOLEAN' },
    { label: t('setup.fields.typeDate', 'Date'), value: 'DATE' },
    { label: t('setup.fields.typeDatetime', 'Date/Time'), value: 'DATETIME' },
    { label: t('setup.fields.typeUuid', 'UUID'), value: 'UUID' },
    {
      label: t('setup.fields.typeAddress', 'Address'),
      value: 'ADDRESS',
    },
    {
      label: t('setup.fields.typeImage', 'Image'),
      value: 'IMAGE',
    },
    {
      label: t('setup.fields.typeJson', 'JSON'),
      value: 'JSON',
    },
    {
      label: t('setup.fields.typeFormula', 'Formula (this record)'),
      value: 'FORMULA',
    },
    {
      label: t('setup.fields.typeRollup', 'Rollup (related records)'),
      value: 'ROLLUP',
    },
  ]
})

const resultTypeOptions = computed(() => [
  { label: t('setup.fields.typeString', 'Text'), value: 'STRING' },
  { label: t('setup.fields.typeInteger', 'Integer'), value: 'INTEGER' },
  { label: t('setup.fields.typeFloat', 'Number'), value: 'FLOAT' },
  { label: t('setup.fields.typeBoolean', 'Checkbox'), value: 'BOOLEAN' },
  { label: t('setup.fields.typeDate', 'Date'), value: 'DATE' },
  { label: t('setup.fields.typeDatetime', 'Date/Time'), value: 'DATETIME' },
])

const interfaceOptions = computed(() => {
  if (form.isLookup) {
    return [
      {
        label: t('setup.fields.ifaceLookup', 'Lookup'),
        value: 'select-dropdown-m2o',
      },
    ]
  }
  if (isAddressType.value) {
    return [
      {
        label: t('setup.fields.ifaceAddress', 'Address'),
        value: 'address',
      },
    ]
  }
  if (isImageType.value) {
    return [
      {
        label: t('setup.fields.ifaceImage', 'Image'),
        value: 'file-image',
      },
    ]
  }
  switch (storageType.value) {
    case 'STRING':
      return [
        { label: t('setup.fields.ifaceText', 'Text'), value: 'input' },
        { label: t('setup.fields.ifaceTextarea', 'Textarea'), value: 'input-multiline' },
        { label: t('setup.fields.ifacePicklist', 'Picklist'), value: 'select-dropdown' },
      ]
    case 'INTEGER':
      return [
        { label: t('setup.fields.ifaceNumber', 'Number'), value: 'input' },
        { label: t('setup.fields.ifacePicklist', 'Picklist'), value: 'select-dropdown' },
      ]
    case 'FLOAT':
      return [
        { label: t('setup.fields.ifaceNumber', 'Number'), value: 'input' },
        { label: t('setup.fields.ifaceCurrency', 'Currency'), value: 'currency' },
      ]
    case 'BOOLEAN':
      return [
        { label: t('setup.fields.ifaceCheckbox', 'Checkbox'), value: 'boolean' },
      ]
    case 'DATE':
    case 'DATETIME':
      return [
        {
          label:
            storageType.value === 'DATE'
              ? t('setup.fields.ifaceDate', 'Date')
              : t('setup.fields.ifaceDateTime', 'Date & Time'),
          value: 'datetime',
        },
      ]
    case 'UUID':
      return [{ label: t('setup.fields.ifaceText', 'Text'), value: 'input' }]
    case 'JSON':
      return [
        {
          label: t('setup.fields.ifaceJsonList', 'JSON List'),
          value: 'json-list',
        },
        {
          label: t('setup.fields.ifaceJsonSensitivity', 'Sensitivity matrix'),
          value: 'json-sensitivity',
        },
        {
          label: t('setup.fields.ifaceJsonCode', 'JSON (raw)'),
          value: 'input-code',
        },
      ]
    default:
      return [{ label: t('setup.fields.ifaceText', 'Text'), value: 'input' }]
  }
})

const dateFormatOptions = computed(() => [
  { label: t('setup.fields.dateFormatShort', 'Short'), value: 'short' },
  { label: t('setup.fields.dateFormatLong', 'Long'), value: 'long' },
  {
    label: t('setup.fields.dateFormatCustom', 'Custom…'),
    value: 'other',
  },
])

const isPicklist = computed(
  () => normalizeFieldInterface(form.interface) === 'select-dropdown',
)
const isCurrency = computed(() => form.interface === 'currency')
const isFloatStorage = computed(() => storageType.value === 'FLOAT')
const isDateLike = computed(
  () => storageType.value === 'DATE' || storageType.value === 'DATETIME',
)

function clampNumericPrecision(raw: unknown): number {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return 18
  return Math.min(38, Math.max(1, n))
}

function clampNumericScale(raw: unknown, precision: number): number {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return Math.min(2, precision)
  return Math.min(precision, Math.max(0, n))
}
const showDefaultValue = computed(
  () =>
    !form.isLookup &&
    !isComputed.value &&
    !isAddressType.value &&
    !isImageType.value &&
    !isJsonType.value,
)

const jsonColumnTypeOptions = computed(() => [
  { label: t('setup.fields.jsonColumnTypeString', 'Text'), value: 'string' },
  { label: t('setup.fields.jsonColumnTypeNumber', 'Number'), value: 'number' },
  { label: t('setup.fields.jsonColumnTypeBoolean', 'Boolean'), value: 'boolean' },
])

const choiceFilter = ref('')

interface DynamicRelationOption {
  label: string
  value: string
  relatedCollection: string
}

interface DynamicJsonFieldOption {
  label: string
  value: string
  columns: string[]
}

const dynamicRelationOptions = ref<DynamicRelationOption[]>([])
const dynamicJsonFieldOptions = ref<DynamicJsonFieldOption[]>([])
const dynamicValueColumnOptions = ref<Array<{ label: string; value: string }>>([])
const dynamicPicklistLoading = ref(false)

const sensitivityRelationOptions = ref<DynamicRelationOption[]>([])
const sensitivityListFieldOptions = ref<Array<{ label: string; value: string }>>([])
const sensitivityCatalogLoading = ref(false)

const sensitivitySourceReady = computed(
  () =>
    Boolean(form.sensitivityRelationField.trim()) &&
    Boolean(form.sensitivityPatogenField.trim()) &&
    Boolean(form.sensitivityPharmacyField.trim()) &&
    Boolean(form.sensitivityResistanceField.trim()) &&
    Boolean(form.sensitivityValueColumn.trim()),
)

const picklistModeOptions = computed(() => [
  { label: t('setup.fields.picklistSourceStatic', 'Static list'), value: 'static' },
  {
    label: t('setup.fields.picklistSourceDynamic', 'Related field'),
    value: 'dynamic',
  },
])

const dynamicPicklistReady = computed(
  () =>
    Boolean(form.dynamicRelationField.trim()) &&
    Boolean(form.dynamicJsonField.trim()) &&
    Boolean(form.dynamicValueColumn.trim()),
)

function jsonListColumns(options: Record<string, unknown> | null | undefined): string[] {
  const raw = options?.columns
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
      return typeof (item as { name?: unknown }).name === 'string'
        ? (item as { name: string }).name.trim()
        : ''
    })
    .filter(Boolean)
}

function syncDynamicValueColumns(): void {
  const selected = dynamicJsonFieldOptions.value.find(
    (option) => option.value === form.dynamicJsonField,
  )
  const names =
    selected?.columns.length
      ? selected.columns
      : form.dynamicValueColumn
        ? [form.dynamicValueColumn]
        : []
  dynamicValueColumnOptions.value = names.map((name) => ({ label: name, value: name }))
}

async function loadDynamicRelationOptions(): Promise<void> {
  const collection = props.collection?.trim()
  if (!collection) {
    dynamicRelationOptions.value = []
    return
  }
  const { fields, relations } = await fetchEntityFieldsAndRelations(collection)
  const options = relations
    .filter((relation) => relation.kind === 'M2O' && relation.relatedEntityApiName && relation.fieldApiName)
    .map((relation) => {
      const field = fields.find((item) => item.apiName === relation.fieldApiName)
      return {
        label: field ? `${field.label} (${relation.fieldApiName})` : relation.fieldApiName,
        value: relation.fieldApiName,
        relatedCollection: relation.relatedEntityApiName ?? '',
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  if (
    form.dynamicRelationField &&
    !options.some((option) => option.value === form.dynamicRelationField)
  ) {
    options.unshift({
      label: form.dynamicRelationField,
      value: form.dynamicRelationField,
      relatedCollection: '',
    })
  }
  dynamicRelationOptions.value = options
}

async function loadDynamicJsonFields(): Promise<void> {
  const related = dynamicRelationOptions.value.find(
    (option) => option.value === form.dynamicRelationField,
  )?.relatedCollection
  if (!related) {
    dynamicJsonFieldOptions.value = form.dynamicJsonField
      ? [{
          label: form.dynamicJsonField,
          value: form.dynamicJsonField,
          columns: form.dynamicValueColumn ? [form.dynamicValueColumn] : [],
        }]
      : []
    syncDynamicValueColumns()
    return
  }

  const { fields } = await fetchEntityFieldsAndRelations(related)
  const options = fields
    .filter((field) => normalizeFieldInterface(field.interface || '') === 'json-list')
    .map((field) => ({
      label: `${field.label} (${field.apiName})`,
      value: field.apiName,
      columns: jsonListColumns(field.options),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (
    form.dynamicJsonField &&
    !options.some((option) => option.value === form.dynamicJsonField)
  ) {
    options.unshift({
      label: form.dynamicJsonField,
      value: form.dynamicJsonField,
      columns: form.dynamicValueColumn ? [form.dynamicValueColumn] : [],
    })
  }
  dynamicJsonFieldOptions.value = options
  syncDynamicValueColumns()
}

async function loadDynamicPicklistCatalog(): Promise<void> {
  dynamicPicklistLoading.value = true
  try {
    await loadDynamicRelationOptions()
    await loadDynamicJsonFields()
  } catch {
    dynamicRelationOptions.value = []
    dynamicJsonFieldOptions.value = []
    dynamicValueColumnOptions.value = []
  } finally {
    dynamicPicklistLoading.value = false
  }
}

async function loadSensitivityRelationOptions(): Promise<void> {
  const collection = props.collection?.trim()
  if (!collection) {
    sensitivityRelationOptions.value = []
    return
  }
  const { fields, relations } = await fetchEntityFieldsAndRelations(collection)
  const options = relations
    .filter((relation) => relation.kind === 'M2O' && relation.relatedEntityApiName && relation.fieldApiName)
    .map((relation) => {
      const field = fields.find((item) => item.apiName === relation.fieldApiName)
      return {
        label: field ? `${field.label} (${relation.fieldApiName})` : relation.fieldApiName,
        value: relation.fieldApiName,
        relatedCollection: relation.relatedEntityApiName ?? '',
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  if (
    form.sensitivityRelationField &&
    !options.some((option) => option.value === form.sensitivityRelationField)
  ) {
    options.unshift({
      label: form.sensitivityRelationField,
      value: form.sensitivityRelationField,
      relatedCollection: '',
    })
  }
  sensitivityRelationOptions.value = options
}

async function loadSensitivityListFields(): Promise<void> {
  const related = sensitivityRelationOptions.value.find(
    (option) => option.value === form.sensitivityRelationField,
  )?.relatedCollection
  const selected = [
    form.sensitivityPatogenField,
    form.sensitivityPharmacyField,
    form.sensitivityResistanceField,
  ].filter(Boolean)

  if (!related) {
    sensitivityListFieldOptions.value = selected.map((name) => ({
      label: name,
      value: name,
    }))
    return
  }

  const { fields } = await fetchEntityFieldsAndRelations(related)
  const options = fields
    .filter((field) => {
      const iface = normalizeFieldInterface(field.interface || '')
      return iface === 'json-list' || String(field.type || '').toUpperCase() === 'JSON'
    })
    .map((field) => ({
      label: `${field.label} (${field.apiName})`,
      value: field.apiName,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  for (const name of selected) {
    if (name && !options.some((option) => option.value === name)) {
      options.unshift({ label: name, value: name })
    }
  }
  sensitivityListFieldOptions.value = options
}

async function loadSensitivityCatalog(): Promise<void> {
  sensitivityCatalogLoading.value = true
  try {
    await loadSensitivityRelationOptions()
    await loadSensitivityListFields()
  } catch {
    sensitivityRelationOptions.value = []
    sensitivityListFieldOptions.value = []
  } finally {
    sensitivityCatalogLoading.value = false
  }
}

async function onSensitivityRelationField(value: string | null): Promise<void> {
  form.sensitivityRelationField = value ?? ''
  await loadSensitivityListFields()
}

function setPicklistMode(mode: 'static' | 'dynamic' | null): void {
  if (mode !== 'static' && mode !== 'dynamic') return
  form.picklistMode = mode
  if (mode === 'static' && form.choices.length === 0) {
    addChoice()
  }
  if (mode === 'dynamic') {
    void loadDynamicPicklistCatalog()
  }
}

async function onDynamicRelationField(value: string | null): Promise<void> {
  form.dynamicRelationField = value ?? ''
  form.dynamicJsonField = ''
  form.dynamicValueColumn = ''
  await loadDynamicJsonFields()
}

function onDynamicJsonField(value: string | null): void {
  form.dynamicJsonField = value ?? ''
  const selected = dynamicJsonFieldOptions.value.find(
    (option) => option.value === form.dynamicJsonField,
  )
  const names = selected?.columns ?? []
  form.dynamicValueColumn = names.includes('value') ? 'value' : names[0] ?? ''
  syncDynamicValueColumns()
}

const filteredChoices = computed(() => {
  const q = choiceFilter.value.trim().toLowerCase()
  const rows = form.choices.map((choice, index) => ({ choice, index }))
  if (!q) return rows
  return rows.filter(
    ({ choice }) =>
      choice.text.toLowerCase().includes(q) ||
      String(choice.value).toLowerCase().includes(q),
  )
})

const choiceDefaultOptions = computed(() =>
  form.choices
    .filter((row) => row.text.trim() || row.value.trim())
    .map((row) => ({
      label: row.text.trim() || row.value,
      value: coerceChoiceValue(row.value, storageType.value),
    })),
)

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const title = computed(() =>
  props.mode === 'create'
    ? t('setup.fields.newField', 'New Field')
    : t('setup.fields.editField', 'Edit Field'),
)

const apiNameLocked = computed(
  () => props.mode === 'edit' && Boolean(props.field?.isSystem),
)

function coerceChoiceValue(raw: string, type: string): string | number {
  const trimmed = raw.trim()
  if (type === 'INTEGER' || type === 'FLOAT') {
    const n = Number(trimmed)
    if (Number.isFinite(n)) {
      return type === 'INTEGER' ? Math.trunc(n) : n
    }
  }
  return trimmed
}

function readDefaultFromOptions(
  options: Record<string, unknown> | null | undefined,
): string | number | boolean | null {
  if (!options) return null
  const value =
    options.default !== undefined
      ? options.default
      : options.defaultValue !== undefined
        ? options.defaultValue
        : undefined
  if (value === undefined || value === null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  return String(value)
}

function coerceDefaultValue(
  raw: string | number | boolean | null,
  type: string,
): unknown {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    return type === 'INTEGER' ? Math.trunc(raw) : raw
  }
  const trimmed = String(raw).trim()
  if (!trimmed) return undefined
  switch (type) {
    case 'BOOLEAN': {
      const lower = trimmed.toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(lower)) return true
      if (['false', '0', 'no', 'off'].includes(lower)) return false
      return trimmed
    }
    case 'INTEGER': {
      const n = Number(trimmed)
      return Number.isFinite(n) ? Math.trunc(n) : trimmed
    }
    case 'FLOAT': {
      const n = Number(trimmed)
      return Number.isFinite(n) ? n : trimmed
    }
    default:
      return trimmed
  }
}

function parseChoices(options: Record<string, unknown> | null | undefined): ChoiceRow[] {
  const raw = options?.choices
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const row = entry as Record<string, unknown>
      return {
        text: String(row.text ?? row.label ?? ''),
        value: row.value === undefined || row.value === null ? '' : String(row.value),
      }
    })
    .filter(Boolean) as ChoiceRow[]
}

function defaultInterfaceFor(type: string, isLookup: boolean): string {
  if (isLookup) return 'select-dropdown-m2o'
  switch (type) {
    case 'BOOLEAN':
      return 'boolean'
    case 'DATE':
    case 'DATETIME':
      return 'datetime'
    case 'FLOAT':
    case 'INTEGER':
      return 'input'
    case 'FORMULA':
    case 'ROLLUP':
      return 'input'
    case 'AUTO_NUMBER':
      return 'input'
    case 'ADDRESS':
      return 'address'
    case 'IMAGE':
      return 'file-image'
    case 'JSON':
      return 'json-list'
    default:
      return 'input'
  }
}

function ensureInterfaceValid(): void {
  if (isAutoNumberType.value) {
    form.interface = 'input'
    return
  }
  if (isAddressType.value) {
    form.interface = 'address'
    return
  }
  if (isImageType.value) {
    form.interface = 'file-image'
    return
  }
  form.interface = normalizeFieldInterface(form.interface)
  // Legacy formula/rollup rows used interface "calculated"; map to a real display iface.
  if (
    isComputed.value &&
    (form.interface === 'calculated' ||
      form.interface.toLowerCase().includes('calculated') ||
      form.interface.toLowerCase().includes('formula') ||
      form.interface.toLowerCase().includes('computed'))
  ) {
    form.interface =
      storageType.value === 'FLOAT' &&
      String(form.currencySuffix || '').trim()
        ? 'currency'
        : interfaceOptions.value[0]?.value ??
          defaultInterfaceFor(storageType.value, form.isLookup)
  }
  const allowed = interfaceOptions.value.map((o) => o.value)
  if (!allowed.includes(form.interface)) {
    form.interface =
      allowed[0] ?? defaultInterfaceFor(storageType.value, form.isLookup)
  }
}

function readComputeMode(options: Record<string, unknown>): ComputeMode {
  const explicit = String(options.computeMode ?? options.compute_mode ?? '')
    .trim()
    .toLowerCase()
  if (explicit === 'formula' || explicit === 'rollup' || explicit === 'none') {
    return explicit
  }
  if (explicit === 'autonumber') return 'autoNumber'
  if (
    options.autoNumber === true ||
    (options.autoNumber &&
      typeof options.autoNumber === 'object' &&
      !Array.isArray(options.autoNumber))
  ) {
    return 'autoNumber'
  }
  if (options.rollup && typeof options.rollup === 'object') return 'rollup'
  for (const key of ['template', 'formula', 'expression', 'compute']) {
    const value = options[key]
    if (typeof value === 'string' && value.trim()) return 'formula'
  }
  return 'none'
}

function readAutoNumberConfig(options: Record<string, unknown>): {
  displayFormat: string
  startingNumber: number
} {
  const nested =
    options.autoNumber &&
    typeof options.autoNumber === 'object' &&
    !Array.isArray(options.autoNumber)
      ? (options.autoNumber as Record<string, unknown>)
      : null
  const displayFormat = String(
    nested?.displayFormat ??
      nested?.display_format ??
      options.displayFormat ??
      options.display_format ??
      '{0000}',
  ).trim() || '{0000}'
  const startingRaw = Number(
    nested?.startingNumber ??
      nested?.starting_number ??
      options.startingNumber ??
      options.starting_number ??
      1,
  )
  return {
    displayFormat,
    startingNumber:
      Number.isFinite(startingRaw) && startingRaw >= 0
        ? Math.trunc(startingRaw)
        : 1,
  }
}

function readFormulaTemplate(options: Record<string, unknown>): string {
  for (const key of ['template', 'formula', 'expression', 'compute']) {
    const value = options[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readRollup(
  options: Record<string, unknown>,
  fieldType?: string,
): {
  childEntity: string | null
  parentField: string | null
  valueField: string | null
  op: string
  filter: Record<string, unknown> | null
  storage: 'virtual' | 'physical'
} {
  const raw = options.rollup
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      childEntity: null,
      parentField: null,
      valueField: null,
      op: 'SUM',
      filter: null,
      storage: 'virtual',
    }
  }
  const row = raw as Record<string, unknown>
  const filter =
    row.filter && typeof row.filter === 'object' && !Array.isArray(row.filter)
      ? (row.filter as Record<string, unknown>)
      : null
  let storage: 'virtual' | 'physical'
  if (row.live === true || row.live === 'true') storage = 'virtual'
  else if (row.live === false || row.live === 'false') storage = 'physical'
  else {
    storage =
      String(fieldType || '').toUpperCase() === 'ALIAS' ? 'virtual' : 'physical'
  }
  return {
    childEntity: String(row.childEntity ?? row.child_entity ?? '').trim() || null,
    parentField: String(row.parentField ?? row.parent_field ?? '').trim() || null,
    valueField: String(row.valueField ?? row.value_field ?? '').trim() || null,
    op: String(row.op ?? row.aggregate ?? 'SUM').trim().toUpperCase() || 'SUM',
    filter,
    storage,
  }
}

function addRollupFilterPair(): void {
  rollupFilterPairs.value = [
    ...rollupFilterPairs.value,
    {
      sourceField: '',
      filterField: '',
      operator: '_eq',
      valueKind: 'literal',
      literalValue: '',
    },
  ]
}

function updateRollupFilterPair(index: number, patch: Partial<FilterPair>): void {
  const pairs = [...rollupFilterPairs.value]
  const current = pairs[index]
  if (!current) return
  pairs[index] = {
    ...current,
    ...patch,
    valueKind: 'literal',
  }
  rollupFilterPairs.value = pairs
}

function removeRollupFilterPair(index: number): void {
  rollupFilterPairs.value = rollupFilterPairs.value.filter(
    (_, pairIndex) => pairIndex !== index,
  )
}

async function loadRelatedChildEntities(): Promise<void> {
  relatedChildEntityOptions.value = []
  const parent = props.collection?.trim()
  if (!parent) return

  relatedChildrenLoading.value = true
  try {
    const relations = await getCachedRelations()
    const childNames = new Set<string>()
    for (const rel of relations) {
      // Child entity owns an M2O/lookup FK pointing at this object.
      const child = relationManyCollection(rel)
      const related = relationRelatedCollection(rel)
      if (keysEqual(related, parent) && child && !keysEqual(child, parent)) {
        childNames.add(child)
      }
    }

    const labelByValue = new Map(
      props.entityOptions.map((opt) => [opt.value, opt.label]),
    )
    const options = [...childNames]
      .map((value) => ({
        label: labelByValue.get(value) || value,
        value,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    const selected = form.rollupChildEntity
    if (selected && !options.some((opt) => opt.value === selected)) {
      const fallback =
        props.entityOptions.find((opt) => opt.value === selected) ?? {
          label: selected,
          value: selected,
        }
      relatedChildEntityOptions.value = [fallback, ...options]
    } else {
      relatedChildEntityOptions.value = options
    }
  } catch {
    relatedChildEntityOptions.value = []
  } finally {
    relatedChildrenLoading.value = false
  }
}

async function loadChildFields(childEntity: string | null): Promise<void> {
  childFieldOptions.value = []
  childLookupFieldOptions.value = []
  if (!childEntity) return
  childFieldsLoading.value = true
  try {
    const { fields, relations } = await fetchEntityFieldsAndRelations(childEntity)
    const m2oByField = new Map(
      relations
        .filter((r) => r.kind === 'M2O')
        .map((r) => [r.fieldApiName, r.relatedEntityApiName]),
    )
    childFieldOptions.value = fields
      .filter((f) => f.apiName !== 'id')
      .map((f) => ({
        label: `${f.label} (${f.apiName})`,
        value: f.apiName,
      }))
    childLookupFieldOptions.value = fields
      .filter((f) => {
        const related = m2oByField.get(f.apiName)
        if (!related) return false
        if (!props.collection) return true
        return related === props.collection
      })
      .map((f) => ({
        label: `${f.label} (${f.apiName})`,
        value: f.apiName,
      }))
  } catch {
    childFieldOptions.value = []
    childLookupFieldOptions.value = []
  } finally {
    childFieldsLoading.value = false
  }
}

function isCompatibleParentDefaultType(
  parentFieldType: string,
  targetType: string,
): boolean {
  const parent = parentFieldType.toUpperCase()
  const target = targetType.toUpperCase()
  if (target === 'DATE' || target === 'DATETIME' || target === 'TIMESTAMP') {
    return parent === 'DATE' || parent === 'DATETIME' || parent === 'TIMESTAMP'
  }
  if (
    target === 'INTEGER' ||
    target === 'BIGINTEGER' ||
    target === 'FLOAT' ||
    target === 'DECIMAL'
  ) {
    return (
      parent === 'INTEGER' ||
      parent === 'BIGINTEGER' ||
      parent === 'FLOAT' ||
      parent === 'DECIMAL'
    )
  }
  if (target === 'BOOLEAN') return parent === 'BOOLEAN'
  if (target === 'UUID') return parent === 'UUID'
  if (parent === 'JSON' || parent === 'ALIAS' || parent === 'UUID') return false
  return true
}

async function loadParentDefaultFieldOptions(): Promise<void> {
  if (!showDefaultValue.value) {
    parentDefaultFieldOptions.value = []
    return
  }
  const collection = props.collection?.trim()
  if (!collection) {
    parentDefaultFieldOptions.value = []
    return
  }

  parentDefaultFieldsLoading.value = true
  try {
    const { relations } = await fetchEntityFieldsAndRelations(collection)
    const m2oParents = relations.filter(
      (relation) =>
        relation.kind === 'M2O' &&
        Boolean(relation.relatedEntityApiName?.trim()),
    )
    const entityLabel = new Map(
      props.entityOptions.map((opt) => [opt.value, opt.label]),
    )
    const options: Array<{ label: string; value: string }> = []
    const seenValues = new Set<string>()
    const targetType = storageType.value

    for (const relation of m2oParents) {
      const related = relation.relatedEntityApiName!.trim()
      const relationField = relation.fieldApiName?.trim()
      if (!relationField) continue
      const parentLabel = entityLabel.get(related) || related
      const { fields, relations: parentRelations } =
        await fetchEntityFieldsAndRelations(related)
      const relationFields = new Set(
        parentRelations
          .filter((item) => item.kind === 'M2O' || item.kind === 'M2M')
          .map((item) => item.fieldApiName),
      )

      for (const field of fields) {
        if (!field.apiName || field.apiName === 'id') continue
        if (relationFields.has(field.apiName)) continue
        if (field.relationKind === 'M2O' || field.relationKind === 'M2M') continue
        if (!isCompatibleParentDefaultType(field.type, targetType)) continue
        // Path includes the child M2O field so Item.base_price ≠ Opportunity.base_price
        // and runtime can copy when that M2O is selected (not only related-list parent).
        const value = `${relationField}.${field.apiName}`
        if (seenValues.has(value)) continue
        seenValues.add(value)
        options.push({
          label: `${parentLabel} (${relationField}) · ${field.label} (${field.apiName})`,
          value,
        })
      }
    }

    let selected = form.defaultFromParent.trim()
    // Upgrade legacy bare field names (e.g. `base_price`) to `item.base_price` when unique.
    if (selected && !selected.includes('.')) {
      const matches = options.filter((option) => {
        const fieldPart = option.value.split('.').pop() ?? ''
        return fieldPart === selected
      })
      if (matches.length === 1) {
        selected = matches[0].value
        form.defaultFromParent = selected
      }
    }
    if (selected && !options.some((option) => option.value === selected)) {
      options.unshift({ label: selected, value: selected })
    }

    parentDefaultFieldOptions.value = options.sort((a, b) =>
      a.label.localeCompare(b.label),
    )
  } catch {
    parentDefaultFieldOptions.value = form.defaultFromParent.trim()
      ? [{
          label: form.defaultFromParent.trim(),
          value: form.defaultFromParent.trim(),
        }]
      : []
  } finally {
    parentDefaultFieldsLoading.value = false
  }
}

function resetFromProps(): void {
  apiNameTouched.value = props.mode === 'edit'
  if (props.mode === 'edit' && props.field) {
    const options = props.field.options ?? {}
    const display = props.field.displayOptions ?? {}
    form.apiName = props.field.apiName
    form.label = props.field.label
    const relatedApi = String(props.field.relatedEntityApiName || '').trim()
    const isImageField =
      isFileImageInterface(props.field.interface) &&
      (!relatedApi || keysEqual(relatedApi, FILES_ASSET_COLLECTION))
    form.isLookup =
      !isImageField &&
      (props.field.relationKind === 'M2O' || props.field.relationKind === 'M2M')
    form.relationKind =
      isImageField
        ? 'none'
        : props.field.relationKind === 'M2O' || props.field.relationKind === 'M2M'
          ? props.field.relationKind
          : 'none'
    form.relatedEntity = isImageField ? null : props.field.relatedEntityApiName
    form.onDelete =
      props.field.onDelete === 'CASCADE' ||
      props.field.onDelete === 'SET NULL' ||
      props.field.onDelete === 'RESTRICT'
        ? props.field.onDelete
        : 'RESTRICT'
    const mode = form.isLookup
      ? 'none'
      : (() => {
          const compute = readComputeMode(options)
          if (compute !== 'none') return compute
          // Legacy system Name fields without computeMode were Auto Number.
          if (
            props.field.apiName === 'name' &&
            props.field.isSystem &&
            options.computeMode == null &&
            options.compute_mode == null &&
            options.autoNumber == null
          ) {
            return 'autoNumber'
          }
          return 'none'
        })()
    if (mode === 'formula') {
      form.type = 'FORMULA'
      form.resultType =
        props.field.type === 'ALIAS' ? 'STRING' : props.field.type || 'FLOAT'
    } else if (mode === 'rollup') {
      form.type = 'ROLLUP'
      form.resultType =
        props.field.type === 'ALIAS' ? 'FLOAT' : props.field.type || 'FLOAT'
    } else if (mode === 'autoNumber') {
      form.type = 'AUTO_NUMBER'
      form.resultType = 'STRING'
    } else if (
      normalizeFieldInterface(props.field.interface || '').toLowerCase() ===
        'address' ||
      String(props.field.interface || '')
        .toLowerCase()
        .includes('address')
    ) {
      form.type = 'ADDRESS'
      form.resultType = 'FLOAT'
    } else if (isImageField) {
      form.type = 'IMAGE'
      form.resultType = 'FLOAT'
    } else {
      form.type = props.field.type === 'ALIAS' ? 'STRING' : props.field.type
      form.resultType = 'FLOAT'
    }
    form.interface = normalizeFieldInterface(props.field.interface || 'input')
    if (form.type === 'ADDRESS') {
      form.interface = 'address'
    }
    if (form.type === 'IMAGE') {
      form.interface = 'file-image'
    }
    form.required = props.field.required
    form.readonly = props.field.readonly
    form.hidden = props.field.hidden
    form.sensitivity = clampSensitivity(props.field.sensitivity)
    form.isUnique = props.field.isUnique
    form.isIndexed =
      Boolean(props.field.isIndexed) ||
      props.field.relationKind === 'M2O' ||
      Boolean(props.field.isUnique)
    form.useInSearch =
      props.field.relationKind === 'M2O' && options.useInSearch === true
    form.sort = props.field.sort
    form.applyDdl = true
    form.defaultValue = readDefaultFromOptions(options)
    form.defaultFromParent =
      typeof options.defaultFromParent === 'string'
        ? options.defaultFromParent.trim()
        : ''
    form.choices = parseChoices(options)
    const choiceSource = parseDynamicPicklistSource(options.choiceSource)
    form.picklistMode = choiceSource ? 'dynamic' : 'static'
    form.dynamicRelationField = choiceSource?.relationField ?? ''
    form.dynamicJsonField = choiceSource?.jsonField ?? ''
    form.dynamicValueColumn = choiceSource?.valueColumn ?? ''
    const sensitivitySource =
      parseSensitivitySource(options.sensitivitySource) ?? defaultSensitivitySource()
    form.sensitivityRelationField = sensitivitySource.relationField
    form.sensitivityPatogenField = sensitivitySource.patogenField
    form.sensitivityPharmacyField = sensitivitySource.pharmacyField
    form.sensitivityResistanceField = sensitivitySource.resistanceField
    form.sensitivityValueColumn = sensitivitySource.valueColumn
    form.formulaTemplate = readFormulaTemplate(options)
    const rollup = readRollup(options, props.field.type)
    form.rollupChildEntity = rollup.childEntity
    form.rollupParentField = rollup.parentField
    form.rollupValueField = rollup.valueField
    form.rollupOp = rollup.op
    form.rollupStorage = rollup.storage
    rollupFilterPairs.value = filterPairsFromFilter(rollup.filter).map((pair) => ({
      ...pair,
      valueKind: 'literal' as const,
    }))
    if (mode === 'rollup') {
      const storedResult = String(options.resultType ?? options.result_type ?? '').trim()
      if (storedResult) {
        form.resultType = storedResult
      } else if (props.field.type !== 'ALIAS') {
        form.resultType = props.field.type || 'FLOAT'
      }
    }
    const autoNumber = readAutoNumberConfig(options)
    form.displayFormat = autoNumber.displayFormat
    form.startingNumber = autoNumber.startingNumber
    if (mode === 'autoNumber') {
      form.readonly = true
      form.required = false
      form.isUnique = true
      form.isIndexed = true
      form.interface = 'input'
      form.isLookup = false
      form.relatedEntity = null
    }
    if (
      form.choices.length > 0 &&
      !String(form.interface).toLowerCase().includes('select') &&
      !form.isLookup
    ) {
      form.interface = 'select-dropdown'
    }
    if (
      (options.suffix || options.currency) &&
      storageType.value === 'FLOAT' &&
      !String(form.interface).toLowerCase().includes('currency')
    ) {
      form.interface = 'currency'
    }
    const format =
      typeof display.format === 'string' && display.format.trim()
        ? display.format.trim()
        : 'short'
    if (format === 'other' || format === 'custom') {
      form.dateFormat = 'other'
      form.dateFormatCustom = String(
        display.custom ?? display.customFormat ?? display.formatString ?? '',
      )
    } else if (format === 'short' || format === 'long') {
      form.dateFormat = format
      form.dateFormatCustom = ''
    } else {
      form.dateFormat = 'other'
      form.dateFormatCustom = format
    }
    // Prefer custom prefix; ignore leftover `$` / ISO markers (company currency is default).
    const prefixOverride = String(options.prefix ?? '').trim()
    const legacySuffix = String(options.suffix ?? options.currency ?? '').trim()
    form.currencySuffix =
      prefixOverride && !isOrgCurrencyPlaceholderAffix(prefixOverride)
        ? prefixOverride
        : legacySuffix && !isOrgCurrencyPlaceholderAffix(legacySuffix)
          ? legacySuffix
          : ''
    form.numericPrecision = clampNumericPrecision(options.precision ?? 18)
    form.decimalPlaces = clampNumericScale(
      options.scale ?? options.decimalPlaces ?? options.minFractionDigits ?? 2,
      form.numericPrecision,
    )
    form.jsonColumns = parseJsonColumns(options)
    ensureInterfaceValid()
    if (form.picklistMode === 'dynamic') {
      void loadDynamicPicklistCatalog()
    } else {
      dynamicRelationOptions.value = []
      dynamicJsonFieldOptions.value = []
      dynamicValueColumnOptions.value = []
    }
    if (normalizeFieldInterface(form.interface) === 'json-sensitivity') {
      void loadSensitivityCatalog()
    } else {
      sensitivityRelationOptions.value = []
      sensitivityListFieldOptions.value = []
    }
    void loadRelatedChildEntities()
    void loadChildFields(form.rollupChildEntity)
    void loadParentDefaultFieldOptions()
    void resetChildLookupFromStored()
    return
  }

  form.apiName = ''
  form.label = ''
  form.type = 'STRING'
  form.resultType = 'FLOAT'
  form.interface = 'input'
  form.required = false
  form.readonly = false
  form.hidden = false
  form.isUnique = false
  form.isIndexed = false
  form.sensitivity = 0
  void fetchEntityMeta(props.collection)
    .then((meta) => {
      if (props.mode !== 'create') return
      form.sensitivity = clampSensitivity(meta.defaultFieldSensitivity)
    })
    .catch(() => {
      /* keep 0 when meta is unavailable */
    })
  form.useInSearch = false
  form.sort = 0
  form.isLookup = false
  form.relationKind = 'none'
  form.relatedEntity = null
  form.onDelete = 'RESTRICT'
  form.applyDdl = true
  form.defaultValue = null
  form.defaultFromParent = ''
  form.choices = []
  form.picklistMode = 'static'
  form.dynamicRelationField = ''
  form.dynamicJsonField = ''
  form.dynamicValueColumn = ''
  dynamicRelationOptions.value = []
  dynamicJsonFieldOptions.value = []
  dynamicValueColumnOptions.value = []
  form.sensitivityRelationField = ''
  form.sensitivityPatogenField = 'patogen'
  form.sensitivityPharmacyField = 'pharmacy'
  form.sensitivityResistanceField = 'resistance'
  form.sensitivityValueColumn = 'name'
  sensitivityRelationOptions.value = []
  sensitivityListFieldOptions.value = []
  form.dateFormat = 'short'
  form.dateFormatCustom = ''
  form.currencySuffix = ''
  form.numericPrecision = 18
  form.decimalPlaces = 2
  form.jsonColumns = []
  form.formulaTemplate = ''
  form.rollupChildEntity = null
  form.rollupParentField = null
  form.rollupValueField = null
  form.rollupOp = 'SUM'
  form.rollupStorage = 'virtual'
  rollupFilterPairs.value = []
  form.displayFormat = '{0000}'
  form.startingNumber = 1
  choiceFilter.value = ''
  childFieldOptions.value = []
  childLookupFieldOptions.value = []
  relatedChildEntityOptions.value = []
  parentDefaultFieldOptions.value = []
  void loadParentDefaultFieldOptions()
  void resetChildLookupFromStored()
}

function addChoice(): void {
  choiceFilter.value = ''
  const nextValue =
    storageType.value === 'INTEGER' || storageType.value === 'FLOAT'
      ? String(
          (form.choices
            .map((c) => Number(c.value))
            .filter((n) => Number.isFinite(n))
            .reduce((max, n) => Math.max(max, n), 0) || 0) + 1,
        )
      : ''
  form.choices.push({ text: '', value: nextValue })
}

function removeChoice(index: number): void {
  form.choices.splice(index, 1)
}

function parseJsonColumns(options: Record<string, unknown> | null | undefined): JsonColumnRow[] {
  const raw = options?.columns
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const typeRaw = String(item.type ?? 'string')
        .toLowerCase()
        .trim()
      const type: JsonColumnRow['type'] =
        typeRaw === 'number' || typeRaw === 'integer' || typeRaw === 'float'
          ? 'number'
          : typeRaw === 'boolean' || typeRaw === 'bool'
            ? 'boolean'
            : 'string'
      return { name, type }
    })
    .filter((col) => Boolean(col.name))
}

function addJsonColumn(): void {
  form.jsonColumns.push({ name: '', type: 'string' })
}

function removeJsonColumn(index: number): void {
  form.jsonColumns.splice(index, 1)
}

function buildOptionsAndDisplay(): {
  options: Record<string, unknown>
  displayOptions: Record<string, unknown>
} {
  const options: Record<string, unknown> = {}
  const displayOptions: Record<string, unknown> = {}

  if (isPicklist.value) {
    if (form.picklistMode === 'dynamic' && dynamicPicklistReady.value) {
      options.choiceSource = {
        relationField: form.dynamicRelationField.trim(),
        jsonField: form.dynamicJsonField.trim(),
        valueColumn: form.dynamicValueColumn.trim(),
      }
    } else {
      options.choices = form.choices
        .filter((row) => row.text.trim() || row.value.trim())
        .map((row) => ({
          text: row.text.trim() || row.value.trim(),
          value: coerceChoiceValue(row.value, storageType.value),
        }))
    }
  }

  if (isJsonList.value) {
    options.columns = form.jsonColumns
      .map((col) => ({
        name: col.name.trim(),
        type: col.type,
      }))
      .filter((col) => Boolean(col.name))
  }

  if (isJsonSensitivity.value && sensitivitySourceReady.value) {
    options.sensitivitySource = {
      relationField: form.sensitivityRelationField.trim(),
      patogenField: form.sensitivityPatogenField.trim() || 'patogen',
      pharmacyField: form.sensitivityPharmacyField.trim() || 'pharmacy',
      resistanceField: form.sensitivityResistanceField.trim() || 'resistance',
      valueColumn: form.sensitivityValueColumn.trim() || 'name',
    }
  }

  if (isFloatStorage.value) {
    const precision = clampNumericPrecision(form.numericPrecision)
    const scale = clampNumericScale(form.decimalPlaces, precision)
    form.numericPrecision = precision
    form.decimalPlaces = scale
    options.precision = precision
    options.scale = scale
    options.decimalPlaces = scale
    options.minFractionDigits = scale
    options.maxFractionDigits = scale
  }

  if (isCurrency.value) {
    const override = form.currencySuffix.trim()
    // Custom symbol → prefix. Blank / `$` / ISO → follow company currency.
    if (override && !isOrgCurrencyPlaceholderAffix(override)) {
      options.prefix = override
    } else {
      delete options.prefix
    }
    delete options.suffix
    delete options.currency
  }

  if (isDateLike.value) {
    if (form.dateFormat === 'other') {
      displayOptions.format = 'other'
      displayOptions.custom = form.dateFormatCustom.trim() || 'dd.mm.yyyy'
    } else {
      displayOptions.format = form.dateFormat
    }
  }

  if (showDefaultValue.value) {
    const coerced = coerceDefaultValue(form.defaultValue, storageType.value)
    if (coerced !== undefined) {
      options.default = coerced
    }
    const fromParent = form.defaultFromParent.trim()
    if (fromParent) {
      options.defaultFromParent = fromParent
    }
  }

  if (computeMode.value === 'formula') {
    options.computeMode = 'formula'
    options.template = form.formulaTemplate.trim()
  } else if (computeMode.value === 'rollup') {
    options.computeMode = 'rollup'
    options.resultType = form.resultType || 'FLOAT'
    const filter = filterFromPairs(
      rollupFilterPairs.value.map((pair) => ({
        ...pair,
        valueKind: 'literal' as const,
      })),
    )
    const live = form.rollupStorage !== 'physical'
    options.rollup = {
      childEntity: form.rollupChildEntity,
      parentField: form.rollupParentField,
      valueField: form.rollupValueField || '*',
      op: form.rollupOp || 'SUM',
      live,
      ...(filter ? { filter } : {}),
    }
  } else if (computeMode.value === 'autoNumber') {
    options.computeMode = 'autoNumber'
    options.autoNumber = {
      displayFormat: form.displayFormat.trim() || '{0000}',
      startingNumber: Number.isFinite(form.startingNumber)
        ? Math.max(0, Math.trunc(form.startingNumber))
        : 1,
    }
  } else if (isNameField.value) {
    // Explicitly disable auto-number so re-open / seed keep Text mode.
    options.computeMode = 'none'
  }

  if (form.relationKind === 'M2O' && form.useInSearch) {
    options.useInSearch = true
  }

  if (isImageType.value) {
    // Format / max size are org General settings — field only marks Image M2O.
    options.files = { ...DEFAULT_IMAGE_FILES_OPTIONS }
  }

  return { options, displayOptions }
}

watch(
  () => [props.visible, props.mode, props.field] as const,
  ([visible]) => {
    if (visible) resetFromProps()
  },
)

watch(
  () => form.label,
  (label) => {
    if (props.mode !== 'create' || apiNameTouched.value) return
    form.apiName = toApiName(label)
  },
)

watch(
  () => [form.type, form.isLookup, form.relationKind, form.resultType] as const,
  (next, prev) => {
    void next
    if (isImageType.value) {
      form.interface = 'file-image'
      form.isLookup = false
      form.relatedEntity = null
      form.relationKind = 'none'
      form.isIndexed = true
      form.useInSearch = false
      return
    }
    if (form.relationKind === 'M2M') {
      form.interface = 'list-m2m'
      return
    }
    if (form.isLookup || form.relationKind === 'M2O') {
      form.interface = 'select-dropdown-m2o'
      form.isIndexed = true
      return
    }
    form.useInSearch = false
    if (isComputed.value) {
      form.readonly = true
      form.required = false
      if (isAutoNumberType.value) {
        form.interface = 'input'
        form.isUnique = true
        form.isIndexed = true
        form.isLookup = false
        return
      }
      if (!form.resultType) form.resultType = 'FLOAT'
      ensureInterfaceValid()
      if (isRollupType.value) {
        void loadRelatedChildEntities()
      }
      return
    }
    if (isAddressType.value) {
      form.interface = 'address'
      form.isLookup = false
      form.relatedEntity = null
      form.relationKind = 'none'
      return
    }
    if (isJsonType.value) {
      form.isLookup = false
      form.relatedEntity = null
      form.relationKind = 'none'
      ensureInterfaceValid()
      if (form.interface === 'json-list' && form.jsonColumns.length === 0) {
        form.jsonColumns = [{ name: '', type: 'string' }]
      }
      return
    }
    const prevType = prev?.[0]
    if (prevType === 'AUTO_NUMBER' && form.type === 'STRING') {
      form.readonly = false
      form.isUnique = true
      form.isIndexed = true
      form.interface = 'input'
    }
    ensureInterfaceValid()
  },
)

watch(
  () => [props.visible, props.collection] as const,
  ([visible]) => {
    if (visible && isRollupType.value) {
      void loadRelatedChildEntities()
    }
  },
)

watch(
  () => form.rollupChildEntity,
  (child, previous) => {
    void loadChildFields(child)
    if (previous && previous !== child) {
      rollupFilterPairs.value = []
    }
  },
)

watch(
  () =>
    [props.visible, props.collection, storageType.value, showDefaultValue.value] as const,
  ([visible]) => {
    if (!visible) return
    void loadParentDefaultFieldOptions()
  },
)

watch(
  () => form.isUnique,
  (unique) => {
    if (unique) form.isIndexed = true
  },
)

watch(
  () => form.interface,
  (iface) => {
    if (iface === 'select-dropdown' && form.picklistMode === 'static' && form.choices.length === 0) {
      form.choices = [
        {
          text: '',
          value:
            storageType.value === 'INTEGER' || storageType.value === 'FLOAT'
              ? '1'
              : '',
        },
      ]
    }
    if (iface === 'json-list' && form.jsonColumns.length === 0) {
      form.jsonColumns = [{ name: '', type: 'string' }]
    }
    if (iface === 'json-sensitivity') {
      if (!form.sensitivityPatogenField.trim()) form.sensitivityPatogenField = 'patogen'
      if (!form.sensitivityPharmacyField.trim()) form.sensitivityPharmacyField = 'pharmacy'
      if (!form.sensitivityResistanceField.trim()) form.sensitivityResistanceField = 'resistance'
      if (!form.sensitivityValueColumn.trim()) form.sensitivityValueColumn = 'name'
      void loadSensitivityCatalog()
    }
  },
)

function submit(): void {
  if (computeMode.value === 'formula' && !form.formulaTemplate.trim()) {
    return
  }
  if (
    computeMode.value === 'rollup' &&
    (!form.rollupChildEntity || !form.rollupParentField)
  ) {
    return
  }
  if (
    isJsonList.value &&
    !form.jsonColumns.some((col) => col.name.trim())
  ) {
    return
  }
  if (isJsonSensitivity.value && !sensitivitySourceReady.value) {
    return
  }
  if (isPicklist.value && form.picklistMode === 'dynamic' && !dynamicPicklistReady.value) {
    return
  }

  const apiName = resolvedApiName.value
  if (!apiName) return

  const { options, displayOptions } = buildOptionsAndDisplay()
  // Virtual rollups → ALIAS (no column). Physical → result type column.
  const resolvedType = isImageType.value
    ? 'UUID'
    : form.relationKind === 'M2O'
      ? 'UUID'
      : form.relationKind === 'M2M'
        ? 'ALIAS'
        : isVirtualRollup.value
          ? 'ALIAS'
          : isAutoNumberType.value
            ? 'STRING'
            : isAddressType.value
              ? 'JSON'
              : storageType.value

  const input: RegistryFieldInputDto = {
    apiName,
    label: form.label.trim() || apiName,
    type: resolvedType,
    interface: isImageType.value
      ? 'file-image'
      : form.relationKind === 'M2O'
        ? 'select-dropdown-m2o'
        : form.relationKind === 'M2M'
          ? 'list-m2m'
          : isAutoNumberType.value
            ? 'input'
            : isAddressType.value
              ? 'address'
              : normalizeFieldInterface(
                  form.interface.trim() ||
                    defaultInterfaceFor(
                      isComputed.value ? storageType.value : resolvedType,
                      false,
                    ),
                ),
    required: isComputed.value || form.relationKind === 'M2M' ? false : form.required,
    readonly: isComputed.value ? true : form.readonly,
    hidden: form.hidden,
    isUnique: isAutoNumberType.value ? true : form.isUnique,
    isIndexed:
      isAutoNumberType.value ||
      isImageType.value ||
      form.relationKind === 'M2O' ||
      form.isUnique ||
      form.isIndexed,
    sensitivity: clampSensitivity(form.sensitivity),
    sort: form.sort,
    options,
    displayOptions,
  }

  if (isImageType.value) {
    input.relationKind = 'M2O'
    input.relatedEntity = FILES_ASSET_COLLECTION
    input.type = 'UUID'
    input.interface = 'file-image'
    input.relationMeta = {
      on_delete: form.onDelete || 'SET NULL',
    }
  } else if (form.relationKind === 'M2O') {
    input.relationKind = 'M2O'
    input.relatedEntity = form.relatedEntity
    input.type = 'UUID'
    input.relationMeta = {
      on_delete: form.onDelete || 'RESTRICT',
    }
    if (form.onDelete === 'SET NULL') {
      input.required = false
    }
  } else if (form.relationKind === 'M2M') {
    input.relationKind = 'M2M'
    input.relatedEntity = form.relatedEntity
    input.type = 'ALIAS'
    input.interface = 'list-m2m'
  } else if (
    props.mode === 'edit' &&
    (props.field?.relationKind === 'M2O' || props.field?.relationKind === 'M2M')
  ) {
    input.relationKind = null
    input.relatedEntity = null
  }

  emit('save', {
    input,
    applyDdl: form.applyDdl,
    ...(supportsChildLookup.value
      ? {
          childLookup: {
            enabled: childLookupEnabled.value,
            settings: childLookupEnabled.value
              ? currentChildLookupSettings()
              : null,
          },
        }
      : {}),
  })
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="title"
    class="setup-field-editor-dialog"
    :style="{ width: 'min(40rem, 95vw)' }"
    :content-style="{ overflowX: 'hidden' }"
    :dismissable-mask="true"
  >
    <div class="setup-field-editor flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label>{{ t('setup.fields.fieldLabel', 'Field Label') }}</label>
        <InputText
          v-model="form.label"
          class="w-full"
          autocomplete="off"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label>{{ t('setup.fields.apiName', 'Field Name (API)') }}</label>
        <InputText
          v-model="form.apiName"
          class="w-full"
          :disabled="apiNameLocked || mode === 'edit'"
          autocomplete="off"
          placeholder="snake_case"
          @update:model-value="apiNameTouched = true"
        />
        <small
          v-if="mode === 'edit'"
          class="text-muted-color"
        >
          {{ t('setup.fields.apiNameLocked', 'API name cannot be changed after create.') }}
        </small>
      </div>

      <div
        v-if="!isAutoNumberType && !isNameField && !isAddressType && !isImageType && !isJsonType"
        class="flex flex-col gap-1"
      >
        <label>{{ t('setup.fields.relationType', 'Relationship') }}</label>
        <Select
          v-model="form.relationKind"
          :options="relationKindOptions"
          option-label="label"
          option-value="value"
          class="w-full"
          :disabled="relationKindLocked"
        />
        <small
          v-if="isM2MRelation"
          class="text-muted-color"
        >
          {{
            t(
              'setup.fields.m2mJunctionHint',
              'Creates a junction object with Hide within the App and Internal enabled.',
            )
          }}
        </small>
      </div>

      <div
        v-if="isRelationField"
        class="flex flex-col gap-1"
      >
        <label>{{ t('setup.fields.relatedEntity', 'Related Object') }}</label>
        <Select
          v-model="form.relatedEntity"
          :options="entityOptions"
          option-label="label"
          option-value="value"
          class="w-full"
          :placeholder="t('setup.fields.selectEntity', 'Select object')"
          filter
          :disabled="relationKindLocked"
        />
      </div>

      <div
        v-if="isM2ORelation"
        class="flex flex-col gap-1"
      >
        <label>{{ t('setup.fields.onDelete', 'Delete Constraint') }}</label>
        <Select
          v-model="form.onDelete"
          :options="onDeleteOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
        <small class="text-muted-color">
          {{
            t(
              'setup.fields.onDeleteHint',
              'What happens to this record when the related record is archived, restored, or deleted.',
            )
          }}
        </small>
      </div>

      <template v-if="!isRelationField">
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.dataType', 'Data Type') }}</label>
          <Select
            v-model="form.type"
            :options="typeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>

        <div
          v-if="isAutoNumberType"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.displayFormat', 'Display Format') }}</label>
            <InputText
              v-model="form.displayFormat"
              class="w-full"
              placeholder="SB-{00000}"
              autocomplete="off"
            />
            <small class="text-muted-color">
              {{
                t(
                  'setup.fields.displayFormatHint',
                  'Use {0} or {0000} for the sequence; optional {YY}/{YYYY}/{MM}/{DD}. Example preview: {preview}',
                  { preview: autoNumberPreview },
                )
              }}
            </small>
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.startingNumber', 'Starting Number') }}</label>
            <InputNumber
              v-model="form.startingNumber"
              class="w-full"
              :min="0"
              :use-grouping="false"
            />
            <small class="text-muted-color">
              {{
                t(
                  'setup.fields.startingNumberHint',
                  'Applies to new records only. Existing Name values are not rewritten.',
                )
              }}
            </small>
          </div>
        </div>

        <div
          v-if="isComputed && !isAutoNumberType"
          class="flex flex-col gap-1"
        >
          <label>{{ t('setup.fields.resultType', 'Result type') }}</label>
          <Select
            v-model="form.resultType"
            :options="resultTypeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>

        <div
          v-if="isFormulaType"
          class="flex flex-col gap-1"
        >
          <label>{{ t('setup.fields.formulaTemplate', 'Formula') }}</label>
          <Textarea
            v-model="form.formulaTemplate"
            class="w-full"
            rows="3"
            auto-resize
            :placeholder="FORMULA_EXAMPLE"
          />
          <small class="text-muted-color">
            {{ formulaHintText }}
          </small>
        </div>

        <div
          v-if="isRollupType"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.rollupStorage', 'Storage') }}</label>
            <Select
              v-model="form.rollupStorage"
              :options="rollupStorageOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.rollupChild', 'Child object') }}</label>
            <Select
              v-model="form.rollupChildEntity"
              :options="relatedChildEntityOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              filter
              :loading="relatedChildrenLoading"
              :placeholder="
                relatedChildrenLoading
                  ? t('common.loading', 'Loading…')
                  : relatedChildEntityOptions.length
                    ? t('setup.fields.selectEntity', 'Select object')
                    : t(
                        'setup.fields.rollupNoChildren',
                        'No related child objects',
                      )
              "
            />
            <small
              v-if="!relatedChildrenLoading && relatedChildEntityOptions.length === 0"
              class="text-muted-color"
            >
              {{
                t(
                  'setup.fields.rollupNoChildrenHint',
                  'Only objects with a lookup to this object appear here.',
                )
              }}
            </small>
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.rollupParentField', 'Parent lookup on child') }}</label>
            <Select
              v-model="form.rollupParentField"
              :options="childLookupFieldOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              filter
              :loading="childFieldsLoading"
              :placeholder="t('setup.fields.selectField', 'Select field')"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.rollupOp', 'Aggregate') }}</label>
            <Select
              v-model="form.rollupOp"
              :options="rollupOpOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>
          <div
            v-if="form.rollupOp !== 'COUNT'"
            class="flex flex-col gap-1"
          >
            <label>{{ t('setup.fields.rollupValueField', 'Value field') }}</label>
            <Select
              v-model="form.rollupValueField"
              :options="childFieldOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              filter
              :loading="childFieldsLoading"
              :placeholder="t('setup.fields.selectField', 'Select field')"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label>{{ t('setup.fields.rollupFilter', 'Child filter') }}</label>
            <small class="text-muted-color">
              {{
                t(
                  'setup.fields.rollupFilterHint',
                  'Optional. Limit which child rows are counted (e.g. status equals Draft).',
                )
              }}
            </small>
            <FilterPairEditor
              :pairs="rollupFilterPairs"
              :source-options="childFieldOptions"
              :filter-options="[]"
              :source-placeholder="t('setup.fields.selectField', 'Select field')"
              :filter-placeholder="t('formBuilder.filterLiteralPlaceholder', 'Value')"
              :add-label="t('setup.fields.rollupFilterAdd', 'Add filter condition')"
              :source-loading="childFieldsLoading"
              rich
              literal-only
              @add="addRollupFilterPair"
              @update-pair="updateRollupFilterPair"
              @remove="removeRollupFilterPair"
            />
          </div>
          <small class="text-muted-color">
            {{ rollupHintText }}
          </small>
        </div>

        <div
          v-if="isAddressType"
          class="flex flex-col gap-1"
        >
          <small class="text-muted-color">
            {{
              t(
                'setup.fields.addressHint',
                'Stores Street, City, State/Province, Zip/Postal Code, and Country as one structured field.',
              )
            }}
          </small>
        </div>

        <div
          v-if="isImageType"
          class="flex flex-col gap-1"
        >
          <small class="text-muted-color">
            {{
              t(
                'setup.fields.imageHint',
                'Stores a single image file linked to the Files object. Format and max size are set in Setup → General. Preview size is configured on the Block Layout.',
              )
            }}
          </small>
        </div>

        <div
          v-if="isJsonType"
          class="flex flex-col gap-1"
        >
          <small class="text-muted-color">
            {{
              t(
                'setup.fields.jsonHint',
                'Stores structured JSON in a jsonb column. Use JSON List for tabular rows, or JSON (raw) for free-form JSON.',
              )
            }}
          </small>
        </div>

        <div
          v-if="!isAutoNumberType && !isAddressType && !isImageType"
          class="flex flex-col gap-1"
        >
          <label>{{ t('setup.fields.interface', 'Interface') }}</label>
          <Select
            v-model="form.interface"
            :options="interfaceOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
      </template>

      <div
        v-if="isJsonSensitivity"
        class="setup-field-sensitivity flex flex-col gap-2"
      >
        <small class="text-muted-color">
          {{
            t(
              'setup.fields.sensitivityHint',
              'Each list comes from a separate JSON List field on the related record (e.g. patogen, pharmacy, resistance).',
            )
          }}
        </small>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.sensitivityRelationField', 'Related record') }}</label>
          <Select
            :model-value="form.sensitivityRelationField"
            :options="sensitivityRelationOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            filter
            :loading="sensitivityCatalogLoading"
            :placeholder="t('setup.fields.selectField', 'Select field')"
            @update:model-value="onSensitivityRelationField"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.sensitivityPatogenField', 'Pathogen list field') }}</label>
          <Select
            v-model="form.sensitivityPatogenField"
            :options="sensitivityListFieldOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            filter
            :loading="sensitivityCatalogLoading"
            :disabled="!form.sensitivityRelationField"
            :placeholder="t('setup.fields.selectField', 'Select field')"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.sensitivityPharmacyField', 'Pharmacy list field') }}</label>
          <Select
            v-model="form.sensitivityPharmacyField"
            :options="sensitivityListFieldOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            filter
            :loading="sensitivityCatalogLoading"
            :disabled="!form.sensitivityRelationField"
            :placeholder="t('setup.fields.selectField', 'Select field')"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.sensitivityResistanceField', 'Resistance list field') }}</label>
          <Select
            v-model="form.sensitivityResistanceField"
            :options="sensitivityListFieldOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            filter
            :loading="sensitivityCatalogLoading"
            :disabled="!form.sensitivityRelationField"
            :placeholder="t('setup.fields.selectField', 'Select field')"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.sensitivityValueColumn', 'Value column') }}</label>
          <InputText
            v-model="form.sensitivityValueColumn"
            class="w-full"
            autocomplete="off"
          />
        </div>
      </div>

      <div
        v-if="isJsonList"
        class="setup-field-json-columns flex flex-col gap-2"
      >
        <div class="flex items-center justify-between gap-2">
          <label>
            {{ t('setup.fields.jsonColumns', 'Columns') }}
            <span class="text-muted-color font-normal">
              ({{ form.jsonColumns.length }})
            </span>
          </label>
          <Button
            :label="t('setup.fields.addJsonColumn', 'Add column')"
            icon="pi pi-plus"
            size="small"
            severity="secondary"
            outlined
            @click="addJsonColumn"
          />
        </div>
        <div class="setup-field-json-columns__list flex flex-col gap-2">
          <div
            v-for="(col, index) in form.jsonColumns"
            :key="index"
            class="flex gap-2 items-center"
          >
            <InputText
              v-model="col.name"
              class="flex-1"
              :placeholder="t('setup.fields.jsonColumnName', 'Name')"
              autocomplete="off"
            />
            <Select
              v-model="col.type"
              :options="jsonColumnTypeOptions"
              option-label="label"
              option-value="value"
              class="w-36"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              :aria-label="t('common.delete', 'Delete')"
              @click="removeJsonColumn(index)"
            />
          </div>
        </div>
      </div>

      <div
        v-if="isPicklist"
        class="setup-field-picklist flex flex-col gap-2"
      >
        <div class="flex flex-col gap-1">
          <label>{{ t('setup.fields.picklistSource', 'Picklist source') }}</label>
          <SelectButton
            :model-value="form.picklistMode"
            :options="picklistModeOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            @update:model-value="setPicklistMode"
          />
        </div>

        <template v-if="form.picklistMode === 'dynamic'">
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.picklistRelationField', 'Related record') }}</label>
            <Select
              :model-value="form.dynamicRelationField"
              :options="dynamicRelationOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              filter
              :loading="dynamicPicklistLoading"
              :placeholder="t('setup.fields.selectField', 'Select field')"
              @update:model-value="onDynamicRelationField"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.picklistJsonField', 'List field') }}</label>
            <Select
              :model-value="form.dynamicJsonField"
              :options="dynamicJsonFieldOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              filter
              :loading="dynamicPicklistLoading"
              :disabled="!form.dynamicRelationField"
              :placeholder="t('setup.fields.selectField', 'Select field')"
              @update:model-value="onDynamicJsonField"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label>{{ t('setup.fields.picklistValueColumn', 'Value column') }}</label>
            <Select
              v-model="form.dynamicValueColumn"
              :options="dynamicValueColumnOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              filter
              :loading="dynamicPicklistLoading"
              :disabled="!form.dynamicJsonField"
              :placeholder="t('setup.fields.selectField', 'Select field')"
            />
          </div>
          <small class="text-muted-color">
            {{
              t(
                'setup.fields.picklistDynamicHint',
                'Options come from the related record. Example: Item → options → value.',
              )
            }}
          </small>
        </template>

        <div
          v-else
          class="flex items-center justify-between gap-2"
        >
          <label>
            {{ t('setup.fields.picklistValues', 'Picklist values') }}
            <span class="text-muted-color font-normal">
              ({{ form.choices.length }})
            </span>
          </label>
          <Button
            :label="t('setup.fields.addChoice', 'Add value')"
            icon="pi pi-plus"
            size="small"
            severity="secondary"
            outlined
            @click="addChoice"
          />
        </div>
        <IconField v-if="form.picklistMode !== 'dynamic' && form.choices.length > 8">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="choiceFilter"
            class="w-full"
            :placeholder="t('setup.fields.filterChoices', 'Filter values…')"
          />
        </IconField>
        <div
          v-if="form.picklistMode !== 'dynamic'"
          class="setup-field-picklist__list"
        >
          <div
            v-for="{ choice, index } in filteredChoices"
            :key="index"
            class="flex gap-2 items-center"
          >
            <InputText
              v-model="choice.text"
              class="flex-1"
              :placeholder="t('setup.fields.choiceLabel', 'Label')"
            />
            <InputText
              v-model="choice.value"
              class="w-28"
              :placeholder="t('setup.fields.choiceValue', 'Value')"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              :aria-label="t('common.delete', 'Delete')"
              @click="removeChoice(index)"
            />
          </div>
          <small
            v-if="choiceFilter.trim() && filteredChoices.length === 0"
            class="text-muted-color"
          >
            {{ t('setup.fields.noMatchingChoices', 'No matching values') }}
          </small>
        </div>
      </div>

      <div
        v-if="isDateLike"
        class="flex flex-col gap-2"
      >
        <label>{{ t('setup.fields.dateFormat', 'Date format') }}</label>
        <Select
          v-model="form.dateFormat"
          :options="dateFormatOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
        <InputText
          v-if="form.dateFormat === 'other'"
          v-model="form.dateFormatCustom"
          class="w-full"
          :placeholder="t('setup.fields.dateFormatExample', 'dd.mm.yyyy HH:mm')"
        />
      </div>

      <div
        v-if="isFloatStorage"
        class="setup-field-editor__numeric grid gap-3"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <label>{{ t('setup.fields.numericSize', 'Size') }}</label>
          <InputNumber
            v-model="form.numericPrecision"
            class="w-full"
            :min="1"
            :max="38"
            show-buttons
            @update:model-value="
              form.decimalPlaces = clampNumericScale(
                form.decimalPlaces,
                clampNumericPrecision($event),
              )
            "
          />
        </div>
        <div class="flex flex-col gap-1 min-w-0">
          <label>{{ t('setup.fields.decimalPlaces', 'Decimals') }}</label>
          <InputNumber
            v-model="form.decimalPlaces"
            class="w-full"
            :min="0"
            :max="clampNumericPrecision(form.numericPrecision)"
            show-buttons
          />
        </div>
      </div>

      <div
        v-if="isCurrency"
        class="setup-field-editor__currency flex flex-col gap-1"
      >
        <label class="inline-flex items-center gap-1">
          {{ t('setup.fields.currencySymbolOverride', 'Currency symbol override') }}
          <button
            type="button"
            class="setup-field-editor__hint"
            v-tooltip.bottom="
              hintTooltip(
                t(
                  'setup.fields.currencySymbolOverrideHint',
                  'Leave blank to use the Company Information currency as a prefix (e.g. $53.27). Do not enter ISO codes like USD.',
                ),
              )
            "
            :aria-label="t('common.moreInfo', 'More information')"
          >
            i
          </button>
        </label>
        <InputText
          v-model="form.currencySuffix"
          class="w-full"
          :placeholder="
            t(
              'setup.fields.currencySymbolOverridePlaceholder',
              'Blank = company currency ($)',
            )
          "
        />
      </div>

      <div
        v-if="showDefaultValue"
        class="flex flex-col gap-1"
      >
        <label>{{ t('setup.fields.defaultValue', 'Default Value') }}</label>
        <Select
          v-if="isPicklist && form.picklistMode !== 'dynamic' && choiceDefaultOptions.length"
          v-model="form.defaultValue"
          :options="choiceDefaultOptions"
          option-label="label"
          option-value="value"
          show-clear
          filter
          class="w-full"
          :placeholder="t('setup.fields.defaultValueNone', 'None')"
        />
        <Select
          v-else-if="storageType === 'BOOLEAN'"
          :model-value="
            form.defaultValue === true || form.defaultValue === 'true'
              ? 'true'
              : form.defaultValue === false || form.defaultValue === 'false'
                ? 'false'
                : null
          "
          :options="[
            { label: t('setup.fields.defaultValueTrue', 'True'), value: 'true' },
            { label: t('setup.fields.defaultValueFalse', 'False'), value: 'false' },
          ]"
          option-label="label"
          option-value="value"
          show-clear
          class="w-full"
          :placeholder="t('setup.fields.defaultValueNone', 'None')"
          @update:model-value="form.defaultValue = $event ?? null"
        />
        <InputText
          v-else
          :model-value="form.defaultValue == null ? '' : String(form.defaultValue)"
          class="w-full"
          :placeholder="t('setup.fields.defaultValueNone', 'None')"
          autocomplete="off"
          @update:model-value="form.defaultValue = $event ?? null"
        />
      </div>

      <div
        v-if="showDefaultValue"
        class="flex flex-col gap-1"
      >
        <label>{{ t('setup.fields.defaultFromParent', 'Default from parent field') }}</label>
        <Select
          :model-value="form.defaultFromParent || null"
          :options="parentDefaultFieldOptions"
          option-label="label"
          option-value="value"
          show-clear
          filter
          class="w-full"
          :loading="parentDefaultFieldsLoading"
          :placeholder="t('setup.fields.defaultValueNone', 'None')"
          :empty-message="
            t(
              'setup.fields.defaultFromParentEmpty',
              'No matching fields on related (M2O) parents.',
            )
          "
          @update:model-value="
            form.defaultFromParent = typeof $event === 'string' ? $event : ''
          "
        />
        <p class="m-0 text-sm text-muted-color">
          {{
            t(
              'setup.fields.defaultFromParentHint',
              'Create only (not on edit). Copies from the related-list parent, or from a selected M2O (e.g. Item → Base price) when that lookup is set.',
            )
          }}
        </p>
      </div>

      <div class="flex flex-wrap gap-x-4 gap-y-2">
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.required"
            binary
            input-id="field-required"
            :disabled="isComputed"
          />
          <label for="field-required">{{ t('setup.fields.required', 'Required') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.readonly"
            binary
            input-id="field-readonly"
            :disabled="isComputed"
          />
          <label for="field-readonly">{{ t('setup.fields.readonly', 'Read-only') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.hidden"
            binary
            input-id="field-hidden"
          />
          <label for="field-hidden">{{ t('setup.fields.hidden', 'Hidden') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.isUnique"
            binary
            input-id="field-unique"
            :disabled="isAutoNumberType"
          />
          <label for="field-unique">{{ t('setup.fields.unique', 'Unique') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.isIndexed"
            binary
            input-id="field-indexed"
            :disabled="form.isLookup || form.isUnique || isAutoNumberType"
          />
          <label for="field-indexed">{{ t('setup.fields.indexed', 'Indexed') }}</label>
        </div>
        <div
          v-if="isM2ORelation"
          class="flex items-center gap-2"
        >
          <Checkbox
            v-model="form.useInSearch"
            binary
            input-id="field-use-in-search"
          />
          <label for="field-use-in-search">{{
            t('setup.fields.useInSearch', 'Use in search')
          }}</label>
        </div>
      </div>
      <p
        v-if="isM2ORelation"
        class="m-0 text-sm text-muted-color"
      >
        {{
          t(
            'setup.fields.useInSearchHint',
            'When enabled, list search matches the related object Display Template (not the raw ID).',
          )
        }}
      </p>
      <div class="flex flex-col gap-1">
        <label class="inline-flex items-center gap-1" for="field-sensitivity">
          {{ t('setup.fields.securityLevel', 'Field security level') }}
          <button
            type="button"
            class="setup-field-editor__hint"
            v-tooltip.bottom="
              hintTooltip(
                t(
                  'setup.fields.securityLevelHint',
                  'Restricted and Confidential fields are only returned by the API to roles granted that level in Setup → Roles (Sensitive read / Sensitive edit). Administrators always see them. Avoid using sensitive fields in the Display Template.',
                ),
              )
            "
            :aria-label="t('common.moreInfo', 'More information')"
          >
            i
          </button>
        </label>
        <Select
          v-model="form.sensitivity"
          input-id="field-sensitivity"
          :options="sensitivityOptions()"
          option-label="label"
          option-value="value"
          class="w-full md:w-60"
        />
      </div>

      <div
        v-if="supportsChildLookup"
        class="flex flex-col gap-2 border-t border-surface-200 pt-3"
      >
        <label class="flex items-center justify-between gap-3">
          {{ t('formBuilder.childValueLookup', 'Child value lookup') }}
          <ToggleSwitch
            class="shrink-0"
            :model-value="childLookupEnabled"
            @update:model-value="setChildLookupEnabled(Boolean($event))"
          />
        </label>
        <template v-if="childLookupEnabled">
          <p
            v-if="childLookupSettingsSummary"
            class="m-0 text-sm text-muted-color"
          >
            {{ childLookupSettingsSummary }}
          </p>
          <Button
            :label="t('formBuilder.configureChildLookup', 'Configure child value lookup')"
            icon="pi pi-cog"
            size="small"
            outlined
            class="align-self-start"
            @click="childLookupDialogVisible = true"
          />
        </template>
      </div>

      <div class="flex items-start gap-2 min-w-0">
        <ToggleSwitch
          v-model="form.applyDdl"
          class="shrink-0"
        />
        <label class="leading-snug">
          {{
            t(
              'setup.fields.applyDdl',
              'Apply crm_schema column / indexes now',
            )
          }}
        </label>
      </div>
    </div>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="dialogVisible = false"
      />
      <Button
        :label="t('common.save', 'Save')"
        :disabled="
          !resolvedApiName ||
            (isRelationField && !form.relatedEntity) ||
            (isPicklist &&
              form.picklistMode !== 'dynamic' &&
              !form.choices.some((c) => c.text.trim() || c.value.trim())) ||
            (isPicklist && form.picklistMode === 'dynamic' && !dynamicPicklistReady) ||
            (isJsonList && !form.jsonColumns.some((c) => c.name.trim())) ||
            (isJsonSensitivity && !sensitivitySourceReady)
        "
        @click="submit"
      />
    </template>
  </Dialog>

  <ChildLookupSettingsDialog
    v-model:visible="childLookupDialogVisible"
    :field-label="form.label"
    :settings="childLookupDraft"
    :is-picklist="childLookupIsPicklist"
    :default-mode="childLookupDefaultMode"
    :default-mode-options="childLookupDefaultModeOptions"
    :source-field-options="childLookupSourceFieldOptions"
    :collection-options="childLookupCollectionOptions"
    :child-field-options="childLookupChildFieldOptions"
    :default-field-options="childLookupDefaultFieldOptions"
    :parent-relation-options="childLookupParentRelationOptions"
    :parent-relation-field="childLookupParentRelationField"
    :show-parent-collection-selector="childLookupShowParentSelector"
    :parent-filter-field-options="childLookupParentFilterFieldOptions"
    :source-token-field-options="childLookupSourceTokenFieldOptions"
    :filter-pairs="childLookupFilterPairs"
    :child-fields-loading="childLookupFieldsLoading"
    :source-fields-loading="childLookupSourceFieldsLoading"
    :parent-fields-loading="childLookupParentFieldsLoading"
    @update:source-field="updateChildLookupSourceField"
    @update:default-mode="setChildLookupDefaultMode"
    @update:collection="updateChildLookupCollection"
    @update:settings="updateChildLookupSettings"
    @update:parent-field="updateChildLookupParentField"
    @add-filter="addChildLookupFilterPair"
    @update-filter="updateChildLookupFilterPair"
    @remove-filter="removeChildLookupFilterPair"
  />
</template>

<style scoped>
.setup-field-editor {
  min-width: 0;
  max-width: 100%;
}

.setup-field-editor :deep(.p-inputtext),
.setup-field-editor :deep(.p-select),
.setup-field-editor :deep(.p-inputnumber),
.setup-field-editor :deep(.p-inputnumber-input) {
  max-width: 100%;
}

.setup-field-editor__numeric {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.setup-field-editor__numeric :deep(.p-inputnumber) {
  width: 100%;
}

.setup-field-editor__hint {
  align-items: center;
  background: var(--p-surface-100, #f1f5f9);
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 999px;
  color: var(--p-surface-600, #475569);
  cursor: help;
  display: inline-flex;
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  height: 1.1rem;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 1.1rem;
}

.setup-field-picklist__list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: min(50vh, 28rem);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.25rem;
}
</style>
