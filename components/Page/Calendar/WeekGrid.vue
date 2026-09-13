<template>
  <div class="overflow-hidden rounded-xl border border-base-200">
    <div class="grid border-b border-base-200 bg-base-50" :style="gridColumns">
      <div class="border-r border-base-200" />
      <div
        v-for="day in days"
        :key="day.key"
        class="group relative px-2 py-2 text-center"
        :class="day.isToday ? 'bg-accent-50' : ''"
      >
        <div
          class="text-xs font-semibold uppercase tracking-wide"
          :class="day.isToday ? 'text-accent-600' : day.isWeekend ? 'text-base-400' : 'text-base-500'"
        >
          {{ t(`calendar.weekdays.${WEEKDAY_KEYS[weekdayIndexOf(day.date)]}`) }}
        </div>
        <div
          class="mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
          :class="day.isToday ? 'bg-accent-500 text-white' : day.isWeekend ? 'text-base-500' : 'text-base-700'"
        >
          {{ day.dayOfMonth }}
        </div>

        <button
          v-if="canCreate"
          type="button"
          class="absolute right-1 top-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-base-400 opacity-0 transition hover:bg-accent-100 hover:text-accent-700 focus-visible:opacity-100 group-hover:opacity-100"
          :aria-label="t('calendar.createOnDay')"
          :title="t('calendar.createOnDay')"
          @click="$emit('create', day.key)"
        >
          <Icon name="material-symbols:add-rounded" class="text-sm" />
        </button>
      </div>
    </div>

    <div v-if="loading" class="space-y-2 p-4">
      <div v-for="index in 6" :key="index" class="h-10 animate-pulse rounded-lg bg-base-100" />
    </div>

    <template v-else>
      <div v-if="hasAllDayEntries" class="grid border-b border-base-200" :style="gridColumns">
        <div class="border-r border-base-200 px-1 py-1 text-right text-[11px] text-base-400">
          {{ t('calendar.allDay') }}
        </div>
        <div
          v-for="day in days"
          :key="`allday-${day.key}`"
          class="space-y-0.5 border-r border-base-100 p-1 last:border-r-0"
          :class="day.isToday ? 'bg-accent-50/50' : ''"
        >
          <button
            v-for="entry in allDayEntries(day.key)"
            :key="entry.key"
            type="button"
            class="block w-full cursor-pointer truncate rounded-r border-l-[3px] px-1 py-0.5 text-left text-[11px] transition hover:brightness-95"
            :class="entry.isCancelled ? 'opacity-60 line-through' : ''"
            :style="chipStyle(entry)"
            :title="entryTooltip(entry)"
            @click="$emit('open', entry)"
          >
            {{ entry.title }}
          </button>
        </div>
      </div>

      <div ref="scrollRef" class="relative max-h-[70vh] overflow-y-auto">
        <div class="grid" :style="gridColumns">
          <!-- Time axis -->
          <div class="border-r border-base-200 bg-white">
            <div
              v-for="hour in hours"
              :key="`hour-${hour}`"
              class="relative border-b border-base-100 pr-1 text-right text-[11px] text-base-400"
              :style="{ height: `${HOUR_HEIGHT}px` }"
            >
              <span v-if="hour > 0" class="absolute right-1 top-0 -translate-y-1/2 bg-white px-0.5">{{ hourLabel(hour) }}</span>
            </div>
          </div>

          <div
            v-for="day in days"
            :key="`col-${day.key}`"
            class="relative border-r border-base-100 last:border-r-0"
            :class="[
              day.isWeekend ? 'bg-base-50/40' : '',
              day.isToday ? 'bg-accent-50/40' : '',
            ]"
          >
            <div
              v-for="hour in hours"
              :key="`slot-${day.key}-${hour}`"
              class="border-b border-base-100"
              :class="hour >= WORKING_HOURS_FROM && hour < WORKING_HOURS_TO ? '' : 'bg-base-50/50'"
              :style="{ height: `${HOUR_HEIGHT}px` }"
            />

            <div
              v-if="day.isToday && nowOffset !== null"
              class="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              :style="{ top: `${nowOffset}px` }"
              :aria-label="t('calendar.now')"
            >
              <span class="-ml-1 h-2 w-2 shrink-0 rounded-full bg-danger-500" />
              <span class="h-px flex-1 bg-danger-500" />
            </div>

            <button
              v-for="positioned in positionedEntries(day.key)"
              :key="positioned.entry.key"
              type="button"
              class="absolute z-15 cursor-pointer overflow-hidden rounded-r border-l-[3px] px-1 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-95"
              :class="positioned.entry.isCancelled ? 'opacity-60 line-through' : ''"
              :style="{
                ...chipStyle(positioned.entry),
                top: `${positioned.top}px`,
                height: `${positioned.height}px`,
                left: positioned.left,
                width: positioned.width,
              }"
              :title="entryTooltip(positioned.entry)"
              @click="$emit('open', positioned.entry)"
            >
              <span v-if="positioned.height < TWO_LINE_HEIGHT" class="flex items-baseline gap-1 overflow-hidden">
                <span v-if="chipTimeLabel(positioned)" class="shrink-0 tabular-nums opacity-75">{{ chipTimeLabel(positioned) }}</span>
                <span class="truncate font-medium">{{ positioned.entry.title }}</span>
              </span>
              <template v-else>
                <span class="block truncate font-medium">{{ positioned.entry.title }}</span>
                <span v-if="chipTimeLabel(positioned)" class="block truncate tabular-nums opacity-75">
                  {{ chipTimeLabel(positioned) }}
                </span>
                <span
                  v-if="positioned.entry.location && positioned.height >= THREE_LINE_HEIGHT"
                  class="block truncate opacity-75"
                >
                  {{ positioned.entry.location }}
                </span>
              </template>
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { buildWeekDays, entryDaySegment, groupEntriesByDay, nowInBerlin, todayKey, weekdayIndexOf, WEEKDAY_KEYS } from '~/composables/useCalendarView'
import type { CalendarEntry } from '~/types/appointment'

