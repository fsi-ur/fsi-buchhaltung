import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { loadAppointment, loadOverrides } from '~/server/utils/appointments'
import { expandOccurrences, formatWallClock, parseWallClock } from '~/server/utils/appointments/recurrence'
import { getMemberIdForUser, loadAppointmentAudience } from '~/server/utils/appointments/visibility'
import type { AppointmentResponseValue } from '~/types/appointment'
import { internalError } from '~/server/utils/api/errors'

interface RespondSuccess {
  ok: true
}

interface RespondError {
  ok: false
  error: string
}

export type RespondAppointmentResponse = RespondSuccess | RespondError

interface RespondBody {
  occurrenceDate: string
  response: AppointmentResponseValue
  comment?: string | null
  /** Answer every remaining occurrence of the series the same way. */
  applyToSeries?: boolean
}

const VALID_RESPONSES: AppointmentResponseValue[] = ['yes', 'no', 'maybe']
/** How far ahead "für alle Termine" answers reach; the same horizon the reminder sweep uses. */
const SERIES_RESPONSE_WINDOW_DAYS = 365

export default defineEventHandler(async (event): Promise<RespondAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.view')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const body = await readBody<RespondBody>(event)
  if (!body || !VALID_RESPONSES.includes(body.response)) {
    return { ok: false, error: 'Ungültige Antwort.' }
  }

  const parsedOccurrence = parseWallClock(body.occurrenceDate)
  if (!parsedOccurrence) return { ok: false, error: 'Für die Antwort fehlt der betroffene Termin.' }
  const occurrenceDate = formatWallClock(parsedOccurrence)

  const memberId = await getMemberIdForUser(Number(current.user.id))
  if (!memberId) return { ok: false, error: 'Zu deinem Benutzer ist kein Mitglied hinterlegt.' }

  const comment = body.comment ? String(body.comment).slice(0, 255) : null

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const appointment = await loadAppointment(appointmentId, conn)
      if (!appointment || appointment.status !== 'active') {
        return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }
      }

      // Being able to *see* an appointment is not the same as being part of it — a manager sees
      // everything but only answers for what actually concerns them.
      const audience = await loadAppointmentAudience(appointmentId, conn)
      if (!audience.memberIds.includes(memberId)) {
        return { ok: false as const, error: 'Du gehörst nicht zum Teilnehmerkreis dieses Termins.' }
      }

      const overrides = (await loadOverrides([appointmentId], conn)).get(appointmentId) ?? []

      const targetDates = body.applyToSeries
        ? remainingOccurrenceDates(appointment, overrides, occurrenceDate)
        : [occurrenceDate]

      // An RSVP for a date the rule does not produce would become an orphan the moment the series
      // is next edited.
      if (!targetDates.length) return { ok: false as const, error: 'Dieser Termin gehört nicht zur Serie.' }

      for (const date of targetDates) {
        await query(
          `INSERT INTO appointment_responses (appointment_id, member_id, occurrence_date, response, comment)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE response = VALUES(response), comment = VALUES(comment)`,
          [appointmentId, memberId, date, body.response, comment],
          conn,
        )
      }

      return { ok: true as const }
    })
  } catch (err: any) {
    return internalError('Deine Antwort konnte nicht gespeichert werden', err)
  }
})

function remainingOccurrenceDates(
  appointment: Parameters<typeof expandOccurrences>[0],
  overrides: Parameters<typeof expandOccurrences>[1],
  fromOccurrenceDate: string,
): string[] {
  const from = parseWallClock(fromOccurrenceDate)
  if (!from) return []

  const to = new Date(from.getTime() + SERIES_RESPONSE_WINDOW_DAYS * 86400000)

  return expandOccurrences(appointment, overrides, { from: fromOccurrenceDate, to: formatWallClock(to) })
    .map(occurrence => occurrence.occurrenceDate)
    .filter(date => date >= fromOccurrenceDate)
}
