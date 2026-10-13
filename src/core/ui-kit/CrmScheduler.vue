<script lang="ts">
export default {
  name: 'CrmScheduler',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import {
  DayPilot,
  DayPilotCalendar,
  DayPilotScheduler,
} from '@daypilot/daypilot-lite-vue'
import RecordCreateDialog from '@/modules/entities/components/RecordCreateDialog.vue'
import RecordEditDialog from '@/modules/entities/components/RecordEditDialog.vue'
import {
  fetchChoiceLabelMap,
  getCachedFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  archiveObjectRecord,
  fetchCompactRecordDetails,
  updateObjectRecord,
  type CompactRecordDetailsRuntime,
} from '@/modules/entities/services/recordDetails'
import { normalizeSchedulerSettings } from '@/modules/config/services/schedulerSettings'
import { useTranslation } from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'
import {
  defaultDateDisplayFormat,
  defaultDateTimeDisplayFormat,
} from '@/core/dateFormatting'
import type {
  SchedulerFilterLevel,
  SchedulerResourceSettings,
  SchedulerSettings,
} from '@/interfaces'
import { bridgeReadItem, bridgeReadItems } from '@/core/graphql/itemsBridge'
import { isVisitAllowed, isoWeekday } from '@/core/scheduleGeneration'
import { expandTemplateEvents } from '@/core/templateEventExpansion'
import {
  buildHierarchyTreeNodes,
  collectTreeNodeAndDescendantKeys,
  type HierarchyTreeNode,
} from '@/core/hierarchyTree'
import {
  extractTemplateFields,
  recordId,
  recordLabel,
  relatedRecordDisplayField,
  relatedRecordFallbackLabel,
  renderTemplateLabel,
  scalarId,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'
import { compactRelatedListHref } from '@/core/compactRecordRoutes'
import { normalizeSpecial } from '@/modules/entities/utils/fieldMapper'

interface SchedulerEventMovePayload {
  e: DayPilot.Event
  newStart: DayPilot.Date
  newEnd: DayPilot.Date
  newResource?: DayPilot.ResourceId
  column?: WeekCalendarColumnRef
}

interface SchedulerRangePayload {
  start: DayPilot.Date
  end: DayPilot.Date
  resource?: DayPilot.ResourceId
  column?: WeekCalendarColumnRef
  control?: {
    clearSelection?: () => void
  }
}

interface WeekCalendarColumnRef {
  id?: DayPilot.ResourceId
  start?: string | { toString: () => string }
  data?: {
    dayKey?: string
    resourceIndex?: number
    isFirstResourceInDay?: boolean
  }
}

type SchedulerEventClickPayload =
  DayPilot.CalendarEventClickArgs |
  DayPilot.SchedulerEventClickArgs

type SchedulerRangeView = 'day' | 'week' | 'month'

interface SchedulerTitleMetadata {
  field: string
  relatedCollection?: string
  template?: string
  displayField?: string
}

interface SchedulerResourceRuntime extends SchedulerResourceSettings {
  key: string
  eventField: string
}

interface ResourceFilterItem {
  id: string
  name: string
  depth: number
  resourceIds: string[]
}

interface CompactTooltipRuntimeState {
  loading: boolean
  error: string | null
  runtime: CompactRecordDetailsRuntime | null
}

interface BubbleLoadArgs {
  async?: boolean
  html?: string
  loaded?: () => void
  source?: {
    data?: {
      tags?: {
        collection?: string
        id?: string | number
      }
    }
    id?: () => string | number
  }
}

const props = defineProps<{
  settings?: SchedulerSettings | null
}>()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()
const { t, i18n } = useTranslation()
registerDayPilotLocales()

const resourcesByKey = ref<Record<string, Record<string, unknown>[]>>({})
const locationRows = ref<Record<string, unknown>[]>([])
const filterTreeRows = ref<Record<string, unknown>[]>([])
const filterTreeSelectedKeys = ref<Record<string, boolean>>({})
const records = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const createDialogVisible = ref(false)
const editDialogVisible = ref(false)
const editRecordId = ref<string | number | null>(null)
const createInitialValues = ref<Record<string, unknown>>({})
const createResourceId = ref<string | number | null>(null)
const createResourceField = ref<string | null>(null)
const createReadonlyFields = ref<string[]>([])
const selectedDate = ref<Date>(new Date())
const rangeView = ref<SchedulerRangeView>('day')
const selectedResourceIds = ref<string[]>([])
const selectedLevelIds = ref<(string | null)[]>([])
const selectedStatusValues = ref<string[]>([])
const schedulerViewport = ref<HTMLElement | null>(null)
const schedulerViewportWidth = ref(0)
const titleMetadata = ref<Record<string, SchedulerTitleMetadata>>({})
const locationMetadata = ref<Record<string, SchedulerTitleMetadata>>({})
const statusChoiceLabels = ref<Record<string, string>>({})
const eventTooltipCache: Record<string, CompactTooltipRuntimeState> = {}
const fallbackTooltip = reactive<{
  visible: boolean
  html: string
  key: string | null
  x: number
  y: number
}>({
  visible: false,
  html: '',
  key: null,
  x: 0,
  y: 0,
})
let loadToken = 0
let availabilityToken = 0
let schedulerResizeObserver: ResizeObserver | null = null
let fallbackTooltipHideTimer: number | null = null

interface AvailabilityTimeWindow {
  start: number
  end: number
}
interface ProviderAvailabilityWindows {
  intake: AvailabilityTimeWindow[]
  block: AvailabilityTimeWindow[]
}
const availabilityByProvider = ref<Map<string, ProviderAvailabilityWindows>>(new Map())
const availabilityVersion = ref(0)
const eventsVersion = ref(0)

const schedulerRowHeaderWidth = 120
const availabilityDisabledColor = '#f1f5f9'
const weekCalendarColumnWidthMin = 88
const weekCalendarHourWidth = 56
const weekCalendarScrollResourceThreshold = 3
const weekCalendarCombinedHeaderHeight = 60
const weekCalendarDayHeaderHeight = 36
// DayPilot Lite does not render column `children`; enable with DayPilot Pro.
const weekCalendarSupportsColumnGroups = false
const eventBubble = createEventBubble()
const hasDayPilotBubble = Boolean(eventBubble)

const normalizedSettings = computed(() =>
  props.settings ? normalizeSchedulerSettings(props.settings) : null,
)
const { canCreate: canCreateEvents, canUpdate: canUpdateEvents, canDelete: canDeleteEvents } =
  useEntityPermissions(() => normalizedSettings.value?.event.collection)
const dayPilotLocale = computed(() =>
  i18n.language.value === 'uk-UA' ? 'uk-ua' : 'en-us',
)
const dayPilotTimeFormat = computed<DayPilot.CalendarConfig['timeFormat']>(() =>
  i18n.language.value === 'uk-UA' ? 'Clock24Hours' : 'Auto',
)
const rangeViewOptions: Array<{ label: string; value: SchedulerRangeView }> = [
  { label: t('scheduler.day', 'Day'), value: 'day' },
  { label: t('scheduler.week', 'Week'), value: 'week' },
  { label: t('scheduler.month', 'Month'), value: 'month' },
]
const resourceDefinitions = computed<SchedulerResourceRuntime[]>(() => {
  const settings = normalizedSettings.value
  if (!settings) return []

  return schedulerResourceDefinitions(settings)
})
const schedulerResourceDefinition = computed(() =>
  resourceDefinitions.value.find(
    (resource) => resource.eventField === normalizedSettings.value?.event.resourceField,
  ) ??
  resourceDefinitions.value[0] ??
  null,
)
const availabilitySettings = computed(() => normalizedSettings.value?.event.availability ?? null)
const eventClickAction = computed(
  () => normalizedSettings.value?.event.clickAction ?? 'openDetails',
)
const allowEventDelete = computed(
  () =>
    normalizedSettings.value?.event.allowDelete === true && canDeleteEvents.value,
)
const useAvailabilityDimming = computed(() => {
  const availability = availabilitySettings.value
  // Template expansion paints virtual capacity — never dim/block cells there or
  // drag-select create cannot span beyond a single free cell.
  if (normalizedSettings.value?.event.sourceMode === 'templateExpansion') {
    return false
  }
  // Never dim/block the scheduler that edits the availability collection itself —
  // its events *are* the availability windows, so guarding it against its own data
  // would make it impossible to move a slot to a provider/time that isn't already
  // covered (chicken-and-egg). The guard still applies elsewhere (e.g. Visit scheduler).
  const editsAvailabilitySource =
    availability?.collection === normalizedSettings.value?.event.collection
  return Boolean(
    availability?.enabled &&
      availability.collection &&
      !editsAvailabilitySource &&
      availability.resourceField &&
      availability.startField &&
      availability.endField &&
      availability.typeField,
  )
})
const resourceBlockTitle = computed(() =>
  normalizedSettings.value?.resource.title?.trim() || t('scheduler.resources', 'Resources'),
)
const locationSettings = computed(() => normalizedSettings.value?.resource.filter ?? null)
const filterLevels = computed<SchedulerFilterLevel[]>(() => locationSettings.value?.levels ?? [])
const locationBlockTitle = computed(() =>
  locationSettings.value?.title?.trim() || t('scheduler.filter', 'Filter'),
)
const useLocationFilter = computed(() => {
  const location = locationSettings.value
  return Boolean(
    location?.enabled &&
      location.collection &&
      location.resourceField &&
      filterLevels.value.length > 0 &&
      filterLevels.value.every((level) => level.groupField),
  )
})
const filterTreeSettings = computed(() => {
  const tree = locationSettings.value?.tree
  if (!tree?.enabled || !tree.parentField) return null
  return tree
})
const filterTreeLevelIndex = computed(() => filterTreeSettings.value?.levelIndex ?? 0)
const useFilterTree = computed(
  () => Boolean(filterTreeSettings.value && useLocationFilter.value),
)
const filterTreeNodes = computed<HierarchyTreeNode[]>(() => {
  if (!useFilterTree.value) return []
  const level = filterLevels.value[filterTreeLevelIndex.value]
  const metadata = level ? locationMetadata.value[level.groupField] : null
  const labelField = metadata?.displayField || 'name'
  return buildHierarchyTreeNodes(filterTreeRows.value, {
    primaryKey: 'id',
    labelField,
    parentField: filterTreeSettings.value?.parentField,
  })
})
const filterTreeMatchIds = computed<Set<string> | null>(() => {
  if (!useFilterTree.value) return null
  const selected = selectedLevelIds.value[filterTreeLevelIndex.value]
  if (selected == null) return null
  return collectTreeNodeAndDescendantKeys(filterTreeNodes.value, selected)
})
const rangeStart = computed(() => {
  if (rangeView.value === 'month') return dateString(monthStart(selectedDate.value))
  if (rangeView.value === 'week') return dateString(weekStart(selectedDate.value))
  return dateString(selectedDate.value)
})
const rangeDays = computed(() => {
  if (rangeView.value === 'month') return daysInMonth(selectedDate.value)
  if (rangeView.value === 'week') return 7
  return 1
})
const resourceItems = computed<DayPilot.ResourceData[]>(() => {
  const resourceDefinition = schedulerResourceDefinition.value
  if (!resourceDefinition) return []

  const rows = resourcesByKey.value[resourceDefinition.key] ?? []
  return rows.reduce<DayPilot.ResourceData[]>((items, resource) => {
    const id = recordId(resource, resourceDefinition.primaryKey)
    if (id === null) return items
    items.push({
      id: schedulerResourceValue(resourceDefinition, id),
      name: recordLabel(resource, resourceDefinition.labelField),
    })
    return items
  }, [])
})
const locationFilteredResourceItems = computed<DayPilot.ResourceData[]>(() => {
  const locationResourceIds = selectedLocationResourceIds.value
  if (!locationResourceIds) return resourceItems.value
  return resourceItems.value.filter((resource) =>
    locationResourceIds.has(String(resource.id)),
  )
})
const filteredResourceItems = computed<DayPilot.ResourceData[]>(() => {
  const items = locationFilteredResourceItems.value
  if (selectedResourceIds.value.length === 0) return items
  const selected = new Set(selectedResourceIds.value)
  return items.filter((resource) => selected.has(String(resource.id)))
})
const resourceFilterItems = computed<ResourceFilterItem[]>(() =>
  locationFilteredResourceItems.value.map((resource) => ({
    id: String(resource.id ?? ''),
    name: resource.name || String(resource.id ?? ''),
    depth: 0,
    resourceIds: [String(resource.id ?? '')],
  })).filter((item) => item.id),
)
interface LevelFilterGroup {
  groupField: string
  title: string
  items: ResourceFilterItem[]
}
function locationLevelMatches(
  row: Record<string, unknown>,
  levelIndex: number,
  selected: string,
): boolean {
  const rowId = scalarId(row[filterLevels.value[levelIndex]?.groupField ?? ''])
  if (rowId === null) return false
  if (
    useFilterTree.value &&
    levelIndex === filterTreeLevelIndex.value &&
    filterTreeMatchIds.value
  ) {
    return filterTreeMatchIds.value.has(String(rowId))
  }
  return String(rowId) === selected
}
function locationRowMatchesLevelsAbove(
  row: Record<string, unknown>,
  levelIndex: number,
): boolean {
  return filterLevels.value.slice(0, levelIndex).every((_level, i) => {
    const selected = selectedLevelIds.value[i]
    if (selected == null) return true
    return locationLevelMatches(row, i, selected)
  })
}
function locationRowMatchesSelectedLevels(row: Record<string, unknown>): boolean {
  return filterLevels.value.every((_level, i) => {
    const selected = selectedLevelIds.value[i]
    if (selected == null) return true
    return locationLevelMatches(row, i, selected)
  })
}
const levelFilterGroups = computed<LevelFilterGroup[]>(() => {
  if (!useLocationFilter.value) return []

  return filterLevels.value.map((level, levelIndex) => {
    const items = new Map<string, ResourceFilterItem>()
    for (const row of locationRows.value) {
      if (!locationRowMatchesLevelsAbove(row, levelIndex)) continue
      const locationId = scalarId(row[level.groupField])
      if (locationId === null) continue
      const key = String(locationId)
      if (items.has(key)) continue
      items.set(key, {
        id: key,
        name: formatLocationFieldLabel(row[level.groupField], level.groupField),
        depth: 0,
        resourceIds: [],
      })
    }
    return {
      groupField: level.groupField,
      title: level.title?.trim() || level.groupField,
      items: Array.from(items.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }
  })
})
const selectedLocationResourceIds = computed<Set<string> | null>(() => {
  if (!useLocationFilter.value) return null
  const location = locationSettings.value
  const resourceDefinition = schedulerResourceDefinition.value
  if (!location || !resourceDefinition) return null
  if (!selectedLevelIds.value.some((value) => value != null)) return null

  const resourceIds = new Set<string>()
  for (const row of locationRows.value) {
    if (!locationRowMatchesSelectedLevels(row)) continue
    const resourceId = scalarId(row[location.resourceField])
    if (resourceId === null) continue
    resourceIds.add(String(schedulerResourceValue(resourceDefinition, resourceId)))
  }
  return resourceIds
})
const schedulerResourceItems = computed<DayPilot.ResourceData[]>(() => {
  return filteredResourceItems.value
})
const calendarColumns = computed<DayPilot.CalendarColumnData[]>(() => {
  if (isWeekResourceCalendar.value) {
    return buildWeekCalendarColumns(
      filteredResourceItems.value,
      parseRangeStartDate(rangeStart.value),
    )
  }

  return filteredResourceItems.value.map((resource) => ({
    id: resource.id,
    name: resource.name || String(resource.id ?? ''),
  }))
})
const statusOptions = computed(() => {
  const settings = normalizedSettings.value
  if (!settings?.event.statusField) return []

  const values = new Set<string>()
  for (const record of records.value) {
    const value = record[settings.event.statusField]
    if (value === null || value === undefined || value === '') continue
    values.add(String(value))
  }

  return Array.from(values)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({
      label: statusChoiceLabels.value[value] ?? value,
      color: settings.event.statusColors?.[value] ?? null,
      value,
    }))
})
const filteredRecords = computed(() => {
  const settings = normalizedSettings.value
  const resourceDefinition = schedulerResourceDefinition.value
  if (!settings || !resourceDefinition) return []

  const resources =
    selectedResourceIds.value.length > 0
      ? new Set(selectedResourceIds.value)
      : selectedLocationResourceIds.value
  const statuses =
    settings.event.statusField && selectedStatusValues.value.length > 0
      ? new Set(selectedStatusValues.value)
      : null

  return records.value.filter((record) => {
    if (useLocationFilter.value) {
      for (const [i, level] of filterLevels.value.entries()) {
        const selected = selectedLevelIds.value[i]
        if (selected == null) continue
        // Deeper levels may not exist directly on the event (or be empty); those
        // are narrowed through the resulting resource set instead.
        const eventValue = scalarId(record[level.groupField])
        if (eventValue === null) continue
        if (
          useFilterTree.value &&
          i === filterTreeLevelIndex.value &&
          filterTreeMatchIds.value
        ) {
          if (!filterTreeMatchIds.value.has(String(eventValue))) return false
        } else if (String(eventValue) !== selected) {
          return false
        }
      }
    }

    const resource = scalarId(record[resourceDefinition.eventField])
    if (resource === null) return false
    const resourceValue = schedulerResourceValue(resourceDefinition, resource)
    if (resources && !resources.has(String(resourceValue))) return false
    if (statuses) {
      const statusValue = record[settings.event.statusField!]
      if (!statuses.has(String(statusValue ?? ''))) return false
    }
    return true
  })
})
const useResourceCalendarView = computed(
  () =>
    normalizedSettings.value?.viewMode === 'resourceCalendar' &&
    (rangeView.value === 'day' || rangeView.value === 'week'),
)
const isWeekResourceCalendar = computed(
  () => useResourceCalendarView.value && rangeView.value === 'week',
)
const isDayResourceCalendar = computed(
  () => useResourceCalendarView.value && rangeView.value === 'day',
)
const weekCalendarResourceCount = computed(
  () => filteredResourceItems.value.length,
)
const weekCalendarUseFixedColumns = computed(
  () =>
    isWeekResourceCalendar.value &&
    weekCalendarResourceCount.value >= weekCalendarScrollResourceThreshold,
)
const weekCalendarTimelineWidth = computed(() =>
  weekCalendarHourWidth +
  (7 * weekCalendarResourceCount.value * weekCalendarColumnWidthMin),
)
const weekFirstResourceId = computed(
  () => String(filteredResourceItems.value[0]?.id ?? ''),
)
const schedulerScale = computed<DayPilot.SchedulerConfig['scale']>(() =>
  rangeView.value === 'day' ? 'Hour' : 'Day',
)
const schedulerCellDuration = computed(() =>
  schedulerScale.value === 'Hour' ? 30 : undefined,
)
const schedulerCellCount = computed(() =>
  schedulerScale.value === 'Hour' ? 48 : rangeDays.value,
)
const schedulerCellWidth = computed(() => {
  const availableWidth = Math.max(
    0,
    schedulerViewportWidth.value - schedulerRowHeaderWidth - 2,
  )
  if (availableWidth <= 0) {
    if (rangeView.value === 'month') return 24
    if (rangeView.value === 'week') return 84
    return 42
  }

  const fittedWidth = Math.floor(availableWidth / schedulerCellCount.value)
  if (rangeView.value === 'month') return Math.max(16, fittedWidth)
  if (rangeView.value === 'week') return Math.max(48, fittedWidth)
  return Math.max(28, fittedWidth)
})
const schedulerTimelineWidth = computed(() =>
  schedulerRowHeaderWidth + (schedulerCellWidth.value * schedulerCellCount.value),
)
const schedulerRenderKey = computed(() => [
  rangeView.value,
  rangeStart.value,
  rangeDays.value,
  schedulerCellWidth.value,
  schedulerViewportWidth.value,
  useResourceCalendarView.value ? 'calendar' : 'scheduler',
  schedulerResourceDefinition.value?.key ?? '',
  useLocationFilter.value ? 'filter' : 'flat',
  selectedLevelIds.value.map((value) => value ?? '').join('|'),
  weekCalendarResourceCount.value,
  weekCalendarUseFixedColumns.value ? 'fixed' : 'auto',
  useAvailabilityDimming.value ? `avail${availabilityVersion.value}` : 'noavail',
  allowEventDelete.value ? 'delete' : 'nodelete',
  eventsVersion.value,
].join(':'))
const isTemplateExpansionMode = computed(
  () => normalizedSettings.value?.event.sourceMode === 'templateExpansion',
)
const events = computed<DayPilot.EventData[]>(() => {
  const settings = normalizedSettings.value
  const eventResourceDefinitions = schedulerResourceDefinition.value
    ? [schedulerResourceDefinition.value]
    : []
  if (!settings || eventResourceDefinitions.length === 0) return []

  if (isTemplateExpansionMode.value && schedulerResourceDefinition.value) {
    const resourceDefinition = schedulerResourceDefinition.value
    const start = parseRangeStartDate(rangeStart.value)
    return expandTemplateEvents(
      filteredRecords.value,
      settings,
      start,
      rangeDays.value,
      resourceDefinition.key,
      (resourceValue, dayKey) => isWeekResourceCalendar.value
        ? weekCalendarColumnId(dayKey, resourceValue)
        : resourceValue,
      (record) => formatEventTitle(record, settings),
      (record) => eventBackColor(record, settings) ?? undefined,
    )
  }

  return filteredRecords.value.reduce<DayPilot.EventData[]>((items, record) => {
    const id = recordId(record, settings.event.primaryKey)
    const start = record[settings.event.startField]
    const end = record[settings.event.endField]
    if (
      id === null ||
      (typeof start !== 'string' && !(start instanceof Date)) ||
      (typeof end !== 'string' && !(end instanceof Date))
    ) {
      return items
    }

    for (const resourceDefinition of eventResourceDefinitions) {
      const resource = scalarId(record[resourceDefinition.eventField])
      if (resource === null) continue

      const resourceValue = schedulerResourceValue(resourceDefinition, resource)
      if (
        isWeekResourceCalendar.value &&
        !isDateInVisibleWeek(start, rangeStart.value)
      ) {
        continue
      }

      const eventResource = isWeekResourceCalendar.value
        ? weekCalendarColumnId(
          dateString(parseEventCalendarDay(start)),
          resourceValue,
        )
        : resourceValue

      const eventStart = useResourceCalendarView.value
        ? toDayPilotEventDateTime(start)
        : start
      const eventEnd = useResourceCalendarView.value
        ? toDayPilotEventDateTime(end)
        : end

      const event = createSchedulerEvent(
        record,
        id,
        eventStart,
        eventEnd,
        eventResource,
        settings,
        resourceDefinition,
      )
      items.push(event)
    }
    return items
  }, [])
})
const calendarConfig = computed<DayPilot.CalendarConfig>(() => ({
  viewType: 'Resources',
  columns: calendarColumns.value,
  events: events.value,
  startDate: isWeekResourceCalendar.value
    ? rangeStart.value
    : dateString(selectedDate.value),
  days: isWeekResourceCalendar.value ? 7 : 1,
  scale: useResourceCalendarView.value ? 'Hour' : undefined,
  cellDuration: useResourceCalendarView.value ? 30 : undefined,
  headerLevels: isWeekResourceCalendar.value
    ? 1
    : undefined,
  headerHeight: isWeekResourceCalendar.value
    ? weekCalendarCombinedHeaderHeight
    : isDayResourceCalendar.value
      ? weekCalendarDayHeaderHeight
      : undefined,
  headerHeightAutoFit: useResourceCalendarView.value ? false : undefined,
  headerLevelHeights: isWeekResourceCalendar.value
    ? [weekCalendarCombinedHeaderHeight]
    : undefined,
  columnWidthSpec: isWeekResourceCalendar.value
    ? (weekCalendarUseFixedColumns.value ? 'Fixed' : 'Auto')
    : undefined,
  columnWidth: isWeekResourceCalendar.value && weekCalendarUseFixedColumns.value
    ? weekCalendarColumnWidthMin
    : undefined,
  columnWidthMin: isWeekResourceCalendar.value && !weekCalendarUseFixedColumns.value
    ? weekCalendarColumnWidthMin
    : undefined,
  hourWidth: useResourceCalendarView.value ? weekCalendarHourWidth : undefined,
  locale: dayPilotLocale.value,
  weekStarts: i18n.language.value === 'uk-UA' ? 1 : 'Auto',
  timeFormat: dayPilotTimeFormat.value,
  businessBeginsHour: 8,
  businessEndsHour: 18,
  eventMoveHandling:
    isTemplateExpansionMode.value || !canUpdateEvents.value ? 'Disabled' : 'Update',
  eventResizeHandling:
    isTemplateExpansionMode.value || !canUpdateEvents.value ? 'Disabled' : 'Update',
  eventClickHandling: 'Enabled',
  timeRangeSelectedHandling: canCreateEvents.value ? 'Enabled' : 'Disabled',
  heightSpec: 'BusinessHoursNoScroll',
  durationBarVisible: true,
  showToolTip: false,
  width: isWeekResourceCalendar.value && weekCalendarUseFixedColumns.value
    ? `${weekCalendarTimelineWidth.value}px`
    : '100%',
  bubble: eventBubble,
  onBeforeCellRender: (args) => applyAvailabilityCellDimming(args),
  onBeforeHeaderRender: (args) => customizeCalendarColumnHeader(args),
  onEventClick: (args) => handleEventClick(args),
  onEventMove: (args) => {
    const payload = buildCalendarEventChangePayload(args, true)
    if (!isEventChangeAllowed(payload, true)) {
      notifyAvailabilityBlocked()
      args.preventDefault()
    }
  },
  onEventMoved: (args) => {
    const payload = buildCalendarEventChangePayload(args, true)
    applyLocalEventChange(payload, true)
    void persistEventMove(payload)
  },
  onEventResize: (args) => {
    const payload = buildCalendarEventResizePayload(args)
    if (!isEventChangeAllowed(payload, false)) {
      notifyAvailabilityBlocked()
      args.preventDefault()
    }
  },
  onEventResized: (args) => {
    const payload = buildCalendarEventResizePayload(args)
    applyLocalEventChange(payload, false)
    void persistEventResize(payload)
  },
  onTimeRangeSelected: (args) => void createEventFromRange({
    start: args.start,
    end: args.end,
    resource: args.resource,
    column:
      readWeekCalendarColumnRef(args) ??
      findWeekCalendarColumnForSelection(args, args.resource),
    control: args.control,
  }),
}))
const schedulerConfig = computed<DayPilot.SchedulerConfig>(() => ({
  resources: schedulerResourceItems.value,
  events: events.value,
  startDate: rangeStart.value,
  days: rangeDays.value,
  scale: schedulerScale.value,
  locale: dayPilotLocale.value,
  weekStarts: i18n.language.value === 'uk-UA' ? 1 : 'Auto',
  timeFormat: dayPilotTimeFormat.value,
  cellDuration: schedulerCellDuration.value,
  cellWidth: schedulerCellWidth.value,
  rowHeaderWidth: schedulerRowHeaderWidth,
  treeEnabled: false,
  timeHeaders: schedulerTimeHeaders(),
  width: `${schedulerTimelineWidth.value}px`,
  eventMoveHandling:
    isTemplateExpansionMode.value || !canUpdateEvents.value ? 'Disabled' : 'Update',
  eventResizeHandling:
    isTemplateExpansionMode.value || !canUpdateEvents.value ? 'Disabled' : 'Update',
  eventClickHandling: 'Enabled',
  timeRangeSelectedHandling: canCreateEvents.value ? 'Enabled' : 'Disabled',
  showToolTip: false,
  heightSpec: 'Max',
  height: 500,
  bubble: eventBubble,
  onBeforeCellRender: (args) => applyAvailabilityCellDimming(args),
  onEventClick: (args) => handleEventClick(args),
  onEventMove: (args) => {
    if (!isEventChangeAllowed(args, true)) {
      notifyAvailabilityBlocked()
      args.preventDefault()
    }
  },
  onEventMoved: (args) => {
    applyLocalEventChange(args, true)
    void persistEventMove(args)
  },
  onEventResize: (args) => {
    if (!isEventChangeAllowed(args, false)) {
      notifyAvailabilityBlocked()
      args.preventDefault()
    }
  },
  onEventResized: (args) => {
    applyLocalEventChange(args, false)
    void persistEventResize(args)
  },
  onTimeRangeSelected: (args) => void createEventFromRange(args),
}))

watch(
  normalizedSettings,
  () => {
    void loadSchedulerData()
  },
  { immediate: true, deep: true },
)

watch(
  [
    rangeStart,
    rangeDays,
    useAvailabilityDimming,
    resourcesByKey,
    () => schedulerResourceDefinition.value?.key ?? '',
  ],
  () => {
    void loadAvailabilityWindows()
  },
  { immediate: true },
)

watch(
  () => schedulerResourceDefinition.value?.key ?? '',
  () => {
    selectedResourceIds.value = []
  },
  { immediate: true },
)

watch(
  selectedLevelIds,
  () => {
    selectedResourceIds.value = []
  },
  { deep: true },
)

watch(
  filterLevels,
  (levels) => {
    selectedLevelIds.value = levels.map((_, i) => selectedLevelIds.value[i] ?? null)
  },
  { immediate: true },
)

// Progressive cascade: the first level is required (auto-selected, never empty);
// deeper levels are optional. Drop selections that are no longer valid once their
// parent selection (or the loaded data) changes.
watch(
  [levelFilterGroups, filterTreeNodes, useFilterTree, filterTreeLevelIndex],
  ([groups]) => {
    if (!useLocationFilter.value) {
      if (selectedLevelIds.value.some((value) => value != null)) {
        selectedLevelIds.value = filterLevels.value.map(() => null)
      }
      return
    }
    const next = [...selectedLevelIds.value]
    let changed = false
    groups.forEach((group, index) => {
      const selected = next[index]
      const treeLevel = useFilterTree.value && index === filterTreeLevelIndex.value
      if (selected != null) {
        const stillValid = treeLevel
          ? Boolean(findTreeNodeByKey(filterTreeNodes.value, selected))
          : group.items.some((item) => item.id === selected)
        if (!stillValid) {
          next[index] = null
          changed = true
        }
      }
      // First level must always hold a value when options exist.
      if (index === 0 && next[index] == null) {
        if (treeLevel && filterTreeNodes.value.length > 0) {
          next[index] = filterTreeNodes.value[0].key
          changed = true
        } else if (group.items.length > 0) {
          next[index] = group.items[0].id
          changed = true
        }
      }
    })
    if (changed) selectedLevelIds.value = next
  },
  { immediate: true },
)

watch(
  [selectedLevelIds, filterTreeLevelIndex, useFilterTree],
  () => {
    if (!useFilterTree.value) {
      filterTreeSelectedKeys.value = {}
      return
    }
    const selected = selectedLevelIds.value[filterTreeLevelIndex.value]
    filterTreeSelectedKeys.value = selected ? { [selected]: true } : {}
  },
  { immediate: true, deep: true },
)

function findTreeNodeByKey(
  nodes: HierarchyTreeNode[],
  key: string,
): HierarchyTreeNode | null {
  for (const node of nodes) {
    if (node.key === key) return node
    const child = findTreeNodeByKey(node.children ?? [], key)
    if (child) return child
  }
  return null
}

function onSelectFilterTreeKeys(keys: Record<string, boolean>): void {
  filterTreeSelectedKeys.value = keys
  const selected = Object.keys(keys).find((key) => keys[key]) ?? null
  onSelectLevel(filterTreeLevelIndex.value, selected)
}

function onSelectLevel(index: number, value: unknown): void {
  const cleared = value === null || value === undefined || value === ''
  // The first level is required and cannot be cleared.
  if (index === 0 && cleared) return
  const next = [...selectedLevelIds.value]
  next[index] = cleared ? null : String(value)
  for (let i = index + 1; i < next.length; i += 1) {
    next[i] = null
  }
  selectedLevelIds.value = next
}

watch(
  [rangeView, selectedDate, schedulerViewportWidth],
  () => {
    void nextTick(updateSchedulerViewportWidth)
  },
)

onMounted(() => {
  schedulerResizeObserver = new ResizeObserver(() => updateSchedulerViewportWidth())
  if (schedulerViewport.value) {
    schedulerResizeObserver.observe(schedulerViewport.value)
  }
  void nextTick(updateSchedulerViewportWidth)
})

onBeforeUnmount(() => {
  schedulerResizeObserver?.disconnect()
  schedulerResizeObserver = null
  clearFallbackTooltipHideTimer()
})

function createSchedulerEvent(
  record: Record<string, unknown>,
  id: string | number,
  start: string | Date,
  end: string | Date,
  resource: string,
  settings: SchedulerSettings,
  resourceDefinition?: SchedulerResourceRuntime,
): DayPilot.EventData {
  const event: DayPilot.EventData = {
    id,
    text: formatEventTitle(record, settings),
    start: typeof start === 'string' ? start : toDayPilotEventDateTime(start),
    end: typeof end === 'string' ? end : toDayPilotEventDateTime(end),
    resource,
    tags: {
      record,
      recordId: id,
      collection: settings.event.collection,
      id,
      resourceKey: resourceDefinition?.key,
      resourceField: resourceDefinition?.eventField,
    },
  }
  if (!hasDayPilotBubble) {
    addFallbackTooltipArea(event, settings.event.collection, id)
  }
  const backColor = eventBackColor(record, settings)
  if (backColor) {
    // event.backColor = backColor
    // event.borderColor = backColor
    event.barHidden = true
    addStatusColorArea(event, backColor)
  }
  if (allowEventDelete.value) {
    addDeleteEventArea(event, id)
  }
  return event
}

async function loadSchedulerData(): Promise<void> {
  const settings = normalizedSettings.value
  const resourceDefinitions = settings ? schedulerResourceDefinitions(settings) : []
  if (!settings?.event.collection || resourceDefinitions.length === 0) {
    resourcesByKey.value = {}
    locationRows.value = []
    filterTreeRows.value = []
    locationMetadata.value = {}
    records.value = []
    statusChoiceLabels.value = {}
    return
  }

  const token = ++loadToken
  loading.value = true
  error.value = null

  try {
    const eventRequest = await schedulerEventRequest(settings)
    const location = settings.resource.filter
    const locationLevels = location?.levels ?? []
    const locationEnabled = Boolean(
      location?.enabled &&
        location.collection &&
        location.resourceField &&
        locationLevels.length > 0 &&
        locationLevels.every((level) => level.groupField),
    )
    const locationRequest = locationEnabled
      ? await schedulerLocationRequest(settings)
      : { fields: [], metadata: {} }
    const treeLevelIndex = location?.tree?.enabled ? (location.tree.levelIndex ?? 0) : -1
    const treeLevel = treeLevelIndex >= 0 ? locationLevels[treeLevelIndex] : null
    const treeParentField = location?.tree?.enabled ? location.tree.parentField : ''
    const treeRelatedCollection = treeLevel
      ? locationRequest.metadata[treeLevel.groupField]?.relatedCollection
      : undefined
    const treeLabelField = treeLevel
      ? (locationRequest.metadata[treeLevel.groupField]?.displayField || 'name')
      : 'name'

    const [resourceEntries, nextLocationRows, nextFilterTreeRows, eventRows, nextStatusChoiceLabels] = await Promise.all([
      Promise.all(resourceDefinitions.map(async (resource) => [
          resource.key,
          await readDynamicItems(resource.collection, {
            limit: -1,
            fields: [
              resource.primaryKey,
              resource.labelField,
            ],
          }),
        ] as const)),
      locationEnabled
        ? readDynamicItems(location!.collection, {
          limit: -1,
          fields: locationRequest.fields,
        })
        : Promise.resolve([]),
      treeRelatedCollection && treeParentField
        ? readDynamicItems(treeRelatedCollection, {
          limit: -1,
          fields: ['id', treeLabelField, treeParentField],
        })
        : Promise.resolve([]),
      readDynamicItems(settings.event.collection, {
        limit: -1,
        fields: eventRequest.fields,
      }),
      loadStatusChoiceLabels(settings),
    ])

    if (token !== loadToken) return
    titleMetadata.value = eventRequest.titleMetadata
    locationMetadata.value = locationRequest.metadata
    statusChoiceLabels.value = nextStatusChoiceLabels
    locationRows.value = nextLocationRows
    filterTreeRows.value = nextFilterTreeRows
    resourcesByKey.value = resourceEntries.reduce<Record<string, Record<string, unknown>[]>>(
      (items, [key, rows]) => {
        items[key] = rows
        return items
      },
      {},
    )
    records.value = eventRows
  } catch (err) {
    if (token !== loadToken) return
    error.value = err instanceof Error
      ? err.message
      : t('scheduler.failedLoadData', 'Failed to load scheduler data.')
  } finally {
    if (token === loadToken) {
      loading.value = false
    }
  }
}

async function loadStatusChoiceLabels(
  settings: SchedulerSettings,
): Promise<Record<string, string>> {
  if (!settings.event.statusField) return {}

  try {
    return await fetchChoiceLabelMap(
      settings.event.collection,
      settings.event.statusField,
      'Select',
    )
  } catch {
    return {}
  }
}

async function schedulerLocationRequest(
  settings: SchedulerSettings,
): Promise<{ fields: string[]; metadata: Record<string, SchedulerTitleMetadata> }> {
  const location = settings.resource.filter
  const levels = location?.levels ?? []
  if (
    !location?.enabled ||
    !location.collection ||
    !location.resourceField ||
    levels.length === 0 ||
    levels.some((level) => !level.groupField)
  ) {
    return { fields: [], metadata: {} }
  }

  const fields = new Set<string>()
  const metadata: Record<string, SchedulerTitleMetadata> = {}
  const allFields = await getCachedFields()
  const relations = await getCachedRelations()

  const locationFieldNames = Array.from(
    new Set([...levels.map((level) => level.groupField), location.resourceField]),
  )
  for (const locationFieldName of locationFieldNames) {
    const locationField = allFields.find(
      (field) =>
        field.collection === location.collection &&
        field.field === locationFieldName,
    )
    const relation = relations.find(
      (item) =>
        item.collection === location.collection &&
        item.field === locationFieldName,
    )
    const special = normalizeSpecial(locationField?.meta?.special)
    const relatedCollection = relation?.related_collection ?? undefined
    const isM2O = Boolean(relatedCollection) && (
      special.includes('m2o') || Boolean(relation?.related_collection)
    )

    if (!isM2O) {
      fields.add(locationFieldName)
      continue
    }

    fields.add(`${locationFieldName}.id`)
    const relatedFields = allFields.filter(
      (field) => field.collection === relatedCollection,
    )
    const template =
      typeof locationField?.meta?.options?.template === 'string' &&
      locationField.meta.options.template.trim()
        ? locationField.meta.options.template
        : undefined
    const templateFields = template ? extractTemplateFields(template) : []
    const useTemplate = shouldUseTemplateForRelatedLabel(template, templateFields)
    const displayField = relatedRecordDisplayField(relatedFields)

    if (useTemplate && template) {
      for (const field of templateFields) {
        fields.add(`${locationFieldName}.${field}`)
      }
    } else {
      fields.add(`${locationFieldName}.${displayField}`)
    }

    metadata[locationFieldName] = {
      field: locationFieldName,
      relatedCollection,
      template: useTemplate ? template : undefined,
      displayField,
    }
  }

  return { fields: Array.from(fields), metadata }
}

function schedulerResourceDefinitions(
  settings: SchedulerSettings,
): SchedulerResourceRuntime[] {
  const resource = {
    ...settings.resource,
    eventField: settings.event.resourceField,
  }

  if (
    !resource.collection ||
    !resource.primaryKey ||
    !resource.labelField ||
    !resource.eventField
  ) {
    return []
  }

  return [{
    ...resource,
    key: schedulerResourceKey(resource, 0),
  }]
}

function schedulerResourceKey(
  resource: SchedulerResourceSettings,
  index: number,
): string {
  return [
    resource.collection || 'resource',
    resource.eventField || `resource-${index}`,
    index,
  ].join(':')
}

function schedulerResourceValue(
  resource: SchedulerResourceRuntime,
  id: string | number,
): string {
  return `${resource.key}:${String(id)}`
}

function parseRangeStartDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseEventCalendarDay(start: string | Date): Date {
  if (start instanceof Date) return start

  const isoDate = start.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return parseRangeStartDate(isoDate)
  }

  return new Date(start)
}

function isDateInVisibleWeek(start: string | Date, weekStartValue: string): boolean {
  const eventDay = parseEventCalendarDay(start)
  const weekStart = parseRangeStartDate(weekStartValue)
  const weekEnd = addDays(weekStart, 6)
  return eventDay >= weekStart && eventDay <= weekEnd
}

function columnStartDayKey(
  column: DayPilot.CalendarBeforeHeaderRenderArgs['column'],
): string | null {
  const startValue = column.start as string | { toString: () => string } | undefined
  if (!startValue) return null

  const text = typeof startValue === 'string'
    ? startValue
    : startValue.toString()
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null
  return text.slice(0, 10)
}

function weekDayHeaderFromColumn(
  column: DayPilot.CalendarBeforeHeaderRenderArgs['column'],
): { dayKey: string; weekday: string; dayNumber: string } | null {
  const fromId = weekDayHeaderFromColumnId(column.id ?? '')
  if (fromId) return fromId

  const dayKey = columnStartDayKey(column)
  if (!dayKey) return null

  const parts = formatWeekDayHeaderParts(parseRangeStartDate(dayKey))
  return {
    dayKey,
    weekday: parts.weekday,
    dayNumber: parts.day,
  }
}

function formatWeekDayHeader(date: Date): string {
  return new Intl.DateTimeFormat(i18n.language.value, {
    weekday: 'short',
    day: 'numeric',
  }).format(date)
}

function formatWeekDayHeaderParts(date: Date): { weekday: string; day: string } {
  return {
    weekday: new Intl.DateTimeFormat(i18n.language.value, { weekday: 'short' }).format(date),
    day: String(date.getDate()),
  }
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
}

function buildWeekCalendarColumns(
  resources: DayPilot.ResourceData[],
  weekStartDate: Date,
): DayPilot.CalendarColumnData[] {
  if (weekCalendarSupportsColumnGroups) {
    return buildWeekCalendarColumnGroups(resources, weekStartDate)
  }

  return buildWeekCalendarFlatColumns(resources, weekStartDate)
}

function parseCalendarDateTime(value: string | Date): Date {
  if (value instanceof Date) return value

  const isoDate = value.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate) && value.length <= 10) {
    return parseRangeStartDate(isoDate)
  }

  return new Date(value)
}

