<script lang="ts">
export default {
  name: 'SetupUniqueGroupsPanel',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  fetchEntityUniqueGroups,
  setFieldIsUnique,
  upsertEntityUniqueGroups,
  type EntityUniqueGroupDto,
} from '@/core/graphql/uniqueGroupsApi'
import { clearMetadataCache } from '@/modules/entities/services/collectionSchema'

const props = defineProps<{
  collection: string
}>()

const { t } = useTranslation()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const groups = ref<EntityUniqueGroupDto[]>([])
const fields = ref<
  Array<{
    apiName: string
    label: string
    isUnique: boolean
    type: string
    hidden: boolean
    isSystem: boolean
  }>
>([])
const singleUniqueFields = ref<string[]>([])

function showError(err: unknown, summary?: string): void {
  toast.add({
    severity: 'error',
    summary: summary || t('common.error', 'Error'),
    detail: err instanceof Error ? err.message : String(err),
    life: 6000,
  })
}

const fieldOptions = computed(() =>
  fields.value
    .filter((f) => f.apiName !== 'id' && f.type.toUpperCase() !== 'ALIAS')
    .map((f) => ({
      label: `${f.label} (${f.apiName})`,
      value: f.apiName,
    })),
)

function syncSingleUniqueFields(): void {
  const allowed = new Set(fieldOptions.value.map((f) => f.value))
  singleUniqueFields.value = fields.value
    .filter((f) => f.isUnique && allowed.has(f.apiName))
    .map((f) => f.apiName)
}

async function healLegacySingleFieldGroups(
  legacy: Array<{ name: string; fields: string[] }>,
  composites: Array<{ name: string; fields: string[] }>,
): Promise<boolean> {
  if (!legacy.length) return false
  // Promote 1-field config leftovers onto is_unique and rewrite uniqueGroups.
  await upsertEntityUniqueGroups(
    props.collection,
    [
      ...legacy.map((g) => ({ name: g.name, fields: [...g.fields] })),
      ...composites.map((g) => ({ name: g.name, fields: [...g.fields] })),
    ],
    true,
  )
  clearMetadataCache()
  return true
}

async function load(): Promise<void> {
  if (!props.collection) return
  loading.value = true
  try {
    const data = await fetchEntityUniqueGroups(props.collection)
    if (data.legacySingleFieldGroups.length) {
      await healLegacySingleFieldGroups(
        data.legacySingleFieldGroups,
        data.uniqueGroups,
      )
      const refreshed = await fetchEntityUniqueGroups(props.collection)
      groups.value = refreshed.uniqueGroups.map((g) => ({
        name: g.name,
        fields: [...g.fields],
      }))
      fields.value = refreshed.fields
      syncSingleUniqueFields()
      return
    }
    groups.value = data.uniqueGroups.map((g) => ({
      name: g.name,
      fields: [...g.fields],
    }))
    fields.value = data.fields
    syncSingleUniqueFields()
  } catch (err) {
    showError(err, t('setup.uniqueGroups.loadError', 'Failed to load unique groups'))
  } finally {
    loading.value = false
  }
}

function addGroup(): void {
  groups.value.push({ name: `group_${groups.value.length + 1}`, fields: [] })
}

function removeGroup(index: number): void {
  groups.value.splice(index, 1)
}

async function saveGroups(): Promise<void> {
  saving.value = true
  try {
    const prepared = groups.value.map((g) => ({
      name: g.name.trim() || g.fields.join('_'),
      fields: g.fields.filter(Boolean),
    }))
    const invalid = prepared.filter(
      (g) => g.fields.length > 0 && g.fields.length < 2,
    )
    if (invalid.length) {
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail: t(
          'setup.uniqueGroups.compositeMinFields',
          'Composite groups need at least 2 fields. Use Single-field unique for one field.',
        ),
        life: 5000,
      })
      saving.value = false
      return
    }
    const cleaned = prepared.filter((g) => g.fields.length >= 2)
    groups.value = await upsertEntityUniqueGroups(props.collection, cleaned, true)
    clearMetadataCache()
    toast.add({
      severity: 'success',
      summary: t('setup.uniqueGroups.saved', 'Unique groups saved'),
      detail: t(
        'setup.uniqueGroups.savedDetail',
        'UNIQUE indexes applied on crm_schema (non-archived rows).',
      ),
      life: 4000,
    })
    await load()
  } catch (err) {
    showError(err, t('setup.uniqueGroups.saveError', 'Failed to save unique groups'))
  } finally {
    saving.value = false
  }
}

