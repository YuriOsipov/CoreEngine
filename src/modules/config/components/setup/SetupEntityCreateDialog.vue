<script lang="ts">
export default {
  name: 'SetupEntityCreateDialog',
}
</script>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useTranslation } from '@/core/translation'
import type { CreateRegistryEntityInput } from '@/core/graphql/entitiesApi'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [payload: { input: CreateRegistryEntityInput; applyDdl: boolean }]
}>()

const { t } = useTranslation()

const form = reactive({
  label: '',
  apiName: '',
  note: '',
  applyDdl: true,
  apiNameTouched: false,
})

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

function toApiName(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

function reset(): void {
  form.label = ''
  form.apiName = ''
  form.note = ''
  form.applyDdl = true
  form.apiNameTouched = false
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) reset()
  },
)

watch(
  () => form.label,
  (label) => {
    if (!form.apiNameTouched) {
      form.apiName = toApiName(label)
    }
  },
)

function submit(): void {
  const apiName = form.apiName.trim()
  const label = form.label.trim() || apiName
  if (!apiName || !label) return
  emit('save', {
    input: {
      apiName,
      label,
      note: form.note.trim() || null,
    },
    applyDdl: form.applyDdl,
  })
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="t('setup.objects.newObject', 'New Object')"
    class="setup-entity-create-dialog"
    :style="{ width: 'min(32rem, 95vw)' }"
    :dismissable-mask="true"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label>{{ t('setup.objects.objectLabel', 'Object Label') }}</label>
        <InputText
          v-model="form.label"
          class="w-full"
          autocomplete="off"
          autofocus
        />
      </div>

      <div class="flex flex-col gap-1">
        <label>{{ t('setup.objects.apiName', 'API Name') }}</label>
        <InputText
          v-model="form.apiName"
          class="w-full"
          autocomplete="off"
          placeholder="snake_case"
          @update:model-value="form.apiNameTouched = true"
        />
        <small class="text-muted-color">
          {{
            t(
              'setup.objects.apiNameHint',
              'Lowercase snake_case. Used for the table and API.',
            )
          }}
        </small>
      </div>

      <div class="flex flex-col gap-1">
        <label>{{ t('setup.objects.description', 'Description') }}</label>
        <Textarea
          v-model="form.note"
          class="w-full"
          rows="2"
          auto-resize
        />
      </div>

      <div class="flex items-center gap-2">
        <ToggleSwitch v-model="form.applyDdl" />
        <label>
          {{
            t(
              'setup.objects.applyDdl',
              'Create crm_schema table now',
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
        :disabled="!form.apiName.trim() || !form.label.trim()"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
