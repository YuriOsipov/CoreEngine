<script lang="ts">
export default {
  name: 'SetupGeneralTab',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useToast } from 'openvue/usetoast'
import {
  getDataSource,
  getRecordsSource,
  getRegistrySource,
} from '@/core/graphql/featureFlags'
import { fetchBffHealth } from '@/core/graphql/registryApi'
import { formatDateValue } from '@/core/dateFormatting'
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_PRESETS,
  DATE_TIME_FORMAT_PRESETS,
  type CompanyProfile,
  defaultCompanyProfile,
  formatOrgCurrencySample,
  loadCompanyProfile,
  saveCompanyProfile,
  timeZoneSelectOptions,
} from '@/core/orgLocale'
import {
  type OrgFilesUploadSettings,
  defaultOrgFilesUploadSettings,
  loadOrgFilesUploadSettings,
  saveOrgFilesUploadSettings,
} from '@/core/orgFilesSettings'
import { IMAGE_FORMAT_OPTIONS } from '@/interfaces'
import {
  TRANSLATION_LANGUAGE_OPTIONS,
  applyOrgLanguageDefault,
  useTranslation,
} from '@/core/translation'
import { scheduleFeatureAvailable } from '../../services/scheduleFeature'

const { t } = useTranslation()
const toast = useToast()
const scheduleAvailable = ref(false)

const dataSource = getDataSource()
const recordsSource = getRecordsSource()
const registrySource = getRegistrySource()

const healthLoading = ref(false)
const healthOk = ref<boolean | null>(null)
const healthDetail = ref<string | null>(null)

const profileLoading = ref(false)
const profileSaving = ref(false)
const draft = ref<CompanyProfile>(defaultCompanyProfile())
const timeZoneOptions = timeZoneSelectOptions()
const languageOptions = TRANSLATION_LANGUAGE_OPTIONS
const currencyOptions = [...CURRENCY_OPTIONS]
const dateFormatOptions = [...DATE_FORMAT_PRESETS]
const dateTimeFormatOptions = [...DATE_TIME_FORMAT_PRESETS]

const filesLoading = ref(false)
const filesSaving = ref(false)
const filesDraft = ref<OrgFilesUploadSettings>(defaultOrgFilesUploadSettings())
const imageFormatOptions = IMAGE_FORMAT_OPTIONS

const filesImageFormats = computed({
  get: () => {
    const mimes = filesDraft.value.allowedMimeTypes
    if (!mimes.length || mimes.every((mime) => mime === 'image' || mime === 'image/')) {
      return [] as string[]
    }
    return mimes.filter((mime) =>
      IMAGE_FORMAT_OPTIONS.some((option) => option.value === mime),
    )
  },
  set: (selected: string[]) => {
    filesDraft.value = {
      ...filesDraft.value,
      allowedMimeTypes: selected.length ? [...selected] : ['image/'],
    }
  },
})

const filesMaxSizeMb = computed({
  get: () => filesDraft.value.maxFileSizeMb,
  set: (value: number | null) => {
    filesDraft.value = {
      ...filesDraft.value,
      maxFileSizeMb:
        typeof value === 'number' && Number.isFinite(value) && value > 0
          ? Math.round(value * 100) / 100
          : null,
    }
  },
})

const previewSample = computed(() => {
  const now = new Date()
  const currencyCode = String(draft.value.currency || 'USD').trim().toUpperCase()
  const currency = formatOrgCurrencySample(
    100,
    draft.value.language,
    currencyCode,
  )
  const datePart = formatDateValue(
    now.toISOString().slice(0, 10),
    draft.value.dateFormat || 'M/d/yyyy',
  )
  const dateTimePart = formatDateValue(
    now.toISOString(),
    draft.value.dateTimeFormat || 'M/d/yyyy h:mm A',
  )
  return `${currency} · ${datePart} · ${dateTimePart}`
})

async function loadProfile(): Promise<void> {
  profileLoading.value = true
  try {
    draft.value = await loadCompanyProfile()
  } catch (error) {
    draft.value = defaultCompanyProfile()
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail:
        error instanceof Error
          ? error.message
          : t('setup.company.loadError', 'Failed to load company information.'),
      life: 4000,
    })
  } finally {
    profileLoading.value = false
  }
}

