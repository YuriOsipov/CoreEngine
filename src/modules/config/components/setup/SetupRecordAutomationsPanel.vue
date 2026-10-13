<script lang="ts">
export default {
  name: 'SetupRecordAutomationsPanel',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import type { MenuItem } from 'openvue/menuitem'
import { useTranslation } from '@/core/translation'
import {
  fetchEntityAutomations,
  upsertEntityAutomations,
  type EntityRecordAutomationDto,
} from '@/core/graphql/recordAutomationsApi'
import { clearMetadataCache } from '@/modules/entities/services/collectionSchema'
import SetupRecordAutomationEditorDialog, {
  type AutomationSetFieldRow,
} from './SetupRecordAutomationEditorDialog.vue'

const props = defineProps<{
  collection: string
}>()

const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()

const loading = ref(false)
const saving = ref(false)
const searchQuery = ref('')
const automations = ref<EntityRecordAutomationDto[]>([])
const fields = ref<
  Array<{
    apiName: string
    label: string
    type: string
    hidden: boolean
    isSystem: boolean
  }>
>([])

/** UI-only rows for setFields key/value editing */
const setFieldRows = ref<Record<string, AutomationSetFieldRow[]>>({})

const editorVisible = ref(false)
const editingRuleId = ref<string | null>(null)
/** Unsaved new rule — not listed until Apply. */
const creatingDraft = ref<EntityRecordAutomationDto | null>(null)
const creatingSetFieldRows = ref<AutomationSetFieldRow[]>([])
const actionMenu = ref()
const activeRule = ref<EntityRecordAutomationDto | null>(null)

const triggerOptions = computed(() => [
  { label: t('setup.automations.triggerCreate', 'On create'), value: 'create' },
  { label: t('setup.automations.triggerUpdate', 'On update'), value: 'update' },
  { label: t('setup.automations.triggerDelete', 'On delete'), value: 'delete' },
])

const fieldOptions = computed(() =>
  fields.value
    .filter((f) => f.apiName !== 'id' && f.type.toUpperCase() !== 'ALIAS')
    .map((f) => ({
      label: `${f.label} (${f.apiName})`,
      value: f.apiName,
    })),
)

const fieldLabelByApiName = computed(() => {
  const map = new Map<string, string>()
  for (const option of fieldOptions.value) {
    map.set(option.value, option.label)
  }
  return map
})

const filteredAutomations = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const rows = [...automations.value].sort((left, right) => {
    const sortDiff = (left.sort ?? 0) - (right.sort ?? 0)
    if (sortDiff !== 0) return sortDiff
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
  if (!query) return rows
  return rows.filter((rule) => {
    const triggers = formatTriggers(rule).toLowerCase()
    const requireChanged = formatRequireChanged(rule).toLowerCase()
    const status = statusLabel(rule).toLowerCase()
    return (
      rule.name.toLowerCase().includes(query) ||
      triggers.includes(query) ||
      requireChanged.includes(query) ||
      status.includes(query) ||
      String(rule.sort ?? '').includes(query)
    )
  })
})

const itemSummary = computed(() =>
  t('setup.itemCountSortedBySort', '{count} Items, Sorted by Sort', {
    count: filteredAutomations.value.length,
  }),
)

const editingRule = computed(() => {
  if (!editingRuleId.value) return null
  if (creatingDraft.value?.id === editingRuleId.value) {
    return creatingDraft.value
  }
  return automations.value.find((rule) => rule.id === editingRuleId.value) ?? null
})

const editingSetFieldRows = computed(() => {
  if (!editingRuleId.value) return []
  if (creatingDraft.value?.id === editingRuleId.value) {
    return creatingSetFieldRows.value.length
      ? creatingSetFieldRows.value
      : [{ field: '', value: '' }]
  }
  return setFieldRows.value[editingRuleId.value] ?? [{ field: '', value: '' }]
})

const actionMenuItems = computed((): MenuItem[] => {
  if (!activeRule.value) return []
  const rule = activeRule.value
  return [
    {
      label: t('setup.configure', 'Configure'),
      icon: 'pi pi-cog',
      command: () => openConfigure(rule.id),
    },
    {
      label: t('common.delete', 'Delete'),
      icon: 'pi pi-trash',
      command: () => confirmDelete(rule),
    },
  ]
})

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: err instanceof Error ? err.message : String(err),
    life: 6000,
  })
}