const props = defineProps<{
  anchor: Date
  entries: CalendarEntry[]
  loading?: boolean
  canCreate?: boolean
}>()

defineEmits<{
  (e: 'open', entry: CalendarEntry): void
  (e: 'create', dayKey: string): void
}>()

const { t } = useI18n()

function entryTime(value: string) {
  return value.slice(11, 16)
}

const HOUR_HEIGHT = 44
const MIN_ENTRY_HEIGHT = 20
/** Below this an entry gets the one-line layout; below the larger one, no location line. */
const TWO_LINE_HEIGHT = 34
const THREE_LINE_HEIGHT = 58
/** Hours outside this band are shaded, so the useful part of the day stands out at a glance. */
const WORKING_HOURS_FROM = 7
const WORKING_HOURS_TO = 20
const DEFAULT_SCROLL_HOUR = 7
const LATEST_SCROLL_HOUR = 18

const hours = Array.from({ length: 24 }, (_, index) => index)
const gridColumns = { gridTemplateColumns: '4.5rem repeat(7, minmax(0, 1fr))' }

const scrollRef = ref<HTMLElement | null>(null)
const nowMinutes = ref(minutesSinceMidnight())
let nowTimer: ReturnType<typeof setInterval> | null = null

const days = computed(() => buildWeekDays(props.anchor))
const entriesByDay = computed(() => groupEntriesByDay(props.entries))

const hasAllDayEntries = computed(() => props.entries.some(entry => entry.allDay))

const nowOffset = computed(() => {
  const today = todayKey()
  if (!days.value.some(day => day.key === today)) return null
  return (nowMinutes.value / 60) * HOUR_HEIGHT
})

function minutesSinceMidnight() {
  const now = nowInBerlin()
  return now.getUTCHours() * 60 + now.getUTCMinutes()
}

function dayEntries(dayKey: string) {
  return entriesByDay.value.get(dayKey) ?? []
}

