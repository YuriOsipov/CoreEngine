<script lang="ts">
export default {
  name: 'RecordPageComponentView',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MenuItem } from 'openvue/menuitem'
import FormRendererLight from '@/modules/entities/components/FormRendererLight.vue'
import CompactRecordTooltip from '@/modules/entities/components/CompactRecordTooltip.vue'
import RelatedListFieldHost from '@/modules/entities/components/RelatedListFieldHost.vue'
import AttachedDataTableField from '@/modules/entities/components/AttachedDataTableField.vue'
import ActivityLogField from '@/modules/entities/components/ActivityLogField.vue'
import type {
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  RecordPageComponent,
} from '@/interfaces'
import { DEFAULT_VISIBLE_ACTION_BUTTONS } from '@/interfaces'
import { buildFieldGroupSchema } from '@/modules/config/utils/recordPageFieldGroup'
import { buildRecordPageFilesField } from '@/modules/config/utils/recordPageFiles'
import { buildRecordPageActivityLogField } from '@/modules/config/utils/recordPageActivityLog'
import type { CompactRecordDetailsRuntime } from '@/modules/entities/services/recordDetails'
import { useTranslation } from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'

type HighlightsBarAction =
  | { key: string; kind: 'edit' | 'delete' | 'restore'; label: string }
  | { key: string; kind: 'custom'; label: string; action: EntityAction }

const props = defineProps<{
  component: RecordPageComponent
  modelValue: Record<string, unknown>
  collection: string
  recordId: string
  m2aEditable?: boolean
  detailLayouts: Record<string, EntityLayoutSchema | null>
  relatedListFields?: Record<string, LayoutFieldMetadata[]>
  highlightsByKey: Record<string, CompactRecordDetailsRuntime | null>
  highlightsLoading: boolean
  highlightsError: string | null
  actions?: EntityAction[]
  actionRunning?: Record<string, boolean>
  actionsDisabled?: boolean
  deleting?: boolean
  recordArchived?: boolean
}>()

const emit = defineEmits<{
  'blocks-saved': [payload: { field: string; value: unknown }]
  'run-action': [action: EntityAction]
  'edit-record': []
  'delete-record': []
  'related-changed': []
}>()

const { t } = useTranslation()
const { canUpdate: canUpdateRecord, canDelete: canDeleteRecord } =
  useEntityPermissions(() => props.collection)
const activeTabId = ref<string | null>(null)
const overflowMenu = ref<{ toggle: (event: Event) => void } | null>(null)

const tabs = computed(() => props.component.tabs ?? [])

watch(
  () => [tabs.value, props.component.defaultTabId] as const,
  ([list, preferred]) => {
    if (!list.length) {
      activeTabId.value = null
      return
    }
    if (activeTabId.value && list.some((tab) => tab.id === activeTabId.value)) {
      return
    }
    if (preferred && list.some((tab) => tab.id === preferred)) {
      activeTabId.value = preferred
      return
    }
    activeTabId.value = list[0]?.id ?? null
  },
  { immediate: true },
)

const tabPanelValue = computed({
  get: () => activeTabId.value ?? tabs.value[0]?.id ?? '0',
  set: (value: string | number) => {
    activeTabId.value = String(value)
  },
})

const highlightsBarActions = computed((): HighlightsBarAction[] => {
  const standard: HighlightsBarAction[] = []
  if (canUpdateRecord.value) {
    standard.push({ key: 'edit', kind: 'edit', label: t('common.edit', 'Edit') })
  }
  if (canDeleteRecord.value) {
    standard.push(
      props.recordArchived
        ? {
            key: 'restore',
            kind: 'restore',
            label: t('common.restore', 'Restore'),
          }
        : {
            key: 'delete',
            kind: 'delete',
            label: t('common.delete', 'Delete'),
          },
    )
  }
  const custom: HighlightsBarAction[] = (props.actions ?? []).map((action) => ({
    key: action.id,
    kind: 'custom',
    label: action.label,
    action,
  }))
  return [...standard, ...custom]
})

const visibleActionLimit = computed(() => {
  const raw = props.component.visibleActionButtons
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_VISIBLE_ACTION_BUTTONS
  return Math.min(20, Math.max(1, Math.floor(raw)))
})

const visibleHighlightsActions = computed(() =>
  highlightsBarActions.value.slice(0, visibleActionLimit.value),
)

const overflowHighlightsActions = computed(() =>
  highlightsBarActions.value.slice(visibleActionLimit.value),
)

const overflowMenuItems = computed((): MenuItem[] =>
  overflowHighlightsActions.value.map((item) => {
    const running =
      item.kind === 'custom'
        ? Boolean(props.actionRunning?.[item.action.id])
        : item.kind === 'delete' || item.kind === 'restore'
          ? Boolean(props.deleting)
          : false
    return {
      label: item.label,
      disabled: props.actionsDisabled || running,
      command: () => runHighlightsAction(item),
    }
  }),
)

