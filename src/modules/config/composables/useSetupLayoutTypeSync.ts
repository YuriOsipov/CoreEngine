import { watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  DEFAULT_SETUP_LAYOUT_TYPE,
  routeQueryLayoutType,
  type SetupLayoutType,
} from '../types/setupLayoutType'

export function useSetupLayoutTypeSync(layoutType: Ref<SetupLayoutType>): {
  syncLayoutTypeQuery: () => void
} {
  const route = useRoute()
  const router = useRouter()
  let syncing = false

  function applyRouteLayoutType(): void {
    syncing = true
    const requested = routeQueryLayoutType(route)
    if (requested !== layoutType.value) {
      layoutType.value = requested
    }
    syncing = false
  }

  function syncLayoutTypeQuery(): void {
    if (syncing) return

    const current =
      typeof route.query.layoutType === 'string'
        ? route.query.layoutType
        : ''
    const next = layoutType.value

    if (current === next) return

    void router.replace({
      query: {
        ...route.query,
        layoutType: next === DEFAULT_SETUP_LAYOUT_TYPE ? undefined : next,
      },
    })
  }

  watch(layoutType, () => {
    syncLayoutTypeQuery()
  })

  watch(
    () => route.query.layoutType,
    () => {
      applyRouteLayoutType()
    },
    { immediate: true },
  )

  return { syncLayoutTypeQuery }
}
