import { query } from '~/server/utils/db'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import { expandOccurrences, type AppointmentRecurrenceRow } from '~/server/utils/appointments/recurrence'
import { loadOverrides } from '~/server/utils/appointments'
import { normalizeDeadline } from '~/server/utils/eventTasks'
import { isTypeEnabled } from '~/server/utils/notifications/settings'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationSettings } from '~/types/notification'
import type { DbConn } from '~/server/utils/notifications/types'

function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Every reminder that is already planned (or was already sent), by dedupe key. The sweeps below scan
 * *all* future shifts/events/tasks on every pass, so this keeps them from re-issuing inserts that
 * would only bounce off the UNIQUE index.
 */
async function loadPlannedKeys(conn?: DbConn): Promise<Set<string>> {
  const rows = await query<Array<{ dedupe_key: string }>>(
    `SELECT dedupe_key FROM notifications WHERE dedupe_key IS NOT NULL`,
    [],
    conn,
  )
  return new Set(rows.map(row => row.dedupe_key))
}

async function sweepShiftReminders(now: Date, settings: NotificationSettings, planned: Set<string>, conn?: DbConn) {
  const leadMinutes = settings.lead_times['shift.reminder'] || []
  if (!leadMinutes.length) return

  // Deliberately not limited to the largest lead time: a reminder is planned as soon as the shift
  // exists, so adding a lead time immediately shows up as scheduled notifications for every
  // upcoming shift instead of only materialising shortly before it starts.
  const shifts = await query<Array<{ id: number, event_id: number, name: string, starts_at: string, ends_at: string, location: string | null, event_name: string }>>(
    `SELECT ess.id, ess.event_id, ess.name, ess.starts_at, ess.ends_at, e.location, e.name AS event_name
     FROM event_shift_slots ess
     JOIN events e ON e.id = ess.event_id
     WHERE ess.starts_at >= ?`,
    [toMysqlDatetime(now)],
    conn,
  )

  for (const shift of shifts) {
    const startsAt = new Date(shift.starts_at.replace(' ', 'T') + 'Z')
    for (const lead of leadMinutes) {
      const scheduledFor = new Date(startsAt.getTime() - lead * 60000)
      if (scheduledFor.getTime() < now.getTime() - 15 * 60000) continue
      if (planned.has(`shift.reminder:${shift.id}:${lead}`)) continue

      await enqueueNotification({
        type: 'shift.reminder',
        payload: {
          event_id: shift.event_id,
          event_name: shift.event_name,
          shift_name: shift.name,
          shift_start: shift.starts_at,
          shift_end: shift.ends_at,
          location: shift.location,
          lead_minutes: lead,
        },
        recipients: { kind: 'shiftAssignees', shiftId: shift.id },
        scheduledFor,
        dedupeKey: `shift.reminder:${shift.id}:${lead}`,
      }, conn)
    }
  }
}

async function sweepEventReminders(now: Date, settings: NotificationSettings, planned: Set<string>, conn?: DbConn) {
  const leadMinutes = settings.lead_times['event.reminder'] || []
  if (!leadMinutes.length) return

  const events = await query<Array<{ id: number, name: string, starts_at: string, ends_at: string, location: string | null }>>(
    `SELECT id, name, starts_at, ends_at, location
     FROM events
     WHERE starts_at >= ?`,
    [toMysqlDatetime(now)],
    conn,
  )

  for (const eventRow of events) {
    const startsAt = new Date(eventRow.starts_at.replace(' ', 'T') + 'Z')
    for (const lead of leadMinutes) {
      const scheduledFor = new Date(startsAt.getTime() - lead * 60000)
      if (scheduledFor.getTime() < now.getTime() - 15 * 60000) continue
      if (planned.has(`event.reminder:${eventRow.id}:${lead}`)) continue

      await enqueueNotification({
        type: 'event.reminder',
        payload: {
          event_id: eventRow.id,
          event_name: eventRow.name,
          event_start: eventRow.starts_at,
          event_end: eventRow.ends_at,
          location: eventRow.location,
          lead_minutes: lead,
        },
        recipients: { kind: 'eventParticipants', eventId: eventRow.id },
        scheduledFor,
        dedupeKey: `event.reminder:${eventRow.id}:${lead}`,
      }, conn)
    }
  }
}

