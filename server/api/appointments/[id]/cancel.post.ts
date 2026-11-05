import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import {
  canEditAppointment,
  copyAppointmentScope,
  dropOrphanedOccurrenceData,
  insertAppointment,
  loadAppointment,
  loadScopeIds,
  loadTypeName,
  moveOccurrenceDataFrom,
  notifyAppointment,
  truncateSeriesBefore,
  withdrawOccurrenceReminders,
} from '~/server/utils/appointments'
import { formatWallClock, parseWallClock } from '~/server/utils/appointments/recurrence'
import type { AppointmentEditScope, SaveAppointmentBody } from '~/types/appointment'
import { internalError } from '~/server/utils/api/errors'

interface CancelAppointmentSuccess {
  ok: true
}

interface CancelAppointmentError {
  ok: false
  error: string
}

export type CancelAppointmentResponse = CancelAppointmentSuccess | CancelAppointmentError

/**
 * Cancels (or reactivates) an appointment, distinct from `[id].delete.ts`: the row and its history
 * stay put, marked `status = 'cancelled'` (or, for a single occurrence, an override row), so it
 * still shows up (struck through) in the calendar rather than vanishing like a hard delete would.
 *
 * Mirrors the edit/delete scopes exactly for a recurring series:
 *  - 'occurrence': only that date is marked cancelled — the rest of the series is untouched.
 *  - 'following': the series is truncated at the split point and a new, independent series is
 *    created from there, immediately cancelled — earlier occurrences stay active.
 *  - 'series' (or a non-recurring appointment): the whole row is marked cancelled.
 * Reactivating (`cancelled: false`) always applies to the whole series — there is no scoped
 * "un-cancel one occurrence" here, since that path is the separate occurrence-override delete flow.
 */
export default defineEventHandler(async (event): Promise<CancelAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.create')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const body = await readBody<{ cancelled?: boolean, scope?: AppointmentEditScope, occurrenceDate?: string | null }>(event).catch(() => null)
  const cancelled = body?.cancelled !== false

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const appointment = await loadAppointment(appointmentId, conn)
      if (!appointment) return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }
      if (!canEditAppointment(current.user, appointment)) {
        return { ok: false as const, error: 'Du darfst diesen Termin nicht ändern.' }
      }

      if (!cancelled) {
        await query(`UPDATE appointments SET status = 'active' WHERE id = ?`, [appointment.id], conn)
        return { ok: true as const }
      }

      const scope: AppointmentEditScope = appointment.recurrence_freq ? (body?.scope ?? 'series') : 'series'

      const parsedOccurrence = parseWallClock(body?.occurrenceDate)
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
        const scopeIds = await loadScopeIds(appointment.id, conn)
        const durationMs = Math.max(
          0,
          (parseWallClock(appointment.ends_at)?.getTime() ?? 0) - (parseWallClock(appointment.starts_at)?.getTime() ?? 0),
        )
        const newStart = parseWallClock(occurrenceDate!)!
        const newEnd = formatWallClock(new Date(newStart.getTime() + durationMs))

        await truncateSeriesBefore(appointment.id, occurrenceDate!, conn)

        const splitBody: SaveAppointmentBody = {
          type_id: appointment.type_id,
          title: appointment.title,
          agenda: appointment.agenda,
          location: appointment.location,
          starts_at: occurrenceDate!,
          ends_at: newEnd,
          all_day: appointment.all_day,
          recurrence_freq: appointment.recurrence_freq,
          recurrence_interval: appointment.recurrence_interval,
          recurrence_weekdays: appointment.recurrence_weekdays,
          recurrence_monthly_mode: appointment.recurrence_monthly_mode,
          recurrence_until: appointment.recurrence_until,
          recurrence_count: appointment.recurrence_count,
          notify_on_create: appointment.notify_on_create,
          notify_on_change: appointment.notify_on_change,
          notify_reminder: appointment.notify_reminder,
          reminder_lead_minutes: appointment.reminder_lead_minutes,
          subdivision_ids: scopeIds.subdivisionIds,
          member_ids: scopeIds.memberIds,
        }

        const newId = await insertAppointment(splitBody, appointment.created_by ?? Number(current.user.id), conn)
        await query(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, [newId], conn)
        await copyAppointmentScope(appointment.id, newId, conn)
        await moveOccurrenceDataFrom(appointment.id, newId, occurrenceDate!, conn)
        await dropOrphanedOccurrenceData(newId, conn)
        await withdrawOccurrenceReminders(appointment.id, null, conn)

        const created = await loadAppointment(newId, conn)
        if (created) {
          await notifyAppointment({
            type: 'appointment.cancelled',
            appointment: created,
            typeName,
            occurrenceDate,
            startsAt: occurrenceDate,
            createdByUserId: Number(current.user.id),
            conn,
          })
        }

        return { ok: true as const }
      }

      await query(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, [appointment.id], conn)
      await withdrawOccurrenceReminders(appointment.id, null, conn)

      await notifyAppointment({
        type: 'appointment.cancelled',
        appointment,
        typeName,
        createdByUserId: Number(current.user.id),
        conn,
      })

      return { ok: true as const }
    })
  } catch (err: any) {
    return internalError('Der Termin konnte nicht geändert werden', err)
  }
})
