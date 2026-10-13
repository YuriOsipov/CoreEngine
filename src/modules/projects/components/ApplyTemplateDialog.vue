<script lang="ts">
export default { name: 'ApplyTemplateDialog' }
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import { listProjectTemplates } from '../services/pmTemplateService'
import { applyProjectTemplate } from '../services/pmProjectService'
import type { PmProjectTemplateRecord } from '@/interfaces/projects'
import { relationLabel } from '../services/pmUtils'

const props = defineProps<{
  visible: boolean
  patientId?: string | null
  presetTemplateId?: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  applied: [projectId: string]
}>()

const { t } = useTranslation()
const toast = useToast()

const templates = ref<PmProjectTemplateRecord[]>([])
const patients = ref<Array<{ id: string; label: string }>>([])
const loading = ref(false)
const submitting = ref(false)
const templateId = ref<string | null>(null)
const selectedPatientId = ref<string | null>(null)
const projectName = ref('')
const dateStart = ref<Date | null>(new Date())

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

watch(
  () => props.visible,
  async (open) => {
    if (!open) return
    selectedPatientId.value = props.patientId ?? null
    dateStart.value = new Date()
    projectName.value = ''
    loading.value = true
    try {
      templates.value = await listProjectTemplates()
      templateId.value =
        props.presetTemplateId && templates.value.some((row) => row.id === props.presetTemplateId)
          ? props.presetTemplateId
          : templates.value[0]?.id ?? null
      const rows = await bridgeReadItems('patient', {
        fields: ['id', 'long_name', 'name'],
        sort: ['long_name'],
        limit: 200,
      })
      patients.value = rows.map((row) => ({
        id: String(row.id),
        label: relationLabel(row, ['long_name', 'name']) || String(row.id),
      }))
    } catch (error) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail:
          error instanceof Error
            ? error.message
            : t('projects.loadError', 'Failed to load project data.'),
        life: 5000,
      })
    } finally {
      loading.value = false
    }
  },
)

async function submit(): Promise<void> {
  if (!templateId.value || !selectedPatientId.value || !dateStart.value) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t('projects.applyRequired', 'Template, patient, and start date are required.'),
      life: 4000,
    })
    return
  }
  submitting.value = true
  try {
    const result = await applyProjectTemplate({
      templateId: templateId.value,
      patientId: selectedPatientId.value,
      dateStart: dateStart.value.toISOString(),
      projectName: projectName.value || null,
    })
    emit('applied', result.projectId)
    dialogVisible.value = false
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('projects.applied', 'Project created from template.'),
      life: 3000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('projects.applyError', 'Failed to apply template.'),
      life: 5000,
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="t('projects.applyTemplate', 'Apply project template')"
    :style="{ width: 'min(480px, 95vw)' }"
  >
    <div v-if="loading" class="pm-dialog-loading">
      <ProgressSpinner style="width: 2rem; height: 2rem" />
    </div>
    <div v-else class="pm-form-grid">
      <label>{{ t('projects.template', 'Template') }}</label>
      <Select
        v-model="templateId"
        :options="templates"
        option-label="name"
        option-value="id"
        class="w-full"
        :disabled="Boolean(presetTemplateId)"
      />

      <label>{{ t('projects.patient', 'Patient') }}</label>
      <Select
        v-model="selectedPatientId"
        :options="patients"
        option-label="label"
        option-value="id"
        filter
        class="w-full"
        :disabled="Boolean(patientId)"
      />

      <label>{{ t('projects.startDate', 'Start date') }}</label>
      <DatePicker v-model="dateStart" show-icon class="w-full" />

      <label>{{ t('projects.projectName', 'Project name') }}</label>
      <InputText
        v-model="projectName"
        class="w-full"
        :placeholder="t('projects.projectNameHint', 'Optional override')"
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
        :label="t('projects.apply', 'Apply')"
        :loading="submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.pm-form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem 0.75rem;
}
.pm-form-grid label {
  font-size: 0.85rem;
  font-weight: 600;
  margin-top: 0.35rem;
}
.pm-dialog-loading {
  display: flex;
  justify-content: center;
  padding: 1.5rem;
}
</style>
