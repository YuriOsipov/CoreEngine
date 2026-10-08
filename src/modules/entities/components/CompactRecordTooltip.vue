<script lang="ts">
export default {
  name: 'CompactRecordTooltip',
}
</script>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { CompactRecordDetailsRuntime } from '../services/recordDetails'
import { tooltipRelatedListRoute } from '@/core/compactRecordRoutes'

const props = withDefaults(
  defineProps<{
    runtime?: CompactRecordDetailsRuntime | null
    loading?: boolean
    error?: string | null
    /** `tooltip` = stacked label/value (hover). `panel` = Salesforce-style inline highlights. */
    variant?: 'tooltip' | 'panel'
  }>(),
  {
    variant: 'tooltip',
  },
)
</script>

<template>
  <div
    class="compact-record"
    :class="variant === 'panel' ? 'compact-record--panel' : 'compact-record--tooltip'"
  >
    <p
      v-if="loading"
      class="m-0 text-muted-color"
    >
      Loading details...
    </p>

    <p
      v-else-if="error"
      class="m-0 text-red-600"
    >
      {{ error }}
    </p>

    <p
      v-else-if="!runtime?.schema"
      class="m-0 text-muted-color"
    >
      No compact details configured.
    </p>

    <template v-else>
      <dl
        v-if="runtime.fields.length > 0"
        class="compact-record__fields m-0"
      >
        <div
          v-for="field in runtime.fields"
          :key="field.id"
          class="compact-record__field"
        >
          <dt class="compact-record__label">{{ field.label }}</dt>
          <dd class="compact-record__value">{{ field.value }}</dd>
        </div>
      </dl>

      <p
        v-if="runtime.fields.length === 0 && runtime.relatedCounts.length === 0"
        class="m-0 text-muted-color"
      >
        Compact details are empty.
      </p>

      <div
        v-if="variant !== 'panel' && runtime.relatedCounts.length > 0"
        class="compact-record__counts"
      >
        <div
          v-for="item in runtime.relatedCounts"
          :key="item.id"
          class="compact-record__count"
        >
          <RouterLink
            :to="tooltipRelatedListRoute(props.runtime, item.relatedCollection)"
            target="_blank"
            class="text-inherit font-semibold no-underline hover:underline"
          >
            {{ item.label }}
          </RouterLink>
          <strong>{{ item.count }}</strong>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.compact-record--tooltip {
  display: grid;
  gap: 0.65rem;
  min-width: 240px;
  max-width: 340px;
  color: var(--p-surface-900);
  font-size: 0.85rem;
}

.compact-record--tooltip .compact-record__fields {
  display: grid;
  gap: 0.35rem 0.75rem;
}

.compact-record--tooltip .compact-record__field {
  display: grid;
  grid-template-columns: minmax(80px, max-content) 1fr;
  gap: 0.75rem;
}

.compact-record--tooltip .compact-record__label {
  color: var(--p-text-muted-color);
  font-weight: 600;
}

.compact-record--tooltip .compact-record__value {
  margin: 0;
  overflow-wrap: anywhere;
}

.compact-record--tooltip .compact-record__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.compact-record--tooltip .compact-record__count {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  background: var(--p-primary-50);
  color: #1e40af;
  padding: 0.25rem 0.55rem;
}

.compact-record--panel {
  width: 100%;
  color: var(--p-surface-900);
  font-size: 0.875rem;
}

.compact-record--panel .compact-record__fields {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.75rem;
  align-items: flex-start;
}

.compact-record--panel .compact-record__field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 7.5rem;
  max-width: 16rem;
  flex: 0 1 auto;
}

.compact-record--panel .compact-record__label {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.2;
}

.compact-record--panel .compact-record__value {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.compact-record--panel .compact-record__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.85rem;
}

.compact-record--panel .compact-record__count {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  background: var(--p-primary-50);
  color: #1e40af;
  padding: 0.25rem 0.55rem;
  font-size: 0.8rem;
}
</style>
