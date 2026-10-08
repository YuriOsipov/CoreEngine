import { reactive } from 'vue'
import {
  fetchCompactRecordDetails,
  type CompactRecordDetailsRuntime,
} from '@/modules/entities/services/recordDetails'
import type { LayoutFieldMetadata } from '@/interfaces'
import { relatedFieldValue } from '@/core/fieldHelpers'

export interface CompactTooltipRuntimeState {
  loading: boolean
  error: string | null
  runtime: CompactRecordDetailsRuntime | null
}

export function useCompactTooltip() {
  const runtime = reactive<Record<string, CompactTooltipRuntimeState>>({})

  function cacheKey(collection: string, id: string | number): string {
    return `${collection}.${id}`
  }

  function getState(
    collection: string,
    id: string | number,
  ): CompactTooltipRuntimeState | null {
    return runtime[cacheKey(collection, id)] ?? null
  }

  async function load(collection: string, id: string | number): Promise<void> {
    const key = cacheKey(collection, id)
    const existing = runtime[key]
    if (existing?.loading || existing?.runtime || existing?.error) return

    runtime[key] = { loading: true, error: null, runtime: null }
    try {
      runtime[key].runtime = await fetchCompactRecordDetails(collection, id)
    } catch (err) {
      runtime[key].error = err instanceof Error ? err.message : 'Failed to load compact details.'
    } finally {
      runtime[key].loading = false
    }
  }

  function getStateForField(
    field: LayoutFieldMetadata,
    rawValue: unknown,
  ): CompactTooltipRuntimeState | null {
    const value = relatedFieldValue(field, rawValue)
    if (value === null || !field.relatedCollection) return null
    return getState(field.relatedCollection, value)
  }

  async function loadForField(field: LayoutFieldMetadata, rawValue: unknown): Promise<void> {
    const value = relatedFieldValue(field, rawValue)
    if (value === null || !field.relatedCollection) return
    await load(field.relatedCollection, value)
  }

  return { cacheKey, getState, load, getStateForField, loadForField }
}