async function sweepTaskDeadlineReminders(now: Date, settings: NotificationSettings, planned: Set<string>, conn?: DbConn) {
  const leadMinutes = settings.lead_times['task.deadline_reminder'] || []
  if (!leadMinutes.length) return

  const tasks = await query<Array<{ id: number, event_id: number, title: string, deadline: string | null, status: string, event_name: string }>>(
    `SELECT et.id, et.event_id, et.title, et.deadline, et.status, e.name AS event_name
     FROM event_tasks et
     JOIN events e ON e.id = et.event_id
     WHERE et.deadline IS NOT NULL AND et.status != 'done'`,
    [],
    conn,
  )

  for (const task of tasks) {
    const deadline = normalizeDeadline(task.deadline)
    if (!deadline) continue
    const deadlineDate = new Date(`${deadline.length === 10 ? `${deadline}T00:00:00` : deadline.replace(' ', 'T')}Z`)

    for (const lead of leadMinutes) {
      const scheduledFor = new Date(deadlineDate.getTime() - lead * 60000)
      if (scheduledFor.getTime() < now.getTime() - 15 * 60000) continue
      if (planned.has(`task.deadline_reminder:${task.id}:${lead}`)) continue

      await enqueueNotification({
        type: 'task.deadline_reminder',
        payload: {
          event_id: task.event_id,
          event_name: task.event_name,
          task_title: task.title,
          task_deadline: task.deadline,
          lead_minutes: lead,
        },
        recipients: { kind: 'taskAssignees', taskId: task.id },
        scheduledFor,
        dedupeKey: `task.deadline_reminder:${task.id}:${lead}`,
      }, conn)
    }
  }
}

const APPOINTMENT_REMINDER_WINDOW_DAYS = 30

async function sweepAppointmentReminders(now: Date, settings: NotificationSettings, planned: Set<string>, conn?: DbConn) {
  const globalLeadMinutes = settings.lead_times['appointment.reminder'] || []

  const today = toMysqlDatetime(now).slice(0, 10)

  // Series that can still produce a future occurrence: either open-ended/not yet finished, or a
  // single appointment that has not started.
  const appointments = await query<Array<AppointmentRecurrenceRow & { type_id: number | null, location: string | null, reminder_lead_minutes: string | null, name: string | null }>>(
    `SELECT a.id, a.title, a.location, a.starts_at, a.ends_at, a.all_day, a.type_id,
            a.recurrence_freq, a.recurrence_interval, a.recurrence_weekdays, a.recurrence_monthly_mode,
            a.recurrence_until, a.recurrence_count, a.reminder_lead_minutes, at.name
     FROM appointments a
     LEFT JOIN appointment_types at ON at.id = a.type_id
     WHERE a.status = 'active'
       AND a.notify_reminder = 1
       AND (
         (a.recurrence_freq IS NOT NULL AND (a.recurrence_until IS NULL OR a.recurrence_until >= ?))
         OR (a.recurrence_freq IS NULL AND a.starts_at >= ?)
       )`,
    [today, toMysqlDatetime(now)],
    conn,
  )

  if (!appointments.length) return

  const overridesByAppointment = await loadOverrides(appointments.map(row => Number(row.id)), conn)

  const windowFrom = toMysqlDatetime(now)
  const windowTo = toMysqlDatetime(new Date(now.getTime() + APPOINTMENT_REMINDER_WINDOW_DAYS * 86400000))

  for (const appointment of appointments) {
    // Per-appointment lead times win over the association-wide ones.
    const leadMinutes = parseLeadMinutesList(appointment.reminder_lead_minutes) || globalLeadMinutes
    if (!leadMinutes.length) continue

    const overrides = overridesByAppointment.get(Number(appointment.id)) ?? []
    const occurrences = expandOccurrences(appointment, overrides, { from: windowFrom, to: windowTo })

    for (const occurrence of occurrences) {
      const startsAt = new Date(occurrence.startsAt.replace(' ', 'T') + 'Z')

      for (const lead of leadMinutes) {
        const scheduledFor = new Date(startsAt.getTime() - lead * 60000)
        if (scheduledFor.getTime() < now.getTime() - 15 * 60000) continue

        // The occurrence date in the key is what makes per-occurrence reminders idempotent.
        const dedupeKey = `appointment.reminder:${appointment.id}:${occurrence.occurrenceDate}:${lead}`
        if (planned.has(dedupeKey)) continue

        await enqueueNotification({
          type: 'appointment.reminder',
          payload: {
            appointment_id: Number(appointment.id),
            appointment_title: occurrence.title,
            appointment_type: appointment.name ?? '',
            appointment_start: occurrence.startsAt,
            appointment_end: occurrence.endsAt,
            occurrence_date: occurrence.occurrenceDate,
            location: occurrence.location ?? '',
            lead_minutes: lead,
          },
          recipients: {
            kind: 'appointmentParticipants',
            appointmentId: Number(appointment.id),
            occurrenceDate: settings.skip_declined_appointment_reminders ? occurrence.occurrenceDate : undefined,
          },
          scheduledFor,
          dedupeKey,
        }, conn)
      }
    }
  }
}

