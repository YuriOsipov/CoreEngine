import { computed, ref, watch } from 'vue'
import type { TreeNode } from 'openvue/treenode'
import type {
  FieldDefinition,
  RelationDefinition,
  DataTableColumnConfig,
  LayoutFieldChildLookup,
  RelatedTransferLookupMapping,
  RelatedTransferSettings,
} from '@/interfaces'
import { keysEqual, relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { resolveRelatedTransferValue } from '@/core/relatedTransferResolver'
import { resolveRecordKey } from '@/core/utils/object'
import { loadChildLookupFieldSettings } from '@/modules/config/services/layoutSettings'
import { getCachedCollectionFields, getCachedRelations } from '@/modules/entities/services/collectionSchema'
import {
  createDynamicItem,
  loadSourceGroups,
  loadSourceItems,
  labelTargetRelationCells,
  loadTargetRows,
  mergeChildLookupFieldSettings,
  resolveLookupPayload,
  loadSelectableLookupOptions,
  sourceItemGroupId,
  type RelatedTransferDataContext,
} from '@/modules/entities/services/relatedTransferData'
import {
  applySelectableLookupDefaults,
  applyTargetDefaultValues,
  buildCreatePayload,
  buildPendingPayload,
  duplicateValue,
  formatTransferValue,
  isLookupSourceColumn,
  lookupSourceTargetField,
  sourceValue,
  targetValue,
} from '@/modules/entities/utils/relatedTransferLookups'
import { choiceValueLabel, formatNumberDisplayValue, humanizeFieldName, resolveNumberDisplayOptions, scalarId } from '@/modules/entities/utils/recordDisplay'
import type {
  LookupHeaderItem,
  TransferRow,
  TranslateFn,
} from '@/modules/entities/components/related-transfer/types'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'

export interface UseRelatedTransferOptions {
  settings: () => RelatedTransferSettings | null | undefined
  label: () => string | undefined
  parentRecord: () => Record<string, unknown>
  parentCollection: () => string | undefined
  parentId: () => string | number | undefined
  targetParentField: () => string | undefined
  currentTargetRows: () => Record<string, unknown>[] | undefined
  t: TranslateFn
  emitSubmitted: (targetCollection: string) => void
}

export function useRelatedTransfer(options: UseRelatedTransferOptions) {
  const sourceItems = ref<Record<string, unknown>[]>([])
  const sourceGroups = ref<Record<string, unknown>[]>([])
  const targetRows = ref<Record<string, unknown>[]>([])
  const pendingRows = ref<TransferRow[]>([])
  const sourceChoiceLabels = ref<Map<string, Map<string, string>>>(new Map())
  const sourceRecordLabels = ref<Map<string, string>>(new Map())
  const sourceRelationCollections = ref<Map<string, string>>(new Map())
  const lookupRowsByTargetField = ref<Map<string, Map<string, Record<string, unknown>>>>(new Map())
  const lookupHeaderItems = ref<LookupHeaderItem[]>([])
  const selectedSourceGroupId = ref<string | number | null>(null)
  const sourceSearchQuery = ref('')
  const sourceSortField = ref<string | undefined>(undefined)
  const sourceSortOrder = ref<1 | -1>(1)
  const loadingSource = ref(false)
  const loadingTarget = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const hydratedSettings = ref<RelatedTransferSettings | null>(null)
  const targetFieldDefinitions = ref<FieldDefinition[]>([])
  const sourceFieldDefinitions = ref<FieldDefinition[]>([])
  const nestedSourceFieldDefinitions = ref<Record<string, FieldDefinition[]>>({})
  const relationDefinitions = ref<RelationDefinition[]>([])
  const childLookupSettingsByField = ref<Record<string, LayoutFieldChildLookup>>({})
  let loadToken = 0
  let hydrateToken = 0

  const settings = computed(() => hydratedSettings.value)
  const source = computed(() => settings.value?.source ?? null)
  const target = computed(() => settings.value?.target ?? null)
  const resolvedTargetParentField = computed(() =>
    options.targetParentField() || target.value?.parentField || '',
  )
  const sourceMode = computed(() => source.value?.mode ?? 'tree')
  const sourcePrimaryKey = computed(() => source.value?.itemPrimaryKey || 'id')
  const groupLabelField = computed(() => source.value?.groupLabelField || 'name')
  const itemLabelFields = computed(() =>
    source.value?.itemLabelFields?.length ? source.value.itemLabelFields : ['name'],
  )
  const duplicateKey = computed(() => target.value?.duplicateKey || target.value?.itemField || 'id')
  const targetColumns = computed<DataTableColumnConfig[]>(() =>
    target.value?.columns?.length
      ? target.value.columns
      : [{ field: target.value?.itemField ?? 'item', header: options.t('relatedTransfer.item', 'Item') }],
  )
  const editableTargetFields = computed(() => {
    const configured = target.value?.editableFields?.filter(Boolean) ?? []
    if (configured.length > 0) return new Set(configured)

    return new Set(
      targetColumns.value
        .filter((column) => /^(qty|quantity)$/i.test(column.field) || /^(qty|quantity)$/i.test(column.header))
        .map((column) => column.field),
    )
  })
  const isConfigured = computed(() =>
    Boolean(
      source.value?.itemCollection &&
        target.value?.collection &&
        resolvedTargetParentField.value &&
        target.value.itemField,
    ),
  )
  const loading = computed(() => loadingSource.value || loadingTarget.value)
  const shouldSplitSourceTree = computed(() =>
    Boolean(
      sourceMode.value === 'tree' &&
        source.value?.groupCollection &&
        source.value.itemGroupField,
    ),
  )
  const fillPanelStyle: Record<string, string> = {
    height: '100%',
    minHeight: '0',
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
  }
  const sourcePanelStyle = computed(() => fillPanelStyle)
  const selectedPanelStyle = computed(() => fillPanelStyle)
  const tableModeScrollHeight = 'flex'
  const treeModeSourceScrollHeight = 'flex'
  const treeModeSelectedScrollHeight = 'flex'

  function dataContext(): RelatedTransferDataContext {
    return {
      t: options.t,
      parentRecord: options.parentRecord(),
      parentId: options.parentId(),
      parentCollection: options.parentCollection(),
      resolvedTargetParentField: resolvedTargetParentField.value,
      targetParentField: target.value?.parentField,
      sourcePrimaryKey: sourcePrimaryKey.value,
      lookupRowsByTargetField: lookupRowsByTargetField.value,
    }
  }

  function payloadContext() {
    return {
      parentRecord: options.parentRecord(),
      parentId: options.parentId(),
      parentField: resolvedTargetParentField.value || target.value?.parentField || '',
      sourcePrimaryKey: sourcePrimaryKey.value,
    }
  }

  function lookupSourceColumnHeader(field: string): string {
    const targetField = lookupSourceTargetField(field)
    const column = targetColumns.value.find((item) => item.field === targetField)
    return column?.header || humanizeFieldName(targetField)
  }

  const sourceTableColumns = computed<DataTableColumnConfig[]>(() => {
    const fields = Array.from(new Set([
      ...(source.value?.itemLabelFields ?? []),
      ...(source.value?.fields ?? []),
    ].filter(Boolean)))
    const tableFields = fields.length > 0 ? fields : itemLabelFields.value

    return tableFields.map((field) => ({
      field,
      header: isLookupSourceColumn(field)
        ? lookupSourceColumnHeader(field)
        : field.split('.').filter(Boolean).map((part) => humanizeFieldName(part)).join(' / '),
    }))
  })

  function cachedLookupRowForSource(
    targetField: string,
    sourceRecord: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const id = sourceValue(sourceRecord, sourcePrimaryKey.value)
    if (id === null) return null
    return lookupRowsByTargetField.value.get(targetField)?.get(String(id)) ?? null
  }

  function lookupSourceDisplayValue(
    sourceRecord: Record<string, unknown>,
    targetField: string,
  ): string {
    const lookup = settings.value?.mapping?.lookups?.[targetField]
    const row = cachedLookupRowForSource(targetField, sourceRecord)
    if (!lookup || !row) return formatTransferValue(undefined)
    return formatTransferValue(row[lookup.valueField])
  }

  function sourceFieldLabelMap(field: string): Map<string, string> | undefined {
    if (sourceChoiceLabels.value.has(field)) return sourceChoiceLabels.value.get(field)
    return [...sourceChoiceLabels.value.entries()].find(([key]) => keysEqual(key, field))?.[1]
  }

  function sourceDisplayValue(item: Record<string, unknown>, field: string): string {
    if (isLookupSourceColumn(field)) {
      return lookupSourceDisplayValue(item, lookupSourceTargetField(field))
    }

    const value = field.includes('.')
      ? resolveRelatedTransferValue(`$source.${field}`, { sourceRecord: item })
      : (() => {
          const key = resolveRecordKey(item, field)
          return key ? item[key] : undefined
        })()
    const labels = sourceFieldLabelMap(field)
    const choiceLabel = labels ? choiceValueLabel(scalarId(value) ?? value, labels) : undefined
    if (choiceLabel) return choiceLabel
    return formatSourceFieldValue(field, value)
  }

  const currentRows = computed<TransferRow[]>(() =>
    targetRows.value.map((row) => ({
      key: `current:${duplicateValue(row, duplicateKey.value) ?? targetValue(row, 'id') ?? JSON.stringify(row)}`,
      kind: 'current' as const,
      target: row,
    })),
  )
  const selectedRows = computed(() => [...pendingRows.value, ...currentRows.value])

  function labeledRelation(id: string | number, label: string | undefined): unknown {
    if (!label || label === String(id)) return id
    return { __crmValueType: 'm2o', id, label }
  }

  function targetRelatedCollection(field: string): string {
    return relatedCollectionForCollectionField(
      relationDefinitions.value,
      target.value?.collection ?? '',
      field,
    )
  }

  function matchingSourceRelationField(
    relatedCollection: string,
    targetField: string,
  ): string | undefined {
    const matches = [...sourceRelationCollections.value.entries()]
      .filter(([, related]) => keysEqual(related, relatedCollection))

    const copied = Object.entries(settings.value?.mapping?.copyFromSource ?? {})
      .find(([field]) => keysEqual(field, targetField))?.[1]
    // Only honor copyFromSource when it points at a real M2O to the related
    // collection (e.g. Item → Item). Ignore PK mappings like Item → Id.
    if (
      copied &&
      matches.some(([field]) => keysEqual(field, copied))
    ) {
      return matches.find(([field]) => keysEqual(field, copied))?.[0] ?? copied
    }

    return matches.find(([field]) => keysEqual(field, targetField))?.[0] ?? matches[0]?.[0]
  }

  function sourceRecordDisplayLabel(
    sourceRecord: Record<string, unknown>,
    id: string | number,
  ): string | undefined {
    const cached = sourceRecordLabels.value.get(String(id))
    if (cached && cached !== String(id)) return cached

    for (const field of itemLabelFields.value) {
      const key = resolveRecordKey(sourceRecord, field)
      if (!key) continue
      const text = sourceDisplayValue(sourceRecord, key)
      if (text && text !== '-' && text !== String(id)) return text
    }

    for (const field of sourceTableColumns.value.map((column) => column.field)) {
      const key = resolveRecordKey(sourceRecord, field)
      if (!key) continue
      const text = sourceDisplayValue(sourceRecord, key)
      if (text && text !== '-' && text !== String(id)) return text
    }

    return cached
  }

  function pendingRelationValue(
    field: string,
    sourceRecord: Record<string, unknown>,
  ): unknown {
    const related = targetRelatedCollection(field)
    if (!related) return undefined

    if (keysEqual(related, source.value?.itemCollection ?? '')) {
      const id = sourceValue(sourceRecord, sourcePrimaryKey.value)
      if (id === null) return undefined
      return labeledRelation(id, sourceRecordDisplayLabel(sourceRecord, id))
    }

    const sourceField = matchingSourceRelationField(related, field)
    if (!sourceField) return undefined
    const sourceKey = resolveRecordKey(sourceRecord, sourceField) ?? sourceField
    const id = scalarId(sourceRecord[sourceKey])
    if (id === null) return undefined
    const choiceLabel =
      sourceChoiceLabels.value.get(sourceField)?.get(String(id)) ??
      [...sourceChoiceLabels.value.entries()].find(([field]) => keysEqual(field, sourceField))?.[1]
        ?.get(String(id))
    return labeledRelation(id, choiceLabel ?? sourceDisplayValue(sourceRecord, sourceKey))
  }

  function rowValue(row: TransferRow, field: string): unknown {
    if (row.kind === 'pending') {
      if (
        row.source &&
        isTargetFieldM2O(field) &&
        !isEditablePendingField(row, field) &&
        !isChildLookupPendingField(row, field)
      ) {
        const displayed = pendingRelationValue(field, row.source)
        if (displayed !== undefined) return displayed
      }
      if (Object.prototype.hasOwnProperty.call(row.draft ?? {}, field)) {
        return row.draft?.[field]
      }
      const payload = row.source && settings.value
        ? buildCreatePayload(settings.value, row.source, payloadContext())
        : {}
      return payload[field] ?? row.source?.[field]
    }
    return targetValue(row.target, field)
  }

  const selectedColumnTotals = computed<Record<string, number>>(() => {
    const totals: Record<string, number> = {}
    for (const column of targetColumns.value) {
      if (!isNumericTargetField(column.field)) continue
      const values = selectedRows.value
        .map((row) => {
          const v = rowValue(row, column.field)
          const n = Number(v)
          return isFinite(n) && v !== null && v !== '' ? n : null
        })
      const numericValues = values.filter((v): v is number => v !== null)
      if (numericValues.length > 0) {
        totals[column.field] = numericValues.reduce((sum, v) => sum + v, 0)
      }
    }
    return totals
  })
  const hasAnyTotal = computed(() => Object.keys(selectedColumnTotals.value).length > 0)

  const computedTotals = computed<Array<{ label: string; value: number }>>(() => {
    const formulas = target.value?.totalFormulas ?? []
    if (formulas.length === 0 || selectedRows.value.length === 0) return []
    const columns = targetColumns.value

    return formulas
      .filter((f) => f.label && f.formula)
      .map((f) => {
        let total = 0
        for (const row of selectedRows.value) {
          const vars: Record<string, number> = {}
          for (const col of columns) {
            const v = rowValue(row, col.field)
            vars[col.field.toLowerCase()] = isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : 0
          }
          try {
            const argNames = Object.keys(vars)
            const argValues = argNames.map((k) => vars[k])
            // eslint-disable-next-line no-new-func
            const result = new Function(...argNames, `return (${f.formula})`)(...argValues)
            if (typeof result === 'number' && isFinite(result)) total += result
          } catch {
            // invalid formula — skip row
          }
        }
        return { label: f.label, value: total }
      })
  })

  const existingDuplicateValues = computed(() => {
    const values = new Set<string>()
    for (const row of selectedRows.value) {
      const duplicate = row.kind === 'pending'
        ? sourceValue(row.source, sourcePrimaryKey.value)
        : duplicateValue(row.target, duplicateKey.value)
      if (duplicate !== null) values.add(String(duplicate))
    }
    return values
  })

  function groupLabel(group: unknown, fallback: string): string {
    if (group && typeof group === 'object') {
      const record = group as Record<string, unknown>
      return String(record[groupLabelField.value] ?? record.name ?? record.id ?? fallback)
    }
    return String(group ?? fallback)
  }

  function buildSourceGroupTree(): TreeNode[] {
    const sourceSettings = source.value
    if (!sourceSettings?.groupCollection) return []

    const groups = new Map<string, TreeNode>()
    const roots: TreeNode[] = []

    for (const group of sourceGroups.value) {
      const groupId = sourceValue(group, sourceSettings.groupPrimaryKey || 'id')
      if (groupId === null) continue
      const key = String(groupId)
      groups.set(key, {
        key: `group:${key}`,
        label: groupLabel(group, key),
        data: { type: 'group', id: groupId },
        children: [],
        selectable: true,
      })
    }

    for (const group of sourceGroups.value) {
      const groupId = sourceValue(group, sourceSettings.groupPrimaryKey || 'id')
      if (groupId === null) continue
      const groupNode = groups.get(String(groupId))
      if (!groupNode) continue

      const parentId = sourceSettings.groupParentField
        ? scalarId(group[sourceSettings.groupParentField])
        : null
      const parentNode = parentId === null ? null : groups.get(String(parentId))
      if (parentNode && parentNode !== groupNode) {
        parentNode.children = [...(parentNode.children ?? []), groupNode]
      } else {
        roots.push(groupNode)
      }
    }

    return roots
  }

  const sourceGroupTreeNodes = computed<TreeNode[]>(() => {
    if (!shouldSplitSourceTree.value) return []
    return buildSourceGroupTree()
  })

  const focusedSourceItems = computed(() => {
    if (!shouldSplitSourceTree.value) return sourceItems.value
    const groupField = source.value?.itemGroupField
    if (!groupField || selectedSourceGroupId.value === null) return []

    return sourceItems.value.filter((item) => {
      const groupId = sourceItemGroupId(item, groupField)
      return groupId !== null && String(groupId) === String(selectedSourceGroupId.value)
    })
  })

  const filteredSortedSourceItems = computed(() => {
    let items = focusedSourceItems.value

    const query = sourceSearchQuery.value.trim().toLowerCase()
    if (query) {
      items = items.filter((item) =>
        sourceTableColumns.value.some((col) =>
          sourceDisplayValue(item, col.field).toLowerCase().includes(query),
        ),
      )
    }

    if (sourceSortField.value) {
      const field = sourceSortField.value
      const order = sourceSortOrder.value
      items = [...items].sort((a, b) => {
        const ka = sourceDisplayValue(a, field).toLowerCase()
        const kb = sourceDisplayValue(b, field).toLowerCase()
        return order * ka.localeCompare(kb)
      })
    }

    return items
  })

  async function hydrateRelatedTransferSettings(): Promise<void> {
    const baseSettings = options.settings()
    const token = ++hydrateToken
    if (!baseSettings) {
      hydratedSettings.value = null
      targetFieldDefinitions.value = []
      sourceFieldDefinitions.value = []
      nestedSourceFieldDefinitions.value = {}
      relationDefinitions.value = []
      childLookupSettingsByField.value = {}
      return
    }

    const targetCollection = baseSettings.target.collection
    const sourceCollection = baseSettings.source.itemCollection
    const fieldNames = baseSettings.target.columns.map((column) => column.field)
    const [nextSettings, fields, sourceFields, relations, childLookups] = await Promise.all([
      mergeChildLookupFieldSettings(baseSettings),
      targetCollection ? getCachedCollectionFields(targetCollection) : Promise.resolve([]),
      sourceCollection ? getCachedCollectionFields(sourceCollection) : Promise.resolve([]),
      getCachedRelations() as Promise<RelationDefinition[]>,
      targetCollection
        ? loadChildLookupFieldSettings(targetCollection, fieldNames)
        : Promise.resolve({}),
    ])
    if (token !== hydrateToken) return
    hydratedSettings.value = nextSettings
    targetFieldDefinitions.value = fields
    sourceFieldDefinitions.value = sourceFields
    relationDefinitions.value = relations
    childLookupSettingsByField.value = childLookups
    nestedSourceFieldDefinitions.value = sourceCollection
      ? await nestedFieldsForSourceColumns(baseSettings, sourceCollection, relations)
      : {}
    if (token !== hydrateToken) return
  }

  async function nestedFieldsForSourceColumns(
    currentSettings: RelatedTransferSettings,
    sourceCollection: string,
    relations: RelationDefinition[],
  ): Promise<Record<string, FieldDefinition[]>> {
    const roots = Array.from(new Set(
      [
        ...(currentSettings.source.itemLabelFields ?? []),
        ...(currentSettings.source.fields ?? []),
      ]
        .filter((field) => field.includes('.'))
        .map((field) => field.split('.')[0] ?? '')
        .filter(Boolean),
    ))
    const entries = await Promise.all(roots.map(async (root) => {
      const related = relatedCollectionForCollectionField(relations, sourceCollection, root)
      if (!related) return [root, [] as FieldDefinition[]] as const
      return [root, await getCachedCollectionFields(related)] as const
    }))
    return Object.fromEntries(entries)
  }

  function sourceFieldDefinition(field: string): FieldDefinition | undefined {
    if (!field.includes('.')) {
      return sourceFieldDefinitions.value.find((item) => keysEqual(item.field, field))
    }
    const [root, ...rest] = field.split('.')
    const leaf = rest[rest.length - 1] ?? ''
    const nested = Object.entries(nestedSourceFieldDefinitions.value)
      .find(([key]) => keysEqual(key, root))?.[1] ?? []
    return nested.find((item) => keysEqual(item.field, leaf))
  }

  function reconcileSelectedSourceGroup(): void {
    const sourceSettings = source.value
    if (!shouldSplitSourceTree.value || !sourceSettings) {
      selectedSourceGroupId.value = null
      return
    }

    const groupIds = new Set(
      sourceGroups.value
        .map((group) => sourceValue(group, sourceSettings.groupPrimaryKey || 'id'))
        .filter((id): id is string | number => id !== null)
        .map((id) => String(id)),
    )

    if (
      selectedSourceGroupId.value !== null &&
      groupIds.has(String(selectedSourceGroupId.value))
    ) {
      return
    }

    selectedSourceGroupId.value = null
  }

  async function loadTransferData(): Promise<void> {
    const currentSettings = settings.value
    if (!currentSettings || !isConfigured.value) {
      sourceItems.value = []
      sourceGroups.value = []
      targetRows.value = []
      pendingRows.value = []
      sourceChoiceLabels.value = new Map()
      sourceRecordLabels.value = new Map()
      sourceRelationCollections.value = new Map()
      lookupRowsByTargetField.value = new Map()
      lookupHeaderItems.value = []
      selectedSourceGroupId.value = null
      return
    }

    const token = ++loadToken
    error.value = null
    loadingSource.value = true
    loadingTarget.value = !options.currentTargetRows()
    pendingRows.value = []

    try {
      const ctx = dataContext()
      const preloadedTargetRows = options.currentTargetRows()
      const [nextSourceResult, nextTargetRows] = await Promise.all([
        loadSourceItems(currentSettings, ctx),
        preloadedTargetRows
          ? labelTargetRelationCells(
            preloadedTargetRows.map((row) => ({ ...row })),
            currentSettings,
          )
          : loadTargetRows(
            currentSettings,
            resolvedTargetParentField.value,
            options.parentId(),
            options.t,
          ),
      ])
      const nextSourceGroups = await loadSourceGroups(currentSettings, options.t)
      if (token !== loadToken) return
      sourceItems.value = nextSourceResult.items
      sourceChoiceLabels.value = nextSourceResult.choiceLabels
      sourceRecordLabels.value = nextSourceResult.sourceRecordLabels
      sourceRelationCollections.value = nextSourceResult.sourceRelationCollections
      lookupRowsByTargetField.value = nextSourceResult.lookupRows
      lookupHeaderItems.value = nextSourceResult.lookupHeaderItems
      sourceGroups.value = nextSourceGroups
      reconcileSelectedSourceGroup()
      targetRows.value = nextTargetRows
      if (nextSourceResult.warning) {
        error.value = nextSourceResult.warning
      }
    } catch (err) {
      if (token === loadToken) {
        error.value =
          err instanceof Error
            ? err.message
            : options.t('relatedTransfer.loadError', 'Failed to load related picker data.')
      }
    } finally {
      if (token === loadToken) {
        loadingSource.value = false
        loadingTarget.value = false
      }
    }
  }

  async function buildCreatePayloadWithLookups(
    currentSettings: RelatedTransferSettings,
    sourceRecord: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return {
      ...buildCreatePayload(currentSettings, sourceRecord, payloadContext()),
      ...await resolveLookupPayload(currentSettings, sourceRecord, dataContext()),
    }
  }

  async function addSourceItem(item: Record<string, unknown>): Promise<void> {
    const id = sourceValue(item, sourcePrimaryKey.value)
    if (id === null || existingDuplicateValues.value.has(String(id))) return

    error.value = null

    try {
      const currentSettings = settings.value
      const draft = currentSettings ? await buildCreatePayloadWithLookups(currentSettings, item) : {}
      const linkedField = target.value?.itemField
      if (linkedField && isTargetFieldM2O(linkedField)) {
        const linked = pendingRelationValue(linkedField, item)
        const linkedId = scalarId(linked)
        if (linkedId !== null) draft[linkedField] = linkedId
      }
      applyTargetDefaultValues(
        draft,
        target.value?.defaultValues,
        {
          parentRecord: options.parentRecord(),
          parentId: options.parentId(),
          sourceRecord: item,
          sourcePrimaryKey: sourcePrimaryKey.value,
        },
      )
      const lookupOptions = currentSettings
        ? await loadSelectableLookupOptions(currentSettings, item, dataContext())
        : {}
      if (currentSettings) {
        applySelectableLookupDefaults(draft, currentSettings, item, lookupOptions, sourcePrimaryKey.value)
      }
      pendingRows.value = [
        {
          key: `pending:${id}`,
          kind: 'pending',
          source: item,
          draft,
          lookupOptions,
        },
        ...pendingRows.value,
      ]
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : options.t('relatedTransfer.lookupError', 'Failed to resolve lookup mapping.')
    }
  }

  function removePending(row: TransferRow): void {
    if (row.kind !== 'pending') return
    pendingRows.value = pendingRows.value.filter((item) => item.key !== row.key)
  }

  async function submitPending(): Promise<void> {
    const currentSettings = settings.value
    const targetSettings = target.value
    if (!currentSettings || !targetSettings || pendingRows.value.length === 0) return

    submitting.value = true
    error.value = null

    try {
      await Promise.all(
        pendingRows.value
          .map((row) =>
            createDynamicItem(
              targetSettings.collection,
              buildPendingPayload(currentSettings, row, payloadContext()),
              options.t('relatedTransfer.targetRowsContext', 'target collection'),
              options.t,
            ),
          ),
      )
      pendingRows.value = []
      await loadTransferData()
      options.emitSubmitted(targetSettings.collection)
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : options.t('relatedTransfer.submitError', 'Failed to create related records.')
    } finally {
      submitting.value = false
    }
  }

  function selectSourceGroup(node: TreeNode): void {
    const data = node.data as Record<string, unknown> | undefined
    const id = scalarId(data?.id)
    if (id !== null) {
      selectedSourceGroupId.value = id
    }
  }

  function isSelectedSourceGroup(node: TreeNode): boolean {
    const data = node.data as Record<string, unknown> | undefined
    const id = scalarId(data?.id)
    return id !== null && selectedSourceGroupId.value !== null &&
      String(id) === String(selectedSourceGroupId.value)
  }

  function onSourceSort(event: {
    sortField?: string | ((item: unknown) => string) | null
    sortOrder?: 1 | -1 | 0 | null
  }): void {
    sourceSortField.value = typeof event.sortField === 'string' ? event.sortField : undefined
    sourceSortOrder.value = (event.sortOrder === -1 ? -1 : 1)
  }

  function isEditableTargetField(field: string): boolean {
    for (const configured of editableTargetFields.value) {
      if (keysEqual(configured, field)) return true
    }
    return false
  }

  function lookupMappingForField(field: string): RelatedTransferLookupMapping | undefined {
    const lookups = settings.value?.mapping?.lookups
    if (!lookups) return undefined
    if (lookups[field]) return lookups[field]
    return Object.entries(lookups).find(([key]) => keysEqual(key, field))?.[1]
  }

  function isQuantityField(field: string): boolean {
    const column = targetColumns.value.find((item) => keysEqual(item.field, field))
    return /^(qty|quantity)$/i.test(field) || /^(qty|quantity)$/i.test(column?.header ?? '')
  }

  function isTargetFieldM2O(field: string): boolean {
    const collection = target.value?.collection ?? ''
    if (!collection) return false
    return isFieldM2O(
      collection,
      field,
      targetFieldDefinitions.value,
      relationDefinitions.value,
    )
  }

  function isNumericDefinition(definition: FieldDefinition | undefined): boolean {
    if (!definition) return false
    if (resolveNumberDisplayOptions(definition)) return true
    const type = definition.type.toLowerCase()
    return ['integer', 'biginteger', 'float', 'decimal', 'numeric', 'number', 'double'].includes(type)
  }

  function formatWithNumberDisplay(
    definition: FieldDefinition | undefined,
    value: unknown,
  ): string {
    const formatted = formatNumberDisplayValue(value, resolveNumberDisplayOptions(definition))
    if (formatted !== null) return formatted
    return formatTransferValue(value)
  }

  function formatTargetFieldValue(field: string, value: unknown): string {
    const definition = targetFieldDefinitions.value.find((item) => keysEqual(item.field, field))
    return formatWithNumberDisplay(definition, value)
  }

  function formatSourceFieldValue(field: string, value: unknown): string {
    return formatWithNumberDisplay(sourceFieldDefinition(field), value)
  }

  function isNumericSourceField(field: string): boolean {
    const definition = sourceFieldDefinition(field)
    if (!definition) return false
    return isNumericDefinition(definition)
  }

  function isNumericTargetField(field: string): boolean {
    // M2O FKs are often typed as integer/uuid — treat them as relations, not numbers.
    if (isTargetFieldM2O(field)) return false
    if (isQuantityField(field)) return true
    const definition = targetFieldDefinitions.value.find((item) => keysEqual(item.field, field))
    if (!definition) return false
    return isNumericDefinition(definition)
  }

  function childLookupSettingsForField(field: string): LayoutFieldChildLookup | undefined {
    if (childLookupSettingsByField.value[field]) {
      return childLookupSettingsByField.value[field]
    }
    return Object.entries(childLookupSettingsByField.value).find(([key]) =>
      keysEqual(key, field),
    )?.[1]
  }

  function isChildLookupPendingField(row: TransferRow, field: string): boolean {
    if (row.kind !== 'pending') return false
    if (!childLookupSettingsForField(field)) return false
    return isSelectableLookupField(row, field) || isEditablePendingField(row, field)
  }

  function isEditablePendingField(row: TransferRow, field: string): boolean {
    if (row.kind !== 'pending') return false
    if (isSelectableLookupField(row, field)) return false
    if (!isEditableTargetField(field)) return false
    return isNumericTargetField(field)
  }

  function isSelectableLookupField(row: TransferRow, field: string): boolean {
    if (row.kind !== 'pending') return false
    const lookup = lookupMappingForField(field)
    if (!lookup?.collection || lookup.selectable !== true) return false
    return isTargetFieldM2O(field)
  }

  function lookupSelectOptions(row: TransferRow, field: string) {
    const options = row.lookupOptions
    if (!options) return []
    if (options[field]) return options[field]
    const entry = Object.entries(options).find(([key]) => keysEqual(key, field))
    return entry?.[1] ?? []
  }

  function updatePendingDraft(row: TransferRow, field: string, value: unknown): void {
    pendingRows.value = pendingRows.value.map((item) => {
      if (item.key !== row.key) return item
      const draft = { ...(item.draft ?? {}) }
      if (value === undefined || value === null || value === '') {
        delete draft[field]
      } else {
        draft[field] = value
      }
      return { ...item, draft }
    })
  }

  watch(
    () => JSON.stringify(options.settings() ?? {}),
    () => {
      void hydrateRelatedTransferSettings()
    },
    { immediate: true },
  )

  watch(
    () => [
      JSON.stringify(settings.value ?? {}),
      JSON.stringify(options.parentRecord() ?? {}),
      JSON.stringify(options.currentTargetRows() ?? []),
      options.parentId() ?? '',
    ],
    () => {
      void loadTransferData()
    },
    { immediate: true },
  )

  return {
    label: computed(() => options.label()),
    settings,
    source,
    target,
    sourceItems,
    sourceGroups,
    targetRows,
    pendingRows,
    lookupHeaderItems,
    selectedSourceGroupId,
    sourceSearchQuery,
    sourceSortField,
    sourceSortOrder,
    loadingSource,
    loadingTarget,
    submitting,
    error,
    resolvedTargetParentField,
    sourcePrimaryKey,
    sourceTableColumns,
    targetColumns,
    editableTargetFields,
    isConfigured,
    loading,
    currentRows,
    selectedRows,
    selectedColumnTotals,
    hasAnyTotal,
    computedTotals,
    existingDuplicateValues,
    shouldSplitSourceTree,
    sourceGroupTreeNodes,
    sourcePanelStyle,
    selectedPanelStyle,
    tableModeScrollHeight,
    treeModeSourceScrollHeight,
    treeModeSelectedScrollHeight,
    filteredSortedSourceItems,
    loadTransferData,
    addSourceItem,
    removePending,
    submitPending,
    selectSourceGroup,
    isSelectedSourceGroup,
    onSourceSort,
    sourceDisplayValue,
    isNumericSourceField,
    formatTransferValue,
    formatTargetFieldValue,
    rowValue,
    isEditablePendingField,
    isNumericTargetField,
    isChildLookupPendingField,
    lookupSelectOptions,
    childLookupSettingsForField,
    updatePendingDraft,
    sourceValue,
    targetCollection: computed(() => target.value?.collection ?? ''),
    parentCollection: computed(() => options.parentCollection() ?? ''),
    parentName: computed(() => resolvedTargetParentField.value),
    parentId: computed(() => options.parentId()),
    parentRecord: computed(() => options.parentRecord()),
  }
}
