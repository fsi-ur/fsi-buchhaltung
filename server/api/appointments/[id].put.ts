import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { copyAppointmentWebsiteSettings } from '~/server/utils/appointmentWebsite'
import { validateAppointment, normalizeAllDayRange, normalizeIdList } from '~/server/utils/appointments/validate'
import {
  canEditAppointment,
  copyAppointmentScope,
  describeAppointmentChanges,
  dropOrphanedOccurrenceData,
  insertAppointment,
  loadAppointment,
  loadScopeIds,
  loadTypeName,
  moveOccurrenceDataFrom,
  notifyAppointment,
  syncAppointmentScope,
  truncateSeriesBefore,
  updateAppointment,
  withdrawOccurrenceReminders,
} from '~/server/utils/appointments'
import { formatWallClock, parseWallClock } from '~/server/utils/appointments/recurrence'
import type { DbConn } from '~/server/utils/notifications/types'
import type { AppointmentEditScope, AppointmentSeries, SaveAppointmentBody } from '~/types/appointment'

interface UpdateAppointmentSuccess {
  ok: true
  /** The series the change landed on — a "following" edit creates a new one. */
  id: number
}

interface UpdateAppointmentError {
  ok: false
  error: string
}

export type UpdateAppointmentResponse = UpdateAppointmentSuccess | UpdateAppointmentError

function sameIdSet(incoming: number[] | undefined, existing: number[]): boolean {
  if (incoming === undefined) return true
  const a = Array.from(new Set(normalizeIdList(incoming))).sort((x, y) => x - y)
  const b = Array.from(new Set(existing)).sort((x, y) => x - y)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

async function findForbiddenOccurrenceChange(body: SaveAppointmentBody, appointment: AppointmentSeries, conn: DbConn): Promise<string | null> {
  if (body.recurrence_freq !== undefined && (body.recurrence_freq ?? null) !== appointment.recurrence_freq) {
    return 'Die Wiederholung lässt sich nur für die ganze Serie ändern.'
  }
  if (body.subdivision_ids !== undefined || body.member_ids !== undefined) {
    const existing = await loadScopeIds(appointment.id, conn)
    if (!sameIdSet(body.subdivision_ids, existing.subdivisionIds) || !sameIdSet(body.member_ids, existing.memberIds)) {
      return 'Die Sichtbarkeit lässt sich nur für die ganze Serie ändern.'
    }
  }
  const notificationChanged = (body.notify_on_create !== undefined && Boolean(body.notify_on_create) !== appointment.notify_on_create)
    || (body.notify_on_change !== undefined && Boolean(body.notify_on_change) !== appointment.notify_on_change)
    || (body.notify_reminder !== undefined && Boolean(body.notify_reminder) !== appointment.notify_reminder)
    || (body.reminder_lead_minutes !== undefined && (body.reminder_lead_minutes || null) !== appointment.reminder_lead_minutes)
  if (notificationChanged) {
    return 'Die Benachrichtigungen lassen sich nur für die ganze Serie ändern.'
  }
  return null
}

export default defineEventHandler(async (event): Promise<UpdateAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.create')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const body = await readBody<SaveAppointmentBody>(event)
  if (!body || typeof body !== 'object') return { ok: false, error: 'Ungültige Anfrage.' }

  const canManage = hasPermission(current.user, 'calendar.manage')

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const appointment = await loadAppointment(appointmentId, conn)
      if (!appointment) return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }
      if (!canEditAppointment(current.user, appointment)) {
        return { ok: false as const, error: 'Du darfst diesen Termin nicht bearbeiten.' }
      }

      const scope: AppointmentEditScope = appointment.recurrence_freq ? (body.scope ?? 'series') : 'series'

      const occurrenceDate = normalizeOccurrenceDate(body.occurrenceDate)
      if ((scope === 'occurrence' || scope === 'following') && !occurrenceDate) {
        return { ok: false as const, error: 'Für diese Änderung fehlt der betroffene Termin der Serie.' }
      }

      const error = await validateAppointment(body, {
        canManage,
        existingTypeId: appointment.type_id,
        scope,
        conn,
      })
      if (error) return { ok: false as const, error }

      const typeName = await loadTypeName(body.type_id ?? appointment.type_id, conn)

      if (scope === 'occurrence') {
        const forbidden = await findForbiddenOccurrenceChange(body, appointment, conn)
        if (forbidden) return { ok: false as const, error: forbidden }

        return await updateSingleOccurrence({
          appointment,
          body,
          occurrenceDate: occurrenceDate!,
          typeName,
          userId: Number(current.user.id),
          conn,
        })
      }

      if (scope === 'following') {
        return await splitSeries({
          appointment,
          body,
          occurrenceDate: occurrenceDate!,
          typeName,
          userId: Number(current.user.id),
          conn,
        })
      }

      await updateAppointment(appointment.id, body, conn)
      await syncAppointmentScope(appointment.id, body, conn)

      const updated = await loadAppointment(appointment.id, conn)
      if (!updated) return { ok: false as const, error: 'Der Termin wurde nicht gefunden.' }

      const ruleChanged = updated.starts_at !== appointment.starts_at
        || updated.recurrence_freq !== appointment.recurrence_freq
        || updated.recurrence_interval !== appointment.recurrence_interval
        || updated.recurrence_weekdays !== appointment.recurrence_weekdays
        || updated.recurrence_monthly_mode !== appointment.recurrence_monthly_mode

      if (ruleChanged) await dropOrphanedOccurrenceData(updated.id, conn)

      await withdrawOccurrenceReminders(updated.id, null, conn)

      const changes = describeAppointmentChanges(appointment, updated)
      if (changes.length) {
        await notifyAppointment({
          type: 'appointment.changed',
          appointment: updated,
          typeName,
          changes,
          createdByUserId: Number(current.user.id),
          conn,
        })
      }

      return { ok: true as const, id: updated.id }
    })
  } catch (err: any) {
    return { ok: false, error: `Der Termin konnte nicht gespeichert werden: ${err?.code ?? err}` }
  }
})

