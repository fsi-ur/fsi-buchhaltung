import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import {
  loadAppointmentWebsiteSettings,
  normalizeAppointmentWebsitePayload,
  saveAppointmentWebsiteSettings,
} from '~/server/utils/appointmentWebsite'
import { isAppointmentVisible, resolveAppointmentViewer } from '~/server/utils/appointments/visibility'

interface UpdateAppointmentWebsiteSuccess {
  ok: true
}

interface UpdateAppointmentWebsiteError {
  ok: false
  error: string
}

export type UpdateAppointmentWebsiteResponse = UpdateAppointmentWebsiteSuccess | UpdateAppointmentWebsiteError

/** Publishing is a property of the whole series — there is no per-occurrence variant. */
export default defineEventHandler(async (event): Promise<UpdateAppointmentWebsiteResponse> => {
  const current = await requirePermission(event, 'calendar.publish')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const body = normalizeAppointmentWebsitePayload(await readBody(event))
  if (!body) return { ok: false, error: 'Ungültige Website-Einstellungen.' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const viewer = await resolveAppointmentViewer(current.user, conn)
      if (!await isAppointmentVisible(appointmentId, viewer, conn) || !await loadAppointmentWebsiteSettings(appointmentId, conn)) {
        return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }
      }

      await saveAppointmentWebsiteSettings(appointmentId, body, conn)
      return { ok: true as const }
    })
  } catch (err: any) {
    return { ok: false, error: `Die Website-Einstellungen konnten nicht gespeichert werden: ${err?.code ?? err}` }
  }
})
