<template>
  <section class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ t('event.planning.timeline') }}</h2>
        <p class="text-sm text-base-500">{{ t('event.planning.timelineHint') }}</p>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        v-for="filter in kindFilters"
        :key="filter.kind ?? 'all'"
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors"
        :class="activeFilter === filter.kind
          ? filter.activeClass
          : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
        @click="activeFilter = filter.kind"
      >
        <Icon :name="filter.icon" />
        {{ filter.label }}
        <span
          class="rounded-full px-1.5 text-xs font-semibold tabular-nums"
          :class="activeFilter === filter.kind ? filter.chipClass : 'bg-base-100 text-base-500'"
        >
          {{ filter.count }}
        </span>
      </button>
    </div>

    <template v-if="!items.length">
      <div class="mt-10 flex flex-col items-center gap-3 text-center">
        <p class="font-medium text-base-700">{{ t('event.planning.noTimelineItems') }}</p>
        <p class="text-sm text-base-500">{{ t('event.planning.noTimelineItemsHint') }}</p>
        <div class="mt-2 flex gap-2">
          <button type="button" class="btn-secondary text-sm" @click="emit('navigate', 'tasks')">
            {{ t('event.planning.tabs.tasks') }}
          </button>
          <button type="button" class="btn-secondary text-sm" @click="emit('navigate', 'shifts')">
            {{ t('event.planning.tabs.shifts') }}
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="!groupedItems.length">
      <div class="mt-10 flex flex-col items-center gap-2 text-center">
        <p class="text-sm text-base-500">{{ t('event.planning.noTimelineItemsFiltered') }}</p>
      </div>
    </template>

    <div v-else class="relative mt-6 pl-8">
      <div class="absolute left-3 top-3 bottom-3 w-0.5 bg-base-200" aria-hidden="true" />

      <div v-if="pastItemCount > 0" class="relative mb-6">
        <div class="absolute -left-8 flex h-6 w-6 items-center justify-center">
          <div class="h-3 w-3 rounded-full border-2 border-white bg-base-300 ring-1 ring-base-300" />
        </div>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-base-500 transition-colors hover:text-base-700"
          @click="showPast = !showPast"
        >
          <Icon :name="showPast ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'" />
          {{ showPast ? t('event.planning.hidePastItems') : t('event.planning.showPastItems', { count: pastItemCount }) }}
        </button>
      </div>

      <div v-for="group in displayGroups" :key="group.dateKey" class="relative mb-6 last:mb-0">
        <div class="absolute -left-8 flex h-6 w-6 items-center justify-center">
          <div
            class="h-4 w-4 rounded-full border-2 border-white ring-1"
            :class="group.isToday
              ? 'bg-accent-500 ring-accent-400'
              : group.isPast
                ? 'bg-base-300 ring-base-300'
                : 'bg-base-500 ring-base-400'"
          />
        </div>

        <div class="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            class="text-sm font-semibold"
            :class="group.isToday ? 'text-accent-600' : group.isPast ? 'text-base-400' : 'text-base-700'"
          >
            {{ group.weekday }}, {{ group.dateLabel }}
          </span>
          <span
            v-if="group.isToday"
            class="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-700"
          >
            {{ t('event.planning.today') }}
          </span>
          <span v-else-if="group.relativeLabel" class="text-xs font-medium" :class="group.isPast ? 'text-base-400' : 'text-base-500'">
            {{ group.relativeLabel }}
          </span>
        </div>

        <p v-if="!group.items.length" class="text-xs text-base-400">{{ t('event.planning.noItemsToday') }}</p>

        <div v-else class="space-y-4">
          <div v-for="cluster in group.clusters" :key="cluster.key">
            <p class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-base-400">
              <Icon name="material-symbols:schedule-rounded" class="text-sm" />
              {{ cluster.timeLabel }}
              <span
                v-if="cluster.items.length > 1"
                class="rounded-full bg-base-100 px-1.5 text-[0.7rem] font-semibold tabular-nums text-base-500"
              >
                {{ cluster.items.length }}
              </span>
            </p>

            <div
              class="grid gap-2"
              :class="[
                cluster.items.length > 1 ? 'sm:grid-cols-2' : '',
                cluster.items.length > 2 ? 'xl:grid-cols-3' : '',
              ]"
            >
              <button
                v-for="item in cluster.items"
                :key="item.id"
                type="button"
                class="group flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-colors"
                :class="itemCardClass(item, group)"
                :title="t(kindConfig[item.kind].titleKey)"
                @click="emit('navigate', kindConfig[item.kind].tab)"
              >
                <span class="flex w-full items-start gap-2.5">
                  <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="itemChipClass(item)">
                    <Icon :name="itemIcon(item)" class="text-lg" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span
                      class="block truncate font-medium"
                      :class="item.kind === 'task' && item.status === 'done' ? 'text-base-400 line-through' : 'text-base-900'"
                    >
                      {{ item.title }}
                    </span>
                    <span class="mt-0.5 block truncate text-xs text-base-500">
                      {{ item.typeLabel }}<template v-if="item.meta"> · {{ item.meta }}</template>
                    </span>
                  </span>
                  <Icon
                    name="material-symbols:chevron-right-rounded"
                    class="shrink-0 text-lg text-base-300 transition-colors group-hover:text-base-500"
                  />
                </span>

                <span
                  v-if="item.kind === 'task' && (item.status === 'in_progress' || item.checklistProgress || urgencyLabel(item))"
                  class="flex flex-wrap items-center gap-1.5"
                >
                  <span
                    v-if="item.status === 'in_progress'"
                    class="rounded-md bg-info-100 px-2 py-0.5 text-xs font-semibold text-info-700"
                  >
                    {{ t('event.planning.taskStatus.inProgress') }}
                  </span>
                  <span
                    v-if="item.checklistProgress"
                    class="inline-flex items-center gap-1 rounded-md bg-info-100 px-2 py-0.5 text-xs font-semibold text-info-700"
                  >
                    <Icon name="material-symbols:checklist-rounded" class="text-sm" />
                    {{ item.checklistProgress.done }}/{{ item.checklistProgress.total }}
                  </span>
                  <span
                    v-if="urgencyLabel(item)"
                    class="rounded-md px-2 py-0.5 text-xs font-semibold"
                    :class="isOverdue(item) ? 'bg-danger-100 text-danger-700' : 'bg-warning-100 text-warning-700'"
                  >
                    {{ urgencyLabel(item) }}
                  </span>
                </span>

                <span v-if="item.kind === 'shift' && item.requiredPeople !== undefined" class="w-full">
                  <span class="flex items-center justify-between gap-2 text-xs font-semibold" :class="staffingTextClass(item)">
                    <span class="inline-flex items-center gap-1">
                      <Icon
                        :name="shiftState(item) === 'full'
                          ? 'material-symbols:check-circle-rounded'
                          : 'material-symbols:person-add-rounded'"
                        class="text-sm"
                      />
                      {{ staffingLabel(item) }}
                    </span>
                    <span class="tabular-nums">{{ item.memberCount ?? 0 }}/{{ item.requiredPeople }}</span>
                  </span>
                  <span class="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-base-200/80">
                    <span
                      class="h-full rounded-full transition-all"
                      :class="staffingBarClass(item)"
                      :style="{ width: `${staffingPercent(item)}%` }"
                    />
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { EventTimelineItem, EventTimelineKind, EventPlanningTabKey } from './types'
import { diffLocalDates } from '~/shared/time'
const { today: appToday } = useAppTimeZone()

