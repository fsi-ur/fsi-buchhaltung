import { query } from '~/server/utils/db'
import { loadEventRelations } from '~/server/utils/events'
import { normalizeShiftTypeKey } from '~/server/utils/eventShifts'
import type { DbConn } from '~/server/utils/notifications/types'
import type { User } from '~/types/user'
import type {
  AppointmentResponseSummary,
  AppointmentResponseValue,
  AppointmentSeries,
  AppointmentTypeRow,
  CalendarEntry,
  CalendarSource,
} from '~/types/appointment'
import { canEditAppointment, loadOverrides, toAppointmentSeries, toAppointmentType, SERIES_COLUMNS } from '~/server/utils/appointments'
import { expandOccurrences, type AppointmentOccurrence } from '~/server/utils/appointments/recurrence'
import { buildVisibleAppointmentsFilter, type AppointmentViewer } from '~/server/utils/appointments/visibility'

export interface CalendarWindow {
  from: string
  to: string
}

export interface CalendarEventSource {
  id: number
  name: string
  starts_at: string
  ends_at: string
  location: string | null
  expected_guests: number | null
  memberOrganizers: string[]
  subdivisionOrganizers: string[]
}

export interface CalendarShiftSource {
  id: number
  eventId: number
  eventName: string
  name: string
  description: string
  location: string | null
  starts_at: string
  ends_at: string
}

export type CalendarTaskStatus = 'open' | 'in_progress' | 'done'

export interface CalendarTaskSource {
  id: number
  eventId: number
  eventName: string
  title: string
  deadline: string
  status: CalendarTaskStatus
  members: string[]
  subdivisions: string[]
}

export interface CalendarAppointmentSource {
  series: AppointmentSeries[]
  occurrences: AppointmentOccurrence[]
  typesById: Map<number, AppointmentTypeRow>
  ownResponses: Map<string, AppointmentResponseValue>
  /** The viewer's answers that await reconfirmation, kept apart so they never count as an answer. */
  unconfirmedResponses: Map<string, AppointmentResponseValue>
  responseSummaries: Map<string, AppointmentResponseSummary>
  respondableAppointmentIds: Set<number>
}

function occurrenceKey(appointmentId: number, occurrenceDate: string) {
  return `${appointmentId}:${occurrenceDate}`
}

export async function loadCalendarEvents(window: CalendarWindow | null, conn?: DbConn): Promise<CalendarEventSource[]> {
  const rows = await query<Array<Record<string, any>>>(
    `SELECT id, name, starts_at, ends_at, location, expected_guests
     FROM events
     ${window ? 'WHERE ends_at >= ? AND starts_at <= ?' : ''}
     ORDER BY starts_at`,
    window ? [window.from, window.to] : [],
    conn,
  )

  const relations = await loadEventRelations(rows.map(row => Number(row.id)))

  return rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    starts_at: String(row.starts_at),
    ends_at: String(row.ends_at),
    location: row.location == null ? null : String(row.location),
    expected_guests: row.expected_guests == null ? null : Number(row.expected_guests),
    memberOrganizers: (relations.memberOrganizers.get(Number(row.id)) ?? []).map(organizer => organizer.full_name),
    subdivisionOrganizers: (relations.subdivisionOrganizers.get(Number(row.id)) ?? []).map(organizer => organizer.name),
  }))
}

export async function loadCalendarShifts(
  memberId: number | null,
  window: CalendarWindow | null,
  conn?: DbConn,
): Promise<CalendarShiftSource[]> {
  if (!memberId) return []

  const rows = await query<Array<Record<string, any>>>(
    `SELECT s.id, s.event_id, e.name AS event_name, s.name, s.description,
            e.location AS event_location, s.starts_at, s.ends_at
     FROM event_shift_slots s
     JOIN event_shift_members esm ON esm.shift_id = s.id
     JOIN events e ON e.id = s.event_id
     WHERE esm.member_id = ?
       ${window ? 'AND s.ends_at >= ? AND s.starts_at <= ?' : ''}
     ORDER BY s.starts_at`,
    window ? [memberId, window.from, window.to] : [memberId],
    conn,
  )

  const eventIds = Array.from(new Set(rows.map(row => Number(row.event_id))))
  const descriptionByKey = new Map<string, string>()

  if (eventIds.length) {
    const descriptionRows = await query<Array<{ event_id: number, name_key: string, description: string }>>(
      `SELECT event_id, name_key, description
       FROM event_shift_type_descriptions
       WHERE event_id IN (${eventIds.map(() => '?').join(',')})`,
      eventIds,
      conn,
    )
    for (const row of descriptionRows) {
      descriptionByKey.set(`${Number(row.event_id)}::${row.name_key}`, String(row.description))
    }
  }

  return rows.map((row) => {
    const typeDescription = descriptionByKey.get(`${Number(row.event_id)}::${normalizeShiftTypeKey(String(row.name))}`) ?? ''
    const shiftDescription = row.description == null ? '' : String(row.description)

    return {
      id: Number(row.id),
      eventId: Number(row.event_id),
      eventName: String(row.event_name),
      name: String(row.name),
      description: [typeDescription, shiftDescription].filter(Boolean).join('\n\n'),
      location: row.event_location == null ? null : String(row.event_location),
      starts_at: String(row.starts_at),
      ends_at: String(row.ends_at),
    }
  })
}

