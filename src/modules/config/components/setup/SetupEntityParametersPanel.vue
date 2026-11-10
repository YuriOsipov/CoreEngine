<script lang="ts">
export default {
  name: 'SetupEntityParametersPanel',
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  fetchEntityMeta,
  templateFieldsToTokens,
  tokensToTemplateFields,
  updateEntityMeta,
  type EntityAccountability,
} from '@/core/graphql/entityMetaApi'
import CrmIconPicker from '@/core/ui-kit/CrmIconPicker.vue'
import { clearMetadataCache } from '@/modules/entities/services/collectionSchema'
import SetupUniqueGroupsPanel from './SetupUniqueGroupsPanel.vue'

function hintTooltip(value: string) {
  return { value, class: 'property-hint-tooltip' }
}

const props = defineProps<{
  collection: string
}>()

const { t } = useTranslation()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)

/** Select cannot use null as option-value (treated as cleared). Map null ↔ 'none'. */
type AccountabilityUi = 'all' | 'activity' | 'none'

const form = reactive({
  apiName: '',
  label: '',
  note: '',
  icon: '',
  displayFields: [] as string[],
  hidden: false,
  internal: false,
  accountability: 'all' as AccountabilityUi,
})

const fieldOptions = ref<Array<{ label: string; value: string }>>([])

const accountabilityOptions = computed(() => [
  {
    label: t(
      'setup.entityParameters.accountabilityAll',
      'Track Activity & Revisions',
    ),
    value: 'all',
  },
  {
    label: t('setup.entityParameters.accountabilityActivity', 'Track Activity'),
    value: 'activity',
  },
  {
    label: t('setup.entityParameters.accountabilityNone', 'Do Not Track'),
    value: 'none',
  },
])

function toAccountabilityUi(value: EntityAccountability): AccountabilityUi {
  return value === null ? 'none' : value
}

function fromAccountabilityUi(value: AccountabilityUi): EntityAccountability {
  return value === 'none' ? null : value
}

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: err instanceof Error ? err.message : String(err),
    life: 6000,
  })
}

async function load(): Promise<void> {
  if (!props.collection) return
  loading.value = true
  try {
    const data = await fetchEntityMeta(props.collection)
    form.apiName = data.apiName
    form.label = data.label
    form.note = data.note ?? ''
    form.icon = data.icon ?? ''
    form.displayFields = tokensToTemplateFields(data.displayTemplate)
    form.hidden = data.hidden
    form.internal = data.internal
    form.accountability = toAccountabilityUi(data.accountability)
    fieldOptions.value = data.fields
      .filter((f) => f.apiName !== 'id' && f.type.toUpperCase() !== 'ALIAS')
      .map((f) => ({
        label: `${f.label} (${f.apiName})`,
        value: f.apiName,
      }))
  } catch (err) {
    showError(
      err,
      t('setup.entityParameters.loadError', 'Failed to load entity parameters'),
    )
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await updateEntityMeta(props.collection, {
      label: form.label.trim() || form.apiName,
      note: form.note.trim() || null,
      icon: form.icon.trim() || null,
      displayTemplate: templateFieldsToTokens(form.displayFields) || null,
      hidden: form.hidden,
      internal: form.internal,
      accountability: fromAccountabilityUi(form.accountability),
    })
    clearMetadataCache()
    toast.add({
      severity: 'success',
      summary: t('setup.entityParameters.saved', 'Entity parameters saved'),
      life: 3500,
    })
    await load()
  } catch (err) {
    showError(
      err,
      t('setup.entityParameters.saveError', 'Failed to save entity parameters'),
    )
  } finally {
    saving.value = false
  }
}

