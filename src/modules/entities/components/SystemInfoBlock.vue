<script lang="ts">
export default {
  name: 'SystemInfoBlock',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import {
  formatAuditUserName,
  resolveUserAvatarUrl,
  userInitials,
  type UserAuditSnapshot,
} from '@/core/systemAuditDisplay'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    record: Record<string, unknown>
    collapsed?: boolean
    title?: string
  }>(),
  {
    collapsed: false,
  },
)

const emit = defineEmits<{
  'update:collapsed': [collapsed: boolean]
}>()

const { t } = useTranslation()

const blockTitle = computed(
  () => props.title ?? t('formRenderer.systemInfo', 'System'),
)

const createdByUser = computed(
  () => props.record.user_created as UserAuditSnapshot | string | null | undefined,
)
const updatedByUser = computed(
  () => props.record.user_updated as UserAuditSnapshot | string | null | undefined,
)

const createdByName = computed(() => formatAuditUserName(createdByUser.value))
const updatedByName = computed(() => formatAuditUserName(updatedByUser.value))
const createdAtLabel = computed(() =>
  formatLocalizedDateTime(props.record.date_created),
)
const updatedAtLabel = computed(() =>
  formatLocalizedDateTime(props.record.date_updated),
)

const showCreatedBy = computed(
  () => Boolean(createdByName.value || createdAtLabel.value),
)
const showUpdatedBy = computed(
  () => Boolean(updatedByName.value || updatedAtLabel.value),
)
const hasContent = computed(() => showCreatedBy.value || showUpdatedBy.value)

function toggleCollapsed(): void {
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <section
    v-if="hasContent"
    class="overflow-hidden border border-surface-200 rounded-lg bg-surface-0"
  >
    <button
      type="button"
      class="w-full flex items-center justify-between m-0 px-4 py-3 bg-primary-50 text-surface-900 text-[0.95rem] font-semibold border-0 cursor-pointer font-[inherit] text-left"
      @click="toggleCollapsed"
    >
      {{ blockTitle }}
      <i
        :class="collapsed ? 'pi pi-chevron-down' : 'pi pi-chevron-up'"
        class="text-xs text-muted-color"
      />
    </button>

    <div
      v-show="!collapsed"
      class="grid grid-cols-1 gap-4 p-4 md:grid-cols-2"
    >
      <div
        v-if="showCreatedBy"
        class="flex min-w-0 flex-col gap-2"
      >
        <span class="text-surface-700 text-sm font-medium">
          {{ t('formRenderer.createdBy', 'Created By') }}
        </span>
        <div class="flex items-center gap-3 min-w-0">
          <Avatar
            v-if="createdByName"
            :image="resolveUserAvatarUrl(createdByUser) ?? undefined"
            :label="resolveUserAvatarUrl(createdByUser) ? undefined : userInitials(createdByUser)"
            shape="circle"
            class="shrink-0"
          />
          <div class="min-w-0 flex flex-col gap-0.5">
            <span
              v-if="createdByName"
              class="text-surface-900 text-[0.95rem] font-medium truncate"
            >
              {{ createdByName }}
            </span>
            <span
              v-if="createdAtLabel"
              class="text-muted-color text-[0.85rem]"
            >
              {{ createdAtLabel }}
            </span>
          </div>
        </div>
      </div>

      <div
        v-if="showUpdatedBy"
        class="flex min-w-0 flex-col gap-2"
      >
        <span class="text-surface-700 text-sm font-medium">
          {{ t('formRenderer.lastModifiedBy', 'Last Modified By') }}
        </span>
        <div class="flex items-center gap-3 min-w-0">
          <Avatar
            v-if="updatedByName"
            :image="resolveUserAvatarUrl(updatedByUser) ?? undefined"
            :label="resolveUserAvatarUrl(updatedByUser) ? undefined : userInitials(updatedByUser)"
            shape="circle"
            class="shrink-0"
          />
          <div class="min-w-0 flex flex-col gap-0.5">
            <span
              v-if="updatedByName"
              class="text-surface-900 text-[0.95rem] font-medium truncate"
            >
              {{ updatedByName }}
            </span>
            <span
              v-if="updatedAtLabel"
              class="text-muted-color text-[0.85rem]"
            >
              {{ updatedAtLabel }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
