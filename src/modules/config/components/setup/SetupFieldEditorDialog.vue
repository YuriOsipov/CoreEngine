<script lang="ts">
export default {
  name: 'SetupFieldEditorDialog',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { LayoutFieldChildLookup } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  fetchEntityFieldsAndRelations,
  type RegistryFieldInputDto,
  type RegistryFieldListRow,
} from '@/core/graphql/fieldsApi'
import { normalizeFieldInterface } from '@/core/graphql/schemaMapper'
import { getCachedRelations } from '@/modules/entities/services/collectionSchema'
import {
  keysEqual,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { useChildLookupFieldConfig } from '@/modules/config/composables/useChildLookupFieldConfig'
import ChildLookupSettingsDialog from '@/modules/config/components/ChildLookupSettingsDialog.vue'

interface ChoiceRow {
  text: string
  value: string
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
  sort: 0,
  isLookup: false,
  /** none | M2O | M2M */
  relationKind: 'none' as 'none' | 'M2O' | 'M2M',
  relatedEntity: null as string | null,
  /** M2O FK ON DELETE — default RESTRICT. */
  onDelete: 'RESTRICT' as 'CASCADE' | 'SET NULL' | 'RESTRICT',
  applyDdl: true,
  defaultValue: null as string | number | boolean | null,
  choices: [] as ChoiceRow[],
  dateFormat: 'short',
  dateFormatCustom: '',
  currencySuffix: '',
  decimalPlaces: 2,
  formulaTemplate: '',
  rollupChildEntity: null as string | null,
  rollupParentField: null as string | null,
  rollupValueField: null as string | null,
  rollupOp: 'SUM' as string,
  displayFormat: '{0000}',
  startingNumber: 1,
})

const childFieldOptions = ref<Array<{ label: string; value: string }>>([])
const childLookupFieldOptions = ref<Array<{ label: string; value: string }>>([])
const childFieldsLoading = ref(false)
const relatedChildEntityOptions = ref<Array<{ label: string; value: string }>>([])
const relatedChildrenLoading = ref(false)
const apiNameTouched = ref(false)

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
    label: t('setup.fields.onDeleteRestrict', 'Restrict (block delete)'),
    value: 'RESTRICT',
  },
  {
    label: t('setup.fields.onDeleteCascade', 'Cascade (delete children)'),
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
  () => !isM2MRelation.value && !isComputed.value && !isAddressType.value,
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
        { label: t('setup.fields.ifaceAddress', 'Address'), value: 'address' },
        { label: t('setup.fields.ifaceJson', 'JSON'), value: 'input-code' },
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
const isDateLike = computed(
  () => storageType.value === 'DATE' || storageType.value === 'DATETIME',
)
const showDefaultValue = computed(
  () => !form.isLookup && !isComputed.value && !isAddressType.value,
)

const choiceFilter = ref('')

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
      return 'calculated'
    case 'AUTO_NUMBER':
      return 'input'
    case 'ADDRESS':
    case 'JSON':
      return 'address'
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
  if (isComputed.value) {
    form.interface = 'calculated'
    return
  }
  form.interface = normalizeFieldInterface(form.interface)
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

function readRollup(options: Record<string, unknown>): {
  childEntity: string | null
  parentField: string | null
  valueField: string | null
  op: string
} {
  const raw = options.rollup
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      childEntity: null,
      parentField: null,
      valueField: null,
      op: 'SUM',
    }
  }
  const row = raw as Record<string, unknown>
  return {
    childEntity: String(row.childEntity ?? row.child_entity ?? '').trim() || null,
    parentField: String(row.parentField ?? row.parent_field ?? '').trim() || null,
    valueField: String(row.valueField ?? row.value_field ?? '').trim() || null,
    op: String(row.op ?? row.aggregate ?? 'SUM').trim().toUpperCase() || 'SUM',
  }
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