export async function loadCalendarTaskDeadlines(
  memberId: number | null,
  window: CalendarWindow | null,
  conn?: DbConn,
): Promise<CalendarTaskSource[]> {
  if (!memberId) return []

  const params: unknown[] = [memberId, memberId]
  if (window) params.push(window.from.slice(0, 10), window.to.slice(0, 10))

  const rows = await query<Array<Record<string, any>>>(
    `SELECT t.id, t.event_id, e.name AS event_name, t.title, t.deadline, t.status
     FROM event_tasks t
     JOIN events e ON e.id = t.event_id
     WHERE t.deadline IS NOT NULL
       AND (
         t.id IN (SELECT task_id FROM event_task_members WHERE member_id = ?)
         OR t.id IN (
           SELECT task_id FROM event_task_subdivisions
           WHERE subdivision_id IN (SELECT subdivision_id FROM subdivision_members WHERE member_id = ?)
         )
       )
       ${window ? 'AND DATE(t.deadline) >= ? AND DATE(t.deadline) <= ?' : ''}
     GROUP BY t.id
     ORDER BY t.deadline`,
    params,
    conn,
  )

  if (!rows.length) return []

  const taskIds = rows.map(row => Number(row.id))

  const [memberRows, subdivisionRows] = await Promise.all([
    query<Array<{ task_id: number, name: string }>>(
      `SELECT etm.task_id, CONCAT(m.first_name, ' ', m.last_name) AS name
       FROM event_task_members etm
       JOIN members m ON m.id = etm.member_id
       WHERE etm.task_id IN (${taskIds.map(() => '?').join(',')})
       ORDER BY m.first_name, m.last_name`,
      taskIds,
      conn,
    ),
    query<Array<{ task_id: number, name: string }>>(
      `SELECT ets.task_id, s.name AS name
       FROM event_task_subdivisions ets
       JOIN subdivisions s ON s.id = ets.subdivision_id
       WHERE ets.task_id IN (${taskIds.map(() => '?').join(',')})
       ORDER BY s.name`,
      taskIds,
      conn,
    ),
  ])

  const groupByTask = (assignees: Array<{ task_id: number, name: string }>) => {
    const map = new Map<number, string[]>()
    for (const row of assignees) {
      const taskId = Number(row.task_id)
      map.set(taskId, [...(map.get(taskId) ?? []), String(row.name)])
    }
    return map
  }

  const membersByTask = groupByTask(memberRows)
  const subdivisionsByTask = groupByTask(subdivisionRows)

  return rows.map(row => ({
    id: Number(row.id),
    eventId: Number(row.event_id),
    eventName: String(row.event_name),
    title: String(row.title),
    deadline: String(row.deadline),
    status: row.status as CalendarTaskStatus,
    members: membersByTask.get(Number(row.id)) ?? [],
    subdivisions: subdivisionsByTask.get(Number(row.id)) ?? [],
  }))
}

async function loadAudienceCounts(appointmentIds: number[], conn?: DbConn): Promise<Map<number, number>> {
  const counts = new Map<number, number>()
  if (!appointmentIds.length) return counts

  const rows = await query<Array<{ appointment_id: number, audience_count: number }>>(
    `SELECT a.id AS appointment_id,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM appointment_subdivisions asub0 WHERE asub0.appointment_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM appointment_members am0 WHERE am0.appointment_id = a.id)
         THEN (SELECT COUNT(*) FROM members WHERE status != 'left')
         ELSE (
           SELECT COUNT(DISTINCT m.id)
           FROM members m
           LEFT JOIN subdivision_members sm ON sm.member_id = m.id
           LEFT JOIN appointment_subdivisions asub ON asub.subdivision_id = sm.subdivision_id AND asub.appointment_id = a.id
           LEFT JOIN appointment_members am ON am.member_id = m.id AND am.appointment_id = a.id
           WHERE m.status != 'left' AND (asub.appointment_id IS NOT NULL OR am.appointment_id IS NOT NULL)
         )
       END AS audience_count
     FROM appointments a
     WHERE a.id IN (${appointmentIds.map(() => '?').join(',')})`,
    appointmentIds,
    conn,
  )

  for (const row of rows) counts.set(Number(row.appointment_id), Number(row.audience_count))
  return counts
}

