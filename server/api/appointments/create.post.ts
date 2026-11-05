import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { validateAppointment } from '~/server/utils/appointments/validate'
import {
  insertAppointment,
  loadAppointment,
  loadTypeName,
  notifyAppointment,
  syncAppointmentScope,
} from '~/server/utils/appointments'
import type { SaveAppointmentBody } from '~/types/appointment'
import { internalError } from '~/server/utils/api/errors'

interface CreateAppointmentSuccess {
  ok: true
  id: number
}

interface CreateAppointmentError {
  ok: false
  error: string
}

export type CreateAppointmentResponse = CreateAppointmentSuccess | CreateAppointmentError

export default defineEventHandler(async (event): Promise<CreateAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.create')
  if (!current.ok) return current

  const body = await readBody<SaveAppointmentBody>(event)
  if (!body || typeof body !== 'object') return { ok: false, error: 'Ungültige Anfrage.' }

  const canManage = hasPermission(current.user, 'calendar.manage')

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const error = await validateAppointment(body, { canManage, scope: 'series', conn })
      if (error) return { ok: false as const, error }

      const appointmentId = await insertAppointment(body, Number(current.user.id), conn)
      await syncAppointmentScope(appointmentId, body, conn)

      const appointment = await loadAppointment(appointmentId, conn)
      if (appointment) {
        await notifyAppointment({
          type: 'appointment.invited',
          appointment,
          typeName: await loadTypeName(appointment.type_id, conn),
          createdByUserId: Number(current.user.id),
          conn,
        })
      }

      return { ok: true as const, id: appointmentId }
    })
  } catch (err: any) {
    return internalError('Der Termin konnte nicht gespeichert werden', err)
  }
})
