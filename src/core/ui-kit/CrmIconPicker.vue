<script lang="ts">
export default {
  name: 'CrmIconPicker',
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type Popover from 'openvue/popover'
import { useTranslation } from '@/core/translation'
import {
  filterPrimeIconNames,
  primeIconNameFromClass,
  toPrimeIconClass,
} from '@/core/primeIcons'

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '',
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useTranslation()

const popoverRef = ref<InstanceType<typeof Popover> | null>(null)
const searchInputRef = ref<{ $el?: HTMLElement } | null>(null)
const query = ref('')

const selectedClass = computed(() => (props.modelValue ?? '').trim())
const selectedName = computed(() => primeIconNameFromClass(selectedClass.value))

const filteredIcons = computed(() => filterPrimeIconNames(query.value))

const triggerLabel = computed(() => {
  if (selectedName.value) return selectedName.value
  return (
    props.placeholder ||
    t('iconPicker.choose', 'Choose icon')
  )
})

function openPicker(event: Event): void {
  if (props.disabled) return
  query.value = ''
  popoverRef.value?.toggle(event)
  void nextTick(() => {
    const root = searchInputRef.value?.$el
    const input =
      root instanceof HTMLInputElement
        ? root
        : root?.querySelector?.('input')
    if (input instanceof HTMLInputElement) input.focus()
  })
}

function selectIcon(name: string): void {
  emit('update:modelValue', toPrimeIconClass(name))
  popoverRef.value?.hide()
}

function clearIcon(event: Event): void {
  event.stopPropagation()
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="crm-icon-picker">
    <div class="crm-icon-picker__row">
      <Button
        type="button"
        class="crm-icon-picker__trigger"
        severity="secondary"
        outlined
        :disabled="disabled"
        :aria-label="t('iconPicker.open', 'Open icon list')"
        @click="openPicker"
      >
        <i
          v-if="selectedClass"
          :class="selectedClass"
          class="crm-icon-picker__preview"
          aria-hidden="true"
        />
        <i
          v-else
          class="pi pi-objects-column crm-icon-picker__preview crm-icon-picker__preview--empty"
          aria-hidden="true"
        />
        <span class="crm-icon-picker__label">{{ triggerLabel }}</span>
        <i class="pi pi-chevron-down crm-icon-picker__caret" aria-hidden="true" />
      </Button>
      <Button
        v-if="selectedClass"
        type="button"
        icon="pi pi-times"
        severity="secondary"
        text
        rounded
        size="small"
        :disabled="disabled"
        :aria-label="t('iconPicker.clear', 'Clear icon')"
        @click="clearIcon"
      />
    </div>

    <Popover ref="popoverRef" class="crm-icon-picker__popover">
      <div class="crm-icon-picker__panel">
        <IconField class="w-full">
          <InputIcon class="pi pi-search" />
          <InputText
            ref="searchInputRef"
            v-model="query"
            class="w-full"
            :placeholder="t('iconPicker.search', 'Search icons…')"
            autocomplete="off"
          />
        </IconField>

        <div
          class="crm-icon-picker__grid"
          role="listbox"
          :aria-label="t('iconPicker.list', 'Icons')"
        >
          <button
            v-for="name in filteredIcons"
            :key="name"
            type="button"
            class="crm-icon-picker__item"
            :class="{ 'crm-icon-picker__item--selected': name === selectedName }"
            role="option"
            :aria-selected="name === selectedName"
            :title="name"
            @click="selectIcon(name)"
          >
            <i :class="toPrimeIconClass(name)" aria-hidden="true" />
          </button>
        </div>

        <p
          v-if="filteredIcons.length === 0"
          class="crm-icon-picker__empty text-muted-color m-0"
        >
          {{ t('iconPicker.noResults', 'No icons match your search.') }}
        </p>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.crm-icon-picker__row {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
  width: 100%;
}

.crm-icon-picker__trigger {
  display: inline-flex;
  flex: 1 1 auto;
  gap: 0.5rem;
  justify-content: flex-start;
  min-width: 0;
  width: 100%;
}

.crm-icon-picker__preview {
  flex-shrink: 0;
  font-size: 1.1rem;
  width: 1.25rem;
  text-align: center;
}

.crm-icon-picker__preview--empty {
  opacity: 0.45;
}

.crm-icon-picker__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crm-icon-picker__caret {
  flex-shrink: 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.crm-icon-picker__panel {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: min(22rem, 80vw);
}

.crm-icon-picker__grid {
  display: grid;
  gap: 0.25rem;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  max-height: 16rem;
  overflow: auto;
  padding: 0.15rem;
}

.crm-icon-picker__item {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  font-size: 1.15rem;
  height: 2.25rem;
  justify-content: center;
  padding: 0;
}

.crm-icon-picker__item:hover {
  background: var(--p-content-hover-background, #f1f5f9);
}

.crm-icon-picker__item--selected {
  background: var(--p-highlight-background, #ecfdf5);
  border-color: var(--p-primary-color, #0f766e);
  color: var(--p-primary-color, #0f766e);
}

.crm-icon-picker__empty {
  font-size: 0.85rem;
  padding: 0.5rem 0.15rem;
}
</style>
