<script lang="ts">
export default {
  name: 'SetupLayoutListPanel',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import type { MenuItem } from 'openvue/menuitem'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'
import type { SetupLayoutListItem } from '@/interfaces'
import { deleteSetupLayout } from '../../services/setupLayoutRegistry'
import { canDeleteRoleScopedLayout } from '@/core/settingRoleUtils'
import { ALL_RECORDS_FILTER_ID } from '../../services/listFilterSettings'
import { RECENTLY_VIEWED_FILTER_ID } from '@/modules/dashboard/services/recentRecords'
import {
  setupLayoutTypeDefaultLabel,
  setupLayoutTypeLabelKey,
  type SetupLayoutType,
} from '../../types/setupLayoutType'

const props = defineProps<{
  collection: string
  layoutType: SetupLayoutType
  layouts: SetupLayoutListItem[]
  loading?: boolean
  searchQuery: string
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  newLayout: []
  editLayout: [layoutId: string]
  deleted: []
}>()

const confirm = useConfirm()
const { t } = useTranslation()
const actionMenu = ref()
const activeLayout = ref<SetupLayoutListItem | null>(null)

const sectionTitle = computed(() =>
  t(
    setupLayoutTypeLabelKey(props.layoutType),
    setupLayoutTypeDefaultLabel(props.layoutType),
  ),
)

const itemSummary = computed(() =>
  t('setup.itemCountSortedByName', '{count} Items, Sorted by Name', {
    count: props.layouts.length,
  }),
)

const showSystemViews = computed(() => props.layoutType === 'table')
const isDocumentLayout = computed(() => props.layoutType === 'document')
const showRoleColumn = computed(
  () => props.layoutType !== 'entity',
)
const isBlockLayout = computed(() => props.layoutType === 'entity')

function canDeleteLayout(layout: SetupLayoutListItem): boolean {
  if (isDocumentLayout.value) return true
  if (isBlockLayout.value) return props.layouts.length > 1
  return canDeleteRoleScopedLayout(layout, props.layouts)
}

const systemViews = computed(() => [
  {
    id: ALL_RECORDS_FILTER_ID,
    name: t('view.allRecords', 'All records'),
  },
  {
    id: RECENTLY_VIEWED_FILTER_ID,
    name: t('filter.recentlyViewed', 'Recently Viewed'),
  },
])

const customViewsSummary = computed(() =>
  t('setup.customViewsSummary', '{count} custom views, sorted by name', {
    count: props.layouts.length,
  }),
)

function formatModifiedDate(value: string | null | undefined): string {
  if (!value) return '—'
  return formatLocalizedDateTime(value) || '—'
}

function roleLabel(layout: SetupLayoutListItem): string {
  if (layout.roleId === null) {
    return t('layoutRole.defaultRole', 'Default (all roles)')
  }
  return layout.roleName ?? layout.roleId
}

function rowMenuItems(layout: SetupLayoutListItem): MenuItem[] {
  return [
    {
      label: t('common.edit', 'Edit'),
      icon: 'pi pi-pencil',
      command: () => emit('editLayout', layout.id),
    },
    {
      label: t('common.delete', 'Delete'),
      icon: 'pi pi-trash',
      disabled: !canDeleteLayout(layout),
      command: () => confirmDelete(layout),
    },
  ]
}

function openRowMenu(event: Event, layout: SetupLayoutListItem): void {
  activeLayout.value = layout
  actionMenu.value?.toggle(event)
}

const actionMenuItems = computed(() =>
  activeLayout.value ? rowMenuItems(activeLayout.value) : [],
)

function confirmDelete(layout: SetupLayoutListItem): void {
  if (!canDeleteLayout(layout)) return

  confirm.require({
    message: t('layoutRole.deleteConfirm', 'Delete this layout?'),
    header: t('layoutRole.deleteLayout', 'Delete layout'),
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: {
      label: t('layoutRole.deleteLayout', 'Delete layout'),
      severity: 'danger',
    },
    accept: async () => {
      await deleteSetupLayout(props.collection, props.layoutType, layout.id)
      emit('deleted')
    },
  })
}
</script>

<template>
  <section class="setup-layout-list">
    <div class="setup-panel-header">
      <div>
        <h2>{{ sectionTitle }}</h2>
        <p class="setup-panel-header__meta">
          <template v-if="showSystemViews">
            {{ customViewsSummary }}
          </template>
          <template v-else>
            {{ itemSummary }}
          </template>
        </p>
      </div>
      <div class="setup-panel-header__actions">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            :model-value="searchQuery"
            :placeholder="t('setup.quickFind', 'Quick Find')"
            class="setup-quick-find"
            @update:model-value="emit('update:searchQuery', String($event ?? ''))"
          />
        </IconField>
        <Button
          :label="t('setup.newLayout', 'New')"
          icon="pi pi-plus"
          @click="emit('newLayout')"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('setup.loadingLayouts', 'Loading configurations...') }}</span>
    </div>

    <template v-else>
      <section
        v-if="showSystemViews"
        class="setup-layout-list__system mb-4"
      >
        <h3 class="setup-layout-list__subtitle">
          {{ t('setup.systemViews', 'System views') }}
        </h3>
        <p class="setup-layout-list__hint">
          {{ t('setup.systemViewsHint', 'Column layout for built-in list views. Configure separately for each role.') }}
        </p>
        <DataTable
          :value="systemViews"
          striped-rows
        >
          <Column
            field="name"
            :header="t('setup.columnLayoutName', 'Name')"
          />
          <Column :header="t('layoutRole.role', 'Role')">
            <template #body>
              {{ t('setup.configurablePerRole', 'Configurable per role') }}
            </template>
          </Column>
          <Column
            :header="t('setup.columnActions', 'Actions')"
            style="width: 8rem"
          >
            <template #body="{ data }">
              <Button
                :label="t('setup.configure', 'Configure')"
                size="small"
                @click="emit('editLayout', data.id)"
              />
            </template>
          </Column>
        </DataTable>
      </section>

      <h3
        v-if="showSystemViews"
        class="setup-layout-list__subtitle"
      >
        {{ t('setup.customViews', 'Custom views') }}
      </h3>

      <DataTable
        :value="layouts"
        striped-rows
        :empty-message="t('setup.noLayouts', 'No configurations found for this layout type.')"
      >
      <Column
        field="name"
        :header="t('setup.columnLayoutName', 'Name')"
        sortable
      >
        <template #body="{ data }">
          <button
            type="button"
            class="setup-link setup-link--button"
            @click="emit('editLayout', data.id)"
          >
            {{ data.name }}
          </button>
        </template>
      </Column>
      <Column
        v-if="isDocumentLayout"
        field="description"
        :header="t('documents.templateDescription', 'Description')"
      >
        <template #body="{ data }">
          <span class="text-muted-color">{{ data.description || '—' }}</span>
        </template>
      </Column>
      <Column
        v-if="showRoleColumn"
        :header="t('layoutRole.role', 'Role')"
      >
        <template #body="{ data }">
          {{ roleLabel(data) }}
        </template>
      </Column>
      <Column
        :header="t('setup.columnModified', 'Modified')"
      >
        <template #body="{ data }">
          <div>{{ formatModifiedDate(data.dateUpdated) }}</div>
          <div
            v-if="data.userUpdatedName"
            class="setup-layout-list__meta"
          >
            {{ data.userUpdatedName }}
          </div>
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
    </template>

    <Menu
      ref="actionMenu"
      :model="actionMenuItems"
      popup
    />
  </section>
</template>