function newRuleId(): string {
  return `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function setFieldsToRows(setFields: Record<string, unknown>): AutomationSetFieldRow[] {
  return Object.entries(setFields).map(([field, value]) => ({
    field,
    value: value === null || value === undefined ? '$NULL' : String(value),
  }))
}

function rowsToSetFields(
  rows: AutomationSetFieldRow[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const field = row.field?.trim()
    if (!field) continue
    out[field] = row.value
  }
  return out
}

function syncSetFieldRowsFromAutomations(): void {
  const next: Record<string, AutomationSetFieldRow[]> = {}
  for (const rule of automations.value) {
    next[rule.id] = setFieldsToRows(rule.setFields ?? {})
    if (!next[rule.id].length) {
      next[rule.id] = [{ field: '', value: '' }]
    }
  }
  setFieldRows.value = next
}

function statusLabel(rule: EntityRecordAutomationDto): string {
  return rule.enabled
    ? t('setup.automations.enabled', 'Enabled')
    : t('setup.automations.disabled', 'Disabled')
}

function formatTriggers(rule: EntityRecordAutomationDto): string {
  const labels = (rule.triggers ?? [])
    .map((value) => triggerOptions.value.find((option) => option.value === value)?.label ?? value)
    .filter(Boolean)
  return labels.length ? labels.join(', ') : '—'
}

function formatRequireChanged(rule: EntityRecordAutomationDto): string {
  const labels = (rule.requireChanged ?? [])
    .map((apiName) => fieldLabelByApiName.value.get(apiName) ?? apiName)
    .filter(Boolean)
  return labels.length ? labels.join(', ') : '—'
}

async function load(): Promise<void> {
  if (!props.collection) return
  loading.value = true
  try {
    const data = await fetchEntityAutomations(props.collection)
    automations.value = data.automations.map((rule, index) => ({
      ...rule,
      sort:
        typeof rule.sort === 'number' && Number.isFinite(rule.sort)
          ? Math.trunc(rule.sort)
          : (index + 1) * 10,
      conditions: (rule.conditions ?? []).map((c) => ({
        ...c,
        valueSource: c.valueSource === 'field' ? 'field' : 'literal',
        compareField: c.compareField ?? null,
      })),
      requireChanged: [...(rule.requireChanged ?? [])],
      triggers: [...(rule.triggers?.length ? rule.triggers : ['create', 'update'])],
      setFields: { ...(rule.setFields ?? {}) },
      actions: Array.isArray(rule.actions) ? [...rule.actions] : [],
    }))
    fields.value = data.fields
    syncSetFieldRowsFromAutomations()
  } catch (err) {
    showError(err, t('setup.automations.loadError', 'Failed to load automations'))
  } finally {
    loading.value = false
  }
}

function nextSortValue(): number {
  let max = 0
  for (const rule of automations.value) {
    const n = typeof rule.sort === 'number' ? rule.sort : 0
    if (n > max) max = n
  }
  return max + 10
}

function addRule(): void {
  const id = newRuleId()
  creatingDraft.value = {
    id,
    name: t('setup.automations.newRuleName', 'New rule'),
    enabled: true,
    sort: nextSortValue(),
    triggers: ['create', 'update'],
    logic: 'and',
    conditions: [],
    requireChanged: [],
    setFields: {},
    actions: [],
  }
  creatingSetFieldRows.value = [{ field: '', value: '' }]
  openConfigure(id)
}

function discardCreatingDraft(): void {
  if (!creatingDraft.value) return
  if (editingRuleId.value === creatingDraft.value.id) {
    editingRuleId.value = null
  }
  creatingDraft.value = null
  creatingSetFieldRows.value = []
}

function removeRuleById(ruleId: string): void {
  const index = automations.value.findIndex((rule) => rule.id === ruleId)
  if (index < 0) return
  const [removed] = automations.value.splice(index, 1)
  if (removed) {
    delete setFieldRows.value[removed.id]
    if (editingRuleId.value === removed.id) {
      editorVisible.value = false
      editingRuleId.value = null
    }
  }
}

function confirmDelete(rule: EntityRecordAutomationDto): void {
  confirm.require({
    message: t(
      'setup.automations.deleteConfirm',
      'Delete automation rule "{name}"?',
      { name: rule.name },
    ),
    header: t('setup.automations.deleteRule', 'Delete rule'),
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: {
      label: t('common.delete', 'Delete'),
      severity: 'danger',
    },
    accept: () => {
      removeRuleById(rule.id)
      void save()
    },
  })
}

function openConfigure(ruleId: string): void {
  editingRuleId.value = ruleId
  editorVisible.value = true
}

function openRowMenu(event: Event, rule: EntityRecordAutomationDto): void {
  activeRule.value = rule
  actionMenu.value?.toggle(event)
}

function applyEditor(payload: {
  rule: EntityRecordAutomationDto
  setFieldRows: AutomationSetFieldRow[]
}): void {
  const nextRule: EntityRecordAutomationDto = {
    ...payload.rule,
    name: payload.rule.name.trim() || payload.rule.id,
    sort:
      typeof payload.rule.sort === 'number' && Number.isFinite(payload.rule.sort)
        ? Math.trunc(payload.rule.sort)
        : nextSortValue(),
    triggers: payload.rule.triggers.length
      ? [...payload.rule.triggers]
      : ['create', 'update'],
    requireChanged: [...(payload.rule.requireChanged ?? [])],
    actions: Array.isArray(payload.rule.actions)
      ? [...payload.rule.actions]
      : [],
  }
  const index = automations.value.findIndex((rule) => rule.id === payload.rule.id)
  if (index < 0) {
    automations.value.push(nextRule)
  } else {
    automations.value[index] = nextRule
  }
  setFieldRows.value[payload.rule.id] = payload.setFieldRows.length
    ? payload.setFieldRows
    : [{ field: '', value: '' }]
  creatingDraft.value = null
  creatingSetFieldRows.value = []
  void save()
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const payload = automations.value.map((rule, index) => ({
      ...rule,
      name: rule.name.trim() || rule.id,
      sort:
        typeof rule.sort === 'number' && Number.isFinite(rule.sort)
          ? Math.trunc(rule.sort)
          : (index + 1) * 10,
      triggers: rule.triggers.length ? rule.triggers : ['create', 'update'],
      conditions: rule.conditions
        .filter((c) => {
          if (!c.field || !c.operator) return false
          if (c.operator === '_null' || c.operator === '_nnull') return true
          if (c.valueSource === 'field') return Boolean(c.compareField)
          return true
        })
        .map((c) => {
          const valueSource = c.valueSource === 'field' ? 'field' : 'literal'
          return {
            field: c.field,
            operator: c.operator,
            valueSource,
            compareField:
              valueSource === 'field' ? c.compareField || null : null,
            value:
              c.operator === '_null' ||
              c.operator === '_nnull' ||
              valueSource === 'field'
                ? null
                : c.value ?? null,
          }
        }),
      requireChanged: rule.requireChanged.filter(Boolean),
      setFields: rowsToSetFields(setFieldRows.value[rule.id] ?? []),
      actions: (rule.actions ?? [])
        .map((action) =>
          action.type === 'break'
            ? { type: 'break' as const }
            : {
                type: 'notify' as const,
                severity:
                  action.severity === 'warn' ? ('warn' as const) : ('info' as const),
                message: String(action.message || '').trim(),
              },
        )
        .filter(
          (action) =>
            action.type === 'break' ||
            (action.type === 'notify' && Boolean(action.message)),
        ),
    }))
    const invalid = payload.find(
      (rule) =>
        !Object.keys(rule.setFields).length && !(rule.actions?.length > 0),
    )
    if (invalid) {
      throw new Error(
        t(
          'setup.automations.effectRequired',
          'Each rule needs at least one field to set, or a notify/break action.',
        ),
      )
    }
    automations.value = await upsertEntityAutomations(props.collection, payload)
    syncSetFieldRowsFromAutomations()
    clearMetadataCache()
    toast.add({
      severity: 'success',
      summary: t('setup.automations.saved', 'Automations saved'),
      detail: t(
        'setup.automations.savedDetail',
        'Rules run on record create/update/delete in the BFF.',
      ),
      life: 4000,
    })
  } catch (err) {
    showError(err, t('setup.automations.saveError', 'Failed to save automations'))
  } finally {
    saving.value = false
  }
}

watch(editorVisible, (visible) => {
  if (!visible) {
    discardCreatingDraft()
  }
})

watch(
  () => props.collection,
  () => {
    editorVisible.value = false
    editingRuleId.value = null
    creatingDraft.value = null
    creatingSetFieldRows.value = []
    searchQuery.value = ''
    void load()
  },
)

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-automations">
    <div class="setup-panel-header">
      <div>
        <h2>{{ t('setup.automations.title', 'Automations') }}</h2>
        <p class="setup-panel-header__meta">
          {{ itemSummary }}
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
            :disabled="loading || saving"
          />
        </IconField>
        <Button
          :label="t('setup.newLayout', 'New')"
          icon="pi pi-plus"
          :disabled="loading || saving"
          @click="addRule"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.automations.loading', 'Loading automations...') }}</span>
    </div>

    <DataTable
      v-else
      :value="filteredAutomations"
      striped-rows
      :empty-message="
        t(
          'setup.automations.empty',
          'No automations yet. Add a rule — for example when fulfilled_qty is not empty and changed, set status and date_fulfilled = $NOW.',
        )
      "
    >
      <Column
        field="sort"
        :header="t('setup.automations.sort', 'Sort')"
        sortable
        style="width: 6rem"
      >
        <template #body="{ data }">
          {{ data.sort }}
        </template>
      </Column>
      <Column
        field="name"
        :header="t('setup.automations.ruleName', 'Rule name')"
        sortable
      >
        <template #body="{ data }">
          <button
            type="button"
            class="setup-link setup-link--button"
            @click="openConfigure(data.id)"
          >
            {{ data.name }}
          </button>
        </template>
      </Column>
      <Column
        field="enabled"
        :header="t('setup.automations.status', 'Status')"
        sortable
      >
        <template #body="{ data }">
          <Tag
            :value="statusLabel(data)"
            :severity="data.enabled ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column :header="t('setup.automations.triggers', 'Triggers')">
        <template #body="{ data }">
          {{ formatTriggers(data) }}
        </template>
      </Column>
      <Column
        :header="
          t('setup.automations.requireChanged', 'Require field changed')
        "
      >
        <template #body="{ data }">
          {{ formatRequireChanged(data) }}
        </template>
      </Column>
      <Column
        :header="t('setup.columnActions', 'Actions')"
        style="width: 4rem"
      >
        <template #body="{ data }">
          <Button
            type="button"
            icon="pi pi-ellipsis-v"
            text
            rounded
            severity="secondary"
            :aria-label="t('setup.rowActions', 'Row actions')"
            @click="openRowMenu($event, data)"
          />
        </template>
      </Column>
    </DataTable>

    <Menu
      ref="actionMenu"
      :model="actionMenuItems"
      popup
    />

    <SetupRecordAutomationEditorDialog
      v-model:visible="editorVisible"
      :rule="editingRule"
      :set-field-rows="editingSetFieldRows"
      :field-options="fieldOptions"
      :collection="collection"
      @apply="applyEditor"
    />
  </section>
</template>

<style scoped>
.setup-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.setup-panel-header h2 {
  margin: 0;
}

.setup-panel-header__meta {
  margin: 0.35rem 0 0;
  color: var(--p-text-muted-color, #6b7280);
  font-size: 0.9rem;
}

.setup-panel-header__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.page-loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem 0;
  color: var(--p-text-muted-color, #6b7280);
}

@media (max-width: 768px) {
  .setup-panel-header {
    flex-direction: column;
  }

  .setup-panel-header__actions {
    width: 100%;
    justify-content: stretch;
  }
}
</style>
