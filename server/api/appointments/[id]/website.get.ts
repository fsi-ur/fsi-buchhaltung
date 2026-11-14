import { defineEventHandler, getQuery } from 'h3'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import {
  loadAppointmentWebsiteSettings,
  loadOccurrenceWebsitePublished,
  normalizeOccurrenceDate,
} from '~/server/utils/appointmentWebsite'
import { isAppointmentVisible, resolveAppointmentViewer } from '~/server/utils/appointments/visibility'
import type { AppointmentWebsiteSettings } from '~/types/appointment'
import { internalError } from '~/server/utils/api/errors'

interface GetAppointmentWebsiteSuccess {
  ok: true
  website: AppointmentWebsiteSettings
  /** Only with `?occurrenceDate=`: that date's deviation from the series (null = like the series). */
  occurrencePublished: boolean | null
  canPublish: boolean
}

interface GetAppointmentWebsiteError {
  ok: false
  error: string
}

export type GetAppointmentWebsiteResponse = GetAppointmentWebsiteSuccess | GetAppointmentWebsiteError

export default defineEventHandler(async (event): Promise<GetAppointmentWebsiteResponse> => {
  const current = await requirePermission(event, 'calendar.view')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const rawOccurrenceDate = getQuery(event).occurrenceDate
  const occurrenceDate = rawOccurrenceDate == null ? null : normalizeOccurrenceDate(rawOccurrenceDate)
  if (rawOccurrenceDate != null && !occurrenceDate) return { ok: false, error: 'Ungültiges Datum des Termins.' }

  try {
    const viewer = await resolveAppointmentViewer(current.user)
    if (!await isAppointmentVisible(appointmentId, viewer)) {
      return { ok: false, error: 'Der Termin wurde nicht gefunden.' }
    }

    const website = await loadAppointmentWebsiteSettings(appointmentId)
    if (!website) return { ok: false, error: 'Der Termin wurde nicht gefunden.' }

    const occurrencePublished = occurrenceDate
      ? await loadOccurrenceWebsitePublished(appointmentId, occurrenceDate)
      : null

    return { ok: true, website, occurrencePublished, canPublish: hasPermission(current.user, 'calendar.publish') }
  } catch (err: any) {
    return internalError('Die Website-Einstellungen konnten nicht geladen werden', err)
  }
})
