<script lang="ts">
export default {
  name: 'DocTemplatePickerDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DocTemplateOption } from '@/interfaces'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  visible: boolean
  templates: DocTemplateOption[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  select: [templateId: string]
}>()

const { t } = useTranslation()
const selectedTemplateId = ref<string | null>(null)

const templateOptions = computed(() =>
  props.templates.map((template) => ({
    label: template.name,
    value: template.id,
    description: template.description?.trim() || '',
  })),
)

watch(
  [() => props.visible, () => props.templates],
  ([visible, templates]) => {
    if (visible && templates.length > 0) {
      selectedTemplateId.value = templates[0]!.id
    }
  },
)

function close(): void {
  emit('update:visible', false)
}

function confirm(): void {
  if (!selectedTemplateId.value) return
  emit('select', selectedTemplateId.value)
  close()
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('documents.chooseTemplate', 'Choose template')"
    :style="{ width: '28rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div
      v-if="loading"
      class="page-loading"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('documents.loadingTemplates', 'Loading templates...') }}</span>
    </div>

    <template v-else>
      <p
        v-if="templates.length === 0"
        class="m-0 text-muted-color"
      >
        {{ t('documents.noTemplates', 'No document templates are available for this collection.') }}
      </p>

      <div
        v-else
        class="flex flex-col gap-2"
      >
        <label class="text-[0.85rem] font-medium" for="runtime-template-select">
          {{ t('documents.template', 'Template') }}
        </label>
        <Select
          id="runtime-template-select"
          v-model="selectedTemplateId"
          :options="templateOptions"
          option-label="label"
          option-value="value"
          fluid
        >
          <template #option="{ option }">
            <div class="flex flex-col gap-0.5">
              <span>{{ option.label }}</span>
              <span
                v-if="option.description"
                class="text-muted-color text-[0.8rem]"
              >
                {{ option.description }}
              </span>
            </div>
          </template>
        </Select>
      </div>
    </template>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        text
        @click="close"
      />
      <Button
        :label="t('common.continue', 'Continue')"
        :disabled="!selectedTemplateId || templates.length === 0"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
