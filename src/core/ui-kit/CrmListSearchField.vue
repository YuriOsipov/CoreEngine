<script lang="ts">
export default {
  name: 'CrmListSearchField',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslation } from '@/core/translation'

const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    placeholder: undefined,
    disabled: false,
  },
)

const emit = defineEmits<{
  search: [query: string]
  clear: []
}>()

const { t } = useTranslation()

const hasValue = computed(() => model.value.trim().length > 0)

function submit(): void {
  emit('search', model.value.trim())
}

function clear(): void {
  model.value = ''
  emit('clear')
}
</script>

<template>
  <div class="crm-list-search-field">
    <IconField class="w-full">
      <InputIcon class="pi pi-search" />
      <InputText
        v-model="model"
        size="small"
        class="w-full"
        :placeholder="
          placeholder
            ?? t('objectList.searchThisList', 'Search this list…')
        "
        :disabled="disabled"
        :aria-label="
          t('objectList.searchThisList', 'Search this list…')
        "
        @keydown.enter.prevent="submit"
      />
    </IconField>
    <Button
      v-if="hasValue"
      type="button"
      icon="pi pi-times"
      text
      rounded
      size="small"
      severity="secondary"
      class="crm-list-search-field__clear"
      :disabled="disabled"
      :aria-label="t('objectList.clearSearch', 'Clear search')"
      @click="clear"
    />
  </div>
</template>

<style scoped>
.crm-list-search-field {
  align-items: center;
  display: flex;
  gap: 0.15rem;
  min-width: 12rem;
  width: 14rem;
}

.crm-list-search-field__clear {
  flex-shrink: 0;
  height: 1.75rem;
  width: 1.75rem;
}
</style>