function dayPilotLocalDateTimeString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

function toDayPilotEventDateTime(value: string | Date): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) &&
      !/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)
    ) {
      return trimmed.slice(0, 19)
    }
  }

  return dayPilotLocalDateTimeString(parseCalendarDateTime(value))
}

function weekCalendarColumnId(
  dayKey: string,
  resourceId: DayPilot.ResourceId,
): string {
  return `${dayKey}#${resourceId}`
}

function parseWeekCalendarColumnId(
  columnId: DayPilot.ResourceId,
): { dayKey: string; resourceId: string } | null {
  const text = String(columnId)
  const separatorIndex = text.indexOf('#')
  if (separatorIndex === -1) return null

  return {
    dayKey: text.slice(0, separatorIndex),
    resourceId: text.slice(separatorIndex + 1),
  }
}

function weekColumnResourceIndex(
  column: DayPilot.CalendarBeforeHeaderRenderArgs['column'],
): number | null {
  const parsed = parseWeekCalendarColumnId(column.id ?? '')
  if (!parsed) return null

  const index = filteredResourceItems.value.findIndex(
    (item) => String(item.id) === parsed.resourceId,
  )
  return index >= 0 ? index : null
}

function weekColumnDayKey(
  resource?: DayPilot.ResourceId,
  column?: WeekCalendarColumnRef,
): string | null {
  if (column?.data?.dayKey) return column.data.dayKey

  const startDayKey = column
    ? columnStartDayKey(column as DayPilot.CalendarBeforeHeaderRenderArgs['column'])
    : null
  if (startDayKey) return startDayKey

  return parseCalendarColumnResource(resource ?? '')?.dayKey ?? null
}