/** Returns null (not []) when nothing is configured, so the caller can fall back to the global list. */
function parseLeadMinutesList(value: string | null): number[] | null {
  if (!value) return null
  const parsed = String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(minutes => Number.isFinite(minutes) && minutes > 0)
  return parsed.length ? parsed : null
}

async function sweepShiftUnderstaffed(now: Date, settings: NotificationSettings, planned: Set<string>, conn?: DbConn) {
  // Switching the warning off is done through the per-type switch in the settings, which
  // `enqueueNotification` already honours; no lead times configured also means nothing to plan.
  const leadMinutes = settings.lead_times['shift.understaffed'] || []
  if (!leadMinutes.length) return

  const shifts = await query<Array<{ id: number, event_id: number, name: string, starts_at: string, ends_at: string, location: string | null, required_people: number, event_name: string, assigned_count: number }>>(
    `SELECT ess.id, ess.event_id, ess.name, ess.starts_at, ess.ends_at, ess.required_people, e.location, e.name AS event_name,
            (SELECT COUNT(*) FROM event_shift_members esm WHERE esm.shift_id = ess.id) AS assigned_count
     FROM event_shift_slots ess
     JOIN events e ON e.id = ess.event_id
     WHERE ess.starts_at >= ?`,
    [toMysqlDatetime(now)],
    conn,
  )

  for (const shift of shifts) {
    const missing = shift.required_people - shift.assigned_count
    if (missing <= 0) continue

    const startsAt = new Date(shift.starts_at.replace(' ', 'T') + 'Z')
    for (const lead of leadMinutes) {
      const scheduledFor = new Date(startsAt.getTime() - lead * 60000)
      if (scheduledFor.getTime() < now.getTime() - 15 * 60000) continue
      if (planned.has(`shift.understaffed:${shift.id}:${lead}`)) continue

      await enqueueNotification({
        type: 'shift.understaffed',
        payload: {
          shift_id: shift.id,
          event_id: shift.event_id,
          event_name: shift.event_name,
          shift_name: shift.name,
          shift_start: shift.starts_at,
          shift_end: shift.ends_at,
          location: shift.location,
          required_people: shift.required_people,
          assigned_people: shift.assigned_count,
          missing_people: missing,
        },
        recipients: { kind: 'eventOrganizers', eventId: shift.event_id },
        scheduledFor,
        dedupeKey: `shift.understaffed:${shift.id}:${lead}`,
      }, conn)
    }
  }
}

async function sweepTaskOverdue(now: Date, conn?: DbConn) {
  const tasks = await query<Array<{ id: number, event_id: number, title: string, deadline: string | null, event_name: string }>>(
    `SELECT et.id, et.event_id, et.title, et.deadline, e.name AS event_name
     FROM event_tasks et
     JOIN events e ON e.id = et.event_id
     WHERE et.deadline IS NOT NULL AND et.status != 'done'`,
    [],
    conn,
  )

  const today = toMysqlDatetime(now).slice(0, 10)

  for (const task of tasks) {
    const deadline = normalizeDeadline(task.deadline)
    if (!deadline || deadline.slice(0, 10) >= today) continue

    const deadlineDate = new Date(`${deadline.length === 10 ? `${deadline}T00:00:00` : deadline.replace(' ', 'T')}Z`)
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - deadlineDate.getTime()) / 86400000))

    await enqueueNotification({
      type: 'task.overdue',
      payload: {
        event_id: task.event_id,
        event_name: task.event_name,
        task_title: task.title,
        task_deadline: task.deadline,
        days_overdue: daysOverdue,
      },
      recipients: { kind: 'eventOrganizers', eventId: task.event_id },
      scheduledFor: now,
      dedupeKey: `task.overdue:${task.id}:${today}`,
    }, conn)
  }
}

/** Reminder types whose scheduled rows are driven by the admin-configured lead times. */
const LEAD_TIME_TYPES: NotificationTypeKey[] = ['shift.reminder', 'shift.understaffed', 'task.deadline_reminder', 'event.reminder']