async function loadFilesSettings(): Promise<void> {
  filesLoading.value = true
  try {
    filesDraft.value = await loadOrgFilesUploadSettings(true)
  } catch (error) {
    filesDraft.value = defaultOrgFilesUploadSettings()
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail:
        error instanceof Error
          ? error.message
          : t('setup.filesUpload.loadError', 'Failed to load image upload settings.'),
      life: 4000,
    })
  } finally {
    filesLoading.value = false
  }
}

async function saveFilesSettings(): Promise<void> {
  filesSaving.value = true
  try {
    filesDraft.value = await saveOrgFilesUploadSettings(filesDraft.value)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('setup.filesUpload.saved', 'Image upload settings saved.'),
      life: 3000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('setup.filesUpload.saveError', 'Failed to save image upload settings.'),
      life: 5000,
    })
  } finally {
    filesSaving.value = false
  }
}

async function saveProfile(): Promise<void> {
  if (!draft.value.organizationName.trim()) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'setup.company.organizationNameRequired',
        'Organization name is required.',
      ),
      life: 4000,
    })
    return
  }

  profileSaving.value = true
  try {
    draft.value = await saveCompanyProfile(draft.value)
    applyOrgLanguageDefault(draft.value.language)
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('setup.company.saved', 'Company information saved.'),
      life: 3000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('setup.company.saveError', 'Failed to save company information.'),
      life: 5000,
    })
  } finally {
    profileSaving.value = false
  }
}

onMounted(async () => {
  void loadProfile()
  void loadFilesSettings()
  void scheduleFeatureAvailable().then((available) => {
    scheduleAvailable.value = available
  })

  if (dataSource !== 'graphql') {
    healthOk.value = null
    healthDetail.value = t(
      'setup.dataSources.bffSkipped',
      'BFF health check skipped (VITE_DATA_SOURCE is not graphql).',
    )
    return
  }

  healthLoading.value = true
  try {
    const { health } = await fetchBffHealth()
    healthOk.value = Boolean(health.ok)
    healthDetail.value = t(
      'setup.dataSources.bffDetail',
      '{service} · entities {entities} · translations {translations}',
      {
        service: health.service || 'crm-bff',
        entities: health.registryEntities ?? 0,
        translations: health.translationEntries ?? 0,
      },
    )
  } catch (error) {
    healthOk.value = false
    healthDetail.value =
      error instanceof Error
        ? error.message
        : t('setup.dataSources.bffFailed', 'BFF health check failed')
  } finally {
    healthLoading.value = false
  }
})
</script>

