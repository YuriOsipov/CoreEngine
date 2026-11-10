import type { LayoutFieldMetadata } from '@/interfaces'
import { formatDateValue } from '@/core/dateFormatting'
import { formatAddressMultiline } from '@/core/addressField'
import {
  isAddressField,
  isRelatedValueField,
  relatedFieldRelationId,
  formatChoiceValue,
  formatFieldDisplayValue,
} from '@/core/fieldHelpers'
import {
  formatNumberDisplayValue,
  relatedRecordFallbackLabel,
} from '@/modules/entities/utils/recordDisplay'
import { useDateDisplayFormats } from '@/core/useDateDisplayFormats'
import { useNumberDisplayOptions } from '@/core/useNumberDisplayOptions'
import { useRelatedDisplayLabels } from '@/core/useRelatedDisplayLabels'
import { useChoiceDisplayLabels } from '@/core/useChoiceDisplayLabels'

export function useFieldDisplay(entity: () => string) {
  const dateFormats = useDateDisplayFormats(entity)
  const numberDisplay = useNumberDisplayOptions(entity)
  const relatedDisplay = useRelatedDisplayLabels(entity)
  const choiceDisplay = useChoiceDisplayLabels(entity)

  function sync(
    fields: LayoutFieldMetadata[],
    getValue: (f: LayoutFieldMetadata) => unknown,
  ): void {
    void dateFormats.sync(fields)
    void numberDisplay.sync(fields)
    relatedDisplay.sync(fields, getValue)
    choiceDisplay.sync(fields)
  }

  function displayValue(field: LayoutFieldMetadata, rawValue: unknown): string {
    if (isAddressField(field)) return formatAddressMultiline(rawValue)

    const dateFormat = dateFormats.formats[field.field]
    if (dateFormat) return formatDateValue(rawValue, dateFormat)

    if (isRelatedValueField(field, rawValue)) {
      const relationId = relatedFieldRelationId(rawValue)
      if (relationId === null) return '-'

      // Prefer async labels (entity display_template). Nested M2O payloads often
      // only include the default name field, which must not win over the template.
      const key = relatedDisplay.cacheKey(field, relationId)
      if (relatedDisplay.keys[field.field] === key) {
        const resolved = relatedDisplay.labels[field.field]
        if (resolved) return resolved
      }

      if (rawValue && typeof rawValue === 'object') {
        const inlineLabel = relatedRecordFallbackLabel(rawValue, relationId)
        if (inlineLabel && inlineLabel !== String(relationId)) {
          return inlineLabel
        }
      }

      return relatedDisplay.keys[field.field] === key
        ? relatedDisplay.labels[field.field] || '-'
        : '-'
    }

    const choiceLabels = choiceDisplay.labels[field.field]
    if (choiceLabels) return formatChoiceValue(rawValue, choiceLabels, formatFieldDisplayValue)

    const numberOpts = numberDisplay.options[field.field]
    if (numberOpts) {
      const formatted = formatNumberDisplayValue(rawValue, numberOpts)
      if (formatted !== null) return formatted
    }

    return formatFieldDisplayValue(rawValue)
  }

  return { sync, displayValue }
}
