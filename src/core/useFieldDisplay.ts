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
import { relatedRecordFallbackLabel } from '@/modules/entities/utils/recordDisplay'
import { useDateDisplayFormats } from '@/core/useDateDisplayFormats'
import { useRelatedDisplayLabels } from '@/core/useRelatedDisplayLabels'
import { useChoiceDisplayLabels } from '@/core/useChoiceDisplayLabels'

export function useFieldDisplay(entity: () => string) {
  const dateFormats = useDateDisplayFormats(entity)
  const relatedDisplay = useRelatedDisplayLabels(entity)
  const choiceDisplay = useChoiceDisplayLabels(entity)

  function sync(
    fields: LayoutFieldMetadata[],
    getValue: (f: LayoutFieldMetadata) => unknown,
  ): void {
    void dateFormats.sync(fields)
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

      if (rawValue && typeof rawValue === 'object') {
        const inlineLabel = relatedRecordFallbackLabel(rawValue, relationId)
        if (inlineLabel && inlineLabel !== String(relationId)) {
          return inlineLabel
        }
      }

      const key = relatedDisplay.cacheKey(field, relationId)
      if (relatedDisplay.keys[field.field] === key) {
        return relatedDisplay.labels[field.field] || '-'
      }
      return '-'
    }

    const choiceLabels = choiceDisplay.labels[field.field]
    if (choiceLabels) return formatChoiceValue(rawValue, choiceLabels, formatFieldDisplayValue)

    return formatFieldDisplayValue(rawValue)
  }

  return { sync, displayValue }
}
