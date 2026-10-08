<script lang="ts">
export default {
  name: 'DocValueListDialog',
}
</script>

<script setup lang="ts">
import { useTranslation } from '@/core/translation'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import type { DocValueListItem } from '@/interfaces'

defineProps<{
  visible: boolean
  documents: DocValueListItem[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  select: [docValueId: string, templateId: string]
  'new-document': []
}>()

const { t } = useTranslation()

function close(): void {
  emit('update:visible', false)
}

function formatDate(value: string | null): string {
  return formatLocalizedDateTime(value) || '—'
}

function openDocument(item: DocValueListItem): void {
  if (!item.templateId) return
  emit('select', item.id, item.templateId)
  close()
}

function createNew(): void {
  emit('new-document')
  close()
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('documents.existingDocuments', 'Documents')"
    :style="{ width: 'min(56rem, 95vw)' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('documents.loadingDocuments', 'Loading documents...') }}</span>
    </div>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          :label="t('documents.newDocument', 'New document')"
          icon="pi pi-plus"
          size="small"
          @click="createNew"
        />
      </div>

      <DataTable
        :value="documents"
        striped-rows
        row-hover
        size="small"
        class="doc-value-list-table"
      >
        <Column
          field="label"
          :header="t('documents.columnDocument', 'Document')"
          sortable
        >
          <template #body="{ data }">
            <button
              type="button"
              class="setup-link setup-link--button"
              :disabled="!data.templateId"
              @click="openDocument(data)"
            >
              {{ data.label }}
            </button>
          </template>
        </Column>
        <Column
          field="documentStatus"
          :header="t('documents.status', 'Status')"
          sortable
        >
          <template #body="{ data }">
            <Tag
              :severity="data.documentStatus === 'completed' ? 'success' : 'warn'"
              :value="
                data.documentStatus === 'completed'
                  ? t('documents.statusCompleted', 'Completed')
                  : t('documents.statusDraft', 'Draft')
              "
            />
          </template>
        </Column>
        <Column
          field="dateCreated"
          :header="t('documents.columnDateCreated', 'Date created')"
          sortable
        >
          <template #body="{ data }">
            {{ formatDate(data.dateCreated) }}
          </template>
        </Column>
        <Column
          field="userCreatedName"
          :header="t('documents.columnUserCreated', 'User created')"
          sortable
        >
          <template #body="{ data }">
            {{ data.userCreatedName || '—' }}
          </template>
        </Column>
        <Column
          field="dateUpdated"
          :header="t('documents.columnDateUpdated', 'Date updated')"
          sortable
        >
          <template #body="{ data }">
            {{ formatDate(data.dateUpdated) }}
          </template>
        </Column>
        <Column
          field="userUpdatedName"
          :header="t('documents.columnUserUpdated', 'User updated')"
          sortable
        >
          <template #body="{ data }">
            {{ data.userUpdatedName || '—' }}
          </template>
        </Column>
        <template #empty>
          <span class="text-muted-color">
            {{ t('documents.noDocumentsYet', 'No documents yet.') }}
          </span>
        </template>
      </DataTable>
    </template>

    <template #footer>
      <Button
        type="button"
        :label="t('common.cancel', 'Cancel')"
        text
        @click="close"
      />
    </template>
  </Dialog>
</template>