/**
 * Drops still-pending reminders that the current settings would no longer produce — a lead time was
 * removed, or the understaffing warning was switched off. The sweeps below then re-create whatever
 * the new configuration does call for (their `dedupe_key` keeps that idempotent), so editing the
 * lead times re-plans the queue instead of leaving the old schedule to fire.
 *
 * The rows are deleted rather than marked `cancelled`, exactly like `dropFutureReminders` does when
 * a shift moves: `dedupe_key` is UNIQUE, so a cancelled tombstone would block the very same
 * reminder from being planned again if the admin re-adds that lead time. Nothing was delivered for
 * these rows, so there is no history to preserve.
 */
export async function dropObsoleteReminders(settings: NotificationSettings, conn?: DbConn) {
  const pending = await query<Array<{ id: number, type_key: NotificationTypeKey, dedupe_key: string }>>(
    `SELECT id, type_key, dedupe_key
     FROM notifications
     WHERE status = 'scheduled' AND dedupe_key IS NOT NULL
       AND type_key IN (${LEAD_TIME_TYPES.map(() => '?').join(',')})`,
    LEAD_TIME_TYPES,
    conn,
  )

  // Keys are "<type>:<entityId>:<leadMinutes>" (see the sweeps above).
  const obsolete = pending.filter((row) => {
    // Switched off association-wide after the reminder was planned.
    if (!isTypeEnabled(settings, row.type_key)) return true
    const lead = Number(row.dedupe_key.split(':').pop())
    if (!Number.isFinite(lead)) return false
    return !(settings.lead_times[row.type_key] || []).includes(lead)
  })

  if (!obsolete.length) return 0

  await query(
    `DELETE FROM notifications
     WHERE status = 'scheduled' AND id IN (${obsolete.map(() => '?').join(',')})`,
    obsolete.map(row => row.id),
    conn,
  )

  return obsolete.length
}

/**
 * The appointment reminders are kept out of LEAD_TIME_TYPES above: their lead times may come from
 * the appointment itself, so "not in settings.lead_times" is not enough to call a row obsolete.
 * They are checked against whichever list actually produced them instead.
 */
async function dropObsoleteAppointmentReminders(settings: NotificationSettings, conn?: DbConn) {
  const pending = await query<Array<{ id: number, dedupe_key: string, reminder_lead_minutes: string | null, notify_reminder: number, status: string }>>(
    `SELECT n.id, n.dedupe_key, a.reminder_lead_minutes, a.notify_reminder, a.status
     FROM notifications n
     LEFT JOIN appointments a ON a.id = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(n.dedupe_key, ':', 2), ':', -1) AS UNSIGNED)
     WHERE n.status = 'scheduled' AND n.type_key = 'appointment.reminder' AND n.dedupe_key IS NOT NULL`,
    [],
    conn,
  )

  if (!pending.length) return 0

  const typeEnabled = isTypeEnabled(settings, 'appointment.reminder')
  const globalLeads = settings.lead_times['appointment.reminder'] || []

  const obsolete = pending.filter((row) => {
    if (!typeEnabled) return true
    // The appointment was deleted, cancelled, or had its reminders switched off.
    if (row.notify_reminder == null || !row.notify_reminder || row.status !== 'active') return true

    const lead = Number(row.dedupe_key.split(':').pop())
    if (!Number.isFinite(lead)) return false

    const leads = parseLeadMinutesList(row.reminder_lead_minutes) || globalLeads
    return !leads.includes(lead)
  })

  if (!obsolete.length) return 0

  await query(
    `DELETE FROM notifications
     WHERE status = 'scheduled' AND id IN (${obsolete.map(() => '?').join(',')})`,
    obsolete.map(row => row.id),
    conn,
  )

  return obsolete.length
}

export async function sweepReminders(now: Date, settings: NotificationSettings, conn?: DbConn) {
  await dropObsoleteReminders(settings, conn)
  await dropObsoleteAppointmentReminders(settings, conn)

  // Loaded after the obsolete rows are gone, so a lead time that is removed and re-added is planned
  // again rather than being seen as already handled.
  const planned = await loadPlannedKeys(conn)

  await sweepShiftReminders(now, settings, planned, conn)
  await sweepEventReminders(now, settings, planned, conn)
  await sweepTaskDeadlineReminders(now, settings, planned, conn)
  await sweepShiftUnderstaffed(now, settings, planned, conn)
  await sweepAppointmentReminders(now, settings, planned, conn)
  await sweepTaskOverdue(now, conn)
}
