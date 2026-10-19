<template>
  <PageHomeWidgetFrame
    :title="t('home.widgets.calendar.title')"
    icon="material-symbols:calendar-month-rounded"
    :loading="loading"
    :is-empty="!upcoming.length"
    empty-icon="material-symbols:event-busy-rounded"
    :empty-text="t('home.widgets.calendar.empty')"
  >
    <template #action>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-base-200 transition cursor-pointer hover:bg-white/20 hover:text-white"
        @click="setPage('Calendar')"
      >
        {{ t('home.widgets.calendar.open') }}
        <Icon name="material-symbols:arrow-forward-rounded" class="text-sm" />
      </button>
    </template>

    <ul class="flex h-full flex-col gap-2">
      <li v-for="entry in upcoming" :key="entry.key">
        <div class="group rounded-lg border border-base-200 p-3 transition hover:border-base-300 hover:bg-base-50">
          <button type="button" class="flex w-full cursor-pointer items-start gap-2 text-left" @click="open(entry)">
            <span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: entry.color }" />
            <span class="min-w-0 flex-1">
              <span class="block text-xs" :class="isToday(entry) ? 'font-semibold text-accent-600' : 'text-base-500'">
                {{ whenLabel(entry) }}
              </span>
              <span class="mt-0.5 block truncate font-medium text-base-900">{{ entry.title }}</span>
              <span v-if="entry.location" class="mt-0.5 flex items-center gap-1 text-xs text-base-500">
                <Icon name="material-symbols:location-on-rounded" class="shrink-0 text-sm text-base-400" />
                <span class="truncate">{{ entry.location }}</span>
              </span>
            </span>
            <Icon
              name="material-symbols:chevron-right-rounded"
              class="mt-0.5 shrink-0 text-lg text-base-300 transition group-hover:translate-x-0.5 group-hover:text-base-500"
            />
          </button>

          <div v-if="needsResponse(entry)" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium text-base-500">{{ t('calendar.rsvp.question') }}</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700 transition hover:bg-success-100"
              :class="respondingKey === entry.key ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
              :disabled="respondingKey === entry.key"
              @click="respond(entry, 'yes')"
            >
              <Icon name="material-symbols:check-circle-rounded" class="text-sm" />
              {{ t('calendar.rsvp.yes') }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md bg-danger-50 px-2.5 py-1 text-xs font-medium text-danger-700 transition hover:bg-danger-100"
              :class="respondingKey === entry.key ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
              :disabled="respondingKey === entry.key"
              @click="respond(entry, 'no')"
            >
              <Icon name="material-symbols:cancel-rounded" class="text-sm" />
              {{ t('calendar.rsvp.no') }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </PageHomeWidgetFrame>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { dayKeyOf, todayKey } from '~/composables/useCalendarView'
import type { GetCalendarEntriesResponse } from '~/server/api/calendar/entries.get'
import type { AppointmentResponseValue, CalendarEntry } from '~/types/appointment'
import { addDaysToLocalDate, nowLocalDateTime } from '~/shared/time'
const { timeZone } = useAppTimeZone()

const { t } = useI18n()
const toast = useToast()
const { setPage } = usePage()
const { formatDate } = useLocaleFormatters()

const WINDOW_DAYS = 30
const MAX_ENTRIES = 5

const loading = ref(true)
const upcoming = ref<CalendarEntry[]>([])
const respondingKey = ref('')

function isToday(entry: CalendarEntry) {
  return dayKeyOf(entry.startsAt) === todayKey(timeZone.value)
}

function whenLabel(entry: CalendarEntry) {
  const dayKey = dayKeyOf(entry.startsAt)
  const today = todayKey(timeZone.value)

  const tomorrow = addDaysToLocalDate(today, 1)

  const date = dayKey === today
    ? t('calendar.today')
    : dayKey === tomorrow
      ? t('calendar.tomorrow')
      : formatDate(entry.startsAt)

  return entry.allDay ? `${date} · ${t('calendar.allDay')}` : `${date} · ${entry.startsAt.slice(11, 16)}`
}

function needsResponse(entry: CalendarEntry) {
  return entry.source === 'appointment' && entry.canRespond && !entry.ownResponse && !entry.isCancelled
}

function open(entry: CalendarEntry) {
  setPage('Calendar', entry.source === 'appointment'
    ? { appointmentId: entry.id, occurrenceDate: entry.occurrenceDate }
    : undefined)
}

async function respond(entry: CalendarEntry, response: AppointmentResponseValue) {
  if (respondingKey.value) return
  respondingKey.value = entry.key

  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>(`/api/appointments/${entry.id}/respond`, {
      method: 'POST',
      body: { occurrenceDate: entry.occurrenceDate, response },
    })

    if (!res.ok) {
      toast.error(res.error || t('calendar.rsvp.failed'))
      return
    }

    toast.success(t('calendar.rsvp.saved'))
    await load()
  } catch {
    toast.error(t('calendar.rsvp.failed'))
  } finally {
    respondingKey.value = ''
  }
}

async function load() {
  loading.value = true
  try {
    const now = nowLocalDateTime(timeZone.value)

    const res = await apiFetch<GetCalendarEntriesResponse>('/api/calendar/entries', {
      query: {
        from: `${now.slice(0, 16)}:00`,
        to: `${addDaysToLocalDate(now.slice(0, 10), WINDOW_DAYS)} 23:59:59`,
      },
    })

    upcoming.value = res.ok
      ? res.entries.filter(entry => !entry.isCancelled).slice(0, MAX_ENTRIES)
      : []
  } catch {
    upcoming.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
useAppRefresh().onRefresh(load)
</script>