const props = defineProps<{
  items: EventTimelineItem[]
}>()

const emit = defineEmits<{
  (e: 'navigate', tab: EventPlanningTabKey): void
}>()

const { t, locale } = useI18n()
const { formatDate } = useLocaleFormatters()

type FilterKind = EventTimelineKind | null

const activeFilter = ref<FilterKind>(null)
const showPast = ref(false)

const kindConfig: Record<EventTimelineKind, { icon: string; chip: string; tab: EventPlanningTabKey; titleKey: string }> = {
  event: { icon: 'material-symbols:flag-rounded', chip: 'bg-accent-100 text-accent-600', tab: 'details', titleKey: 'event.planning.tabs.details' },
  task: { icon: 'material-symbols:task-alt-rounded', chip: 'bg-warning-100 text-warning-600', tab: 'tasks', titleKey: 'event.planning.navigateToTask' },
  shift: { icon: 'material-symbols:calendar-month-rounded', chip: 'bg-info-100 text-info-600', tab: 'shifts', titleKey: 'event.planning.openShifts' },
}

const kindCounts = computed(() => {
  const counts: Record<EventTimelineKind, number> = { event: 0, task: 0, shift: 0 }
  for (const item of props.items) counts[item.kind]++
  return counts
})

const kindFilters = computed<{ kind: FilterKind; label: string; icon: string; count: number; activeClass: string; chipClass: string }[]>(() => [
  {
    kind: null,
    label: t('common.all'),
    icon: 'material-symbols:format-list-bulleted-rounded',
    count: props.items.length,
    activeClass: 'border-base-300 bg-base-100 text-base-800',
    chipClass: 'bg-base-200 text-base-600',
  },
  {
    kind: 'event',
    label: t('event.planning.milestones'),
    icon: 'material-symbols:flag-rounded',
    count: kindCounts.value.event,
    activeClass: 'border-accent-300 bg-accent-50 text-accent-800',
    chipClass: 'bg-accent-100 text-accent-700',
  },
  {
    kind: 'task',
    label: t('event.planning.tasks'),
    icon: 'material-symbols:task-alt-rounded',
    count: kindCounts.value.task,
    activeClass: 'border-warning-300 bg-warning-50 text-warning-800',
    chipClass: 'bg-warning-100 text-warning-700',
  },
  {
    kind: 'shift',
    label: t('event.planning.shifts'),
    icon: 'material-symbols:calendar-month-rounded',
    count: kindCounts.value.shift,
    activeClass: 'border-info-300 bg-info-50 text-info-800',
    chipClass: 'bg-info-100 text-info-700',
  },
])