function readWeekCalendarColumnRef(
  args: unknown,
): WeekCalendarColumnRef | undefined {
  if (!args || typeof args !== 'object') return undefined
  const column = (args as { column?: WeekCalendarColumnRef }).column
  if (!column || typeof column !== 'object') return undefined
  return column
}

function findWeekCalendarColumnForSelection(
  args: unknown,
  resource?: DayPilot.ResourceId,
): WeekCalendarColumnRef | undefined {
  const direct = readWeekCalendarColumnRef(args)
  if (direct) return direct
  if (!isWeekResourceCalendar.value || resource === undefined) return undefined

  const payload = args as {
    index?: number
    columnIndex?: number
  }
  const index = typeof payload.index === 'number'
    ? payload.index
    : typeof payload.columnIndex === 'number'
      ? payload.columnIndex
      : undefined
  if (typeof index !== 'number') return undefined

  const column = calendarColumns.value[index]
  return column ? column as WeekCalendarColumnRef : undefined
}

function weekDayKeyFromEvent(event: DayPilot.Event): string | null {
  const settings = normalizedSettings.value
  if (!settings) return null

  const tags = event.data?.tags as { record?: Record<string, unknown> } | undefined
  const start = tags?.record?.[settings.event.startField]
  if (typeof start !== 'string' && !(start instanceof Date)) return null

  return dateString(parseEventCalendarDay(start))
}

