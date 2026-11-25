<script lang="ts">
export default {
  name: 'SetupGeneralTab',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'openvue/usetoast'
import { fileAssetUrl, uploadFile } from '@/core/graphql/filesProxy'
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
  normalizeCompanyProfile,
  saveCompanyProfile,
  timeZoneSelectOptions,
} from '@/core/orgLocale'
import {
  type OrgFilesUploadSettings,
  defaultOrgFilesUploadSettings,
  loadOrgFilesUploadSettings,
  normalizeOrgFilesUploadSettings,
  saveOrgFilesUploadSettings,
} from '@/core/orgFilesSettings'
import {
  type OrgFailedRunNotifySettings,
  defaultFailedRunNotifySettings,
  loadFailedRunNotifySettings,
  normalizeFailedRunNotifySettings,
  saveFailedRunNotifySettings,
} from '@/core/orgFailedRunNotify'
import { IMAGE_FORMAT_OPTIONS } from '@/interfaces'
import {
  TRANSLATION_LANGUAGE_OPTIONS,
  applyOrgLanguageDefault,
  useTranslation,
} from '@/core/translation'
import SetupPageHeader from './SetupPageHeader.vue'

const { t } = useTranslation()
const toast = useToast()
const companyEditing = ref(false)
const companySnapshot = ref<CompanyProfile | null>(null)
const filesSnapshot = ref<OrgFilesUploadSettings | null>(null)
const notifySnapshot = ref<OrgFailedRunNotifySettings | null>(null)

const dataSource = getDataSource()
const recordsSource = getRecordsSource()
const registrySource = getRegistrySource()

const healthLoading = ref(false)
const healthOk = ref<boolean | null>(null)
const healthDetail = ref<string | null>(null)

const profileLoading = ref(false)
const draft = ref<CompanyProfile>(defaultCompanyProfile())
const timeZoneOptions = timeZoneSelectOptions()
const languageOptions = TRANSLATION_LANGUAGE_OPTIONS
const currencyOptions = [...CURRENCY_OPTIONS]
const dateFormatOptions = [...DATE_FORMAT_PRESETS]
const dateTimeFormatOptions = [...DATE_TIME_FORMAT_PRESETS]

const filesLoading = ref(false)
const filesDraft = ref<OrgFilesUploadSettings>(defaultOrgFilesUploadSettings())
const imageFormatOptions = IMAGE_FORMAT_OPTIONS

const notifyLoading = ref(false)
const notifyDraft = ref<OrgFailedRunNotifySettings>(defaultFailedRunNotifySettings())

const pageLoading = computed(
  () => profileLoading.value || filesLoading.value || notifyLoading.value,
)
const pageSaving = ref(false)
const logoUploading = ref(false)
const logoInputRef = ref<HTMLInputElement | null>(null)

const logoPreviewUrl = computed(() => {
  const id = draft.value.logoFileId?.trim()
  if (!id) return ''
  return fileAssetUrl(id, { width: 160, height: 160, fit: 'contain' })
})

const logoAccept = computed(() => {
  const mimes = filesDraft.value.allowedMimeTypes
  if (!mimes.length || mimes.every((mime) => mime === 'image' || mime === 'image/')) {
    return 'image/*'
  }
  return mimes.join(',')
})

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

function optionLabel(
  options: Array<{ label: string; value: string }>,
  value: string,
): string {
  return options.find((option) => option.value === value)?.label || value || '—'
}

function displayText(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || '—'
}

const languageDisplay = computed(() =>
  optionLabel(languageOptions, draft.value.language),
)
const timeZoneDisplay = computed(() =>
  optionLabel(timeZoneOptions, draft.value.timeZone),
)
const dateFormatDisplay = computed(() =>
  optionLabel(dateFormatOptions, draft.value.dateFormat),
)
const dateTimeFormatDisplay = computed(() =>
  optionLabel(dateTimeFormatOptions, draft.value.dateTimeFormat),
)
const currencyDisplay = computed(() =>
  optionLabel(currencyOptions, draft.value.currency),
)

const filesFormatDisplay = computed(() => {
  const formats = filesImageFormats.value
  if (!formats.length) {
    return t('setup.filesUpload.formatAny', 'Any image format')
  }
  return formats
    .map((value) => optionLabel(imageFormatOptions, value))
    .join(', ')
})