function todayDateKey(): string {
  return appToday()
}

function rawToDateKey(raw: string): string {
  return raw.slice(0, 10)
}

function isOverdue(item: EventTimelineItem): boolean {
  return item.raw < todayDateKey() && item.kind === 'task' && item.status !== 'done'
}

function isDueSoon(item: EventTimelineItem): boolean {
  const daysMs = 72 * 60 * 60 * 1000
  const deadline = new Date(item.raw).getTime()
  const now = Date.now()
  return item.kind === 'task' && item.status !== 'done' && deadline >= now && deadline <= now + daysMs
}

function urgencyLabel(item: EventTimelineItem): string | null {
  if (isOverdue(item)) return t('event.planning.overdue')
  if (isDueSoon(item)) return t('event.planning.dueSoon')
  return null
}

function itemIcon(item: EventTimelineItem): string {
  if (item.kind === 'task' && item.status === 'done') return 'material-symbols:check-circle-rounded'
  return kindConfig[item.kind].icon
}

function itemChipClass(item: EventTimelineItem): string {
  if (item.kind === 'task') {
    if (item.status === 'done') return 'bg-success-100 text-success-600'
    if (isOverdue(item)) return 'bg-danger-100 text-danger-600'
  }
  return kindConfig[item.kind].chip
}

type ShiftState = 'full' | 'partial' | 'empty'

function shiftState(item: EventTimelineItem): ShiftState {
  const required = item.requiredPeople ?? 0
  const count = item.memberCount ?? 0
  if (count >= required) return 'full'
  return count > 0 ? 'partial' : 'empty'
}

function staffingLabel(item: EventTimelineItem): string {
  if (shiftState(item) === 'full') return t('event.planning.shiftFull')
  const missing = (item.requiredPeople ?? 0) - (item.memberCount ?? 0)
  return missing === 1 ? t('event.planning.shiftNeedsOne') : t('event.planning.shiftNeeds', { count: missing })
}

function staffingTextClass(item: EventTimelineItem): string {
  const state = shiftState(item)
  return state === 'full' ? 'text-success-700' : state === 'partial' ? 'text-warning-700' : 'text-danger-700'
}

function staffingBarClass(item: EventTimelineItem): string {
  const state = shiftState(item)
  return state === 'full' ? 'bg-success-500' : state === 'partial' ? 'bg-warning-500' : 'bg-danger-500'
}

function staffingPercent(item: EventTimelineItem): number {
  const required = item.requiredPeople ?? 0
  if (!required) return 100
  return Math.min(100, Math.round(((item.memberCount ?? 0) / required) * 100))
}

