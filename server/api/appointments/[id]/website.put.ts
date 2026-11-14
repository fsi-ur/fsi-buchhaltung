import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import {
  isScheduledOccurrence,
  loadAppointmentWebsiteSettings,
  normalizeAppointmentWebsitePayload,
  normalizeOccurrenceWebsitePayload,
  saveAppointmentWebsiteSettings,
  saveOccurrenceWebsitePublished,
} from '~/server/utils/appointmentWebsite'
import { isAppointmentVisible, resolveAppointmentViewer } from '~/server/utils/appointments/visibility'
import { internalError } from '~/server/utils/api/errors'

interface UpdateAppointmentWebsiteSuccess {
  ok: true
}

interface UpdateAppointmentWebsiteError {
  ok: false
  error: string
}

export type UpdateAppointmentWebsiteResponse = UpdateAppointmentWebsiteSuccess | UpdateAppointmentWebsiteError

/**
 * Body `{ published, visible_from }` sets the whole series. Body `{ occurrenceDate, published }`
 * lets one date of a recurring series deviate — `true` publishes only that date, `false` hides it,
 * `null` makes it follow the series again.
 */
export default defineEventHandler(async (event): Promise<UpdateAppointmentWebsiteResponse> => {
  const current = await requirePermission(event, 'calendar.publish')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const raw = await readBody(event)
  const forOccurrence = Boolean(raw && typeof raw === 'object' && 'occurrenceDate' in raw && raw.occurrenceDate != null)
  const seriesBody = forOccurrence ? null : normalizeAppointmentWebsitePayload(raw)
  const occurrenceBody = forOccurrence ? normalizeOccurrenceWebsitePayload(raw) : null
  if (!seriesBody && !occurrenceBody) return { ok: false, error: 'Ungültige Website-Einstellungen.' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const viewer = await resolveAppointmentViewer(current.user, conn)
      if (!await isAppointmentVisible(appointmentId, viewer, conn) || !await loadAppointmentWebsiteSettings(appointmentId, conn)) {
        return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }
      }

      if (occurrenceBody) {
        if (!await isScheduledOccurrence(appointmentId, occurrenceBody.occurrenceDate, conn)) {
          return { ok: false as const, error: 'Dieser Termin gehört nicht zur Serie.' }
        }
        await saveOccurrenceWebsitePublished(appointmentId, occurrenceBody.occurrenceDate, occurrenceBody.published, conn)
        return { ok: true as const }
      }

      await saveAppointmentWebsiteSettings(appointmentId, seriesBody!, conn)
      return { ok: true as const }
    })
  } catch (err: any) {
    return internalError('Die Website-Einstellungen konnten nicht gespeichert werden', err)
  }
})