const filesMaxSizeDisplay = computed(() => {
  const size = filesDraft.value.maxFileSizeMb
  if (size == null) {
    return t('setup.filesUpload.maxFileSizeNone', 'No limit')
  }
  return String(size)
})

const notifyEnabledDisplay = computed(() =>
  notifyDraft.value.enabled
    ? t('common.enabled', 'Enabled')
    : t('common.disabled', 'Disabled'),
)

function startCompanyEdit(): void {
  companySnapshot.value = normalizeCompanyProfile(draft.value)
  filesSnapshot.value = normalizeOrgFilesUploadSettings(filesDraft.value)
  notifySnapshot.value = normalizeFailedRunNotifySettings(notifyDraft.value)
  companyEditing.value = true
}

function openLogoPicker(): void {
  logoInputRef.value?.click()
}

function clearLogo(): void {
  draft.value = {
    ...draft.value,
    logoFileId: '',
  }
}

function validateLogoFile(file: File): string | null {
  const mimes = filesDraft.value.allowedMimeTypes
  const allowAny =
    !mimes.length || mimes.every((mime) => mime === 'image' || mime === 'image/')
  if (!file.type.startsWith('image/')) {
    return t('setup.company.logoNotImage', 'Company logo must be an image file.')
  }
  if (!allowAny && !mimes.includes(file.type)) {
    return t(
      'setup.company.logoTypeNotAllowed',
      'This image format is not allowed by Image upload settings.',
    )
  }
  const maxMb = filesDraft.value.maxFileSizeMb
  if (
    typeof maxMb === 'number' &&
    Number.isFinite(maxMb) &&
    maxMb > 0 &&
    file.size > maxMb * 1024 * 1024
  ) {
    return t(
      'setup.company.logoTooLarge',
      'Company logo exceeds the max file size ({size} MB).',
      { size: maxMb },
    )
  }
  return null
}

async function onLogoSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const validationError = validateLogoFile(file)
  if (validationError) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: validationError,
      life: 4000,
    })
    return
  }

  logoUploading.value = true
  try {
    const uploaded = await uploadFile(file)
    draft.value = {
      ...draft.value,
      logoFileId: uploaded.id,
    }
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('setup.company.logoUploadError', 'Failed to upload company logo.'),
      life: 5000,
    })
  } finally {
    logoUploading.value = false
  }
}

function cancelCompanyEdit(): void {
  if (companySnapshot.value) {
    draft.value = normalizeCompanyProfile(companySnapshot.value)
  }
  if (filesSnapshot.value) {
    filesDraft.value = normalizeOrgFilesUploadSettings(filesSnapshot.value)
  }
  if (notifySnapshot.value) {
    notifyDraft.value = normalizeFailedRunNotifySettings(notifySnapshot.value)
  }
  companySnapshot.value = null
  filesSnapshot.value = null
  notifySnapshot.value = null
  companyEditing.value = false
}

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

  pageSaving.value = true
  try {
    draft.value = await saveCompanyProfile(draft.value)
    applyOrgLanguageDefault(draft.value.language)
    filesDraft.value = await saveOrgFilesUploadSettings(filesDraft.value)
    notifyDraft.value = await saveFailedRunNotifySettings(notifyDraft.value)
    companySnapshot.value = null
    filesSnapshot.value = null
    notifySnapshot.value = null
    companyEditing.value = false
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
    pageSaving.value = false
  }
}

async function loadNotifySettings(): Promise<void> {
  notifyLoading.value = true
  try {
    notifyDraft.value = await loadFailedRunNotifySettings()
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('setup.failedRunNotify.loadError', 'Failed to load failed-run alerts.'),
      life: 5000,
    })
  } finally {
    notifyLoading.value = false
  }
}

