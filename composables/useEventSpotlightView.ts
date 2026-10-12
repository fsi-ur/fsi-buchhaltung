import { computed, type Ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { EventSpotlight } from '~/types/event'
import type { EventPlanningTabKey } from '~/components/Page/Events/planning/types'

export type EventSummaryTileVariant = 'ok' | 'warning' | 'neutral'

export interface EventSummaryTile {
  label: string
  value: string
  icon: string
  variant: EventSummaryTileVariant
  tab: EventPlanningTabKey
}

/** Shared presentation logic for an event spotlight/widget: labels, date range and planning summary tiles. */
export function useEventSpotlightView(event: Ref<EventSpotlight | null>) {
  const { t } = useI18n()
  const { formatDate, formatDateTime } = useLocaleFormatters()

  const statusLabel = computed(() => {
    if (!event.value) return ''
    if (event.value.status === 'ongoing') return t('event.spotlight.ongoingLabel')
    if (event.value.status === 'past') return t('event.spotlight.latestLabel')
    return t('event.spotlight.upcomingLabel')
  })

  const countdownLabel = computed(() => {
    const days = event.value?.daysToStart
    if (days == null) return ''
    if (days > 0) return t('event.planning.daysUntilEvent', { days })
    if (days === 0) return t('event.planning.eventToday')
    return t('event.planning.daysPastEvent', { days: Math.abs(days) })
  })

  const rangeLabel = computed(() => {
    const active = event.value
    if (!active) return ''
    if (active.starts_at && active.ends_at) {
      const sameDay = active.starts_at.slice(0, 10) === active.ends_at.slice(0, 10)
      return sameDay
        ? `${formatDateTime(active.starts_at)} – ${formatTime(active.ends_at)}`
        : `${formatDateTime(active.starts_at)} – ${formatDateTime(active.ends_at)}`
    }
    return formatDateTime(active.starts_at || active.ends_at)
  })

  const organizerLabels = computed(() => {
    const active = event.value
    if (!active) return []
    return [
      ...active.subdivision_organizers.map(o => `${o.code} - ${o.name}`),
      ...active.member_organizers.map(o => o.full_name),
    ]
  })

  const summaryTiles = computed<EventSummaryTile[]>(() => {
    const active = event.value
    if (!active?.planning) return []
    const { tasks, shifts, checklists, details } = active.planning

    const masterComplete = details.locationSet && details.guestsSet
    const masterTile: EventSummaryTile = {
      label: t('event.masterData'),
      value: masterComplete
        ? t('event.planning.statusText.complete')
        : details.locationSet || details.guestsSet
          ? t('event.planning.statusText.partiallySet')
          : t('event.planning.statusText.notSet'),
      icon: 'material-symbols:info-outline-rounded',
      variant: masterComplete ? 'ok' : details.locationSet || details.guestsSet ? 'warning' : 'neutral',
      tab: 'details',
    }

    const tasksTile: EventSummaryTile = {
      label: t('event.planning.tabs.tasks'),
      value: tasks.total === 0
        ? t('event.planning.statusText.noneYet')
        : t('event.spotlight.tasksDone', { done: tasks.done, total: tasks.total }),
      icon: 'material-symbols:task-alt-rounded',
      variant: tasks.total === 0 ? 'neutral' : tasks.open === 0 ? 'ok' : 'warning',
      tab: 'tasks',
    }

    const shiftsTile: EventSummaryTile = {
      label: t('event.planning.tabs.shifts'),
      value: shifts.total === 0
        ? t('event.planning.statusText.noneYet')
        : t('event.planning.staffedCount', { current: shifts.fullyStaffed, required: shifts.total }),
      icon: 'material-symbols:calendar-month-rounded',
      variant: shifts.total === 0 ? 'neutral' : shifts.unstaffed === 0 ? 'ok' : 'warning',
      tab: 'shifts',
    }

    const checklistsTile: EventSummaryTile = {
      label: t('event.planning.tabs.checklists'),
      value: checklists.totalItems === 0
        ? t('event.planning.statusText.noneYet')
        : t('event.planning.checklistItemsDone', { done: checklists.doneItems, total: checklists.totalItems }),
      icon: 'material-symbols:checklist-rounded',
      variant: checklists.totalItems === 0 ? 'neutral' : checklists.doneItems === checklists.totalItems ? 'ok' : 'warning',
      tab: 'checklists',
    }

    return [masterTile, tasksTile, shiftsTile, checklistsTile]
  })

  function formatTime(value?: string | null) {
    if (!value) return ''
    const full = formatDateTime(value)
    const date = formatDate(value)
    // Strip the leading date portion to keep just the time when on the same day.
    return full.startsWith(date) ? full.slice(date.length).trim().replace(/^[,·\s]+/, '') : full
  }

  return { statusLabel, countdownLabel, rangeLabel, organizerLabels, summaryTiles }
}
