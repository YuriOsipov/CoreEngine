<script lang="ts">
export default {
  name: 'AppearanceMenu',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type Popover from 'openvue/popover'
import { useTranslation } from '@/core/translation'
import {
  COLOR_SCHEME_PREFERENCES,
  OPEN_VUE_PRESET_IDS,
  useAppearance,
  type ColorSchemePreference,
  type OpenVuePresetId,
  type PrimaryColorId,
  type SurfaceColorId,
} from '@/core/theme/appearance'
import {
  PRIMARY_COLORS,
  SURFACE_COLORS,
} from '@/core/theme/appearancePalettes'

const { t } = useTranslation()
const {
  preset,
  colorScheme,
  primary,
  surface,
  isDark,
  setPreset,
  setColorScheme,
  setPrimaryColor,
  setSurfaceColor,
} = useAppearance()
const popover = ref<InstanceType<typeof Popover> | null>(null)

const presetOptions = computed(() =>
  OPEN_VUE_PRESET_IDS.map((id) => ({
    value: id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  })),
)

const colorSchemeOptions = computed(() =>
  COLOR_SCHEME_PREFERENCES.map((value) => ({
    value,
    icon:
      value === 'dark' ? 'pi pi-moon' : value === 'system' ? 'pi pi-desktop' : 'pi pi-sun',
    label: t(
      value === 'dark'
        ? 'app.colorSchemeDark'
        : value === 'system'
          ? 'app.colorSchemeSystem'
          : 'app.colorSchemeLight',
      value === 'dark' ? 'Dark' : value === 'system' ? 'System' : 'Light',
    ),
  })),
)

const toggleLabel = computed(() => t('app.appearance', 'Appearance'))

function toggle(event: Event): void {
  popover.value?.toggle(event)
}

function onPreset(value: OpenVuePresetId | null): void {
  if (value) void setPreset(value)
}

function onColorScheme(value: ColorSchemePreference | null): void {
  if (value) setColorScheme(value)
}

function onPrimary(value: PrimaryColorId): void {
  setPrimaryColor(value)
}

function onSurface(value: SurfaceColorId): void {
  setSurfaceColor(value)
}
</script>

<template>
  <Button
    type="button"
    :icon="isDark ? 'pi pi-moon' : 'pi pi-sun'"
    text
    rounded
    severity="secondary"
    class="appearance-menu__trigger"
    :aria-label="toggleLabel"
    :title="toggleLabel"
    aria-haspopup="dialog"
    @click="toggle"
  />
  <Popover
    ref="popover"
    class="appearance-menu__popover"
  >
    <div class="appearance-menu__panel">
      <div class="appearance-menu__field">
        <span class="appearance-menu__label">
          {{ t('app.primary', 'Primary') }}
        </span>
        <div
          class="appearance-menu__swatches"
          role="listbox"
          :aria-label="t('app.primary', 'Primary')"
        >
          <button
            v-for="color in PRIMARY_COLORS"
            :key="color.name"
            type="button"
            role="option"
            class="appearance-menu__swatch"
            :class="{
              'appearance-menu__swatch--selected': primary === color.name,
              'appearance-menu__swatch--noir': color.name === 'noir',
            }"
            :style="
              color.name === 'noir'
                ? undefined
                : { background: color.swatch }
            "
            :aria-selected="primary === color.name"
            :title="color.name"
            :aria-label="color.name"
            @click="onPrimary(color.name)"
          />
        </div>
      </div>

      <div class="appearance-menu__field">
        <span class="appearance-menu__label">
          {{ t('app.surface', 'Surface') }}
        </span>
        <div
          class="appearance-menu__swatches"
          role="listbox"
          :aria-label="t('app.surface', 'Surface')"
        >
          <button
            v-for="color in SURFACE_COLORS"
            :key="color.name"
            type="button"
            role="option"
            class="appearance-menu__swatch"
            :class="{ 'appearance-menu__swatch--selected': surface === color.name }"
            :style="{ background: color.swatch }"
            :aria-selected="surface === color.name"
            :title="color.name"
            :aria-label="color.name"
            @click="onSurface(color.name)"
          />
        </div>
      </div>

      <div class="appearance-menu__field">
        <span class="appearance-menu__label">
          {{ t('app.theme', 'Theme') }}
        </span>
        <SelectButton
          class="appearance-menu__choices"
          :model-value="preset"
          :options="presetOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          :aria-label="t('app.theme', 'Theme')"
          @update:model-value="onPreset"
        />
      </div>

      <div class="appearance-menu__field">
        <span class="appearance-menu__label">
          {{ t('app.colorScheme', 'Color scheme') }}
        </span>
        <SelectButton
          class="appearance-menu__choices"
          :model-value="colorScheme"
          :options="colorSchemeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          :aria-label="t('app.colorScheme', 'Color scheme')"
          @update:model-value="onColorScheme"
        >
          <template #option="{ option }">
            <span class="appearance-menu__option">
              <i :class="option.icon" />
              <span>{{ option.label }}</span>
            </span>
          </template>
        </SelectButton>
      </div>
    </div>
  </Popover>
</template>

<style scoped>
.appearance-menu__trigger {
  height: 2.15rem;
  width: 2.15rem;
}

.appearance-menu__panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 18rem;
  max-width: 22rem;
}

.appearance-menu__field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.appearance-menu__label {
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.appearance-menu__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.appearance-menu__swatch {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--p-content-border-color, #e2e8f0) 70%, transparent);
  padding: 0;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  transition: box-shadow 0.12s, transform 0.12s;
}

.appearance-menu__swatch:hover {
  transform: scale(1.08);
}

.appearance-menu__swatch--selected {
  box-shadow:
    0 0 0 2px var(--p-content-background, #fff),
    0 0 0 3.5px var(--p-primary-color, #10b981);
}

.appearance-menu__swatch--noir {
  background: linear-gradient(
    135deg,
    #ffffff 49.5%,
    #020617 50.5%
  );
}

.appearance-menu__option {
  align-items: center;
  display: inline-flex;
  gap: 0.35rem;
}

.appearance-menu__choices {
  display: flex;
  width: 100%;
}

.appearance-menu__choices :deep(.p-togglebutton) {
  flex: 1 1 auto;
  justify-content: center;
}
</style>