function itemCardClass(item: EventTimelineItem, group: DayGroup): string[] {
  const classes: string[] = group.isPast ? ['opacity-70'] : []
  if (item.kind === 'event') {
    classes.push('border-accent-200 bg-accent-50/60 hover:bg-accent-50')
  } else if (item.kind === 'shift') {
    const state = shiftState(item)
    if (state === 'full') classes.push('border-success-200 bg-white hover:bg-success-50/50')
    else if (state === 'partial') classes.push('border-warning-300 bg-warning-50/50 hover:bg-warning-50')
    else classes.push('border-danger-300 bg-danger-50/50 hover:bg-danger-50')
  } else if (isOverdue(item)) {
    classes.push('border-danger-200 bg-white hover:bg-danger-50/40')
  } else {
    classes.push('border-base-200 bg-white hover:bg-base-50')
  }
  return classes
}

function itemGroupTimeLabel(item: EventTimelineItem): string {
  const hasTime = item.raw.length > 10
  const hasEndTime = item.rawEnd && item.rawEnd.length > 10

  if (!hasTime && !hasEndTime) return t('event.planning.allDay')

  try {
    const fmt = new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' })
    const start = hasTime ? fmt.format(new Date(item.raw)) : null
    const end = hasEndTime ? fmt.format(new Date(item.rawEnd!)) : null

    if (start && end) return `${start} – ${end}`
    return start ?? end ?? t('event.planning.allDay')
  } catch {
    return item.timeLabel
  }
}

function weekdayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return ''
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: 'long' }).format(new Date(year, month - 1, day))
  } catch {
    return ''
  }
}

function relativeDayLabel(daysFromToday: number): string | null {
  if (daysFromToday === 1) return t('event.planning.tomorrow')
  if (daysFromToday === -1) return t('event.planning.yesterday')
  if (daysFromToday > 1) return t('event.planning.inDays', { days: daysFromToday })
  if (daysFromToday < -1) return t('event.planning.daysAgo', { days: Math.abs(daysFromToday) })
  return null
}

interface TimeCluster {
  key: string
  timeLabel: string
  items: EventTimelineItem[]
}

interface DayGroup {
  dateKey: string
  dateLabel: string
  weekday: string
  relativeLabel: string | null
  isToday: boolean
  isPast: boolean
  items: EventTimelineItem[]
  clusters: TimeCluster[]
}

function buildClusters(items: EventTimelineItem[]): TimeCluster[] {
  const clusters: TimeCluster[] = []
  const byLabel = new Map<string, TimeCluster>()

  for (const item of items) {
    const timeLabel = itemGroupTimeLabel(item)
    let cluster = byLabel.get(timeLabel)
    if (!cluster) {
      cluster = { key: timeLabel, timeLabel, items: [] }
      byLabel.set(timeLabel, cluster)
      clusters.push(cluster)
    }
    cluster.items.push(item)
  }

  return clusters
}

function buildGroup(dateKey: string, today: string, items: EventTimelineItem[]): DayGroup {
  let dateLabel: string
  try {
    dateLabel = formatDate(dateKey)
  } catch {
    dateLabel = dateKey
  }

  const daysFromToday = diffLocalDates(today, dateKey)

  return {
    dateKey,
    dateLabel,
    weekday: weekdayLabel(dateKey),
    relativeLabel: relativeDayLabel(daysFromToday),
    isToday: dateKey === today,
    isPast: dateKey < today,
    items,
    clusters: buildClusters(items),
  }
}

const groupedItems = computed<DayGroup[]>(() => {
  const filtered = activeFilter.value
    ? props.items.filter(item => item.kind === activeFilter.value)
    : props.items

  const today = todayDateKey()
  const map = new Map<string, EventTimelineItem[]>()

  for (const item of filtered) {
    const key = rawToDateKey(item.raw)
    const existing = map.get(key) ?? []
    existing.push(item)
    map.set(key, existing)
  }

  const keys = Array.from(map.keys()).sort()

  return keys.map((dateKey) => {
    const items = (map.get(dateKey) ?? []).slice().sort((a, b) => new Date(a.raw).getTime() - new Date(b.raw).getTime())
    return buildGroup(dateKey, today, items)
  })
})

const pastItemCount = computed(() =>
  groupedItems.value.reduce((sum, group) => sum + (group.isPast ? group.items.length : 0), 0),
)

const displayGroups = computed<DayGroup[]>(() => {
  const groups = groupedItems.value.filter(group => showPast.value || !group.isPast)

  if (!groupedItems.value.some(group => group.isToday)) {
    const today = todayDateKey()
    groups.push(buildGroup(today, today, []))
    groups.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1))
  }

  return groups
})
</script>