export async function loadCalendarAppointments(
  viewer: AppointmentViewer,
  window: CalendarWindow,
  conn?: DbConn,
): Promise<CalendarAppointmentSource> {
  const filter = buildVisibleAppointmentsFilter(viewer)

  const seriesRows = await query<Array<Record<string, any>>>(
    `SELECT ${SERIES_COLUMNS}
     FROM appointments a
     WHERE ${filter.sql}`,
    filter.params,
    conn,
  )

  const series = seriesRows.map(toAppointmentSeries)
  const empty: CalendarAppointmentSource = {
    series: [],
    occurrences: [],
    typesById: new Map(),
    ownResponses: new Map(),
    unconfirmedResponses: new Map(),
    responseSummaries: new Map(),
    respondableAppointmentIds: new Set(),
  }

  if (!series.length) return empty

  const appointmentIds = series.map(row => row.id)
  const overridesByAppointment = await loadOverrides(appointmentIds, conn)

  const occurrences: AppointmentOccurrence[] = []
  for (const appointment of series) {
    occurrences.push(...expandOccurrences(
      appointment,
      overridesByAppointment.get(appointment.id) ?? [],
      window,
      { includeCancelled: true },
    ))
  }

  const typeRows = await query<Array<Record<string, any>>>(
    `SELECT id, name, color, icon, sort_order, is_active, description FROM appointment_types`,
    [],
    conn,
  )
  const typesById = new Map(typeRows.map(row => [Number(row.id), toAppointmentType(row)]))

  const responseRows = await query<Array<{ appointment_id: number, member_id: number, occurrence_date: string, response: AppointmentResponseValue, needs_reconfirmation: number }>>(
    `SELECT appointment_id, member_id, occurrence_date, response, needs_reconfirmation
     FROM appointment_responses
     WHERE appointment_id IN (${appointmentIds.map(() => '?').join(',')})`,
    appointmentIds,
    conn,
  )

  const ownResponses = new Map<string, AppointmentResponseValue>()
  const unconfirmedResponses = new Map<string, AppointmentResponseValue>()
  const responseSummaries = new Map<string, AppointmentResponseSummary>()

  for (const row of responseRows) {
    const key = occurrenceKey(Number(row.appointment_id), String(row.occurrence_date))
    const summary = responseSummaries.get(key) ?? { yes: 0, no: 0, maybe: 0, pending: 0, unconfirmed: 0 }
    const unconfirmed = Boolean(Number(row.needs_reconfirmation))
    if (unconfirmed) summary.unconfirmed += 1
    else summary[row.response] += 1
    responseSummaries.set(key, summary)

    if (viewer.memberId != null && Number(row.member_id) === viewer.memberId) {
      (unconfirmed ? unconfirmedResponses : ownResponses).set(key, row.response)
    }
  }

  const audienceCountByAppointment = await loadAudienceCounts(appointmentIds, conn)
  for (const occurrence of occurrences) {
    const key = occurrenceKey(occurrence.appointmentId, occurrence.occurrenceDate)
    const summary = responseSummaries.get(key) ?? { yes: 0, no: 0, maybe: 0, pending: 0, unconfirmed: 0 }
    const audienceCount = audienceCountByAppointment.get(occurrence.appointmentId) ?? 0
    summary.pending = Math.max(0, audienceCount - summary.yes - summary.no - summary.maybe)
    responseSummaries.set(key, summary)
  }

  const respondableAppointmentIds = new Set<number>()
  if (viewer.memberId != null) {
    const rows = await query<Array<{ id: number }>>(
      `SELECT a.id
       FROM appointments a
       WHERE a.id IN (${appointmentIds.map(() => '?').join(',')})
         AND (
           (
             NOT EXISTS (SELECT 1 FROM appointment_subdivisions asub1 WHERE asub1.appointment_id = a.id)
             AND NOT EXISTS (SELECT 1 FROM appointment_members am1 WHERE am1.appointment_id = a.id)
           )
           OR EXISTS (
                SELECT 1 FROM appointment_subdivisions asub
                JOIN subdivision_members asm ON asm.subdivision_id = asub.subdivision_id
                WHERE asub.appointment_id = a.id AND asm.member_id = ?
              )
           OR EXISTS (SELECT 1 FROM appointment_members am WHERE am.appointment_id = a.id AND am.member_id = ?)
         )`,
      [...appointmentIds, viewer.memberId, viewer.memberId],
      conn,
    )
    for (const row of rows) respondableAppointmentIds.add(Number(row.id))
  }

  return { series, occurrences, typesById, ownResponses, unconfirmedResponses, responseSummaries, respondableAppointmentIds }
}