function normalizeOccurrenceDate(value: string | null | undefined): string | null {
  const parsed = parseWallClock(value)
  return parsed ? formatWallClock(parsed) : null
}

interface OccurrenceEditArgs {
  appointment: AppointmentSeries
  body: SaveAppointmentBody
  occurrenceDate: string
  typeName: string | null
  userId: number
  conn: any
}

async function updateSingleOccurrence(args: OccurrenceEditArgs): Promise<UpdateAppointmentResponse> {
  const { appointment, body, occurrenceDate, conn } = args

  const allDay = body.all_day ?? appointment.all_day
  const range = allDay
    ? normalizeAllDayRange(body.starts_at, body.ends_at)
    : { starts_at: body.starts_at, ends_at: body.ends_at }

  const title = String(body.title).trim()
  const agenda = body.agenda ? String(body.agenda) : null
  const location = body.location ? String(body.location).trim() : null

  const seriesDurationMs = Math.max(
    0,
    (parseWallClock(appointment.ends_at)?.getTime() ?? 0) - (parseWallClock(appointment.starts_at)?.getTime() ?? 0),
  )
  const scheduledStart = parseWallClock(occurrenceDate)
  const scheduledEnd = scheduledStart ? formatWallClock(new Date(scheduledStart.getTime() + seriesDurationMs)) : null

  const overrideValues = {
    title: title === appointment.title ? null : title,
    agenda: agenda === appointment.agenda ? null : agenda,
    location: location === appointment.location ? null : location,
    starts_at: range.starts_at === occurrenceDate ? null : range.starts_at,
    ends_at: range.ends_at === scheduledEnd ? null : range.ends_at,
  }

  await query(
    `INSERT INTO appointment_occurrence_overrides
       (appointment_id, occurrence_date, is_cancelled, title, agenda, location, starts_at, ends_at)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_cancelled = 0, title = VALUES(title), agenda = VALUES(agenda),
       location = VALUES(location), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at)`,
    [
      appointment.id, occurrenceDate,
      overrideValues.title, overrideValues.agenda, overrideValues.location,
      overrideValues.starts_at, overrideValues.ends_at,
    ],
    conn,
  )

  if (overrideValues.starts_at) {
    await withdrawOccurrenceReminders(appointment.id, occurrenceDate, conn)
  }

  await notifyAppointment({
    type: 'appointment.changed',
    appointment,
    typeName: args.typeName,
    occurrenceDate,
    startsAt: overrideValues.starts_at ?? occurrenceDate,
    endsAt: overrideValues.ends_at ?? scheduledEnd,
    changes: 'Ein einzelner Termin der Serie wurde geändert.',
    createdByUserId: args.userId,
    conn,
  })

  return { ok: true, id: appointment.id }
}

async function splitSeries(args: OccurrenceEditArgs): Promise<UpdateAppointmentResponse> {
  const { appointment, body, occurrenceDate, conn } = args

  await truncateSeriesBefore(appointment.id, occurrenceDate, conn)

  const newId = await insertAppointment(body, appointment.created_by ?? args.userId, conn)
  await copyAppointmentWebsiteSettings(appointment.id, newId, conn)

  if (body.subdivision_ids !== undefined || body.member_ids !== undefined) {
    await syncAppointmentScope(newId, body, conn)
  } else {
    await copyAppointmentScope(appointment.id, newId, conn)
  }

  await moveOccurrenceDataFrom(appointment.id, newId, occurrenceDate, conn)
  await dropOrphanedOccurrenceData(newId, conn)

  await withdrawOccurrenceReminders(appointment.id, null, conn)

  const created = await loadAppointment(newId, conn)
  if (created) {
    await notifyAppointment({
      type: 'appointment.changed',
      appointment: created,
      typeName: args.typeName,
      changes: 'Dieser und alle folgenden Termine der Serie wurden geändert.',
      createdByUserId: args.userId,
      conn,
    })
  }

  return { ok: true, id: newId }
}
