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
        <div class="group flex items-start gap-2 rounded-lg border border-base-200 p-3 transition hover:border-base-300 hover:bg-base-50">
          <button type="button" class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left" @click="open(entry)">
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
          </button>

          <MenuDropdown
            v-if="canRespond(entry)"
            v-model="openResponseMenu"
            :id="entry.key"
            :disabled="respondingKey === entry.key"
            wrapper-class="relative shrink-0"
          >
            <template #trigger>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition"
                :class="[
                  responseBadgeClass(entry.ownResponse),
                  respondingKey === entry.key ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                ]"
                :aria-label="`${t('calendar.rsvp.yourAnswer')} ${badgeLabel(entry)}`"
              >
                <Icon
                  :name="respondingKey === entry.key ? 'material-symbols:progress-activity' : badgeIcon(entry)"
                  class="text-[13px]"
                  :class="respondingKey === entry.key ? 'animate-spin' : ''"
                />
                {{ badgeLabel(entry) }}
                <Icon name="material-symbols:keyboard-arrow-down-rounded" class="-mr-0.5 text-[13px] opacity-70" />
              </button>
            </template>

            <template #default="{ styling }">
              <button
                v-for="option in responseOptions"
                :key="option.value"
                type="button"
                :class="[styling, entry.ownResponse === option.value ? 'font-medium text-link-600' : '']"
                @click="respond(entry, option.value)"
              >
                <Icon :name="option.icon" class="text-base" :class="option.iconClass" />
                {{ option.label }}
              </button>
            </template>
          </MenuDropdown>

          <button
            type="button"
            tabindex="-1"
            aria-hidden="true"
            class="shrink-0 cursor-pointer"
            @click="open(entry)"
          >
            <Icon
              name="material-symbols:chevron-right-rounded"
              class="mt-0.5 text-lg text-base-300 transition group-hover:translate-x-0.5 group-hover:text-base-500"
            />
          </button>
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

const openResponseMenu = ref<string | number | null>(null)

const responseOptions = computed(() => ([
  { value: 'yes' as const, label: t('calendar.rsvp.yes'), icon: 'material-symbols:check-circle-rounded', iconClass: 'text-success-600' },
  { value: 'maybe' as const, label: t('calendar.rsvp.maybe'), icon: 'material-symbols:help-rounded', iconClass: 'text-warning-600' },
  { value: 'no' as const, label: t('calendar.rsvp.no'), icon: 'material-symbols:cancel-rounded', iconClass: 'text-danger-600' },
]))

function responseBadgeClass(response: AppointmentResponseValue | null) {
  if (response === 'yes') return 'bg-success-100 text-success-700 hover:bg-success-200'
  if (response === 'no') return 'bg-danger-100 text-danger-700 hover:bg-danger-200'
  if (response === 'maybe') return 'bg-warning-100 text-warning-700 hover:bg-warning-200'
  return 'bg-white text-base-600 outline-1 outline-dashed outline-base-300 hover:bg-base-100'
}

function responseIcon(response: AppointmentResponseValue | null) {
  if (response === 'yes') return 'material-symbols:check-circle-rounded'
  if (response === 'no') return 'material-symbols:cancel-rounded'
  if (response === 'maybe') return 'material-symbols:help-rounded'
  return 'material-symbols:schedule-rounded'
}

function responseBadgeLabel(response: AppointmentResponseValue | null) {
  if (response === 'yes') return t('calendar.rsvp.yesShort')
  if (response === 'no') return t('calendar.rsvp.noShort')
  if (response === 'maybe') return t('calendar.rsvp.maybeShort')
  return t('calendar.rsvp.pending')
}

/** An answer awaiting reconfirmation reads as "please confirm", not as an answer. */
function needsReconfirmation(entry: CalendarEntry) {
  return !entry.ownResponse && Boolean(entry.unconfirmedResponse)
}

function badgeLabel(entry: CalendarEntry) {
  return needsReconfirmation(entry) ? t('calendar.rsvp.reconfirmShort') : responseBadgeLabel(entry.ownResponse)
}

function badgeIcon(entry: CalendarEntry) {
  return needsReconfirmation(entry) ? 'material-symbols:sync-problem-rounded' : responseIcon(entry.ownResponse)
}

function canRespond(entry: CalendarEntry) {
  return entry.source === 'appointment' && entry.canRespond && !entry.isCancelled
}

function open(entry: CalendarEntry) {
  setPage('Calendar', entry.source === 'appointment'
    ? { appointmentId: entry.id, occurrenceDate: entry.occurrenceDate }
    : undefined)
}

async function respond(entry: CalendarEntry, response: AppointmentResponseValue) {
  openResponseMenu.value = null
  if (respondingKey.value || entry.ownResponse === response) return
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
    entry.ownResponse = response
    entry.unconfirmedResponse = null
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