function formatDayPilotTimeParts(value: DayPilot.Date): string {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function buildDayPilotDateTime(dayKey: string, value: DayPilot.Date): DayPilot.Date {
  return new DayPilot.Date(`${dayKey}T${formatDayPilotTimeParts(value)}`)
}

function applyWeekColumnDayToDayPilotDate(
  value: DayPilot.Date,
  dayKey: string,
): DayPilot.Date {
  return buildDayPilotDateTime(dayKey, value)
}

function buildWeekCalendarFlatColumns(
  resources: DayPilot.ResourceData[],
  weekStartDate: Date,
): DayPilot.CalendarColumnData[] {
  const today = new Date()
  const columns: DayPilot.CalendarColumnData[] = []

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const day = addDays(weekStartDate, dayOffset)
    const dayKey = dateString(day)
    const dayParts = formatWeekDayHeaderParts(day)

    resources.forEach((resource, resourceIndex) => {
      columns.push({
        id: weekCalendarColumnId(dayKey, resource.id ?? ''),
        name: resource.name || String(resource.id ?? ''),
        start: dayKey,
        data: {
          dayKey,
          weekday: dayParts.weekday,
          dayNumber: dayParts.day,
          isToday: isSameCalendarDay(day, today),
          isWeekStart: dayOffset === 0,
          isFirstResourceInDay: resourceIndex === 0,
          resourceIndex,
        },
      } as DayPilot.CalendarColumnData)
    })
  }

  return columns
}

function buildWeekCalendarColumnGroups(
  resources: DayPilot.ResourceData[],
  weekStartDate: Date,
): DayPilot.CalendarColumnData[] {
  const today = new Date()
  const groups: WeekCalendarColumnGroup[] = []

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const day = addDays(weekStartDate, dayOffset)
    const dayKey = dateString(day)
    const dayParts = formatWeekDayHeaderParts(day)

    groups.push({
      name: formatWeekDayHeader(day),
      data: {
        dayKey,
        weekday: dayParts.weekday,
        dayNumber: dayParts.day,
        isToday: isSameCalendarDay(day, today),
        isWeekStart: dayOffset === 0,
      },
      children: resources.map((resource, resourceIndex) => ({
        id: resource.id,
        name: resource.name || String(resource.id ?? ''),
        start: dayKey,
        data: {
          dayKey,
          resourceIndex,
        },
      })),
    })
  }

  return groups as DayPilot.CalendarColumnData[]
}

interface WeekCalendarColumnGroup {
  name: string
  data?: {
    dayKey: string
    weekday: string
    dayNumber: string
    isToday: boolean
    isWeekStart: boolean
  }
  children: DayPilot.CalendarColumnData[]
}

function weekDayHeaderFromColumnId(
  columnId: DayPilot.ResourceId,
): { dayKey: string; weekday: string; dayNumber: string } | null {
  const text = String(columnId)
  const separatorIndex = text.indexOf('#')
  if (separatorIndex === -1) return null

  const dayKey = text.slice(0, separatorIndex)
  const parts = formatWeekDayHeaderParts(parseRangeStartDate(dayKey))
  return {
    dayKey,
    weekday: parts.weekday,
    dayNumber: parts.day,
  }
}

function isWeekColumnFirstResourceInDay(
  column: DayPilot.CalendarBeforeHeaderRenderArgs['column'],
  _dayKey: string,
  columnData?: { isFirstResourceInDay?: boolean; resourceIndex?: number },
): boolean {
  if (columnData?.isFirstResourceInDay === true) return true
  if (columnData?.resourceIndex === 0) return true

  const resourceIndex = columnData?.resourceIndex ?? weekColumnResourceIndex(column)
  if (resourceIndex === 0) return true

  const parsed = parseWeekCalendarColumnId(column.id ?? '')
  if (parsed && weekFirstResourceId.value) {
    return parsed.resourceId === weekFirstResourceId.value
  }

  return false
}

function weekColumnResourceName(
  column: DayPilot.CalendarBeforeHeaderRenderArgs['column'],
): string {
  const directName = column.name || ''
  if (directName && !directName.includes('#')) return directName

  const parsed = parseWeekCalendarColumnId(column.id ?? '')
  if (!parsed) return directName || String(column.id ?? '')

  const resource = filteredResourceItems.value.find(
    (item) => String(item.id) === parsed.resourceId,
  )
  return resource?.name || directName || parsed.resourceId
}

function customizeCalendarColumnHeader(
  args: DayPilot.CalendarBeforeHeaderRenderArgs,
): void {
  if (!useResourceCalendarView.value) return

  const column = args.column
  const resourceName = weekColumnResourceName(column)

  if (isDayResourceCalendar.value) {
    args.header.cssClass = 'crm-scheduler__day-resource-header'
    args.header.html = `
      <span class="crm-scheduler__day-resource-label" title="${resourceName}">
        ${resourceName}
      </span>
    `
    return
  }

  if (!isWeekResourceCalendar.value) return

  const columnData = column.data as {
    dayKey?: string
    weekday?: string
    dayNumber?: string
    isToday?: boolean
    isWeekStart?: boolean
    resourceIndex?: number
    isFirstResourceInDay?: boolean
  } | undefined
  const dayFromColumn = weekDayHeaderFromColumn(column)
  const weekday = String(columnData?.weekday ?? dayFromColumn?.weekday ?? '')
  const dayNumber = String(columnData?.dayNumber ?? dayFromColumn?.dayNumber ?? '')
  const dayKey = columnData?.dayKey ?? dayFromColumn?.dayKey ?? ''
  const isToday = columnData?.isToday === true ||
    (dayKey !== '' && isSameCalendarDay(parseRangeStartDate(dayKey), new Date()))
  const isFirstResourceInDay =
    columnData?.isFirstResourceInDay === true ||
    columnData?.resourceIndex === 0 ||
    weekColumnResourceIndex(column) === 0 ||
    isWeekColumnFirstResourceInDay(column, dayKey, columnData)
  const isWeekStart = columnData?.isWeekStart === true ||
    (dayKey !== '' && dayKey === rangeStart.value)

  if (weekCalendarSupportsColumnGroups && args.header.children?.length) {
    args.header.cssClass = [
      'crm-scheduler__week-day-header',
      isToday ? 'crm-scheduler__week-day-header--today' : '',
      isWeekStart ? 'crm-scheduler__week-day-header--start' : '',
    ].filter(Boolean).join(' ')
    args.header.html = `
      <div class="crm-scheduler__week-day">
        <span class="crm-scheduler__week-day-weekday">${weekday}</span>
        <span class="crm-scheduler__week-day-number">${dayNumber}</span>
      </div>
    `
    return
  }

  if (weekCalendarSupportsColumnGroups) {
    const isFirstResourceInGroup = columnData?.resourceIndex === 0
    args.header.cssClass = [
      'crm-scheduler__week-resource-header',
      isFirstResourceInGroup ? 'crm-scheduler__week-resource-header--start' : '',
    ].filter(Boolean).join(' ')
    args.header.html = `
      <span class="crm-scheduler__week-resource-label" title="${resourceName}">
        ${resourceName}
      </span>
    `
    return
  }

  args.header.cssClass = [
    'crm-scheduler__week-flat-header',
    isToday ? 'crm-scheduler__week-flat-header--today' : '',
    isFirstResourceInDay ? 'crm-scheduler__week-flat-header--day-start' : '',
    isWeekStart && isFirstResourceInDay ? 'crm-scheduler__week-flat-header--week-start' : '',
  ].filter(Boolean).join(' ')
  args.header.html = `
    <div class="crm-scheduler__week-flat-header-body">
      <div class="crm-scheduler__week-day${isFirstResourceInDay ? '' : ' crm-scheduler__week-day--empty'}">
        <span class="crm-scheduler__week-day-weekday">${weekday}</span>
        <span class="crm-scheduler__week-day-number">${dayNumber}</span>
      </div>
      <span class="crm-scheduler__week-resource-label" title="${resourceName}">
        ${resourceName}
      </span>
    </div>
  `
}

function resolveWeekCalendarRangeDate(
  value: DayPilot.Date,
  resource?: DayPilot.ResourceId,
  column?: WeekCalendarColumnRef,
): DayPilot.Date {
  if (!isWeekResourceCalendar.value) return value

  const dayKey = weekColumnDayKey(resource, column)
  if (!dayKey) return value

  return applyWeekColumnDayToDayPilotDate(value, dayKey)
}

