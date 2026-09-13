<template>
  <div class="overflow-hidden rounded-xl border border-base-200">
    <div class="grid border-b border-base-200 bg-base-50" :style="gridColumns">
      <div />
      <div
        v-for="weekday in weekdayLabels"
        :key="weekday.key"
        class="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide"
        :class="weekday.isWeekend ? 'text-base-400' : 'text-base-500'"
      >
        <abbr :title="weekday.longLabel" class="no-underline">{{ weekday.label }}</abbr>
      </div>
    </div>

    <div v-if="loading">
      <div v-for="row in 6" :key="row" class="grid" :style="gridColumns">
        <div class="calendar-week-cell border-b border-r border-base-100 bg-base-50/60" />
        <div
          v-for="col in 7"
          :key="col"
          class="calendar-cell h-32 animate-pulse border-b border-r border-base-100 p-2"
        >
          <div class="h-3 w-5 rounded bg-base-100" />
          <div v-if="(row + col) % 3 === 0" class="mt-2 h-3.5 w-4/5 rounded bg-base-100" />
        </div>
      </div>
    </div>

    <div v-else>
      <div v-for="week in weeks" :key="week.key" class="grid" :style="gridColumns">
        <button
          type="button"
          class="calendar-week-cell flex cursor-pointer items-start justify-center border-b border-r border-base-100 bg-base-50/60 pt-2 text-[11px] font-semibold text-base-400 transition hover:bg-accent-50 hover:text-accent-600"
          :title="t('calendar.switchToWeek', { week: week.number })"
          :aria-label="t('calendar.switchToWeek', { week: week.number })"
          @click="$emit('open-week', week.key)"
        >
          {{ week.number }}
        </button>

        <div
          v-for="day in week.days"
          :key="day.key"
          class="calendar-cell group relative flex h-32 flex-col gap-1 border-b border-r border-base-100 p-1.5"
          :class="[
            day.inCurrentMonth ? 'bg-white' : 'bg-base-50/60',
            day.isWeekend && day.inCurrentMonth ? 'bg-base-50/40' : '',
            day.isToday ? 'bg-accent-50/60 ring-1 ring-inset ring-accent-200' : '',
          ]"
        >
          <div class="flex items-center justify-between">
            <span
              class="flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold"
              :class="day.isToday
                ? 'bg-accent-500 text-white'
                : day.inCurrentMonth ? 'text-base-700' : 'text-base-400'"
            >
              {{ day.dayOfMonth }}
            </span>

            <button
              v-if="canCreate && day.inCurrentMonth"
              type="button"
              class="-mr-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-base-400 opacity-0 transition hover:bg-accent-100 hover:text-accent-700 focus-visible:opacity-100 group-hover:opacity-100"
              :aria-label="t('calendar.createOnDay')"
              :title="t('calendar.createOnDay')"
              @click="$emit('create', day.key)"
            >
              <Icon name="material-symbols:add-rounded" class="text-sm" />
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
            <button
              v-for="entry in visibleEntries(day.key)"
              :key="entry.key"
              type="button"
              class="flex w-full cursor-pointer items-center gap-1 rounded-r border-l-[3px] py-0.5 pl-1 pr-1 text-left text-[11px] leading-tight transition hover:brightness-95"
              :class="entry.isCancelled ? 'opacity-60' : ''"
              :style="chipStyle(entry)"
              :title="entryTooltip(entry)"
              @click="$emit('open', entry)"
            >
              <span v-if="chipTimeLabel(entry, day.key)" class="shrink-0 tabular-nums opacity-75">{{ chipTimeLabel(entry, day.key) }}</span>
              <span class="truncate" :class="entry.isCancelled ? 'line-through' : ''">{{ entry.title }}</span>
              <Icon
                v-if="entry.ownResponse"
                :name="responseIcon(entry.ownResponse)"
                class="ml-auto shrink-0 text-[13px] opacity-80"
                :aria-label="t(`calendar.rsvp.${entry.ownResponse}Short`)"
              />
            </button>

            <button
              v-if="overflowCount(day.key) > 0"
              type="button"
              class="mt-auto cursor-pointer self-start rounded px-1 py-0.5 text-left text-[11px] font-semibold text-base-500 transition hover:bg-base-100 hover:text-base-700"
              @click="$emit('expand-day', day.key)"
            >
              {{ t('calendar.moreEntries', { count: overflowCount(day.key) }) }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { buildMonthMatrix, entryDaySegment, groupEntriesByDay, isoWeekNumber, WEEKDAY_KEYS } from '~/composables/useCalendarView'
import type { AppointmentResponseValue, CalendarEntry } from '~/types/appointment'

const props = defineProps<{
  anchor: Date
  entries: CalendarEntry[]
  loading?: boolean
  canCreate?: boolean
}>()

defineEmits<{
  (e: 'open', entry: CalendarEntry): void
  (e: 'create', dayKey: string): void
  (e: 'expand-day', dayKey: string): void
  (e: 'open-week', dayKey: string): void
}>()

const { t } = useI18n()

function entryTime(value: string) {
  return value.slice(11, 16)
}

/** Room for four chips before the "+N weitere" line takes over the last slot. */
const MAX_CHIPS_PER_DAY = 4

const gridColumns = { gridTemplateColumns: '2rem repeat(7, minmax(0, 1fr))' }

const weekdayLabels = computed(() => WEEKDAY_KEYS.map((key, index) => ({
  key,
  label: t(`calendar.weekdays.${key}`),
  longLabel: t(`calendar.weekdaysLong.${key}`),
  isWeekend: index >= 5,
})))

const weeks = computed(() => buildMonthMatrix(props.anchor).map(days => ({
  key: days[0]?.key ?? '',
  number: isoWeekNumber(days[0]?.date ?? props.anchor),
  days,
})))
const entriesByDay = computed(() => groupEntriesByDay(props.entries))

function dayEntries(dayKey: string) {
  return entriesByDay.value.get(dayKey) ?? []
}

function visibleEntries(dayKey: string) {
  const entries = dayEntries(dayKey)
  return entries.length > MAX_CHIPS_PER_DAY ? entries.slice(0, MAX_CHIPS_PER_DAY - 1) : entries
}

function overflowCount(dayKey: string) {
  return Math.max(0, dayEntries(dayKey).length - visibleEntries(dayKey).length)
}

function chipTimeLabel(entry: CalendarEntry, dayKey: string): string | null {
  if (entry.allDay) return null
  const { isFirstDay, isLastDay, isMultiDay } = entryDaySegment(entry, dayKey)
  if (!isMultiDay) return entryTime(entry.startsAt)
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

function responseIcon(response: AppointmentResponseValue) {
  if (response === 'yes') return 'material-symbols:check-circle-rounded'
  if (response === 'no') return 'material-symbols:cancel-rounded'
  return 'material-symbols:help-rounded'
}

// A tinted chip rather than a solid one: a month cell holds several of these and solid blocks of
// saturated colour make the grid unreadable. The full-strength colour survives on the left edge,
// which is what actually carries the "which calendar is this" signal at chip size.
function chipStyle(entry: CalendarEntry) {
  return {
    backgroundColor: `color-mix(in srgb, ${entry.color} 16%, white)`,
    color: `color-mix(in srgb, ${entry.color} 75%, black)`,
    borderLeftColor: entry.color,
  }
}
</script>

<style scoped>
.calendar-cell:last-child {
  border-right-width: 0;
}
</style>
