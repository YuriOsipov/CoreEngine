<script lang="ts">
export default {
  name: 'CrmAddressField',
  inheritAttrs: false,
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ADDRESS_SUB_FIELDS,
  normalizeAddressValue,
  type AddressSubFieldKey,
  type AddressValue,
} from '@/core/addressField'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    modelValue?: unknown
    disabled?: boolean
    readonly?: boolean
    inputId?: string
  }>(),
  {
    modelValue: null,
    disabled: false,
    readonly: false,
    inputId: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: AddressValue]
}>()

const { t } = useTranslation()

const value = computed(() => normalizeAddressValue(props.modelValue))

const locked = computed(() => props.disabled || props.readonly)

const subFieldLabels: Record<AddressSubFieldKey, string> = {
  address: t('address.street', 'Street'),
  city: t('address.city', 'City'),
  state: t('address.state', 'State/Province'),
  postCode: t('address.postCode', 'Zip/Postal Code'),
  country: t('address.country', 'Country'),
}

function inputIdFor(key: AddressSubFieldKey): string {
  return props.inputId ? `${props.inputId}_${key}` : key
}

function updateSubField(key: AddressSubFieldKey, next: string | undefined): void {
  if (locked.value) return
  emit('update:modelValue', {
    ...value.value,
    [key]: next ?? '',
  })
}
</script>

<template>
  <div class="crm-address-field grid grid-cols-12 gap-3 w-full">
    <div
      v-for="key in ADDRESS_SUB_FIELDS"
      :key="key"
      class="flex flex-col gap-1"
      :class="key === 'address' ? 'col-span-12' : 'col-span-12 md:col-span-6'"
    >
      <label
        class="text-[0.8rem] text-surface-600"
        :for="inputIdFor(key)"
      >
        {{ subFieldLabels[key] }}
      </label>
      <InputText
        :id="inputIdFor(key)"
        :model-value="value[key]"
        fluid
        :disabled="locked"
        :readonly="readonly"
        autocomplete="off"
        @update:model-value="updateSubField(key, $event)"
      />
    </div>
  </div>
</template>
