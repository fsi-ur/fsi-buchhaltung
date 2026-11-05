import { defineEventHandler, getQuery, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import {
  canEditAppointment,
  loadAppointment,
  loadTypeName,
  notifyAppointment,
  resolveExplicitAudienceRule,
  truncateSeriesBefore,
  withdrawOccurrenceReminders,
} from '~/server/utils/appointments'
import { formatWallClock, parseWallClock } from '~/server/utils/appointments/recurrence'
import type { AppointmentEditScope } from '~/types/appointment'
import { internalError } from '~/server/utils/api/errors'

interface DeleteAppointmentSuccess {
  ok: true
}

interface DeleteAppointmentError {
  ok: false
  error: string
}

export type DeleteAppointmentResponse = DeleteAppointmentSuccess | DeleteAppointmentError

export default defineEventHandler(async (event): Promise<DeleteAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.create')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const body = await readBody<{ scope?: AppointmentEditScope, occurrenceDate?: string | null }>(event).catch(() => null)
  const queryParams = getQuery(event)
  const requestedScope = (body?.scope ?? queryParams.scope) as AppointmentEditScope | undefined
  const rawOccurrenceDate = (body?.occurrenceDate ?? queryParams.occurrenceDate) as string | undefined

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const appointment = await loadAppointment(appointmentId, conn)
      if (!appointment) return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }
      if (!canEditAppointment(current.user, appointment)) {
        return { ok: false as const, error: 'Du darfst diesen Termin nicht löschen.' }
      }

      const scope: AppointmentEditScope = appointment.recurrence_freq ? (requestedScope ?? 'series') : 'series'

      const parsedOccurrence = parseWallClock(rawOccurrenceDate)
      const occurrenceDate = parsedOccurrence ? formatWallClock(parsedOccurrence) : null
      if ((scope === 'occurrence' || scope === 'following') && !occurrenceDate) {
        return { ok: false as const, error: 'Für diese Änderung fehlt der betroffene Termin der Serie.' }
      }

      const typeName = await loadTypeName(appointment.type_id, conn)

      if (scope === 'occurrence') {
        await query(
          `INSERT INTO appointment_occurrence_overrides (appointment_id, occurrence_date, is_cancelled)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE is_cancelled = 1`,
          [appointment.id, occurrenceDate],
          conn,
        )
        await withdrawOccurrenceReminders(appointment.id, occurrenceDate, conn)

        await notifyAppointment({
          type: 'appointment.cancelled',
          appointment,
          typeName,
          occurrenceDate,
          startsAt: occurrenceDate,
          createdByUserId: Number(current.user.id),
          conn,
        })

        return { ok: true as const }
      }

      if (scope === 'following') {
        await truncateSeriesBefore(appointment.id, occurrenceDate!, conn)

        await query(
          `DELETE FROM appointment_occurrence_overrides WHERE appointment_id = ? AND occurrence_date >= ?`,
          [appointment.id, occurrenceDate],
          conn,
        )
        await query(
          `DELETE FROM appointment_responses WHERE appointment_id = ? AND occurrence_date >= ?`,
          [appointment.id, occurrenceDate],
          conn,
        )
        await withdrawOccurrenceReminders(appointment.id, null, conn)

        await notifyAppointment({
          type: 'appointment.cancelled',
          appointment,
          typeName,
          occurrenceDate,
          startsAt: occurrenceDate,
          createdByUserId: Number(current.user.id),
          conn,
        })

        return { ok: true as const }
      }

      await notifyAppointment({
        type: 'appointment.cancelled',
        appointment,
        typeName,
        recipients: await resolveExplicitAudienceRule(appointment.id, conn),
        createdByUserId: Number(current.user.id),
        conn,
      })

      await withdrawOccurrenceReminders(appointment.id, null, conn)
      await query(`DELETE FROM appointments WHERE id = ?`, [appointment.id], conn)

      return { ok: true as const }
    })
  } catch (err: any) {
    return internalError('Der Termin konnte nicht gelöscht werden', err)
  }
})