async function onSingleUniqueChange(next: string[] | null): Promise<void> {
  const allowed = new Set(fieldOptions.value.map((f) => f.value))
  const prev = new Set(
    fields.value
      .filter((f) => f.isUnique && allowed.has(f.apiName))
      .map((f) => f.apiName),
  )
  const nextList = (next ?? []).filter((f) => allowed.has(f))
  const nextSet = new Set(nextList)
  const toEnable = [...nextSet].filter((f) => !prev.has(f))
  const toDisable = [...prev].filter((f) => !nextSet.has(f))
  if (!toEnable.length && !toDisable.length) return

  singleUniqueFields.value = nextList
  saving.value = true
  try {
    for (const field of toEnable) {
      await setFieldIsUnique(props.collection, field, true, true)
    }
    for (const field of toDisable) {
      await setFieldIsUnique(props.collection, field, false, true)
    }
    clearMetadataCache()
    await load()
  } catch (err) {
    showError(err, t('setup.uniqueGroups.toggleError', 'Failed to update unique flag'))
    syncSingleUniqueFields()
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
  <section class="setup-unique-groups">
    <div class="setup-panel-header">
      <div>
        <h3 class="m-0">
          {{ t('setup.uniqueGroups.title', 'Unique / avoid duplicates') }}
        </h3>
        <p class="setup-panel-header__meta">
          {{
            t(
              'setup.uniqueGroups.hint',
              'Mark fields or field groups that must be unique (like Directus). Applies UNIQUE indexes on crm_schema, ignoring archived rows.',
            )
          }}
        </p>
      </div>
    </div>

    <div
      v-if="loading"
      class="setup-unique-groups__loading"
    >
      <ProgressSpinner style="width: 2rem; height: 2rem" />
    </div>

    <template v-else>
      <h4 class="setup-unique-groups__subtitle">
        {{ t('setup.uniqueGroups.singleFields', 'Single-field unique') }}
      </h4>
      <MultiSelect
        :model-value="singleUniqueFields"
        :options="fieldOptions"
        option-label="label"
        option-value="value"
        display="chip"
        filter
        class="w-full"
        :disabled="saving"
        :placeholder="t('setup.uniqueGroups.selectFields', 'Select fields')"
        @update:model-value="onSingleUniqueChange($event)"
      />

      <h4 class="setup-unique-groups__subtitle">
        {{ t('setup.uniqueGroups.composite', 'Composite unique groups') }}
      </h4>
      <p class="setup-unique-groups__composite-hint text-muted-color">
        {{
          t(
            'setup.uniqueGroups.compositeHint',
            'Two or more fields that must be unique together. Single fields belong under Single-field unique above.',
          )
        }}
      </p>

      <div
        v-for="(group, index) in groups"
        :key="index"
        class="setup-unique-groups__group"
      >
        <div class="setup-unique-groups__group-header">
          <InputText
            v-model="group.name"
            :placeholder="t('setup.uniqueGroups.groupName', 'Group name')"
            class="w-full"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            :aria-label="t('common.delete', 'Delete')"
            @click="removeGroup(index)"
          />
        </div>
        <MultiSelect
          v-model="group.fields"
          :options="fieldOptions"
          option-label="label"
          option-value="value"
          display="chip"
          filter
          :placeholder="t('setup.uniqueGroups.selectFields', 'Select fields')"
          class="w-full"
          :class="{ 'p-invalid': group.fields.length === 1 }"
        />
        <small
          v-if="group.fields.length === 1"
          class="text-red-500"
        >
          {{
            t(
              'setup.uniqueGroups.compositeMinFields',
              'Composite groups need at least 2 fields. Use Single-field unique for one field.',
            )
          }}
        </small>
      </div>

      <div class="setup-unique-groups__actions">
        <Button
          :label="t('setup.uniqueGroups.addGroup', 'Add group')"
          icon="pi pi-plus"
          severity="secondary"
          outlined
          :disabled="saving"
          @click="addGroup"
        />
        <Button
          :label="t('setup.uniqueGroups.save', 'Save unique groups')"
          icon="pi pi-check"
          :loading="saving"
          @click="saveGroups"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.setup-unique-groups__subtitle {
  margin: 1rem 0 0.5rem;
  font-size: 0.95rem;
}
.setup-unique-groups__composite-hint {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  line-height: 1.35;
}
.setup-unique-groups__group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 6px;
}
.setup-unique-groups__group-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.setup-unique-groups__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.setup-unique-groups__loading {
  display: flex;
  justify-content: center;
  padding: 1rem;
}
</style>
