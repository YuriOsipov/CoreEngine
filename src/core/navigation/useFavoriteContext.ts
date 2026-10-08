import { ref } from 'vue'
import type { NavTarget } from '@/interfaces'

export interface FavoriteContext {
  /** Suggested label pre-filled in the prompt dialog. */
  defaultLabel: string
  /** Target to store when the user confirms. */
  target: NavTarget
}

/** Module-level singleton: any page sets this while it is mounted. */
const context = ref<FavoriteContext | null>(null)

export function useFavoriteContext() {
  function setFavoriteContext(value: FavoriteContext): void {
    context.value = value
  }

  function clearFavoriteContext(): void {
    context.value = null
  }

  return {
    context,
    setFavoriteContext,
    clearFavoriteContext,
  }
}