function runHighlightsAction(item: HighlightsBarAction): void {
  if (item.kind === 'custom') {
    emit('run-action', item.action)
    return
  }
  if (item.kind === 'edit') {
    emit('edit-record')
    return
  }
  emit('delete-record')
}

function toggleOverflowMenu(event: Event): void {
  overflowMenu.value?.toggle(event)
}

function highlightsActionSeverity(item: HighlightsBarAction): 'danger' | undefined {
  return item.kind === 'delete' ? 'danger' : undefined
}

function highlightsActionOutlined(_item: HighlightsBarAction): boolean {
  return false
}

function highlightsActionLoading(item: HighlightsBarAction): boolean {
  if (item.kind === 'delete' || item.kind === 'restore') return Boolean(props.deleting)
  if (item.kind === 'custom') return Boolean(props.actionRunning?.[item.action.id])
  return false
}

function highlightsKey(component: RecordPageComponent): string {
  return component.compactLayoutId || '__role__'
}

function fieldAsSchema(component: RecordPageComponent): EntityLayoutSchema | null {
  if (!component.field || !component.fieldComponent) return null
  const field: LayoutFieldMetadata = {
    id: component.id,
    field: component.field,
    label: component.label || component.field,
    component: component.fieldComponent,
    // Outer Page Layout grid already sized this cell — fill it completely.
    span: 12,
    format: component.format,
    relatedCollection: component.relatedCollection,
  }
  return {
    entity: props.collection,
    version: 1,
    actions: [],
    systemInfo: { enabled: false },
    sections: [
      {
        id: `section_${component.id}`,
        columns: 12,
        groups: [
          {
            id: `group_${component.id}`,
            title: '',
            fields: [field],
            collapsed: false,
            inlineLabels: component.inlineLabels !== false,
          },
        ],
      },
    ],
  }
}

function relatedListFieldsFor(component: RecordPageComponent): LayoutFieldMetadata[] {
  const fromLayout = props.relatedListFields?.[component.id]
  if (fromLayout?.length) {
    return fromLayout.map((field) => ({
      ...field,
      span: 12,
    }))
  }

  // Legacy fallback: collection-only config without Block Layout fields.
  if (!component.relatedCollection) return []
  return [
    {
      id: component.id,
      field: component.relatedCollection,
      label: component.label || component.relatedCollection,
      component: 'DataTable',
      span: 12,
      relatedCollection: component.relatedCollection,
      dataTable: {
        columns: [],
        sort: null,
      },
    },
  ]
}

function filesFieldFor(component: RecordPageComponent): LayoutFieldMetadata | null {
  if (component.type !== 'files') return null
  return buildRecordPageFilesField(props.collection, component)
}

const pageFilesField = computed(() => filesFieldFor(props.component))

function activityLogFieldFor(component: RecordPageComponent): LayoutFieldMetadata | null {
  if (component.type !== 'activityLog') return null
  return buildRecordPageActivityLogField(props.collection, component)
}

const pageActivityLogField = computed(() => activityLogFieldFor(props.component))

function fieldGroupSchema(component: RecordPageComponent): EntityLayoutSchema | null {
  return buildFieldGroupSchema(props.collection, component)
}

function componentGridStyle(component: RecordPageComponent): Record<string, string> {
  if (component.type === 'field') {
    const span = Math.min(12, Math.max(1, component.span ?? 6))
    return { gridColumn: `span ${span}` }
  }
  return { gridColumn: 'span 12' }
}
</script>