export { occurrenceKey }

export const CALENDAR_SOURCE_STYLE: Record<Exclude<CalendarSource, 'appointment'>, { color: string, icon: string }> = {
  event: { color: '#0ea5e9', icon: 'material-symbols:event-rounded' },
  shift: { color: '#8b5cf6', icon: 'material-symbols:schedule-rounded' },
  task: { color: '#f59e0b', icon: 'material-symbols:flag-rounded' },
}

const DEFAULT_APPOINTMENT_COLOR = '#3b82f6'
const DEFAULT_APPOINTMENT_ICON = 'material-symbols:event-note-rounded'

export function buildAppointmentEntries(source: CalendarAppointmentSource, user: User): CalendarEntry[] {
  const seriesById = new Map(source.series.map(row => [row.id, row]))

  return source.occurrences.map((occurrence) => {
    const series = seriesById.get(occurrence.appointmentId)
    const type = series?.type_id != null ? source.typesById.get(series.type_id) ?? null : null
    const key = occurrenceKey(occurrence.appointmentId, occurrence.occurrenceDate)

    return {
      source: 'appointment' as const,
      key: `appointment:${occurrence.appointmentId}:${occurrence.occurrenceDate}`,
      id: occurrence.appointmentId,
      occurrenceDate: occurrence.occurrenceDate,
      title: occurrence.title,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      allDay: Boolean(series?.all_day),
      color: type?.color || DEFAULT_APPOINTMENT_COLOR,
      icon: type?.icon || DEFAULT_APPOINTMENT_ICON,
      typeId: type?.id ?? null,
      typeName: type?.name ?? null,
      location: occurrence.location,
      ownResponse: source.ownResponses.get(key) ?? null,
      unconfirmedResponse: source.unconfirmedResponses.get(key) ?? null,
      canRespond: source.respondableAppointmentIds.has(occurrence.appointmentId),
      responseSummary: source.responseSummaries.get(key) ?? { yes: 0, no: 0, maybe: 0, pending: 0, unconfirmed: 0 },
      isCancelled: occurrence.isCancelled,
      canEdit: series ? canEditAppointment(user, series) : false,
      eventId: null,
      eventTab: null,
    }
  })
}

function readOnlyEntry(
  source: Exclude<CalendarSource, 'appointment'>,
  id: number,
  title: string,
  startsAt: string,
  endsAt: string,
  options: { allDay?: boolean, location?: string | null, eventId?: number | null, eventTab?: string | null } = {},
): CalendarEntry {
  const style = CALENDAR_SOURCE_STYLE[source]

  return {
    source,
    key: `${source}:${id}:`,
    id,
    occurrenceDate: null,
    title,
    startsAt,
    endsAt,
    allDay: Boolean(options.allDay),
    color: style.color,
    icon: style.icon,
    typeId: null,
    typeName: null,
    location: options.location ?? null,
    ownResponse: null,
    unconfirmedResponse: null,
    canRespond: false,
    responseSummary: null,
    isCancelled: false,
    canEdit: false,
    eventId: options.eventId ?? null,
    eventTab: options.eventTab ?? null,
  }
}

export function buildEventEntries(events: CalendarEventSource[]): CalendarEntry[] {
  return events.map(row => readOnlyEntry('event', row.id, row.name, row.starts_at, row.ends_at, {
    location: row.location,
    eventId: row.id,
  }))
}

export function buildShiftEntries(shifts: CalendarShiftSource[]): CalendarEntry[] {
  return shifts.map(row => readOnlyEntry('shift', row.id, row.name, row.starts_at, row.ends_at, {
    location: row.location,
    eventId: row.eventId,
    eventTab: 'shifts',
  }))
}

export function buildTaskEntries(tasks: CalendarTaskSource[]): CalendarEntry[] {
  return tasks.map((row) => {
    const hasTime = /\d{2}:\d{2}/.test(row.deadline)
    const startsAt = hasTime ? row.deadline : `${row.deadline.slice(0, 10)} 00:00:00`
    const endsAt = hasTime ? row.deadline : `${row.deadline.slice(0, 10)} 23:59:59`

    return readOnlyEntry('task', row.id, row.title, startsAt, endsAt, {
      allDay: !hasTime,
      eventId: row.eventId,
      eventTab: 'tasks',
    })
  })
}
