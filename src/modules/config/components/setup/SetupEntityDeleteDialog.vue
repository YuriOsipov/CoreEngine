<script lang="ts">
export default {
  name: 'SetupEntityDeleteDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  visible: boolean
  apiName: string
  label: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: []
}>()

const { t } = useTranslation()

const step = ref<1 | 2>(1)
const confirmName = ref('')

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const nameMatches = computed(
  () => confirmName.value.trim() === props.apiName.trim(),
)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      step.value = 1
      confirmName.value = ''
    }
  },
)

function goNext(): void {
  step.value = 2
  confirmName.value = ''
}

function submit(): void {
  if (!nameMatches.value) return
  emit('confirm')
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="
      step === 1
        ? t('setup.objects.deleteHeader', 'Delete object')
        : t('setup.objects.deleteConfirmHeader', 'Confirm deletion')
    "
    class="setup-entity-delete-dialog"
    :style="{ width: 'min(32rem, 95vw)' }"
    :dismissable-mask="true"
  >
    <div
      v-if="step === 1"
      class="flex flex-col gap-3"
    >
      <Message
        severity="warn"
        :closable="false"
      >
        {{
          t(
            'setup.objects.deleteWarning',
            'You are about to delete "{label}" ({api}). The registry entry will be removed from Object Manager. The physical crm_schema table is kept (data safety).',
            { label, api: apiName },
          )
        }}
      </Message>
      <p class="m-0 text-color-secondary">
        {{
          t(
            'setup.objects.deleteStep1Hint',
            'This cannot be undone from the UI. Continue only if you are sure.',
          )
        }}
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
    >
      <p class="m-0">
        {{
          t(
            'setup.objects.deleteTypePrompt',
            'Type the API name to confirm deletion:',
          )
        }}
      </p>
      <code class="setup-entity-delete-dialog__api">{{ apiName }}</code>
      <InputText
        v-model="confirmName"
        class="w-full"
        autocomplete="off"
        :placeholder="apiName"
      />
    </div>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        @click="dialogVisible = false"
      />
      <Button
        v-if="step === 1"
        :label="t('setup.objects.deleteContinue', 'Continue')"
        severity="danger"
        outlined
        @click="goNext"
      />
      <Button
        v-else
        :label="t('setup.objects.deleteConfirm', 'Delete permanently')"
        severity="danger"
        :disabled="!nameMatches"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.setup-entity-delete-dialog__api {
  display: inline-block;
  padding: 0.35rem 0.55rem;
  border-radius: 0.35rem;
  background: var(--p-surface-100);
  font-size: 0.9rem;
}
</style>