watch(
  () => props.collection,
  () => {
    void load()
  },
)

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="setup-entity-parameters">
    <div class="setup-panel-header">
      <div>
        <h3 class="m-0">
          {{ t('setup.entityParameters.title', 'Entity parameters') }}
        </h3>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.entityParameters.hint',
              'Object-level settings: note, icon, display template, visibility, activity tracking, and duplication rules.',
            )
          }}
        </p>
      </div>
      <Button
        :label="t('common.save', 'Save')"
        icon="pi pi-check"
        :loading="saving"
        :disabled="loading"
        @click="save"
      />
    </div>

    <div
      v-if="loading"
      class="setup-entity-parameters__loading"
    >
      <ProgressSpinner style="width: 2rem; height: 2rem" />
    </div>

    <div
      v-else
      class="setup-entity-parameters__form flex flex-col gap-3"
    >
      <div class="flex flex-col gap-1">
        <label>{{ t('setup.entityParameters.collection', 'Collection') }}</label>
        <InputText
          :model-value="form.apiName"
          class="w-full"
          disabled
        />
      </div>

      <div class="flex flex-col gap-1">
        <label>{{ t('setup.entityParameters.label', 'Label') }}</label>
        <InputText
          v-model="form.label"
          class="w-full"
          autocomplete="off"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label>{{ t('setup.entityParameters.note', 'Note') }}</label>
        <Textarea
          v-model="form.note"
          class="w-full"
          rows="3"
          auto-resize
          :placeholder="
            t(
              'setup.entityParameters.notePlaceholder',
              'A description of this collection…',
            )
          "
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="inline-flex items-center gap-1">
          {{ t('setup.entityParameters.icon', 'Icon') }}
          <button
            type="button"
            class="setup-entity-parameters__hint"
            v-tooltip.bottom="
              hintTooltip(
                t(
                  'setup.entityParameters.iconHint',
                  'Pick a PrimeIcon from the list (same icons used in navigation and menus).',
                ),
              )
            "
            :aria-label="t('common.moreInfo', 'More information')"
          />
        </label>
        <CrmIconPicker v-model="form.icon" />
      </div>

      <div class="flex flex-col gap-1">
        <label>
          {{ t('setup.entityParameters.displayTemplate', 'Display Template') }}
        </label>
        <MultiSelect
          v-model="form.displayFields"
          :options="fieldOptions"
          option-label="label"
          option-value="value"
          display="chip"
          filter
          class="w-full"
          :placeholder="
            t(
              'setup.entityParameters.displayTemplatePlaceholder',
              'Select fields…',
            )
          "
        />
        <small class="text-muted-color">
          {{
            t(
              'setup.entityParameters.displayTemplateHint',
              'Used for record titles and relation labels. Order matches chip order.',
            )
          }}
        </small>
      </div>

      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.hidden"
            binary
            input-id="entity-hidden"
          />
          <label for="entity-hidden">
            {{ t('setup.entityParameters.hidden', 'Hide within the App') }}
          </label>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="form.internal"
            binary
            input-id="entity-internal"
          />
          <label for="entity-internal">
            {{ t('setup.entityParameters.internal', 'Internal') }}
          </label>
        </div>
      </div>
      <small class="text-muted-color -mt-1">
        {{
          t(
            'setup.entityParameters.internalHint',
            'Internal objects are hidden from collection pickers and from Object Manager unless Show internal is on.',
          )
        }}
      </small>

      <div class="flex flex-col gap-1">
        <label>
          {{
            t(
              'setup.entityParameters.accountability',
              'Activity & Revision Tracking',
            )
          }}
        </label>
        <Select
          v-model="form.accountability"
          :options="accountabilityOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>
    </div>

    <Divider />

    <SetupUniqueGroupsPanel :collection="collection" />
  </section>
</template>

<style scoped>
.setup-entity-parameters__loading {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.setup-entity-parameters__form {
  max-width: 40rem;
}

.setup-entity-parameters__hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.setup-entity-parameters__hint::before {
  content: 'i';
}

:global(.property-hint-tooltip),
:global(.property-hint-tooltip .p-tooltip-text) {
  max-width: 16rem;
  white-space: normal;
  line-height: 1.4;
}
</style>
