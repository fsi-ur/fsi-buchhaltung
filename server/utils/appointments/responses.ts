import { query } from '~/server/utils/db'
import { loadAppointment, loadOverrides } from '~/server/utils/appointments'
import { expandOccurrences, formatWallClock, listScheduledOccurrenceDates, parseWallClock } from '~/server/utils/appointments/recurrence'
import { loadAppointmentAudience } from '~/server/utils/appointments/visibility'
import type { AppointmentResponseValue } from '~/types/appointment'
import type { DbConn } from '~/server/utils/notifications/types'

export const VALID_APPOINTMENT_RESPONSES: AppointmentResponseValue[] = ['yes', 'no', 'maybe']
/** How far ahead "für alle Termine" answers reach; the same horizon the reminder sweep uses. */
const SERIES_RESPONSE_WINDOW_DAYS = 365

export interface SaveAppointmentResponseArgs {
  appointmentId: number
  memberId: number
  /** Original (unshifted) start of the occurrence, as produced by the recurrence rule. */
  occurrenceDate: string
  response: AppointmentResponseValue
  comment?: string | null
  /** Answer every remaining occurrence of the series the same way. */
  applyToSeries?: boolean
}

/**
 * Stores an RSVP — shared by the calendar's answer form and the answer buttons of a push
 * notification, so both enforce the same rules. Must run inside an (audit) transaction.
 */
export async function saveAppointmentResponse(
  args: SaveAppointmentResponseArgs,
  conn: DbConn,
): Promise<{ ok: true } | { ok: false, error: string }> {
  const parsedOccurrence = parseWallClock(args.occurrenceDate)
  if (!parsedOccurrence) return { ok: false, error: 'Für die Antwort fehlt der betroffene Termin.' }
  const occurrenceDate = formatWallClock(parsedOccurrence)

  const appointment = await loadAppointment(args.appointmentId, conn)
  if (!appointment || appointment.status !== 'active') {
    return { ok: false, error: 'Der Termin wurde nicht gefunden.' }
  }

  // Being able to *see* an appointment is not the same as being part of it — a manager sees
  // everything but only answers for what actually concerns them.
  const audience = await loadAppointmentAudience(args.appointmentId, conn)
  if (!audience.memberIds.includes(args.memberId)) {
    return { ok: false, error: 'Du gehörst nicht zum Teilnehmerkreis dieses Termins.' }
  }

  const overrides = (await loadOverrides([args.appointmentId], conn)).get(args.appointmentId) ?? []

  const targetDates = args.applyToSeries
    ? remainingOccurrenceDates(appointment, overrides, occurrenceDate)
    : isOccurrenceOf(appointment, overrides, occurrenceDate) ? [occurrenceDate] : []

  // An RSVP for a date the rule does not produce would become an orphan the moment the series
  // is next edited.
  if (!targetDates.length) return { ok: false, error: 'Dieser Termin gehört nicht zur Serie.' }

  const comment = args.comment ? String(args.comment).slice(0, 255) : null

  for (const date of targetDates) {
    await query(
      `INSERT INTO appointment_responses (appointment_id, member_id, occurrence_date, response, comment)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), comment = VALUES(comment), needs_reconfirmation = 0`,
      [args.appointmentId, args.memberId, date, args.response, comment],
      conn,
    )
  }

  return { ok: true }
}

/**
 * The series' scheduled (original) dates from `from` to `to`, without cancelled ones. Deliberately
 * not `expandOccurrences`: that filters by the *effective* time, so an occurrence moved by an
 * override would fall out of a window around its scheduled date — and an answer to it be refused.
 */
function scheduledOccurrenceDates(
  appointment: Parameters<typeof expandOccurrences>[0],
  overrides: Parameters<typeof expandOccurrences>[1],
  from: string,
  to: string,
): string[] {
  const seriesStart = parseWallClock(appointment.starts_at)
  const until = parseWallClock(to)
  if (!seriesStart || !until || until.getTime() < seriesStart.getTime()) return []

  const horizonDays = Math.ceil((until.getTime() - seriesStart.getTime()) / 86400000) + 1
  const cancelled = new Set(overrides
    .filter(override => Boolean(override.is_cancelled))
    .map(override => parseWallClock(override.occurrence_date))
    .filter((date): date is Date => Boolean(date))
    .map(formatWallClock))

  return listScheduledOccurrenceDates(appointment, horizonDays)
    .filter(date => date >= from && date <= to && !cancelled.has(date))
}

/** True when the series really has a (not cancelled) occurrence scheduled at this date (SEC-29). */
function isOccurrenceOf(
  appointment: Parameters<typeof expandOccurrences>[0],
  overrides: Parameters<typeof expandOccurrences>[1],
  occurrenceDate: string,
): boolean {
  return scheduledOccurrenceDates(appointment, overrides, occurrenceDate, occurrenceDate).includes(occurrenceDate)
}

function remainingOccurrenceDates(
  appointment: Parameters<typeof expandOccurrences>[0],
  overrides: Parameters<typeof expandOccurrences>[1],
  fromOccurrenceDate: string,
): string[] {
  const from = parseWallClock(fromOccurrenceDate)
  if (!from) return []

  const to = formatWallClock(new Date(from.getTime() + SERIES_RESPONSE_WINDOW_DAYS * 86400000))
  return scheduledOccurrenceDates(appointment, overrides, fromOccurrenceDate, to)
}
