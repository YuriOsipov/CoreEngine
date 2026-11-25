<script lang="ts">
export default {
  name: 'CompactRecordTooltip',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Dropdown as FloatingDropdown } from 'floating-vue'
import type { CompactRecordDetailsRuntime } from '../services/recordDetails'
import { tooltipRelatedListRoute } from '@/core/compactRecordRoutes'

const props = withDefaults(
  defineProps<{
    runtime?: CompactRecordDetailsRuntime | null
    loading?: boolean
    error?: string | null
    /**
     * Compact Layout output views:
     * - `tooltip` = stacked label/value (hover)
     * - `panel` = multi-row grid using field spans
     * - `inline` = single-line header strip
     */
    variant?: 'tooltip' | 'panel' | 'inline'
    /** When true, render values only (no field labels). */
    hideLabels?: boolean
  }>(),
  {
    variant: 'tooltip',
    hideLabels: false,
  },
)

/** Compact highlights: first logical line only; full text in hover hint. */
function compactValueDisplay(value: string): {
  preview: string
  full: string
  showHint: boolean
} {
  const full = value ?? ''
  if (!full || full === '-') {
    return { preview: full || '-', full: full || '-', showHint: false }
  }
  const firstLine = (full.split(/\r?\n/, 1)[0] ?? full).trimEnd()
  const preview = firstLine.length > 0 ? firstLine : full
  return {
    preview,
    full,
    showHint: preview !== full,
  }
}

function fieldGridStyle(span?: number): Record<string, string> | undefined {
  if (props.variant !== 'panel') return undefined
  const resolved = Math.min(12, Math.max(1, span ?? 12))
  return { gridColumn: `span ${resolved}` }
}

const panelFields = computed(() =>
  (props.runtime?.fields ?? []).map((field) => ({
    ...field,
    display: compactValueDisplay(field.value),
  })),
)

const isPanelLike = computed(
  () => props.variant === 'panel' || props.variant === 'inline',
)
</script>

<template>
  <div
    class="compact-record"
    :class="{
      'compact-record--tooltip': variant === 'tooltip',
      'compact-record--panel': variant === 'panel',
      'compact-record--inline': variant === 'inline',
    }"
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
          v-for="field in panelFields"
          :key="field.id"
          class="compact-record__field"
          :class="{ 'compact-record__field--values-only': hideLabels }"
          :style="fieldGridStyle(field.span)"
        >
          <dt
            v-if="!hideLabels"
            class="compact-record__label"
          >{{ field.label }}</dt>
          <dd class="compact-record__value">
            <template v-if="isPanelLike">
              <FloatingDropdown
                v-if="field.display.showHint"
                theme="compact-record"
                placement="bottom-start"
                :distance="8"
                :delay="{ show: 250, hide: 150 }"
                :triggers="['hover', 'focus']"
                :popper-triggers="['hover']"
              >
                <span class="compact-record__value-text compact-record__value-text--single-line">
                  {{ field.display.preview }}…
                </span>
                <template #popper>
                  <div class="compact-record__hint max-w-md whitespace-pre-wrap break-words p-3 text-sm leading-relaxed">
                    {{ field.display.full }}
                  </div>
                </template>
              </FloatingDropdown>
              <span
                v-else
                class="compact-record__value-text compact-record__value-text--single-line"
                :title="field.value.length > 48 ? field.value : undefined"
              >{{ field.display.preview }}</span>
            </template>
            <template v-else>{{ field.value }}</template>
          </dd>
        </div>
      </dl>

      <p
        v-if="runtime.fields.length === 0 && runtime.relatedCounts.length === 0"
        class="m-0 text-muted-color"
      >
        Compact details are empty.
      </p>

      <div
        v-if="variant === 'tooltip' && runtime.relatedCounts.length > 0"
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
  color: var(--app-text, var(--p-text-color));
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
  background: var(--p-highlight-background);
  color: var(--p-highlight-color, var(--p-primary-color));
  padding: 0.25rem 0.55rem;
}

.compact-record--panel {
  width: 100%;
  color: var(--app-text, var(--p-text-color));
  font-size: 0.875rem;
}

.compact-record--panel .compact-record__fields {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.45rem 0.75rem;
  align-items: start;
}

.compact-record--panel .compact-record__field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.compact-record--panel .compact-record__field--values-only {
  min-width: 0;
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
  min-width: 0;
}

.compact-record--panel .compact-record__value-text--single-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  background: var(--p-highlight-background);
  color: var(--p-highlight-color, var(--p-primary-color));
  padding: 0.25rem 0.55rem;
  font-size: 0.8rem;
}

/* Single-line header strip (Highlights). */
.compact-record--inline {
  width: 100%;
  color: var(--app-text, var(--p-text-color));
  font-size: 0.875rem;
  min-width: 0;
}

.compact-record--inline .compact-record__fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.55rem 1.75rem;
  min-width: 0;
  padding-top: 0.15rem;
}

.compact-record--inline .compact-record__field {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  flex: 0 1 auto;
  max-width: 16rem;
  min-width: 0;
}

.compact-record--inline .compact-record__field--values-only {
  max-width: 14rem;
}

.compact-record--inline .compact-record__label {
  color: var(--app-text-muted, var(--p-text-muted-color));
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  text-transform: uppercase;
  white-space: nowrap;
}

.compact-record--inline .compact-record__value {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  min-width: 0;
}

.compact-record--inline .compact-record__value-text--single-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 12rem;
}
</style>
