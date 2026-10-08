import { watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  isSetupLayoutSection,
  routeQueryCollectionSection,
  type SetupCollectionSection,
} from '../types/setupCollectionSection'

export function useSetupCollectionSectionSync(
  section: Ref<SetupCollectionSection>,
): { syncSectionQuery: () => void } {
  const route = useRoute()
  const router = useRouter()
  let syncing = false

  function applyRouteSection(): void {
    syncing = true
    const requested = routeQueryCollectionSection(route)
    if (requested !== section.value) {
      section.value = requested
    }
    syncing = false
  }

  function syncSectionQuery(): void {
    if (syncing) return

    const next = section.value
    const currentSection =
      typeof route.query.section === 'string' ? route.query.section : ''
    if (
      currentSection === next
      && route.query.layoutType == null
      && route.query.mode == null
    ) {
      return
    }

    void router.replace({
      query: {
        ...route.query,
        section: next,
        layoutType: undefined,
        mode: undefined,
      },
    })
  }

  watch(section, () => {
    syncSectionQuery()
  })

  watch(
    () => [route.query.section, route.query.layoutType, route.query.mode],
    () => {
      applyRouteSection()
    },
    { immediate: true },
  )

  return { syncSectionQuery }
}

export function sectionIsLayout(section: SetupCollectionSection): boolean {
  return isSetupLayoutSection(section)
}