<template>
  <section class="setup-tab-content flex flex-col gap-4">
    <h2>{{ t('setup.generalTitle', 'General') }}</h2>

    <div class="border border-surface-200 rounded-lg p-4 flex flex-col gap-3">
      <div class="font-semibold">
        {{ t('setup.dataSources.title', 'Data sources') }}
      </div>
      <div class="flex flex-wrap gap-2">
        <Tag
          severity="secondary"
          :value="
            t('setup.dataSources.dataTag', 'Data: {source}', { source: dataSource })
          "
        />
        <Tag
          severity="secondary"
          :value="
            t('setup.dataSources.recordsTag', 'Records: {source}', {
              source: recordsSource,
            })
          "
        />
        <Tag
          severity="secondary"
          :value="
            t('setup.dataSources.registryTag', 'Registry: {source}', {
              source: registrySource,
            })
          "
        />
        <Tag
          v-if="healthLoading"
          severity="info"
          :value="t('setup.dataSources.bffChecking', 'BFF: checking…')"
        />
        <Tag
          v-else-if="healthOk === true"
          severity="success"
          :value="t('setup.dataSources.bffOk', 'BFF: ok')"
        />
        <Tag
          v-else-if="healthOk === false"
          severity="danger"
          :value="t('setup.dataSources.bffDown', 'BFF: down')"
        />
        <Tag
          v-else
          severity="secondary"
          :value="t('setup.dataSources.bffIdle', 'BFF: n/a')"
        />
      </div>
      <p v-if="healthDetail" class="text-muted-color text-[0.8rem] m-0">
        {{ healthDetail }}
      </p>
    </div>

    <div class="border border-surface-200 rounded-lg p-4 flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="font-semibold">
          {{ t('setup.company.title', 'Company Information') }}
        </div>
        <Button
          :label="t('setup.company.save', 'Save')"
          icon="pi pi-save"
          size="small"
          :loading="profileSaving"
          :disabled="profileLoading"
          @click="saveProfile"
        />
      </div>

      <ProgressSpinner
        v-if="profileLoading"
        class="self-center"
        stroke-width="4"
        style="width: 2rem; height: 2rem"
      />

      <template v-else>
        <div class="flex flex-col gap-3">
          <div class="text-[0.9rem] font-medium text-muted-color">
            {{ t('setup.company.generalInfo', 'General Information') }}
          </div>
          <div class="flex flex-col gap-1 max-w-xl">
            <label class="text-[0.85rem]" for="org-name">
              {{ t('setup.company.organizationName', 'Organization Name') }}
            </label>
            <InputText
              id="org-name"
              v-model="draft.organizationName"
              class="w-full"
            />
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <div class="text-[0.9rem] font-medium text-muted-color">
            {{ t('setup.company.address', 'Address') }}
          </div>
          <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-country">
                {{ t('setup.company.country', 'Country') }}
              </label>
              <InputText id="org-country" v-model="draft.address.country" class="w-full" />
            </div>
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-[0.85rem]" for="org-street">
                {{ t('setup.company.street', 'Street') }}
              </label>
              <Textarea
                id="org-street"
                v-model="draft.address.street"
                class="w-full"
                rows="2"
                auto-resize
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-city">
                {{ t('setup.company.city', 'City') }}
              </label>
              <InputText id="org-city" v-model="draft.address.city" class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-state">
                {{ t('setup.company.state', 'State / Province') }}
              </label>
              <InputText id="org-state" v-model="draft.address.state" class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-postal">
                {{ t('setup.company.postalCode', 'Zip / Postal Code') }}
              </label>
              <InputText
                id="org-postal"
                v-model="draft.address.postalCode"
                class="w-full"
              />
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <div class="text-[0.9rem] font-medium text-muted-color">
            {{ t('setup.company.localeSettings', 'Locale Settings') }}
          </div>
          <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-language">
                {{ t('setup.company.language', 'Default Language') }}
              </label>
              <Select
                id="org-language"
                v-model="draft.language"
                :options="languageOptions"
                option-label="label"
                option-value="value"
                class="w-full"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-timezone">
                {{ t('setup.company.timeZone', 'Default Time Zone') }}
              </label>
              <Select
                id="org-timezone"
                v-model="draft.timeZone"
                :options="timeZoneOptions"
                option-label="label"
                option-value="value"
                filter
                class="w-full"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-date">
                {{ t('setup.company.dateFormat', 'Date') }}
              </label>
              <Select
                id="org-date"
                v-model="draft.dateFormat"
                :options="dateFormatOptions"
                option-label="label"
                option-value="value"
                class="w-full"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[0.85rem]" for="org-datetime">
                {{ t('setup.company.dateTimeFormat', 'Date Time') }}
              </label>
              <Select
                id="org-datetime"
                v-model="draft.dateTimeFormat"
                :options="dateTimeFormatOptions"
                option-label="label"
                option-value="value"
                class="w-full"
              />
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <div class="text-[0.9rem] font-medium text-muted-color">
            {{ t('setup.company.currencySettings', 'Currency Settings') }}
          </div>
          <div class="flex flex-col gap-1 max-w-md">
            <label class="text-[0.85rem]" for="org-currency">
              {{ t('setup.company.currency', 'Currency') }}
            </label>
            <Select
              id="org-currency"
              v-model="draft.currency"
              :options="currencyOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>
        </div>

        <p class="text-muted-color text-[0.85rem] m-0">
          <span class="font-medium">{{ t('setup.company.preview', 'Preview') }}:</span>
          {{ previewSample }}
        </p>
      </template>
    </div>

    <div class="border border-surface-200 rounded-lg p-4 flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="font-semibold">
          {{ t('setup.filesUpload.title', 'Image upload') }}
        </div>
        <Button
          :label="t('setup.filesUpload.save', 'Save')"
          icon="pi pi-save"
          size="small"
          :loading="filesSaving"
          :disabled="filesLoading"
          @click="saveFilesSettings"
        />
      </div>

      <ProgressSpinner
        v-if="filesLoading"
        class="self-center"
        stroke-width="4"
        style="width: 2rem; height: 2rem"
      />

      <template v-else>
        <p class="text-muted-color text-[0.85rem] m-0">
          {{
            t(
              'setup.filesUpload.hint',
              'Applies to all Image fields. Preview size is still configured per Block Layout.',
            )
          }}
        </p>
        <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          <div class="flex flex-col gap-1">
            <label class="text-[0.85rem]" for="org-image-format">
              {{ t('setup.filesUpload.format', 'Format') }}
            </label>
            <MultiSelect
              id="org-image-format"
              v-model="filesImageFormats"
              :options="imageFormatOptions"
              option-label="label"
              option-value="value"
              display="chip"
              :show-toggle-all="true"
              class="w-full"
              :placeholder="t('setup.filesUpload.formatAny', 'Any image format')"
            />
            <small class="text-muted-color">
              {{
                t(
                  'setup.filesUpload.formatHint',
                  'Leave empty to allow any image type.',
                )
              }}
            </small>
          </div>
          <div class="flex flex-col gap-1 max-w-xs">
            <label class="text-[0.85rem]" for="org-image-max-size">
              {{ t('setup.filesUpload.maxFileSize', 'Max file size (MB)') }}
            </label>
            <InputNumber
              id="org-image-max-size"
              v-model="filesMaxSizeMb"
              class="w-full"
              :min="0.1"
              :max="100"
              :min-fraction-digits="0"
              :max-fraction-digits="1"
              :placeholder="t('setup.filesUpload.maxFileSizeNone', 'No limit')"
              show-buttons
            />
            <small class="text-muted-color">
              {{
                t(
                  'setup.filesUpload.maxFileSizeHint',
                  'Optional upload limit for Image fields. Leave empty for no extra limit.',
                )
              }}
            </small>
          </div>
        </div>
      </template>
    </div>

    <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
      <RouterLink
        v-if="scheduleAvailable"
        :to="{ name: 'setup-schedule' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-calendar-clock text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('schedule.setupTitle', 'Schedule') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'schedule.setupLinkHint',
                'Provider work-time templates and slot generation.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-tasks' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-clock text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.tasks.title', 'Tasks') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.tasks.linkHint',
                'Schedule slot generation, database verification, and notifications.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-flows' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-share-alt text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.flows.title', 'Flows') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.flows.linkHint',
                'Map flow keys to external HTTP webhooks for Automations.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-schema-sync' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-sync text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.schemaSync.title', 'Schema sync') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.schemaSync.linkHint',
                'Review registry sync status for SUPABASE/PLATFORM entities.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-archived' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-inbox text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.archived.title', 'Archived records') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.archived.linkHint',
                'Browse and restore soft-deleted records by object.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-reports' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-chart-bar text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.reports.title', 'Reports') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.reports.linkHint',
                'Create and edit pivot reports for Navigation and dashboards.',
              )
            }}
          </span>
        </span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'setup-dashboards' }"
        class="border border-surface-200 rounded-lg flex items-start gap-3 no-underline p-4 text-inherit hover:border-primary"
      >
        <i class="pi pi-th-large text-primary text-xl mt-1" aria-hidden="true" />
        <span class="flex flex-col gap-1">
          <span class="font-semibold">{{ t('setup.dashboards.title', 'Dashboards') }}</span>
          <span class="text-muted-color text-[0.8rem]">
            {{
              t(
                'setup.dashboards.linkHint',
                'Create and edit dashboards for Navigation and Home.',
              )
            }}
          </span>
        </span>
      </RouterLink>
    </div>
  </section>
</template>