function parseCalendarColumnResource(
  value: DayPilot.ResourceId,
): { resource: SchedulerResourceRuntime; id: string; dayKey: string | null } | null {
  const text = String(value)
  const separatorIndex = text.indexOf('#')
  if (separatorIndex === -1) {
    const parsed = parseSchedulerResourceValue(value)
    return parsed ? { ...parsed, dayKey: null } : null
  }

  const parsed = parseSchedulerResourceValue(text.slice(separatorIndex + 1))
  if (!parsed) return null

  return {
    ...parsed,
    dayKey: text.slice(0, separatorIndex),
  }
}

function parseSchedulerResourceValue(
  value: DayPilot.ResourceId,
): { resource: SchedulerResourceRuntime; id: string } | null {
  const text = String(value)
  const resource = resourceDefinitions.value.find((item) =>
    text.startsWith(`${item.key}:`),
  )
  if (!resource) return null

  return {
    resource,
    id: text.slice(resource.key.length + 1),
  }
}

function formatLocationFieldLabel(value: unknown, field: string): string {
  const metadata = locationMetadata.value[field]
  if (metadata?.relatedCollection) {
    return formatRelatedEventTitle(value, metadata)
  }

  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

interface AvailabilityCellRenderArgs {
  cell: {
    start: DayPilot.Date
    end: DayPilot.Date
    resource?: DayPilot.ResourceId
    properties: {
      backColor?: string
      disabled?: boolean
      business?: boolean
    }
  }
}

function localDateTimeString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Local timestamp for a DayPilot cell boundary (naive parse, matches slot data). */
function cellTimestamp(value: DayPilot.Date): number {
  return new Date(dayPilotDateString(value)).getTime()
}

function resolveCellProviderId(cell: AvailabilityCellRenderArgs['cell']): string | null {
  if (cell.resource === undefined || cell.resource === null) return null
  return parseCalendarColumnResource(cell.resource)?.id ?? null
}

/**
 * A cell is bookable when it falls inside one of the provider's intake windows
 * and overlaps no block window. Providers without intake windows are treated as
 * fully unavailable (matches the create-time availability guard).
 */
function isCellBookable(providerId: string, start: number, end: number): boolean {
  const windows = availabilityByProvider.value.get(providerId)
  if (!windows || windows.intake.length === 0) return false
  const inIntake = windows.intake.some((window) => start >= window.start && end <= window.end)
  if (!inIntake) return false
  const inBlock = windows.block.some((window) => start < window.end && end > window.start)
  return !inBlock
}

/** Dims + disables calendar/scheduler cells outside a provider's intake windows. */
function applyAvailabilityCellDimming(rawArgs: unknown): void {
  if (!useAvailabilityDimming.value) return
  const args = rawArgs as AvailabilityCellRenderArgs
  const providerId = resolveCellProviderId(args.cell)
  if (providerId === null) return
  const start = cellTimestamp(args.cell.start)
  const end = cellTimestamp(args.cell.end)
  if (Number.isNaN(start) || Number.isNaN(end)) return
  if (!isCellBookable(providerId, start, end)) {
    args.cell.properties.disabled = true
    args.cell.properties.backColor = availabilityDisabledColor
  }
}

async function loadAvailabilityWindows(): Promise<void> {
  const availability = availabilitySettings.value
  const resourceDefinition = schedulerResourceDefinition.value
  const token = ++availabilityToken

  const clear = (): void => {
    if (availabilityByProvider.value.size > 0) {
      availabilityByProvider.value = new Map()
    }
    availabilityVersion.value += 1
  }

  if (!useAvailabilityDimming.value || !availability || !resourceDefinition) {
    clear()
    return
  }

  const providerIds = (resourcesByKey.value[resourceDefinition.key] ?? [])
    .map((row) => recordId(row, resourceDefinition.primaryKey))
    .filter((id): id is string | number => id !== null)
  if (providerIds.length === 0) {
    clear()
    return
  }

  const rangeStartDate = parseRangeStartDate(rangeStart.value)
  const rangeEndDate = addDays(rangeStartDate, rangeDays.value)

  try {
    const rows = await bridgeReadItems(availability.collection, {
      limit: -1,
      filter: {
        [availability.resourceField]: { _in: providerIds },
        [availability.startField]: { _lt: localDateTimeString(rangeEndDate) },
        [availability.endField]: { _gt: localDateTimeString(rangeStartDate) },
      },
      fields: [
        availability.resourceField,
        availability.startField,
        availability.endField,
        availability.typeField,
      ],
    })
    if (token !== availabilityToken) return

    const intakeValue = availability.intakeValue || 'intake'
    const blockValue = availability.blockValue || 'block'
    const map = new Map<string, ProviderAvailabilityWindows>()
    for (const row of rows) {
      const providerId = scalarId(row[availability.resourceField])
      if (providerId === null) continue
      const start = new Date(String(row[availability.startField])).getTime()
      const end = new Date(String(row[availability.endField])).getTime()
      if (Number.isNaN(start) || Number.isNaN(end)) continue
      const key = String(providerId)
      const entry = map.get(key) ?? { intake: [], block: [] }
      const type = String(row[availability.typeField] ?? '')
      if (type === blockValue) entry.block.push({ start, end })
      else if (type === intakeValue) entry.intake.push({ start, end })
      map.set(key, entry)
    }
    availabilityByProvider.value = map
    availabilityVersion.value += 1
  } catch {
    if (token !== availabilityToken) return
    clear()
  }
}

function registerDayPilotLocales(): void {
  const datePattern = defaultDateDisplayFormat()
  const dateTimePattern = defaultDateTimeDisplayFormat({ includeSeconds: false })
  const timePattern = dateTimePattern.slice(datePattern.length).trim()

  DayPilot.Locale.register(new DayPilot.Locale('uk-ua', {
    dayNames: [
      'неділя',
      'понеділок',
      'вівторок',
      'середа',
      'четвер',
      'п’ятниця',
      'субота',
    ],
    dayNamesShort: ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
    monthNames: [
      'січень',
      'лютий',
      'березень',
      'квітень',
      'травень',
      'червень',
      'липень',
      'серпень',
      'вересень',
      'жовтень',
      'листопад',
      'грудень',
      '',
    ],
    monthNamesShort: [
      'січ.',
      'лют.',
      'бер.',
      'квіт.',
      'трав.',
      'черв.',
      'лип.',
      'серп.',
      'вер.',
      'жовт.',
      'лист.',
      'груд.',
      '',
    ],
    timePattern,
    datePattern,
    dateTimePattern,
    timeFormat: 'Clock24Hours',
    weekStarts: 1,
  }))
}

function findWeekCalendarColumnByResourceId(
  resource?: DayPilot.ResourceId,
): WeekCalendarColumnRef | undefined {
  if (resource === undefined) return undefined

  const text = String(resource)
  const column = calendarColumns.value.find(
    (item) => String(item.id) === text,
  )
  return column ? column as WeekCalendarColumnRef : undefined
}

function buildCalendarEventChangePayload(
  args: DayPilot.CalendarEventMoveArgs | DayPilot.CalendarEventMovedArgs,
  includeResource: boolean,
): SchedulerEventMovePayload {
  const newResource = includeResource ? args.newResource : undefined
  return {
    e: args.e,
    newStart: args.newStart,
    newEnd: args.newEnd,
    newResource,
    column: includeResource
      ? findWeekCalendarColumnByResourceId(newResource)
      : findWeekCalendarColumnByResourceId(args.e.resource()),
  }
}

function buildCalendarEventResizePayload(
  args: DayPilot.CalendarEventResizeArgs | DayPilot.CalendarEventResizedArgs,
): SchedulerEventMovePayload {
  return {
    e: args.e,
    newStart: args.newStart,
    newEnd: args.newEnd,
    column: findWeekCalendarColumnByResourceId(args.e.resource()),
  }
}

function resolveMoveTargetResource(
  payload: SchedulerEventMovePayload,
): ReturnType<typeof parseCalendarColumnResource> {
  const candidates: DayPilot.ResourceId[] = []
  if (payload.newResource !== undefined) {
    candidates.push(payload.newResource)
  }
  if (payload.column?.id !== undefined) {
    candidates.push(payload.column.id)
  }

  for (const candidate of candidates) {
    const parsed = parseCalendarColumnResource(candidate)
    if (parsed) return parsed
  }

  return null
}

/** Resolves the drop/resize target (provider + real start/end) for an event change. */
function resolveEventChangeTarget(
  payload: SchedulerEventMovePayload,
  includeResource: boolean,
): { providerId: string | null; start: DayPilot.Date; end: DayPilot.Date } {
  const rangeResource = includeResource && payload.newResource !== undefined
    ? payload.newResource
    : payload.e.resource()
  const moveTarget = includeResource ? resolveMoveTargetResource(payload) : null
  // The target day is encoded in the moved-to column id (`dayKey#resourceId`);
  // prefer it so cross-day drags land on the correct day. Only fall back to the
  // event's original day when the resource/column carries no day.
  const targetDayKey =
    moveTarget?.dayKey ??
    parseCalendarColumnResource(rangeResource)?.dayKey ??
    payload.column?.data?.dayKey ??
    weekDayKeyFromEvent(payload.e)
  const column = targetDayKey ? { data: { dayKey: targetDayKey } } : payload.column
  return {
    providerId: moveTarget?.id ?? parseCalendarColumnResource(rangeResource)?.id ?? null,
    start: resolveWeekCalendarRangeDate(payload.newStart, rangeResource, column),
    end: resolveWeekCalendarRangeDate(payload.newEnd, rangeResource, column),
  }
}

/** Synchronous availability check used to block drag/resize onto unavailable slots. */
function isEventChangeAllowed(
  payload: SchedulerEventMovePayload,
  includeResource: boolean,
): boolean {
  if (!useAvailabilityDimming.value) return true
  const { providerId, start, end } = resolveEventChangeTarget(payload, includeResource)
  if (providerId === null) return true
  const startMs = cellTimestamp(start)
  const endMs = cellTimestamp(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true
  return isCellBookable(providerId, startMs, endMs)
}

function notifySuccess(message: string): void {
  toast.add({
    severity: 'success',
    summary: message,
    life: 3000,
  })
}

function notifyAvailabilityBlocked(): void {
  error.value = t(
    'scheduler.outsideAvailability',
    'This provider is not available for the selected time.',
  )
}

async function persistEventMove(
  payload: SchedulerEventMovePayload,
): Promise<void> {
  await persistEventChange(payload, true)
}

async function persistEventResize(
  payload: SchedulerEventMovePayload,
): Promise<void> {
  await persistEventChange(payload, false)
}

async function persistEventChange(
  payload: SchedulerEventMovePayload,
  includeResource: boolean,
): Promise<void> {
  const settings = normalizedSettings.value
  if (!settings) return

  const id = eventRecordId(payload.e)
  if (id === null) return

  saving.value = true
  error.value = null
  try {
    const record = records.value.find(
      (item) => String(recordId(item, settings.event.primaryKey)) === String(id),
    )
    const { start: newStart, end: newEnd } = resolveEventChangeTarget(payload, includeResource)
    const patch: Record<string, unknown> = {
      [settings.event.startField]: dayPilotDateString(newStart),
      [settings.event.endField]: dayPilotDateString(newEnd),
    }
    if (includeResource) {
      const nextResource = resolveMoveTargetResource(payload)
      if (nextResource) {
        const field = nextResource.resource.eventField
        patch[field] = record
          ? normalizeRelationPatchValue(record, field, nextResource.id)
          : nextResource.id
      }
    }
    if (includeResource) {
      applySelectedLocationValue(patch)
    }

    const updated = await updateObjectRecord(
      settings.event.collection,
      String(id),
      patch,
    )
    patchEventRecord(id, {
      ...updated,
      ...patch,
      [settings.event.primaryKey]: id,
    })
    notifySuccess(t('scheduler.updated', 'Scheduler event updated.'))
  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : t('scheduler.failedUpdateEvent', 'Failed to update event.')
    await loadSchedulerData()
  } finally {
    saving.value = false
  }
}

/** Updates local records immediately so the calendar reflects drag/drop before the API responds. */
function applyLocalEventChange(
  payload: SchedulerEventMovePayload,
  includeResource: boolean,
): void {
  const settings = normalizedSettings.value
  const id = eventRecordId(payload.e)
  if (!settings || id === null) return

  const record = records.value.find(
    (item) => String(recordId(item, settings.event.primaryKey)) === String(id),
  )
  const { start: newStart, end: newEnd } = resolveEventChangeTarget(payload, includeResource)
  const patch: Record<string, unknown> = {
    [settings.event.startField]: dayPilotDateString(newStart),
    [settings.event.endField]: dayPilotDateString(newEnd),
  }

  let resourceChanged = false
  if (includeResource) {
    const nextResource = resolveMoveTargetResource(payload)
    if (nextResource) {
      const field = nextResource.resource.eventField
      patch[field] = record
        ? normalizeRelationPatchValue(record, field, nextResource.id)
        : nextResource.id
      resourceChanged = true
    }
    applySelectedLocationValue(patch)
  }

  patchEventRecord(id, patch, { bumpEventsVersion: resourceChanged })
}

function normalizeRelationPatchValue(
  record: Record<string, unknown>,
  field: string,
  id: string,
): string | number {
  const current = record[field]
  if (typeof current === 'number') {
    const parsed = Number(id)
    return Number.isNaN(parsed) ? id : parsed
  }
  return id
}

async function createEventFromRange(payload: SchedulerRangePayload): Promise<void> {
  const settings = normalizedSettings.value
  if (!settings || payload.resource === undefined || !canCreateEvents.value) return

  const resource = parseCalendarColumnResource(payload.resource)
  if (!resource) return

  error.value = null
  createResourceId.value = resource.id
  createResourceField.value = resource.resource.eventField
  createReadonlyFields.value = locationReadonlyFields()
  const start = resolveWeekCalendarRangeDate(payload.start, payload.resource, payload.column)
  const end = resolveWeekCalendarRangeDate(payload.end, payload.resource, payload.column)

  // Templates define capacity windows — do not block create against availability.
  if (!isTemplateExpansionMode.value) {
    const availability = settings.event.availability
    if (availability?.enabled) {
      const allowed = await isVisitAllowed(
        availability,
        resource.id,
        new Date(dayPilotDateString(start)),
        new Date(dayPilotDateString(end)),
      ).catch(() => true)
      if (!allowed) {
        error.value = t(
          'scheduler.outsideAvailability',
          'This provider is not available for the selected time.',
        )
        payload.control?.clearSelection?.()
        return
      }
    }
  }

  createInitialValues.value = isTemplateExpansionMode.value
    ? buildTemplateRangeCreateInitialValues(settings, resource, start, end)
    : buildSchedulerCreateInitialValues(settings, resource, start, end)
  applyCreateStatusSeed(createInitialValues.value)
  createDialogVisible.value = true
  payload.control?.clearSelection?.()
}

function applyCreateStatusSeed(target: Record<string, unknown>): void {
  const statusField = normalizedSettings.value?.event.statusField
  if (statusField && selectedStatusValues.value.length === 1) {
    target[statusField] = selectedStatusValues.value[0]
  }
}

function buildSchedulerCreateInitialValues(
  settings: SchedulerSettings,
  resource: { resource: SchedulerResourceRuntime; id: string },
  start: DayPilot.Date,
  end: DayPilot.Date,
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    [settings.event.startField]: dayPilotDateString(start),
    [settings.event.endField]: dayPilotDateString(end),
    [resource.resource.eventField]: resource.id,
  }

  applyCreateTitleSeed(values, settings, false)
  applySelectedLocationValue(values)
  return values
}

/**
 * Drag-select create for schedule templates: map the selected slot to a weekly
 * recurrence rule (weekday + start/end times) and validity start date.
 */
function buildTemplateRangeCreateInitialValues(
  settings: SchedulerSettings,
  resource: { resource: SchedulerResourceRuntime; id: string },
  start: DayPilot.Date,
  end: DayPilot.Date,
): Record<string, unknown> {
  const startLocal = new Date(dayPilotDateString(start))
  const validityStart = new Date(startLocal)
  validityStart.setHours(0, 0, 0, 0)

  let startTime = formatDayPilotHm(start)
  let endTime = formatDayPilotHm(end)
  if (endTime <= startTime) {
    const bumped = new Date(startLocal)
    bumped.setHours(start.getHours() + 1, start.getMinutes(), 0, 0)
    endTime = formatLocalHm(bumped)
  }

  const ruleField = settings.event.ruleField ?? 'template'
  const values: Record<string, unknown> = {
    [settings.event.startField]: localDateTimeString(validityStart),
    [resource.resource.eventField]: resource.id,
    [ruleField]: {
      frequency: 'weekly',
      weekParity: 'all',
      daysOfWeek: [isoWeekday(startLocal)],
      daysOfMonth: [],
      startTime,
      endTime,
    },
  }

  applyCreateTitleSeed(values, settings, true)
  applySelectedLocationValue(values)
  return values
}

function formatDayPilotHm(value: DayPilot.Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function formatLocalHm(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function applyCreateTitleSeed(
  target: Record<string, unknown>,
  settings: SchedulerSettings,
  isTemplate: boolean,
): void {
  const defaultTitle = settings.event.defaultTitle
    || (isTemplate
      ? t('scheduler.createTemplateDefaultTitle', 'New schedule template')
      : t('scheduler.createDefaultTitle', 'New visit'))
  const ruleField = settings.event.ruleField

  for (const field of eventTitleFields(settings)) {
    if (titleMetadata.value[field]?.relatedCollection) continue
    if (ruleField && field === ruleField) continue
    target[field] = defaultTitle
  }
}

function applySelectedLocationValue(target: Record<string, unknown>): void {
  if (!useLocationFilter.value) return

  filterLevels.value.forEach((level, i) => {
    const selected = selectedLevelIds.value[i]
    if (selected != null) target[level.groupField] = selected
  })
}

async function handleEventCreated(record: Record<string, unknown>): Promise<void> {
  const createdRecord = await fetchSchedulerEventRecord(record).catch(() => null)
  const settings = normalizedSettings.value
  records.value = [
    createdRecord ?? record,
    ...records.value.filter((item) => {
      if (!settings) return true
      return String(recordId(item, settings.event.primaryKey)) !== String(recordId(record, settings.event.primaryKey))
    }),
  ]
  createInitialValues.value = {}
  createResourceId.value = null
  createResourceField.value = null
  createReadonlyFields.value = []
  notifySuccess(
    isTemplateExpansionMode.value
      ? t('scheduler.templateCreated', 'Schedule template created.')
      : t('scheduler.created', 'Scheduler event created.'),
  )
}

function locationReadonlyFields(): string[] {
  if (!useLocationFilter.value) return []
  return filterLevels.value
    .filter((_, i) => selectedLevelIds.value[i] != null)
    .map((level) => level.groupField)
}

function openEventDetails(payload: SchedulerEventClickPayload): void {
  const settings = normalizedSettings.value
  if (!settings) return

  const id = eventRecordId(payload.e)
  if (id === null) return

  const route = router.resolve({
    name: 'record-details',
    params: {
      collection: settings.event.collection,
      id: String(id),
    },
  })
  window.open(route.href, '_blank', 'noopener')
}

function openEventEditDialog(payload: SchedulerEventClickPayload): void {
  const id = eventRecordId(payload.e)
  if (id === null) return
  editRecordId.value = id
  editDialogVisible.value = true
}

function handleEventClick(payload: SchedulerEventClickPayload): void {
  // Template design: always open the edit form dialog on slot click
  // (virtual expanded events map back to the real template record).
  if (isTemplateExpansionMode.value || eventClickAction.value === 'openEditDialog') {
    openEventEditDialog(payload)
    return
  }
  openEventDetails(payload)
}

function confirmDeleteEvent(id: string | number): void {
  const settings = normalizedSettings.value
  if (!settings) return

  confirm.require({
    message: t('datatable.confirmDeleteMessage', 'Delete this record?'),
    header: t('datatable.confirmDeleteHeader', 'Confirm Delete'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('common.delete', 'Delete'),
      severity: 'danger',
    },
    accept: () => {
      void deleteSchedulerEvent(id)
    },
  })
}

async function deleteSchedulerEvent(id: string | number): Promise<void> {
  const settings = normalizedSettings.value
  if (!settings) return

  saving.value = true
  error.value = null
  try {
    await archiveObjectRecord(settings.event.collection, String(id))
    records.value = records.value.filter(
      (record) => String(recordId(record, settings.event.primaryKey)) !== String(id),
    )
    eventsVersion.value += 1
    notifySuccess(t('scheduler.deleted', 'Scheduler event deleted.'))
  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : t('datatable.deleteError', 'Failed to delete record.')
  } finally {
    saving.value = false
  }
}

function handleEventUpdated(record: Record<string, unknown>): void {
  const settings = normalizedSettings.value
  if (!settings) return

  const id = recordId(record, settings.event.primaryKey)
  if (id === null) return

  patchEventRecord(id, record, { bumpEventsVersion: true })
  notifySuccess(t('scheduler.updated', 'Scheduler event updated.'))
  editRecordId.value = null
}

function handleEventDeleted(id: string | number): void {
  const settings = normalizedSettings.value
  if (!settings) return

  records.value = records.value.filter(
    (record) => String(recordId(record, settings.event.primaryKey)) !== String(id),
  )
  eventsVersion.value += 1
  notifySuccess(t('scheduler.deleted', 'Scheduler event deleted.'))
  editRecordId.value = null
}

function patchEventRecord(
  id: string | number,
  patch: Record<string, unknown>,
  options?: { bumpEventsVersion?: boolean },
): void {
  const settings = normalizedSettings.value
  if (!settings) return

  records.value = records.value.map((record) =>
    String(recordId(record, settings.event.primaryKey)) === String(id)
      ? mergeEventPatch(record, patch)
      : record,
  )
  if (options?.bumpEventsVersion) {
    eventsVersion.value += 1
  }
}

function addDeleteEventArea(
  event: DayPilot.EventData,
  id: string | number,
): void {
  const areas = Array.isArray(event.areas) ? [...event.areas] : []
  areas.push({
    id: 'event-delete',
    action: 'None',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    html: '&times;',
    cssClass: 'crm-scheduler__event-delete',
    toolTip: t('common.delete', 'Delete'),
    onClick: (args: { originalEvent?: MouseEvent }) => {
      args.originalEvent?.stopPropagation()
      confirmDeleteEvent(id)
    },
  })
  event.areas = areas
}

function addFallbackTooltipArea(
  event: DayPilot.EventData,
  collection: string,
  id: string | number,
): void {
  const areas = Array.isArray(event.areas) ? [...event.areas] : []
  areas.push({
    id: 'compact-tooltip',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    style: 'background: transparent;',
    visibility: 'Visible',
    onMouseEnter: (args: unknown) => showFallbackTooltip(args, collection, id),
    onMouseLeave: () => scheduleHideFallbackTooltip(),
  })
  event.areas = areas
}

function addStatusColorArea(event: DayPilot.EventData, color: string): void {
  const areas = Array.isArray(event.areas) ? [...event.areas] : []
  areas.push({
    id: 'status-color',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backColor: color,
    visibility: 'Visible',
  })
  event.areas = areas
}

function showFallbackTooltip(
  args: unknown,
  collection: string,
  id: string | number,
): void {
  clearFallbackTooltipHideTimer()
  const point = tooltipPoint(args)
  const key = [collection, id].join('.')
  fallbackTooltip.visible = true
  fallbackTooltip.key = key
  fallbackTooltip.x = Math.min(point.x + 12, window.innerWidth - 360)
  fallbackTooltip.y = Math.min(point.y + 12, window.innerHeight - 260)

  const existing = eventTooltipCache[key]
  if (existing && !existing.loading) {
    fallbackTooltip.html = compactTooltipHtml(existing)
    return
  }

  fallbackTooltip.html = compactTooltipHtml({
    loading: true,
    error: null,
    runtime: null,
  })
  void loadFallbackTooltip(key, collection, id)
}

async function loadFallbackTooltip(
  key: string,
  collection: string,
  id: string | number,
): Promise<void> {
  await ensureTooltipState(key, collection, id)
  if (fallbackTooltip.key === key) {
    fallbackTooltip.html = compactTooltipHtml(eventTooltipCache[key])
  }
}

function scheduleHideFallbackTooltip(): void {
  clearFallbackTooltipHideTimer()
  fallbackTooltipHideTimer = window.setTimeout(() => {
    fallbackTooltip.visible = false
    fallbackTooltip.key = null
  }, 150)
}

function clearFallbackTooltipHideTimer(): void {
  if (fallbackTooltipHideTimer === null) return
  window.clearTimeout(fallbackTooltipHideTimer)
  fallbackTooltipHideTimer = null
}

function createEventBubble(): unknown {
  const Bubble = (DayPilot as unknown as { Bubble?: new(options: unknown) => unknown }).Bubble
  if (!Bubble) return undefined

  return new Bubble({
    onLoad: (args: BubbleLoadArgs) => {
      const collection = args.source?.data?.tags?.collection
      const id = args.source?.data?.tags?.id ?? args.source?.id?.()
      if (!collection || (typeof id !== 'string' && typeof id !== 'number')) {
        args.html = compactTooltipHtml({
          loading: false,
          error: t(
            'scheduler.compactDetailsUnavailable',
            'Event details are not available.',
          ),
          runtime: null,
        })
        return
      }

      const key = [collection, id].join('.')
      const existing = eventTooltipCache[key]
      if (existing && !existing.loading) {
        args.html = compactTooltipHtml(existing)
        return
      }

      args.async = true
      args.html = compactTooltipHtml({
        loading: true,
        error: null,
        runtime: null,
      })
      void loadBubbleTooltip(key, collection, id, args)
    },
  })
}

async function loadBubbleTooltip(
  key: string,
  collection: string,
  id: string | number,
  args: BubbleLoadArgs,
): Promise<void> {
  await ensureTooltipState(key, collection, id)
  args.html = compactTooltipHtml(eventTooltipCache[key])
  args.loaded?.()
}

async function ensureTooltipState(
  key: string,
  collection: string,
  id: string | number,
): Promise<void> {
  if (!eventTooltipCache[key]) {
    eventTooltipCache[key] = {
      loading: true,
      error: null,
      runtime: null,
    }
  }
  if (!eventTooltipCache[key].loading && (
    eventTooltipCache[key].runtime ||
    eventTooltipCache[key].error
  )) {
    return
  }

  try {
    eventTooltipCache[key].runtime = await fetchCompactRecordDetails(collection, id)
  } catch (err) {
    eventTooltipCache[key].error =
      err instanceof Error
        ? err.message
        : t('scheduler.failedLoadCompactDetails', 'Failed to load compact details.')
  } finally {
    eventTooltipCache[key].loading = false
  }
}

function tooltipPoint(args: unknown): { x: number; y: number } {
  const payload = args && typeof args === 'object'
    ? (args as Record<string, unknown>)
    : {}
  const event = (
    payload.originalEvent ??
    payload.event ??
    payload.e
  ) as MouseEvent | undefined
  if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return { x: event.clientX, y: event.clientY }
  }

  const source = payload.source
  const div =
    source && typeof source === 'object'
      ? (source as Record<string, unknown>).div
      : payload.div
  if (div instanceof HTMLElement) {
    const rect = div.getBoundingClientRect()
    return { x: rect.left, y: rect.bottom }
  }

  return { x: 16, y: 16 }
}

function compactTooltipHtml(state: CompactTooltipRuntimeState): string {
  if (state.loading) {
    return `<div class="crm-scheduler-bubble"><p class="crm-scheduler-bubble__muted">${escapeHtml(t('common.loadingDetails', 'Loading details...'))}</p></div>`
  }
  if (state.error) {
    return `<div class="crm-scheduler-bubble"><p class="crm-scheduler-bubble__error">${escapeHtml(state.error)}</p></div>`
  }
  if (!state.runtime?.schema) {
    return `<div class="crm-scheduler-bubble"><p class="crm-scheduler-bubble__muted">${escapeHtml(t('common.noCompactDetailsConfigured', 'No compact details configured.'))}</p></div>`
  }

  const fields = state.runtime.fields.length
    ? `<dl class="crm-scheduler-bubble__fields">${state.runtime.fields
        .map((field) => `
          <div class="crm-scheduler-bubble__field">
            <dt>${escapeHtml(field.label)}</dt>
            <dd>${escapeHtml(field.value)}</dd>
          </div>
        `)
        .join('')}</dl>`
    : ''
  const counts = state.runtime.relatedCounts.length
    ? `<div class="crm-scheduler-bubble__counts">${state.runtime.relatedCounts
        .map((item) => `
          <div class="crm-scheduler-bubble__count">
            <a
              class="crm-scheduler-bubble__count-link"
              href="${escapeHtml(compactRelatedListHref(
                state.runtime!.collection,
                state.runtime!.id,
                item.relatedCollection,
              ))}"
              target="_blank"
              rel="noopener noreferrer"
            >${escapeHtml(item.label)}</a>
            <strong>${escapeHtml(String(item.count))}</strong>
          </div>
        `)
        .join('')}</div>`
    : ''
  const empty = !fields && !counts
    ? `<p class="crm-scheduler-bubble__muted">${escapeHtml(t('common.compactDetailsEmpty', 'Compact details are empty.'))}</p>`
    : ''

  return `<div class="crm-scheduler-bubble">${fields}${empty}${counts}</div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function mergeEventPatch(
  record: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...record, ...patch }
  const resourceField = schedulerResourceDefinition.value?.eventField
  for (const metadata of Object.values(titleMetadata.value)) {
    if (resourceField && metadata.field === resourceField) continue
    if (
      metadata.relatedCollection &&
      hasOwn(patch, metadata.field) &&
      record[metadata.field] &&
      typeof record[metadata.field] === 'object' &&
      (patch[metadata.field] === null ||
        typeof patch[metadata.field] !== 'object')
    ) {
      merged[metadata.field] = record[metadata.field]
    }
  }
  if (resourceField && hasOwn(patch, resourceField)) {
    merged[resourceField] = patch[resourceField]
  }

  return merged
}

async function readDynamicItems(
  collection: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  return bridgeReadItems(collection, params)
}

async function fetchSchedulerEventRecord(
  record: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const settings = normalizedSettings.value
  if (!settings) return null

  const id = recordId(record, settings.event.primaryKey)
  if (id === null) return null

  const eventRequest = await schedulerEventRequest(settings)
  return bridgeReadItem(settings.event.collection, id, {
    fields: eventRequest.fields,
  })
}

async function schedulerEventRequest(
  settings: SchedulerSettings,
): Promise<{ fields: string[]; titleMetadata: Record<string, SchedulerTitleMetadata> }> {
  const fields = new Set([
    settings.event.primaryKey,
    settings.event.startField,
    settings.event.endField,
    settings.event.resourceField,
    settings.event.statusField,
    settings.event.sourceMode === 'templateExpansion' ? settings.event.ruleField : null,
  ].filter(Boolean) as string[])
  const allFields = await getCachedFields()
  const relations = await getCachedRelations()
  const metadata: Record<string, SchedulerTitleMetadata> = {}
  for (const resource of schedulerResourceDefinitions(settings)) {
    fields.add(resource.eventField)
  }
  const location = settings.resource.filter
  if (location?.enabled && location.groupField) {
    fields.add(location.groupField)
  }

  for (const titleFieldName of eventTitleFields(settings)) {
    const titleField = allFields.find(
      (field) =>
        field.collection === settings.event.collection &&
        field.field === titleFieldName,
    )
    const relation = relations.find(
      (item) =>
        item.collection === settings.event.collection &&
        item.field === titleFieldName,
    )
    // Skip title fields that don't exist on the collection (e.g. a renamed or
    // misconfigured layout). Requesting an unknown field makes the records API
    // reject the whole request and breaks the entire scheduler load.
    if (!titleField && !relation) {
      continue
    }

    const special = normalizeSpecial(titleField?.meta?.special)
    const relatedCollection = relation?.related_collection ?? undefined
    const isM2O = Boolean(relatedCollection) && (
      special.includes('m2o') || Boolean(relation?.related_collection)
    )

    if (!isM2O) {
      fields.add(titleFieldName)
      continue
    }

    fields.delete(titleFieldName)
    fields.add(`${titleFieldName}.id`)

    const relatedFields = allFields.filter(
      (field) => field.collection === relatedCollection,
    )
    const template =
      typeof titleField?.meta?.options?.template === 'string' &&
      titleField.meta.options.template.trim()
        ? titleField.meta.options.template
        : undefined
    const templateFields = template ? extractTemplateFields(template) : []
    const useTemplate = shouldUseTemplateForRelatedLabel(template, templateFields)
    const displayField = relatedRecordDisplayField(relatedFields)

    if (useTemplate && template) {
      for (const field of templateFields) {
        fields.add(`${titleFieldName}.${field}`)
      }
    } else {
      fields.add(`${titleFieldName}.${displayField}`)
    }

    metadata[titleFieldName] = {
      field: titleFieldName,
      relatedCollection,
      template: useTemplate ? template : undefined,
      displayField,
    }
  }

  return { fields: Array.from(fields), titleMetadata: metadata }
}

function formatEventTitle(
  record: Record<string, unknown>,
  settings: SchedulerSettings,
): string {
  const title = eventTitleFields(settings)
    .map((field) => formatEventTitleField(record, field))
    .filter(Boolean)
    .join(' · ')

  return title || settings.event.defaultTitle || t('scheduler.defaultTitle', 'Visit')
}

function eventTitleFields(settings: SchedulerSettings): string[] {
  const fields = settings.event.titleFields?.length
    ? settings.event.titleFields
    : [settings.event.titleField]
  return Array.from(new Set(fields.filter((field) => field.trim())))
}

function formatEventTitleField(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field]
  const metadata = titleMetadata.value[field]
  if (metadata?.relatedCollection) {
    return formatRelatedEventTitle(value, metadata)
  }

  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

function eventBackColor(
  record: Record<string, unknown>,
  settings: SchedulerSettings,
): string | null {
  if (!settings.event.statusField) return null
  const statusValue = record[settings.event.statusField]
  if (statusValue === null || statusValue === undefined || statusValue === '') {
    return null
  }

  const backColor = settings.event.statusColors?.[String(statusValue)]
  return typeof backColor === 'string' && backColor.trim()
    ? backColor.trim()
    : null
}

function formatRelatedEventTitle(
  value: unknown,
  metadata: SchedulerTitleMetadata,
): string {
  const id = scalarId(value)
  if (!value || typeof value !== 'object') return String(id ?? '')

  const row = value as Record<string, unknown>
  if (metadata.template) {
    return renderTemplateLabel(metadata.template, row)
  }

  if (metadata.displayField) {
    const displayValue = row[metadata.displayField]
    if (displayValue !== null && displayValue !== undefined && displayValue !== '') {
      return String(displayValue)
    }
  }

  return relatedRecordFallbackLabel(row, id)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function eventRecordId(event: DayPilot.Event): string | number | null {
  const dataTags = (event.data as {
    tags?: { recordId?: unknown; id?: unknown }
  } | undefined)?.tags

  const dataRecordId = dataTags?.recordId ?? dataTags?.id
  if (typeof dataRecordId === 'string' || typeof dataRecordId === 'number') {
    return dataRecordId
  }

  const taggedId = event.tag('recordId') ?? event.tag('id')
  if (typeof taggedId === 'string' || typeof taggedId === 'number') {
    return taggedId
  }

  const idValue = event.id()
  return typeof idValue === 'string' || typeof idValue === 'number'
    ? idValue
    : null
}

function dayPilotDateString(value: DayPilot.Date): string {
  return value.toString().slice(0, 19)
}

function schedulerTimeHeaders(): DayPilot.TimeHeaderData[] {
  if (rangeView.value === 'week') {
    return [
      { groupBy: 'Month' },
      { groupBy: 'Day', format: 'ddd d' },
    ]
  }

  if (rangeView.value === 'month') {
    return [
      { groupBy: 'Month' },
      { groupBy: 'Day', format: 'd' },
    ]
  }

  return [
    { groupBy: 'Day', format: 'dddd, MMMM d' },
    { groupBy: 'Hour' },
  ]
}

function updateSchedulerViewportWidth(): void {
  schedulerViewportWidth.value = schedulerViewport.value?.clientWidth ?? 0
}

function toggleResourceFilterItem(item: ResourceFilterItem): void {
  if (item.resourceIds.length === 0) return

  const selected = new Set(selectedResourceIds.value)
  const allSelected = item.resourceIds.every((resourceId) => selected.has(resourceId))
  if (allSelected) {
    selectedResourceIds.value = selectedResourceIds.value.filter(
      (resourceId) => !item.resourceIds.includes(resourceId),
    )
    return
  }

  selectedResourceIds.value = Array.from(new Set([
    ...selectedResourceIds.value,
    ...item.resourceIds,
  ]))
}

function isResourceFilterItemSelected(item: ResourceFilterItem): boolean {
  return item.resourceIds.length > 0 &&
    item.resourceIds.every((resourceId) => selectedResourceIds.value.includes(resourceId))
}

function toggleStatusFilter(status: string): void {
  selectedStatusValues.value = toggleFilterValue(selectedStatusValues.value, status)
}

function toggleFilterValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function clearResourceFilters(): void {
  selectedResourceIds.value = []
}

function clearStatusFilters(): void {
  selectedStatusValues.value = []
}

function dateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function weekStart(date: Date): Date {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)
  return start
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}
</script>

<template>
  <div class="crm-scheduler grid gap-2">
    <Message
      v-if="!normalizedSettings"
      severity="warn"
      :closable="false"
    >
      {{ t('scheduler.settingsNotConfigured', 'Scheduler settings are not configured.') }}
    </Message>
    <Message
      v-else-if="!normalizedSettings.resource.collection || !normalizedSettings.event.collection"
      severity="warn"
      :closable="false"
    >
      {{ t('scheduler.selectCollections', 'Select resource and event collections to render scheduler.') }}
    </Message>
    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="mb-1"
    >
      {{ error }}
    </Message>

    <div class="grid grid-cols-[220px_minmax(0,1fr)] gap-2 w-full items-start max-[960px]:grid-cols-1">
      <aside class="grid gap-2 w-[220px] min-w-0 max-[960px]:w-full">
        <Card class="crm-scheduler__side-card min-w-0 overflow-hidden w-full">
          <template #title>{{ t('scheduler.calendar', 'Calendar') }}</template>
          <template #content>
            <DatePicker
              v-model="selectedDate"
              class="crm-scheduler__calendar-picker block text-[0.7rem] max-w-full overflow-hidden"
              inline
              fluid
            />
          </template>
        </Card>

        <Card
          v-if="useLocationFilter"
          class="crm-scheduler__side-card min-w-0 overflow-hidden w-full"
        >
          <template #title>
            <div class="flex items-center gap-3 justify-between">
              <span>{{ locationBlockTitle }}</span>
            </div>
          </template>
          <template #content>
            <div class="grid gap-3">
              <template
                v-for="(group, index) in levelFilterGroups"
                :key="group.groupField || index"
              >
                <div
                  v-if="useFilterTree && index === filterTreeLevelIndex"
                  class="crm-scheduler__filter-group"
                >
                  <span>{{ group.title }}</span>
                  <Tree
                    :value="filterTreeNodes"
                    selection-mode="single"
                    :selection-keys="filterTreeSelectedKeys"
                    class="crm-scheduler__filter-tree !border-0 !p-0 text-[0.8rem] font-normal"
                    @update:selection-keys="onSelectFilterTreeKeys"
                  >
                    <template #default="{ node }">
                      <span class="rounded inline-flex py-0.5 px-1">{{ node.label }}</span>
                    </template>
                  </Tree>
                  <p
                    v-if="filterTreeNodes.length === 0"
                    class="text-muted-color text-[0.8rem] m-0 font-normal"
                  >
                    {{ t('scheduler.noFilters', 'No filters.') }}
                  </p>
                </div>
                <label
                  v-else
                  class="crm-scheduler__filter-group"
                >
                  <span>{{ group.title }}</span>
                  <Select
                    :model-value="selectedLevelIds[index] ?? null"
                    :options="group.items"
                    option-label="name"
                    option-value="id"
                    :placeholder="`${t('scheduler.select', 'Select')} ${group.title}`"
                    :show-clear="index > 0"
                    fluid
                    @update:model-value="onSelectLevel(index, $event)"
                  />
                </label>
              </template>
              <p v-if="levelFilterGroups.length === 0" class="text-muted-color text-[0.8rem] m-0">
                {{ t('scheduler.noFilters', 'No filters.') }}
              </p>
            </div>
          </template>
        </Card>

        <Card class="crm-scheduler__side-card min-w-0 overflow-hidden w-full">
          <template #title>
            <div class="flex items-center gap-3 justify-between">
              <span>{{ resourceBlockTitle }}</span>
              <Button
                v-if="selectedResourceIds.length"
                :label="t('common.all', 'All')"
                size="small"
                text
                @click="clearResourceFilters"
              />
            </div>
          </template>
          <template #content>
            <div class="grid gap-[0.4rem] content-start overflow-x-hidden overflow-y-auto" style="height: calc(1.25rem * 5 + 0.4rem * 4); max-height: calc(1.25rem * 5 + 0.4rem * 4)">
              <label
                v-for="item in resourceFilterItems"
                :key="item.id"
                class="crm-scheduler__check-row min-h-5"
                :style="{ paddingLeft: `${item.depth * 0.85}rem` }"
              >
                <Checkbox
                  :model-value="isResourceFilterItemSelected(item)"
                  :binary="true"
                  @update:model-value="toggleResourceFilterItem(item)"
                />
                <span>{{ item.name }}</span>
              </label>
            </div>
            <p v-if="resourceFilterItems.length === 0" class="text-muted-color text-[0.8rem] m-0">
              {{ t('scheduler.noResources', 'No resources.') }}
            </p>
          </template>
        </Card>

        <Card class="crm-scheduler__side-card min-w-0 overflow-hidden w-full">
          <template #title>
            <div class="flex items-center gap-3 justify-between">
              <span>{{ t('scheduler.status', 'Status') }}</span>
              <Button
                v-if="selectedStatusValues.length"
                :label="t('common.all', 'All')"
                size="small"
                text
                @click="clearStatusFilters"
              />
            </div>
          </template>
          <template #content>
            <div v-if="statusOptions.length" class="grid gap-[0.4rem] max-h-56 overflow-auto">
              <label
                v-for="item in statusOptions"
                :key="item.value"
                class="crm-scheduler__check-row"
              >
                <Checkbox
                  :model-value="selectedStatusValues.includes(item.value)"
                  :binary="true"
                  @update:model-value="toggleStatusFilter(item.value)"
                />
                <span
                  v-if="item.color"
                  class="border border-surface-300 rounded-full inline-block h-3 w-3"
                  :style="{ backgroundColor: item.color }"
                  aria-hidden="true"
                />
                <span>{{ item.label }}</span>
              </label>
            </div>
            <p v-else class="text-muted-color text-[0.8rem] m-0">
              {{ t('scheduler.statusFieldHint', 'Select a status field in Scheduler settings.') }}
            </p>
          </template>
        </Card>
      </aside>

      <section class="grid overflow-hidden w-full min-w-0">
        <Card class="crm-scheduler__calendar-card min-w-0 overflow-hidden w-full">
          <template #title>
            <div class="flex items-center gap-3 flex-wrap justify-between">
              <SelectButton
                v-model="rangeView"
                :options="rangeViewOptions"
                option-label="label"
                option-value="value"
                size="small"
                :allow-empty="false"
                class="crm-scheduler__range-tabs"
              />
              <div class="flex items-center gap-2">
                <Button
                  :label="t('common.refresh', 'Refresh')"
                  icon="pi pi-refresh"
                  size="small"
                  text
                  :disabled="loading || saving"
                  @click="loadSchedulerData"
                />
                <span v-if="saving" class="text-muted-color text-[0.85rem]">
                  {{ t('common.saving', 'Saving...') }}
                </span>
              </div>
            </div>
          </template>
          <template #content>
            <div
              ref="schedulerViewport"
              class="crm-scheduler__viewport min-w-0 w-full"
              :class="{
                'crm-scheduler__viewport--day': isDayResourceCalendar,
                'crm-scheduler__viewport--week': isWeekResourceCalendar,
                'crm-scheduler__viewport--week-scroll': weekCalendarUseFixedColumns,
              }"
            >
              <div v-if="loading" class="crm-scheduler__loading flex items-center gap-3 text-muted-color text-[0.85rem]">
                <ProgressSpinner stroke-width="4" />
                <span>{{ t('scheduler.loadingScheduler', 'Loading scheduler...') }}</span>
              </div>
              <DayPilotCalendar
                v-else-if="useResourceCalendarView"
                :key="`calendar-${schedulerRenderKey}`"
                :config="calendarConfig"
              />
              <DayPilotScheduler
                v-else-if="normalizedSettings"
                :key="`scheduler-${schedulerRenderKey}`"
                :config="schedulerConfig"
              />
            </div>
          </template>
        </Card>
      </section>
    </div>

    <div
      v-if="fallbackTooltip.visible"
      class="bg-surface-0 border border-surface-300 rounded-lg shadow-[0_16px_38px_rgb(15_23_42/18%)] max-w-[360px] p-3 fixed z-[1000]"
      :style="{
        left: `${fallbackTooltip.x}px`,
        top: `${fallbackTooltip.y}px`,
      }"
      @mouseenter="clearFallbackTooltipHideTimer"
      @mouseleave="scheduleHideFallbackTooltip"
      v-html="fallbackTooltip.html"
    />

    <RecordCreateDialog
      v-if="normalizedSettings?.event.collection"
      :visible="createDialogVisible"
      :collection="normalizedSettings.event.collection"
      :parent-field="createResourceField || normalizedSettings.event.resourceField || undefined"
      :parent-id="createResourceId ?? undefined"
      :initial-values="createInitialValues"
      :readonly-fields="createReadonlyFields"
      @update:visible="createDialogVisible = $event"
      @created="handleEventCreated"
    />

    <RecordEditDialog
      v-if="normalizedSettings?.event.collection"
      :visible="editDialogVisible"
      :collection="normalizedSettings.event.collection"
      :record-id="editRecordId"
      :primary-key="normalizedSettings.event.primaryKey"
      :allow-delete="allowEventDelete"
      @update:visible="editDialogVisible = $event"
      @updated="handleEventUpdated"
      @deleted="handleEventDeleted"
    />
  </div>
</template>

<style scoped>
.crm-scheduler {
  --sched-wash: #edf3f4;
  --sched-ink: #37352f;
  font-family: Inter, system-ui, sans-serif;
  color: var(--sched-ink);
}

.crm-scheduler__side-card,
.crm-scheduler__calendar-card {
  background: var(--sched-wash);
  border: 0;
  border-radius: 8px;
  box-shadow: none;
}

.crm-scheduler__side-card :deep(.p-card-body),
.crm-scheduler__calendar-card :deep(.p-card-body) {
  min-width: 0;
  overflow: hidden;
  padding: 0.55rem 0.5rem 0.65rem;
  background: transparent;
}

.crm-scheduler__side-card :deep(.p-card-title),
.crm-scheduler__calendar-card :deep(.p-card-title) {
  color: #111;
  font-size: 0.88rem;
  font-weight: 600;
  margin: 0;
}

.crm-scheduler__side-card :deep(.p-card-content),
.crm-scheduler__calendar-card :deep(.p-card-content) {
  min-width: 0;
  overflow: hidden;
  padding: 0.45rem 0 0;
}

.crm-scheduler__filter-group {
  display: grid;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.crm-scheduler__check-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.2;
  color: var(--sched-ink);
}

.crm-scheduler__range-tabs {
  background: rgba(255, 255, 255, 0.55);
  border-radius: 8px;
  padding: 0.15rem;
}

.crm-scheduler__range-tabs :deep(.p-togglebutton) {
  border: 0;
  background: transparent;
  color: rgba(55, 53, 47, 0.62);
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 6px;
}

.crm-scheduler__range-tabs :deep(.p-togglebutton.p-togglebutton-checked),
.crm-scheduler__range-tabs :deep(.p-togglebutton[data-p-checked='true']) {
  background: #fff;
  color: var(--sched-ink);
  box-shadow: 0 0 0 1px rgba(55, 53, 47, 0.08), 0 1px 2px rgba(55, 53, 47, 0.08);
}

.crm-scheduler__calendar-picker :deep(.p-datepicker) {
  border: 0;
  box-shadow: none;
  min-width: 0;
  padding: 0;
  width: 100%;
  background: transparent;
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-header) {
  gap: 0.15rem;
  padding: 0.15rem;
  background: transparent;
  border: 0;
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-title) {
  gap: 0.2rem;
  font-size: 0.8rem;
  color: var(--sched-ink);
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-calendar) {
  table-layout: fixed;
  width: 100%;
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-calendar th),
.crm-scheduler__calendar-picker :deep(.p-datepicker-calendar td) {
  padding: 0.05rem;
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-weekday) {
  color: rgba(55, 53, 47, 0.45);
  font-size: 0.65rem;
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-day) {
  height: 1.45rem;
  min-width: 1.45rem;
  width: 1.45rem;
  color: var(--sched-ink);
}

.crm-scheduler__calendar-picker :deep(.p-datepicker-day.p-datepicker-day-selected),
.crm-scheduler__calendar-picker :deep(.p-datepicker-day[data-p-selected='true']) {
  background: #fff;
  color: var(--sched-ink);
  box-shadow: 0 0 0 1px rgba(55, 53, 47, 0.12);
}

.crm-scheduler__filter-tree {
  max-height: 14rem;
  overflow: auto;
}

.crm-scheduler__filter-tree :deep(.p-tree-node-content) {
  padding: 0.15rem 0.25rem;
  border-radius: 6px;
}

.crm-scheduler__filter-tree :deep(.p-tree-node-selected > .p-tree-node-content),
.crm-scheduler__filter-tree :deep(.p-tree-node-content[data-p-selected='true']) {
  background: #fff;
  color: var(--sched-ink);
}

.crm-scheduler__viewport :deep(.scheduler_default_main),
.crm-scheduler__viewport :deep(.calendar_default_main) {
  max-width: 100%;
}

.crm-scheduler__viewport--day {
  --crm-day-header-height: 36px;
}

.crm-scheduler__viewport--day :deep(.calendar_default_colheader_cell) {
  height: var(--crm-day-header-height);
  min-height: var(--crm-day-header-height);
  padding: 0;
  vertical-align: middle;
}

.crm-scheduler__viewport--day :deep(.calendar_default_colheader_inner) {
  height: 100%;
}

.crm-scheduler__viewport--day :deep(.crm-scheduler__day-resource-header) {
  align-items: center;
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
  box-sizing: border-box;
  display: flex;
  height: var(--crm-day-header-height);
  justify-content: center;
  padding: 0 0.35rem;
}

.crm-scheduler__viewport--day :deep(.crm-scheduler__day-resource-label) {
  font-size: 0.8rem;
  font-weight: 500;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.crm-scheduler__viewport--week {
  --crm-week-header-height: 60px;
  overflow-x: auto;
  overflow-y: hidden;
}

.crm-scheduler__viewport--week-scroll :deep(.calendar_default_main) {
  max-width: none;
  min-width: min-content;
}

.crm-scheduler__viewport--week :deep(.calendar_default_colheader) {
  font-size: 0.75rem;
  line-height: 1.2;
}

.crm-scheduler__viewport--week :deep(.calendar_default_colheader_cell) {
  height: var(--crm-week-header-height);
  min-height: var(--crm-week-header-height);
  padding: 0;
  vertical-align: top;
}

.crm-scheduler__viewport--week :deep(.calendar_default_colheader_inner) {
  height: 100%;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-flat-header) {
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
  box-sizing: border-box;
  height: var(--crm-week-header-height);
  padding: 0;
  vertical-align: top;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-flat-header--today) {
  background: color-mix(in srgb, var(--p-primary-50) 70%, var(--p-surface-0));
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-flat-header--day-start) {
  border-left: 1px solid var(--p-surface-300);
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-flat-header-body) {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: var(--crm-week-header-height);
  justify-content: space-between;
  padding: 0.3rem 0.35rem 0.35rem;
  width: 100%;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day) {
  align-items: center;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 0.05rem;
  justify-content: center;
  min-height: 1.5rem;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day--empty) {
  visibility: hidden;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-resource-label) {
  display: block;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.2;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day-weekday) {
  color: var(--p-text-muted-color);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day-number) {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day-header) {
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
  font-weight: 600;
  vertical-align: middle;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day-header--today) {
  background: color-mix(in srgb, var(--p-primary-50) 70%, var(--p-surface-0));
  color: var(--p-primary-700);
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-day-header--start) {
  border-left: 1px solid var(--p-surface-200);
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-resource-header) {
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
  padding: 0.2rem 0.35rem;
  vertical-align: bottom;
}

.crm-scheduler__viewport--week :deep(.crm-scheduler__week-resource-header--start) {
  border-left: 1px solid var(--p-surface-200);
}

.crm-scheduler__loading :deep(.p-progressspinner) {
  height: 1.5rem;
  width: 1.5rem;
}

.crm-scheduler__viewport :deep(.crm-scheduler__event-delete) {
  align-items: center;
  background: rgb(0 0 0 / 40%);
  border-radius: 3px;
  color: #fff;
  cursor: pointer;
  display: flex;
  font-size: 14px;
  font-weight: 700;
  justify-content: center;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.crm-scheduler__viewport :deep(.calendar_default_event:hover .crm-scheduler__event-delete),
.crm-scheduler__viewport :deep(.scheduler_default_event:hover .crm-scheduler__event-delete) {
  opacity: 1;
}
</style>
