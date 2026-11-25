import { computed, ref } from 'vue'
import {
  updatePreset,
  updateSurfacePalette,
  usePreset,
} from '@openvue/themes'
import {
  findSurfaceColor,
  isPrimaryColorId,
  isSurfaceColorId,
  primaryPresetExtension,
  type PrimaryColorId,
  type SurfaceColorId,
} from './appearancePalettes'

/** Keep in sync with the flash-prevention script in index.html. */
export const APPEARANCE_STORAGE_KEY = 'crm.appearance'
export const DARK_MODE_CLASS = 'app-dark'

export const OPEN_VUE_PRESET_IDS = ['aura', 'lara', 'material', 'nora'] as const
export const COLOR_SCHEME_PREFERENCES = ['light', 'dark', 'system'] as const

export type OpenVuePresetId = (typeof OPEN_VUE_PRESET_IDS)[number]
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number]
export type { PrimaryColorId, SurfaceColorId }

export interface AppearanceSettings {
  preset: OpenVuePresetId
  colorScheme: ColorSchemePreference
  primary: PrimaryColorId
  surface: SurfaceColorId
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: 'aura',
  colorScheme: 'system',
  primary: 'emerald',
  surface: 'zinc',
}

type ThemePreset = Awaited<typeof import('@openvue/themes/aura')>['default']

const presetLoaders: Record<OpenVuePresetId, () => Promise<ThemePreset>> = {
  aura: () => import('@openvue/themes/aura').then((mod) => mod.default),
  lara: () => import('@openvue/themes/lara').then((mod) => mod.default),
  material: () => import('@openvue/themes/material').then((mod) => mod.default),
  nora: () => import('@openvue/themes/nora').then((mod) => mod.default),
}

const presetCache = new Map<OpenVuePresetId, ThemePreset>()
const appearance = ref<AppearanceSettings>(DEFAULT_APPEARANCE)
const systemDark = ref(false)
let activePreset: OpenVuePresetId | null = null
let systemWatcherStarted = false

export function parseAppearance(raw: string | null): AppearanceSettings {
  if (!raw) return { ...DEFAULT_APPEARANCE }
  try {
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>
    const preset = OPEN_VUE_PRESET_IDS.includes(parsed.preset as OpenVuePresetId)
      ? (parsed.preset as OpenVuePresetId)
      : DEFAULT_APPEARANCE.preset
    const colorScheme = COLOR_SCHEME_PREFERENCES.includes(
      parsed.colorScheme as ColorSchemePreference,
    )
      ? (parsed.colorScheme as ColorSchemePreference)
      : DEFAULT_APPEARANCE.colorScheme
    const primary = isPrimaryColorId(parsed.primary)
      ? parsed.primary
      : DEFAULT_APPEARANCE.primary
    const surface = isSurfaceColorId(parsed.surface)
      ? parsed.surface
      : DEFAULT_APPEARANCE.surface
    return { preset, colorScheme, primary, surface }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function readAppearance(): AppearanceSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_APPEARANCE }
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveDark(
  colorScheme: ColorSchemePreference,
  systemDark = systemPrefersDark(),
): boolean {
  if (colorScheme === 'dark') return true
  if (colorScheme === 'light') return false
  return systemDark
}

export function applyColorScheme(colorScheme: ColorSchemePreference): void {
  if (typeof document === 'undefined') return
  systemDark.value = systemPrefersDark()
  document.documentElement.classList.toggle(
    DARK_MODE_CLASS,
    resolveDark(colorScheme, systemDark.value),
  )
}

export async function loadPreset(preset: OpenVuePresetId): Promise<ThemePreset> {
  const cached = presetCache.get(preset)
  if (cached) return cached
  const loaded = await presetLoaders[preset]()
  presetCache.set(preset, loaded)
  return loaded
}

function persist(next: AppearanceSettings): void {
  appearance.value = next
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode or a full quota: keep the in-memory choice for this session.
  }
}

function applyPrimaryPalette(primary: PrimaryColorId): void {
  updatePreset(primaryPresetExtension(primary))
}

function applySurfacePalette(surface: SurfaceColorId): void {
  updateSurfacePalette(findSurfaceColor(surface).palette)
}

/** Re-apply Primary + Surface after a full preset swap (or on startup). */
export function applyAppearancePalettes(
  settings: Pick<AppearanceSettings, 'primary' | 'surface'> = appearance.value,
): void {
  applyPrimaryPalette(settings.primary)
  applySurfacePalette(settings.surface)
}

export async function setPreset(preset: OpenVuePresetId): Promise<void> {
  if (!OPEN_VUE_PRESET_IDS.includes(preset)) return
  persist({ ...appearance.value, preset })
  if (activePreset === preset) return
  const loaded = await loadPreset(preset)
  if (appearance.value.preset !== preset) return
  usePreset(loaded)
  activePreset = preset
  applyAppearancePalettes(appearance.value)
}

export function setColorScheme(colorScheme: ColorSchemePreference): void {
  if (!COLOR_SCHEME_PREFERENCES.includes(colorScheme)) return
  persist({ ...appearance.value, colorScheme })
  applyColorScheme(colorScheme)
}

export function setPrimaryColor(primary: PrimaryColorId): void {
  if (!isPrimaryColorId(primary)) return
  persist({ ...appearance.value, primary })
  applyPrimaryPalette(primary)
}

export function setSurfaceColor(surface: SurfaceColorId): void {
  if (!isSurfaceColorId(surface)) return
  persist({ ...appearance.value, surface })
  applySurfacePalette(surface)
}

/** Call once at startup, after the saved preset has been passed to OpenVue. */
export function markPresetApplied(preset: OpenVuePresetId): void {
  activePreset = preset
  appearance.value = readAppearance()
  applyAppearancePalettes(appearance.value)
}

export function watchSystemColorScheme(): void {
  if (systemWatcherStarted) return
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  systemWatcherStarted = true
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = media.matches
  const onChange = (): void => {
    systemDark.value = media.matches
    if (appearance.value.colorScheme === 'system') applyColorScheme('system')
  }
  media.addEventListener('change', onChange)
}

export function useAppearance() {
  return {
    preset: computed(() => appearance.value.preset),
    colorScheme: computed(() => appearance.value.colorScheme),
    primary: computed(() => appearance.value.primary),
    surface: computed(() => appearance.value.surface),
    isDark: computed(() => resolveDark(appearance.value.colorScheme, systemDark.value)),
    setPreset,
    setColorScheme,
    setPrimaryColor,
    setSurfaceColor,
  }
}