onMounted(async () => {
  void loadProfile()
  void loadFilesSettings()
  void loadNotifySettings()

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
    <SetupPageHeader
      :title="t('setup.company.title', 'Company Information')"
      icon-class="pi pi-building"
    >
      <template #actions>
        <template v-if="companyEditing">
          <Button
            :label="t('common.cancel', 'Cancel')"
            severity="secondary"
            outlined
            size="small"
            :disabled="pageSaving || pageLoading || logoUploading"
            @click="cancelCompanyEdit"
          />
          <Button
            :label="t('setup.company.save', 'Save')"
            icon="pi pi-save"
            size="small"
            :loading="pageSaving"
            :disabled="pageLoading || logoUploading"
            @click="saveProfile"
          />
        </template>
        <Button
          v-else
          :label="t('common.edit', 'Edit')"
          icon="pi pi-pencil"
          size="small"
          :disabled="pageLoading"
          @click="startCompanyEdit"
        />
      </template>
    </SetupPageHeader>

    <ProgressSpinner
      v-if="pageLoading"
      class="self-center"
      stroke-width="4"
      style="width: 2rem; height: 2rem"
    />

    <template v-else>
      <section class="setup-detail-section">
        <h3 class="setup-detail-section__title">
          {{ t('setup.company.organizationDetail', 'Organization Detail') }}
        </h3>
        <div class="setup-detail-grid">
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-name">
              {{ t('setup.company.organizationName', 'Organization Name') }}
            </label>
            <InputText
              v-if="companyEditing"
              id="org-name"
              v-model="draft.organizationName"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">
              {{ displayText(draft.organizationName) }}
            </p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <p class="setup-detail-field__label">
              {{ t('setup.company.logo', 'Company Logo') }}
            </p>
            <div class="setup-company-logo">
              <div
                v-if="logoPreviewUrl"
                class="setup-company-logo__preview"
              >
                <img
                  :src="logoPreviewUrl"
                  :alt="t('setup.company.logo', 'Company Logo')"
                />
              </div>
              <p
                v-else
                class="setup-detail-field__value"
              >
                {{ t('setup.company.logoEmpty', 'No logo') }}
              </p>
              <div
                v-if="companyEditing"
                class="setup-company-logo__actions"
              >
                <input
                  ref="logoInputRef"
                  type="file"
                  class="hidden"
                  :accept="logoAccept"
                  @change="onLogoSelected"
                />
                <Button
                  :label="
                    logoPreviewUrl
                      ? t('setup.company.logoReplace', 'Replace')
                      : t('setup.company.logoUpload', 'Upload')
                  "
                  :icon="logoPreviewUrl ? 'pi pi-refresh' : 'pi pi-upload'"
                  size="small"
                  severity="secondary"
                  outlined
                  :loading="logoUploading"
                  :disabled="pageSaving"
                  @click="openLogoPicker"
                />
                <Button
                  v-if="logoPreviewUrl"
                  :label="t('common.remove', 'Remove')"
                  icon="pi pi-trash"
                  size="small"
                  severity="danger"
                  text
                  :disabled="logoUploading || pageSaving"
                  @click="clearLogo"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="setup-detail-section">
        <h3 class="setup-detail-section__title">
          {{ t('setup.company.address', 'Address') }}
        </h3>
        <div class="setup-detail-grid">
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-country">
              {{ t('setup.company.country', 'Country') }}
            </label>
            <InputText
              v-if="companyEditing"
              id="org-country"
              v-model="draft.address.country"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">
              {{ displayText(draft.address.country) }}
            </p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-street">
              {{ t('setup.company.street', 'Street') }}
            </label>
            <Textarea
              v-if="companyEditing"
              id="org-street"
              v-model="draft.address.street"
              class="w-full"
              rows="2"
              auto-resize
            />
            <p v-else class="setup-detail-field__value">
              {{ displayText(draft.address.street) }}
            </p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-city">
              {{ t('setup.company.city', 'City') }}
            </label>
            <InputText
              v-if="companyEditing"
              id="org-city"
              v-model="draft.address.city"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">
              {{ displayText(draft.address.city) }}
            </p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-state">
              {{ t('setup.company.state', 'State / Province') }}
            </label>
            <InputText
              v-if="companyEditing"
              id="org-state"
              v-model="draft.address.state"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">
              {{ displayText(draft.address.state) }}
            </p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-postal">
              {{ t('setup.company.postalCode', 'Zip / Postal Code') }}
            </label>
            <InputText
              v-if="companyEditing"
              id="org-postal"
              v-model="draft.address.postalCode"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">
              {{ displayText(draft.address.postalCode) }}
            </p>
          </div>
        </div>
      </section>

      <section class="setup-detail-section">
        <h3 class="setup-detail-section__title">
          {{ t('setup.company.localeSettings', 'Locale Settings') }}
        </h3>
        <div class="setup-detail-grid">
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-language">
              {{ t('setup.company.language', 'Default Language') }}
            </label>
            <Select
              v-if="companyEditing"
              id="org-language"
              v-model="draft.language"
              :options="languageOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">{{ languageDisplay }}</p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-timezone">
              {{ t('setup.company.timeZone', 'Default Time Zone') }}
            </label>
            <Select
              v-if="companyEditing"
              id="org-timezone"
              v-model="draft.timeZone"
              :options="timeZoneOptions"
              option-label="label"
              option-value="value"
              filter
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">{{ timeZoneDisplay }}</p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-date">
              {{ t('setup.company.dateFormat', 'Date') }}
            </label>
            <Select
              v-if="companyEditing"
              id="org-date"
              v-model="draft.dateFormat"
              :options="dateFormatOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">{{ dateFormatDisplay }}</p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-datetime">
              {{ t('setup.company.dateTimeFormat', 'Date Time') }}
            </label>
            <Select
              v-if="companyEditing"
              id="org-datetime"
              v-model="draft.dateTimeFormat"
              :options="dateTimeFormatOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">{{ dateTimeFormatDisplay }}</p>
          </div>
        </div>
      </section>

      <section class="setup-detail-section">
        <h3 class="setup-detail-section__title">
          {{ t('setup.company.currencySettings', 'Currency Settings') }}
        </h3>
        <div class="setup-detail-grid">
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-currency">
              {{ t('setup.company.currency', 'Currency') }}
            </label>
            <Select
              v-if="companyEditing"
              id="org-currency"
              v-model="draft.currency"
              :options="currencyOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
            <p v-else class="setup-detail-field__value">{{ currencyDisplay }}</p>
          </div>
          <div class="setup-detail-field">
            <p class="setup-detail-field__label">
              {{ t('setup.company.preview', 'Preview') }}
            </p>
            <p class="setup-detail-field__value">{{ previewSample }}</p>
          </div>
        </div>
      </section>
      <section class="setup-detail-section">
        <h3 class="setup-detail-section__title">
          {{ t('setup.failedRunNotify.title', 'Failed-run alerts') }}
        </h3>
        <div class="setup-detail-grid">
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="failed-run-notify">
              {{ t('setup.failedRunNotify.enableShort', 'Email on failure') }}
            </label>
            <div v-if="companyEditing" class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <ToggleSwitch
                  v-model="notifyDraft.enabled"
                  input-id="failed-run-notify"
                />
                <label
                  for="failed-run-notify"
                  class="text-[0.9rem] cursor-pointer"
                >
                  {{
                    t(
                      'setup.failedRunNotify.enable',
                      'Email admins when a flow or scheduled task fails',
                    )
                  }}
                </label>
              </div>
              <p class="text-muted-color text-[0.8rem] m-0">
                {{
                  t(
                    'setup.failedRunNotify.hint',
                    'Uses platform SMTP (SMTP_HOST / SMTP_FROM). Recipients are active admin users, or FAILED_RUN_NOTIFY_EMAIL if set. Same key is not emailed again for 15 minutes. n8n failures stay in n8n — use its failed-execution alert template.',
                  )
                }}
              </p>
            </div>
            <p v-else class="setup-detail-field__value">{{ notifyEnabledDisplay }}</p>
          </div>
        </div>
      </section>

      <section class="setup-detail-section">
        <h3 class="setup-detail-section__title">
          {{ t('setup.filesUpload.title', 'Image upload') }}
        </h3>
        <p
          v-if="companyEditing"
          class="text-muted-color text-[0.85rem] m-0"
        >
          {{
            t(
              'setup.filesUpload.hint',
              'Applies to all Image fields. Preview size is still configured per Block Layout.',
            )
          }}
        </p>
        <div class="setup-detail-grid">
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-image-format">
              {{ t('setup.filesUpload.format', 'Format') }}
            </label>
            <div v-if="companyEditing" class="flex flex-col gap-1">
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
            <p v-else class="setup-detail-field__value">{{ filesFormatDisplay }}</p>
          </div>
          <div
            class="setup-detail-field"
            :class="{ 'setup-detail-field--edit': companyEditing }"
          >
            <label class="setup-detail-field__label" for="org-image-max-size">
              {{ t('setup.filesUpload.maxFileSize', 'Max file size (MB)') }}
            </label>
            <div v-if="companyEditing" class="flex flex-col gap-1">
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
            <p v-else class="setup-detail-field__value">{{ filesMaxSizeDisplay }}</p>
          </div>
        </div>
      </section>
    </template>

    <section class="setup-detail-section">
      <h3 class="setup-detail-section__title">
        {{ t('setup.dataSources.title', 'Data sources') }}
      </h3>
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
    </section>
  </section>
</template>
