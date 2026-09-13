<template>
  <div>
    <div v-if="loading" class="space-y-3">
      <div v-for="index in 5" :key="index" class="animate-pulse rounded-xl border border-base-200 p-4">
        <div class="h-3 w-24 rounded bg-base-200" />
        <div class="mt-2 h-4 w-2/3 rounded bg-base-100" />
      </div>
    </div>

    <CommonTableEmptyState
      v-else-if="!days.length"
      :icon="isFiltered ? 'material-symbols:filter-alt-off-rounded' : 'material-symbols:event-busy-rounded'"
      :title="isFiltered ? t('calendar.emptyFiltered') : t('calendar.empty')"
    />

    <ol v-else class="space-y-6">
      <li v-for="day in days" :key="day.key">
        <!-- Sticky so the day a row belongs to stays readable while scrolling a long agenda. -->
        <h3
          class="sticky top-0 z-10 -mx-1 mb-2 flex items-baseline gap-2 bg-white/95 px-1 py-1 text-sm font-semibold backdrop-blur"
          :class="day.isToday ? 'text-accent-700' : 'text-base-700'"
        >
          <span>{{ formatDayHeading(day.key) }}</span>
          <span
            v-if="day.relativeLabel"
            class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
            :class="day.isToday ? 'bg-accent-100 text-accent-700' : 'bg-base-100 text-base-500'"
          >
            {{ day.relativeLabel }}
          </span>
          <span class="ml-auto text-xs font-medium text-base-400">{{ day.entries.length }}</span>
        </h3>

        <ul class="space-y-2">
          <li v-for="entry in day.entries" :key="entry.key">
            <button
              type="button"
              class="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-base-200 bg-white p-3 text-left transition hover:border-base-300 hover:bg-base-50 hover:shadow-sm"
              :class="entry.isCancelled ? 'opacity-60' : ''"
              @click="$emit('open', entry)"
            >
              <span
                class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                :style="badgeStyle(entry)"
              >
                <Icon :name="entry.icon" class="text-base" />
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-base-500">
                  <span class="font-medium tabular-nums text-base-600">{{ entryTimeLabel(entry, day.key) }}</span>
                  <span v-if="entry.typeName" class="text-base-400">· {{ entry.typeName }}</span>
                  <span v-if="entry.isCancelled" class="font-semibold text-danger-600">· {{ t('calendar.cancelled') }}</span>
                </span>

                <span
                  class="mt-0.5 block truncate font-medium text-base-900"
                  :class="entry.isCancelled ? 'line-through' : ''"
                >
                  {{ entry.title }}
                </span>

                <span v-if="entry.location" class="mt-0.5 flex items-center gap-1 text-xs text-base-500">
                  <Icon name="material-symbols:location-on-rounded" class="shrink-0 text-sm text-base-400" />
                  <span class="truncate">{{ entry.location }}</span>
                </span>
              </span>

              <span class="flex shrink-0 items-center gap-1.5 self-center">
                <span
                  v-if="entry.ownResponse"
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="responseClass(entry.ownResponse)"
                >
                  <Icon :name="responseIcon(entry.ownResponse)" class="text-[13px]" />
                  {{ t(`calendar.rsvp.${entry.ownResponse}Short`) }}
                </span>
                <span
                  v-else-if="entry.canRespond && !entry.isCancelled"
                  class="rounded-full bg-base-100 px-2 py-0.5 text-[11px] font-semibold text-base-500"
                >
                  {{ t('calendar.rsvp.pending') }}
                </span>

                <Icon
                  name="material-symbols:chevron-right-rounded"
                  class="text-lg text-base-300 transition group-hover:translate-x-0.5 group-hover:text-base-500"
                />
              </span>
            </button>
          </li>
        </ul>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { entryDaySegment, groupEntriesByDay, todayKey } from '~/composables/useCalendarView'
import type { AppointmentResponseValue, CalendarEntry } from '~/types/appointment'

const props = defineProps<{
  entries: CalendarEntry[]
  loading?: boolean
  isFiltered?: boolean
}>()

defineEmits<{
  (e: 'open', entry: CalendarEntry): void
}>()

const { t } = useI18n()
const { formatDayHeading } = useLocaleFormatters()

const days = computed(() => {
  const grouped = groupEntriesByDay(props.entries)
  const today = todayKey()
  const tomorrow = shiftDayKey(today, 1)

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({
      key,
      entries,
      isToday: key === today,
      // "Heute"/"Morgen" next to the full date: the date alone forces the reader to do the maths.
      relativeLabel: key === today ? t('calendar.today') : key === tomorrow ? t('calendar.tomorrow') : '',
    }))
})

function shiftDayKey(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Entry timestamps are wall-clock strings in the association's local time, not real UTC instants —
 * `formatTime` would convert them to Europe/Berlin a second time. A plain slice reads the
 * hour/minute exactly as stored.
 */
function entryTimeLabel(entry: CalendarEntry, dayKey: string) {
  if (entry.allDay) return t('calendar.allDay')

  const start = entry.startsAt.slice(11, 16)
  const end = entry.endsAt.slice(11, 16)

  const { isFirstDay, isLastDay, isMultiDay } = entryDaySegment(entry, dayKey)
  if (isMultiDay) {
    if (isFirstDay) return t('calendar.from', { time: start })
    if (isLastDay) return t('calendar.until', { time: end })
    return t('calendar.allDay')
  }

  return end && end !== start ? `${start} – ${end}` : start
}

/** The tinted square mirrors the month/week chips, so a source keeps one colour everywhere. */
function badgeStyle(entry: CalendarEntry) {
  return {
    backgroundColor: `color-mix(in srgb, ${entry.color} 16%, white)`,
    color: `color-mix(in srgb, ${entry.color} 75%, black)`,
  }
}

function responseClass(response: AppointmentResponseValue) {
  if (response === 'yes') return 'bg-success-100 text-success-700'
  if (response === 'no') return 'bg-danger-100 text-danger-700'
  return 'bg-warning-100 text-warning-700'
}

function responseIcon(response: AppointmentResponseValue) {
  if (response === 'yes') return 'material-symbols:check-circle-rounded'
  if (response === 'no') return 'material-symbols:cancel-rounded'
  return 'material-symbols:help-rounded'
}
</script>
