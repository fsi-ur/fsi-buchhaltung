import { defineEventHandler, getRequestHost, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { getUserByCalendarToken } from '~/server/utils/calendarToken'
import { query } from '~/server/utils/db'
import {
  loadCalendarAppointments,
  loadCalendarEvents,
  loadCalendarShifts,
  loadCalendarTaskDeadlines,
  type CalendarEventSource,
  type CalendarTaskStatus,
} from '~/server/utils/calendarSources'
import { agendaPlainText } from '~/server/utils/appointments'
import { getUserPermissions, getUserPositionIds, getUserRoleIds } from '~/server/utils/permissions'
import {
  buildIcsFeed,
  type IcsFeedAppointment,
  type IcsFeedEvent,
  type IcsFeedShift,
  type IcsFeedTaskDeadline,
} from '~/server/utils/icsFeed'
import { addMinutesToLocalDateTime, nowLocalDateTime } from '~/shared/time'
import { getAppTimeZone } from '~/server/utils/time'

const TASK_STATUS_LABELS: Record<CalendarTaskStatus, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  done: 'Erledigt',
}

/** Appointments are materialised occurrence by occurrence over this window. */
const APPOINTMENT_PAST_DAYS = 90
const APPOINTMENT_FUTURE_DAYS = 365

function buildEventDescription(row: CalendarEventSource): string {
  const lines: string[] = []

  if (row.expected_guests != null) lines.push(`Erwartete Gäste: ${row.expected_guests}`)

  const organizers = [...row.memberOrganizers, ...row.subdivisionOrganizers]
  if (organizers.length) lines.push(`Organisiert von: ${organizers.join(', ')}`)

  return lines.join('\n')
}

function buildTaskDescription(status: CalendarTaskStatus, members: string[], subdivisions: string[]): string {
  const lines: string[] = [`Status: ${TASK_STATUS_LABELS[status]}`]

  if (members.length) lines.push(`Zugewiesen an: ${members.join(', ')}`)
  if (subdivisions.length) lines.push(`Abteilung(en): ${subdivisions.join(', ')}`)

  return lines.join('\n')
}

function buildAppointmentDescription(typeName: string | null, agenda: string | null, summary: { yes: number, no: number, maybe: number } | null): string {
  const lines: string[] = []

  if (typeName) lines.push(typeName)

  const agendaText = agendaPlainText(agenda)
  if (agendaText) lines.push(agendaText)

  if (summary && (summary.yes || summary.no || summary.maybe)) {
    lines.push(`Rückmeldungen: ${summary.yes} Zusagen, ${summary.no} Absagen, ${summary.maybe} vielleicht`)
  }

  return lines.join('\n\n')
}

// Token-authenticated route, deliberately isolated from the cookie-based
// guards in server/utils/api/guards.ts — calendar apps can't send cookies.
export default defineEventHandler(async (event) => {
  const rawParam = getRouterParam(event, 'token') ?? ''
  const token = rawParam.replace(/\.ics$/i, '')

  if (!token) {
    setResponseStatus(event, 404)
    return 'Not found'
  }

  const user = await getUserByCalendarToken(token)
  if (!user) {
    setResponseStatus(event, 404)
    return 'Not found'
  }

  const memberRows = await query<{ id: number }[]>(
    `SELECT id FROM members WHERE account = ? LIMIT 1`,
    [user.id],
  )
  const memberId = memberRows[0] ? Number(memberRows[0].id) : null

  const timeZone = await getAppTimeZone()
  const now = nowLocalDateTime(timeZone)
  const appointmentWindow = {
    from: addMinutesToLocalDateTime(now, -APPOINTMENT_PAST_DAYS * 24 * 60),
    to: addMinutesToLocalDateTime(now, APPOINTMENT_FUTURE_DAYS * 24 * 60),
  }

  // The same loaders the in-app calendar uses, so both surfaces can never show different things.
  const [events, shifts, tasks] = await Promise.all([
    loadCalendarEvents(null),
    loadCalendarShifts(memberId, null),
    loadCalendarTaskDeadlines(memberId, null),
  ])

  // The token route resolves nothing but a user id, so the effective permissions have to be loaded
  // here — the feed must show exactly what the calendar page would show this user, no more.
  const [roleIds, positionIds] = await Promise.all([getUserRoleIds(user.id), getUserPositionIds(user.id)])
  const permissions = await getUserPermissions(user.id, roleIds, positionIds)

  const appointments = permissions.includes('calendar.view')
    ? await loadCalendarAppointments(
      { userId: user.id, memberId, canManage: permissions.includes('calendar.manage') },
      appointmentWindow,
    )
    : null

  const host = getRequestHost(event) || 'fsi-buchhaltung.local'

  const icsEvents: IcsFeedEvent[] = events.map(row => ({
    id: row.id,
    name: row.name,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    location: row.location,
    description: buildEventDescription(row),
  }))

  const icsShifts: IcsFeedShift[] = shifts.map(row => ({
    id: row.id,
    eventName: row.eventName,
    name: row.name,
    description: row.description,
    location: row.location,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
  }))

  const icsTasks: IcsFeedTaskDeadline[] = tasks.map(row => ({
    id: row.id,
    eventName: row.eventName,
    title: row.title,
    deadline: row.deadline,
    description: buildTaskDescription(row.status, row.members, row.subdivisions),
  }))

  const icsAppointments: IcsFeedAppointment[] = []

  if (appointments) {
    const seriesById = new Map(appointments.series.map(row => [row.id, row]))

    for (const occurrence of appointments.occurrences) {
      // Cancelled occurrences are simply absent from the feed; the subscriber's calendar drops
      // them on the next refresh, so there is nothing left for STATUS:CANCELLED to describe.
      if (occurrence.isCancelled) continue

      const series = seriesById.get(occurrence.appointmentId)
      const type = series?.type_id != null ? appointments.typesById.get(series.type_id) ?? null : null
      const summary = appointments.responseSummaries.get(`${occurrence.appointmentId}:${occurrence.occurrenceDate}`) ?? null

      icsAppointments.push({
        appointmentId: occurrence.appointmentId,
        occurrenceDate: occurrence.occurrenceDate,
        title: occurrence.title,
        starts_at: occurrence.startsAt,
        ends_at: occurrence.endsAt,
        allDay: Boolean(series?.all_day),
        location: occurrence.location,
        description: buildAppointmentDescription(type?.name ?? null, occurrence.agenda, summary),
      })
    }
  }

  const ics = buildIcsFeed({
    events: icsEvents,
    shifts: icsShifts,
    tasks: icsTasks,
    appointments: icsAppointments,
    calendarName: 'FSi Kalender',
    host,
    timeZone,
  })

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'inline; filename="fsi-kalender.ics"')
  setHeader(event, 'Cache-Control', 'private, max-age=300')

  return ics
})