function resetFromProps(): void {
  apiNameTouched.value = props.mode === 'edit'
  if (props.mode === 'edit' && props.field) {
    const options = props.field.options ?? {}
    const display = props.field.displayOptions ?? {}
    form.apiName = props.field.apiName
    form.label = props.field.label
    form.isLookup =
      props.field.relationKind === 'M2O' || props.field.relationKind === 'M2M'
    form.relationKind =
      props.field.relationKind === 'M2O' || props.field.relationKind === 'M2M'
        ? props.field.relationKind
        : 'none'
    form.relatedEntity = props.field.relatedEntityApiName
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
    } else {
      form.type = props.field.type === 'ALIAS' ? 'STRING' : props.field.type
      form.resultType = 'FLOAT'
    }
    form.interface = normalizeFieldInterface(props.field.interface || 'input')
    if (form.type === 'ADDRESS') {
      form.interface = 'address'
    }
    form.required = props.field.required
    form.readonly = props.field.readonly
    form.hidden = props.field.hidden
    form.isUnique = props.field.isUnique
    form.isIndexed =
      Boolean(props.field.isIndexed) ||
      props.field.relationKind === 'M2O' ||
      Boolean(props.field.isUnique)
    form.sort = props.field.sort
    form.applyDdl = true
    form.defaultValue = readDefaultFromOptions(options)
    form.choices = parseChoices(options)
    form.formulaTemplate = readFormulaTemplate(options)
    const rollup = readRollup(options)
    form.rollupChildEntity = rollup.childEntity
    form.rollupParentField = rollup.parentField
    form.rollupValueField = rollup.valueField
    form.rollupOp = rollup.op
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
      (options.suffix || options.currency || options.decimalPlaces != null) &&
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
    form.currencySuffix = String(options.suffix ?? options.currency ?? '')
    form.decimalPlaces = Number(
      options.decimalPlaces ?? options.minFractionDigits ?? 2,
    )
    if (!Number.isFinite(form.decimalPlaces)) form.decimalPlaces = 2
    ensureInterfaceValid()
    void loadRelatedChildEntities()
    void loadChildFields(form.rollupChildEntity)
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
  form.sort = 0
  form.isLookup = false
  form.relationKind = 'none'
  form.relatedEntity = null
  form.onDelete = 'RESTRICT'
  form.applyDdl = true
  form.defaultValue = null
  form.choices = []
  form.dateFormat = 'short'
  form.dateFormatCustom = ''
  form.currencySuffix = ''
  form.decimalPlaces = 2
  form.formulaTemplate = ''
  form.rollupChildEntity = null
  form.rollupParentField = null
  form.rollupValueField = null
  form.rollupOp = 'SUM'
  form.displayFormat = '{0000}'
  form.startingNumber = 1
  choiceFilter.value = ''
  childFieldOptions.value = []
  childLookupFieldOptions.value = []
  relatedChildEntityOptions.value = []
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

function buildOptionsAndDisplay(): {
  options: Record<string, unknown>
  displayOptions: Record<string, unknown>
} {
  const options: Record<string, unknown> = {}
  const displayOptions: Record<string, unknown> = {}

  if (isPicklist.value) {
    options.choices = form.choices
      .filter((row) => row.text.trim() || row.value.trim())
      .map((row) => ({
        text: row.text.trim() || row.value.trim(),
        value: coerceChoiceValue(row.value, storageType.value),
      }))
  }

  if (isCurrency.value) {
    if (form.currencySuffix.trim()) {
      options.suffix = form.currencySuffix.trim()
    }
    const places = Math.min(6, Math.max(0, Math.trunc(Number(form.decimalPlaces) || 0)))
    options.decimalPlaces = places
    options.minFractionDigits = places
    options.maxFractionDigits = places
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
  }

  if (computeMode.value === 'formula') {
    options.computeMode = 'formula'
    options.template = form.formulaTemplate.trim()
  } else if (computeMode.value === 'rollup') {
    options.computeMode = 'rollup'
    options.rollup = {
      childEntity: form.rollupChildEntity,
      parentField: form.rollupParentField,
      valueField: form.rollupValueField || '*',
      op: form.rollupOp || 'SUM',
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
    if (form.relationKind === 'M2M') {
      form.interface = 'list-m2m'
      return
    }
    if (form.isLookup || form.relationKind === 'M2O') {
      form.interface = 'select-dropdown-m2o'
      form.isIndexed = true
      return
    }
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
      form.interface = 'calculated'
      if (!form.resultType) form.resultType = 'FLOAT'
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
  (child) => {
    void loadChildFields(child)
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
    if (iface === 'select-dropdown' && form.choices.length === 0) {
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

  const apiName = resolvedApiName.value
  if (!apiName) return

  const { options, displayOptions } = buildOptionsAndDisplay()
  const resolvedType =
    form.relationKind === 'M2O'
      ? 'UUID'
      : form.relationKind === 'M2M'
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
    interface:
      form.relationKind === 'M2O'
        ? 'select-dropdown-m2o'
        : form.relationKind === 'M2M'
          ? 'list-m2m'
          : isAutoNumberType.value
            ? 'input'
            : isAddressType.value
              ? 'address'
              : isComputed.value
                ? 'calculated'
                : normalizeFieldInterface(
                    form.interface.trim() || defaultInterfaceFor(resolvedType, false),
                  ),
    required: isComputed.value || form.relationKind === 'M2M' ? false : form.required,
    readonly: isComputed.value ? true : form.readonly,
    hidden: form.hidden,
    isUnique: isAutoNumberType.value ? true : form.isUnique,
    isIndexed:
      isAutoNumberType.value ||
      form.relationKind === 'M2O' ||
      form.isUnique ||
      form.isIndexed,
    sort: form.sort,
    options,
    displayOptions,
  }

  if (form.relationKind === 'M2O') {
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
        v-if="!isAutoNumberType && !isNameField && !isAddressType"
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
              'What happens to this record when the related record is deleted.',
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
          <small class="text-muted-color">
            {{
              t(
                'setup.fields.rollupHint',
                'Recalculated when child records change. Stored on this object.',
              )
            }}
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
          v-if="!isComputed && !isAddressType"
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
        v-if="isPicklist"
        class="setup-field-picklist flex flex-col gap-2"
      >
        <div class="flex items-center justify-between gap-2">
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
        <IconField v-if="form.choices.length > 8">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="choiceFilter"
            class="w-full"
            :placeholder="t('setup.fields.filterChoices', 'Filter values…')"
          />
        </IconField>
        <div class="setup-field-picklist__list">
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
        v-if="isCurrency"
        class="setup-field-editor__currency grid gap-3"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <label>{{ t('setup.fields.currencySuffix', 'Currency suffix') }}</label>
          <InputText
            v-model="form.currencySuffix"
            class="w-full"
            placeholder="₴ / USD / €"
          />
        </div>
        <div class="flex flex-col gap-1 min-w-0">
          <label>{{ t('setup.fields.decimalPlaces', 'Decimals') }}</label>
          <InputNumber
            v-model="form.decimalPlaces"
            class="w-full"
            :min="0"
            :max="6"
            show-buttons
          />
        </div>
      </div>

      <div
        v-if="showDefaultValue"
        class="flex flex-col gap-1"
      >
        <label>{{ t('setup.fields.defaultValue', 'Default Value') }}</label>
        <Select
          v-if="isPicklist && choiceDefaultOptions.length"
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
            (isPicklist && !form.choices.some((c) => c.text.trim() || c.value.trim()))
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

.setup-field-editor__currency {
  grid-template-columns: minmax(0, 1fr) minmax(7.5rem, 9rem);
}

.setup-field-editor__currency :deep(.p-inputnumber) {
  width: 100%;
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