<template>
  <div class="record-page-component-view">
    <div
      v-if="component.type === 'highlights'"
      class="rounded-lg border border-surface-200 bg-surface-0 p-4"
    >
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h2 class="m-0 text-base font-semibold">
          {{ component.label || t('recordPage.component.highlights', 'Highlights') }}
        </h2>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            v-for="item in visibleHighlightsActions"
            :key="item.key"
            :label="item.label"
            size="small"
            :severity="highlightsActionSeverity(item)"
            :outlined="highlightsActionOutlined(item)"
            :loading="highlightsActionLoading(item)"
            :disabled="actionsDisabled || highlightsActionLoading(item)"
            @click="runHighlightsAction(item)"
          />
          <Button
            v-if="overflowHighlightsActions.length > 0"
            type="button"
            icon="pi pi-chevron-down"
            size="small"
            severity="secondary"
            outlined
            :aria-label="t('recordPage.moreActions', 'More actions')"
            :disabled="actionsDisabled"
            @click="toggleOverflowMenu"
          />
          <Menu
            ref="overflowMenu"
            :model="overflowMenuItems"
            popup
          />
        </div>
      </div>
      <CompactRecordTooltip
        variant="panel"
        :loading="highlightsLoading"
        :error="highlightsError"
        :runtime="highlightsByKey[highlightsKey(component)] ?? null"
      />
    </div>

    <FormRendererLight
      v-else-if="component.type === 'detail' && detailLayouts[component.id]"
      :schema="detailLayouts[component.id]!"
      :model-value="modelValue"
      :parent-id="recordId"
      :parent-name="collection"
      :m2a-editable="m2aEditable"
      @blocks-saved="emit('blocks-saved', $event)"
      @related-changed="emit('related-changed')"
    />

    <FormRendererLight
      v-else-if="component.type === 'field' && fieldAsSchema(component)"
      embedded
      :schema="fieldAsSchema(component)!"
      :model-value="modelValue"
      :parent-id="recordId"
      :parent-name="collection"
      :m2a-editable="m2aEditable"
      @blocks-saved="emit('blocks-saved', $event)"
      @related-changed="emit('related-changed')"
    />

    <FormRendererLight
      v-else-if="component.type === 'fieldGroup' && fieldGroupSchema(component)"
      embedded
      :schema="fieldGroupSchema(component)!"
      :model-value="modelValue"
      :parent-id="recordId"
      :parent-name="collection"
      :m2a-editable="m2aEditable"
      @blocks-saved="emit('blocks-saved', $event)"
      @related-changed="emit('related-changed')"
    />

    <!-- Legacy Actions panel: no longer rendered; use Highlights. -->

    <div
      v-else-if="component.type === 'relatedList' && relatedListFieldsFor(component).length > 0"
      class="flex flex-col gap-3"
    >
      <div
        v-for="field in relatedListFieldsFor(component)"
        :key="field.id"
        class="rounded-lg border border-surface-200 bg-surface-0 p-3"
      >
        <RelatedListFieldHost
          :field="field"
          :collection="collection"
          :record-id="recordId"
          :record="modelValue"
          show-create
          show-actions
          show-view-all
          :m2a-editable="m2aEditable"
          @blocks-saved="emit('blocks-saved', $event)"
          @related-changed="emit('related-changed')"
        />
      </div>
    </div>

    <div
      v-else-if="component.type === 'relatedList'"
      class="rounded-lg border border-dashed border-surface-300 px-4 py-3 text-sm text-muted-color"
    >
      {{ t('recordPage.relatedListNotConfigured', 'No related lists on the selected Block Layout.') }}
    </div>

    <div
      v-else-if="component.type === 'files' && pageFilesField"
      class="rounded-lg border border-surface-200 bg-surface-0 p-3"
    >
      <AttachedDataTableField
        :field="pageFilesField"
        :model-value="modelValue"
        :parent-id="recordId"
        :parent-name="collection"
      />
    </div>

    <div
      v-else-if="component.type === 'activityLog' && pageActivityLogField"
      class="rounded-lg border border-surface-200 bg-surface-0 p-3"
    >
      <ActivityLogField
        :field="pageActivityLogField"
        :collection="collection"
        :record-id="recordId"
      />
    </div>

    <div
      v-else-if="component.type === 'tabs'"
      class="rounded-lg border border-surface-200 bg-surface-0 p-3"
    >
      <Tabs v-model:value="tabPanelValue">
        <TabList>
          <Tab
            v-for="tab in tabs"
            :key="tab.id"
            :value="tab.id"
          >
            {{ tab.title }}
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel
            v-for="tab in tabs"
            :key="tab.id"
            :value="tab.id"
          >
            <div class="grid grid-cols-12 content-start gap-3 pt-2">
              <div
                v-for="child in tab.components"
                :key="child.id"
                class="min-w-0"
                :style="componentGridStyle(child)"
              >
                <RecordPageComponentView
                  :component="child"
                  :model-value="modelValue"
                  :collection="collection"
                  :record-id="recordId"
                  :m2a-editable="m2aEditable"
                  :detail-layouts="detailLayouts"
                  :related-list-fields="relatedListFields"
                  :highlights-by-key="highlightsByKey"
                  :highlights-loading="highlightsLoading"
                  :highlights-error="highlightsError"
                  :actions="actions"
                  :action-running="actionRunning"
                  :actions-disabled="actionsDisabled"
                  :deleting="deleting"
                  @blocks-saved="emit('blocks-saved', $event)"
                  @related-changed="emit('related-changed')"
                  @run-action="emit('run-action', $event)"
                  @edit-record="emit('edit-record')"
                  @delete-record="emit('delete-record')"
                />
              </div>
              <p
                v-if="tab.components.length === 0"
                class="col-span-12 m-0 text-sm text-muted-color"
              >
                {{ t('recordPage.emptyTabRuntime', 'This tab has no components.') }}
              </p>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  </div>
</template>
