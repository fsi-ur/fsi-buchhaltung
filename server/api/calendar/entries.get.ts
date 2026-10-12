import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import {
  buildAppointmentEntries,
  buildEventEntries,
  buildShiftEntries,
  buildTaskEntries,
  loadCalendarAppointments,
  loadCalendarEvents,
  loadCalendarShifts,
  loadCalendarTaskDeadlines,
  type CalendarWindow,
} from '~/server/utils/calendarSources'
import { getMemberIdForUser, resolveAppointmentViewer } from '~/server/utils/appointments/visibility'
import { hasPermission } from '~/server/utils/api/guards'
import { formatWallClock, parseWallClock } from '~/server/utils/appointments/recurrence'
import type { AppointmentTypeRow, CalendarEntry } from '~/types/appointment'
import { addDaysToLocalDate, type LocalDate } from '~/shared/time'
import { appTodayLocalDate } from '~/server/utils/time'

interface GetCalendarEntriesSuccess {
  ok: true
  entries: CalendarEntry[]
  /** Every type in use, so the source filter can offer per-type toggles. */
  appointmentTypes: AppointmentTypeRow[]
  from: string
  to: string
}

interface GetCalendarEntriesError {
  ok: false
  error: string
}

export type GetCalendarEntriesResponse = GetCalendarEntriesSuccess | GetCalendarEntriesError

/** One request per calendar window, merging all four sources into a single shape. */
export default defineEventHandler(async (event): Promise<GetCalendarEntriesResponse> => {
  const current = await requirePermission(event, 'calendar.view')
  if (!current.ok) return current

  const params = getQuery(event)
  const window = resolveWindow(params.from, params.to, await appTodayLocalDate())
  if (!window) return { ok: false, error: 'Ungültiger Zeitraum.' }

  const viewer = await resolveAppointmentViewer(current.user)
  const memberId = viewer.memberId ?? await getMemberIdForUser(Number(current.user.id))

  // Events and shift/task deadlines are only offered to users who may see them at all; a plain
  // calendar user without event access simply gets the appointment source.
  const canSeeEvents = hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup'])

  const [appointments, events, shifts, tasks] = await Promise.all([
    loadCalendarAppointments(viewer, window),
    canSeeEvents ? loadCalendarEvents(window) : Promise.resolve([]),
    canSeeEvents ? loadCalendarShifts(memberId, window) : Promise.resolve([]),
    canSeeEvents ? loadCalendarTaskDeadlines(memberId, window) : Promise.resolve([]),
  ])

  const entries = [
    ...buildAppointmentEntries(appointments, current.user),
    ...buildEventEntries(events),
    ...buildShiftEntries(shifts),
    ...buildTaskEntries(tasks),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))

  return {
    ok: true,
    entries,
    appointmentTypes: Array.from(appointments.typesById.values())
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    from: window.from,
    to: window.to,
  }
})

function resolveWindow(from: unknown, to: unknown, today: LocalDate): CalendarWindow | null {
  const parsedFrom = parseWallClock(typeof from === 'string' ? normalizeBoundary(from, '00:00:00') : null)
  const parsedTo = parseWallClock(typeof to === 'string' ? normalizeBoundary(to, '23:59:59') : null)

  if (!parsedFrom || !parsedTo) {
    const monthStart = `${today.slice(0, 7)}-01`
    const monthEnd = addDaysToLocalDate(addDaysToLocalDate(monthStart, 31).slice(0, 7) + '-01', -1)
    return { from: `${monthStart} 00:00:00`, to: `${monthEnd} 23:59:59` }
  }

  if (parsedTo.getTime() < parsedFrom.getTime()) return null

  return { from: formatWallClock(parsedFrom), to: formatWallClock(parsedTo) }
}

function normalizeBoundary(value: string, fallbackTime: string): string {
  return value.length <= 10 ? `${value} ${fallbackTime}` : value
}
