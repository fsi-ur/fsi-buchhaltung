import { defineEventHandler } from 'h3'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { loadAppointmentWebsiteSettings } from '~/server/utils/appointmentWebsite'
import { isAppointmentVisible, resolveAppointmentViewer } from '~/server/utils/appointments/visibility'
import type { AppointmentWebsiteSettings } from '~/types/appointment'

interface GetAppointmentWebsiteSuccess {
  ok: true
  website: AppointmentWebsiteSettings
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

  try {
    const viewer = await resolveAppointmentViewer(current.user)
    if (!await isAppointmentVisible(appointmentId, viewer)) {
      return { ok: false, error: 'Der Termin wurde nicht gefunden.' }
    }

    const website = await loadAppointmentWebsiteSettings(appointmentId)
    if (!website) return { ok: false, error: 'Der Termin wurde nicht gefunden.' }

    return { ok: true, website, canPublish: hasPermission(current.user, 'calendar.publish') }
  } catch (err: any) {
    return { ok: false, error: `Die Website-Einstellungen konnten nicht geladen werden: ${err?.code ?? err}` }
  }
})