function allDayEntries(dayKey: string) {
  return dayEntries(dayKey).filter(entry => entry.allDay)
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function minutesInDay(value: string, dayKey: string): number {
  if (value.slice(0, 10) < dayKey) return 0
  const hours = Number(value.slice(11, 13))
  const minutes = Number(value.slice(14, 16))
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0
}

function positionedEntries(dayKey: string) {
  const timed = dayEntries(dayKey)
    .filter(entry => !entry.allDay)
    .map(entry => ({
      entry,
      start: minutesInDay(entry.startsAt, dayKey),
      end: entry.endsAt.slice(0, 10) > dayKey ? 24 * 60 : minutesInDay(entry.endsAt, dayKey),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const results: { entry: CalendarEntry, dayKey: string, top: number, height: number, left: string, width: string }[] = []

  let clusterEnd = -Infinity
  let clusterItems: typeof timed = []

  const flushCluster = () => {
    if (!clusterItems.length) return

    // Greedy lane assignment: each item takes the first lane whose previous occupant has already
    // ended by the time this one starts; otherwise it opens a new lane.
    const laneEnds: number[] = []
    const columns: number[] = []
    for (const item of clusterItems) {
      let lane = laneEnds.findIndex(end => end <= item.start)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(item.end)
      } else {
        laneEnds[lane] = item.end
      }
      columns.push(lane)
    }
    const lanes = laneEnds.length

    clusterItems.forEach((item, i) => {
      const column = columns[i] ?? 0
      // A 1px gap between lanes (via calc, not the percentage split alone) so overlapping entries
      // read as separate cards rather than bleeding into one another — similarly tinted colours
      // otherwise touch edge-to-edge with nothing to tell them apart.
      results.push({
        entry: item.entry,
        dayKey,
        top: (item.start / 60) * HOUR_HEIGHT,
        height: Math.max(MIN_ENTRY_HEIGHT, ((item.end - item.start) / 60) * HOUR_HEIGHT),
        left: `calc(${(column / lanes) * 100}% + ${column > 0 ? 1 : 0}px)`,
        width: `calc(${(1 / lanes) * 100}% - ${lanes > 1 ? 1 : 0}px)`,
      })
    })

    clusterItems = []
  }

  for (const item of timed) {
    if (clusterItems.length && item.start >= clusterEnd) flushCluster()
    clusterItems.push(item)
    clusterEnd = clusterItems.length === 1 ? item.end : Math.max(clusterEnd, item.end)
  }
  flushCluster()

  return results
}

function chipTimeLabel(positioned: { entry: CalendarEntry, dayKey: string }): string | null {
  const { entry, dayKey } = positioned
  const { isFirstDay, isLastDay, isMultiDay } = entryDaySegment(entry, dayKey)
  if (!isMultiDay) return `${entryTime(entry.startsAt)} – ${entryTime(entry.endsAt)}`
  if (isFirstDay) return t('calendar.from', { time: entryTime(entry.startsAt) })
  if (isLastDay) return t('calendar.until', { time: entryTime(entry.endsAt) })
  return null
}

/** The chip is truncated by design, so the tooltip carries the parts that get cut off. */
function entryTooltip(entry: CalendarEntry) {
  const time = entry.allDay ? t('calendar.allDay') : `${entryTime(entry.startsAt)} – ${entryTime(entry.endsAt)}`
  return [
    `${time} · ${entry.title}`,
    entry.location,
    entry.isCancelled ? t('calendar.cancelled') : null,
  ].filter(Boolean).join('\n')
}

function chipStyle(entry: CalendarEntry) {
  return {
    backgroundColor: `color-mix(in srgb, ${entry.color} 18%, white)`,
    color: `color-mix(in srgb, ${entry.color} 75%, black)`,
    borderLeftColor: entry.color,
    // A thin white outline so two overlapping entries in adjacent, similarly-tinted lanes still
    // read as separate cards instead of merging into one block of colour.
    boxShadow: '0 0 0 1px white',
  }
}

/**
 * A 24-hour axis opens at midnight, which is never where the week's content is. Scroll to the
 * earliest entry (or the start of the working day) so the week is readable without scrolling.
 */
function scrollToRelevantHour() {
  const container = scrollRef.value
  if (!container) return

  const starts = props.entries
    .filter(entry => !entry.allDay)
    .map(entry => Number(entry.startsAt.slice(11, 13)))
    .filter(hour => Number.isFinite(hour))

  const earliest = starts.length ? Math.min(...starts) : DEFAULT_SCROLL_HOUR
  const target = Math.min(Math.max(earliest, 0), LATEST_SCROLL_HOUR)

  container.scrollTop = Math.max(0, target * HOUR_HEIGHT - HOUR_HEIGHT / 2)
}

watch(() => [props.anchor, props.entries, props.loading] as const, () => {
  void nextTick(scrollToRelevantHour)
})

onMounted(() => {
  void nextTick(scrollToRelevantHour)
  nowTimer = setInterval(() => { nowMinutes.value = minutesSinceMidnight() }, 60000)
})

onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})
</script>
