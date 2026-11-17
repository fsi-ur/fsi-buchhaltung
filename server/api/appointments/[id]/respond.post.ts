import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getMemberIdForUser } from '~/server/utils/appointments/visibility'
import { saveAppointmentResponse, VALID_APPOINTMENT_RESPONSES } from '~/server/utils/appointments/responses'
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

export default defineEventHandler(async (event): Promise<RespondAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.view')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const body = await readBody<RespondBody>(event)
  if (!body || !VALID_APPOINTMENT_RESPONSES.includes(body.response)) {
    return { ok: false, error: 'Ungültige Antwort.' }
  }
  if (!body.occurrenceDate) return { ok: false, error: 'Für die Antwort fehlt der betroffene Termin.' }

  const memberId = await getMemberIdForUser(Number(current.user.id))
  if (!memberId) return { ok: false, error: 'Zu deinem Benutzer ist kein Mitglied hinterlegt.' }

  try {
    return await withAuditTransaction(current.user, conn => saveAppointmentResponse({
      appointmentId,
      memberId,
      occurrenceDate: String(body.occurrenceDate),
      response: body.response,
      comment: body.comment,
      applyToSeries: body.applyToSeries,
    }, conn))
  } catch (err: any) {
    return internalError('Deine Antwort konnte nicht gespeichert werden', err)
  }
})
