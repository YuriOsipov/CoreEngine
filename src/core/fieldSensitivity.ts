import { t } from '@/core/translation'

/** Field-level security tiers (fields.sensitivity / role max_*_sensitivity). */
export const SENSITIVITY_NONE = 0
export const SENSITIVITY_RESTRICTED = 1
export const SENSITIVITY_CONFIDENTIAL = 2

export interface SensitivityOption {
  label: string
  value: number
}

export function clampSensitivity(value: unknown): number {
  const num = Math.trunc(Number(value))
  if (!Number.isFinite(num) || num <= 0) return SENSITIVITY_NONE
  return Math.min(num, SENSITIVITY_CONFIDENTIAL)
}

export function sensitivityOptions(): SensitivityOption[] {
  return [
    { label: t('fieldSensitivity.none', 'None'), value: SENSITIVITY_NONE },
    { label: t('fieldSensitivity.restricted', 'Restricted'), value: SENSITIVITY_RESTRICTED },
    {
      label: t('fieldSensitivity.confidential', 'Confidential'),
      value: SENSITIVITY_CONFIDENTIAL,
    },
  ]
}

/** Options for a role's edit tier, which can never exceed its read tier. */
export function editSensitivityOptions(maxRead: number): SensitivityOption[] {
  return sensitivityOptions().filter((option) => option.value <= maxRead)
}
