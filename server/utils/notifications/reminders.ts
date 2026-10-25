import { query } from '~/server/utils/db'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import { expandOccurrences, type AppointmentRecurrenceRow } from '~/server/utils/appointments/recurrence'
import { loadOverrides } from '~/server/utils/appointments'
import { normalizeDeadline } from '~/server/utils/eventTasks'
import { isTypeEnabled } from '~/server/utils/notifications/settings'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationSettings } from '~/types/notification'
import type { DbConn, ShiftListEntry, TaskListEntry } from '~/server/utils/notifications/types'
import { clusterByLeadTime, findCluster } from '~/server/utils/notifications/clusters'
import { diffLocalDates } from '~/shared/time'

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
          // The person's other shifts of the event are folded in at send time (dispatch.ts).
          shift_id: shift.id,
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
          task_id: task.id,
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

export interface StaffingShiftRow {
  id: number
  event_id: number
  name: string
  starts_at: string
  ends_at: string
  required_people: number
  assigned_count: number
}

/** Every shift of the given events with its current head count. */
export async function loadShiftStaffing(eventIds: number[], conn?: DbConn): Promise<StaffingShiftRow[]> {
  if (!eventIds.length) return []
  const rows = await query<StaffingShiftRow[]>(
    `SELECT ess.id, ess.event_id, ess.name, ess.starts_at, ess.ends_at, ess.required_people,
            (SELECT COUNT(*) FROM event_shift_members esm WHERE esm.shift_id = ess.id) AS assigned_count
     FROM event_shift_slots ess
     WHERE ess.event_id IN (${eventIds.map(() => '?').join(',')})`,
    eventIds,
    conn,
  )
  return rows.map(row => ({
    ...row,
    id: Number(row.id),
    event_id: Number(row.event_id),
    required_people: Number(row.required_people),
    assigned_count: Number(row.assigned_count),
  }))
}

/**
 * The understaffed shifts one warning covers: the group of the event's shifts that `leaderId` leads
 * for this lead time (see clusters.ts). null when `leaderId` does not lead a group — another
 * warning of the same event covers it.
 */
export function understaffedShiftsOfCluster(shifts: StaffingShiftRow[], leadMinutes: number, leaderId: number): ShiftListEntry[] | null {
  const cluster = findCluster(shifts.map(shift => ({ id: shift.id, start: shift.starts_at, end: shift.ends_at })), leadMinutes, 'span', leaderId)
  if (!cluster || cluster.leaderId !== leaderId) return null

  const ids = new Set(cluster.ids)
  return shifts
    .filter(shift => ids.has(shift.id) && shift.assigned_count < shift.required_people)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .map(shift => ({
      shift_id: shift.id,
      name: shift.name,
      start: shift.starts_at,
      end: shift.ends_at,
      assigned: shift.assigned_count,
      required: shift.required_people,
    }))
}

/** Payload fields of the understaffing warning that depend on the current head counts. */
export function understaffedPayload(entries: ShiftListEntry[]) {
  const first = entries[0]!
  return {
    shift_list: entries,
    shift_name: first.name,
    shift_start: first.start,
    shift_end: first.end,
    required_people: entries.reduce((sum, entry) => sum + (entry.required ?? 0), 0),
    assigned_people: entries.reduce((sum, entry) => sum + (entry.assigned ?? 0), 0),
    missing_people: entries.reduce((sum, entry) => sum + Math.max(0, (entry.required ?? 0) - (entry.assigned ?? 0)), 0),
  }
}

/**
 * One warning per event and lead time instead of one per shift: the event's shifts are grouped like
 * a person's shift reminders (clusters.ts, `span`), and each group with at least one understaffed
 * shift gets a single warning, keyed and timed on the group's first shift. Which shifts are still
 * short is re-read when it is sent (dispatch.ts).
 */
async function sweepShiftUnderstaffed(now: Date, settings: NotificationSettings, planned: Set<string>, conn?: DbConn) {
  // Switching the warning off is done through the per-type switch in the settings, which
  // `enqueueNotification` already honours; no lead times configured also means nothing to plan.
  const leadMinutes = settings.lead_times['shift.understaffed'] || []
  if (!leadMinutes.length) return

  const events = await query<Array<{ id: number, name: string, location: string | null }>>(
    `SELECT e.id, e.name, e.location
     FROM events e
     WHERE EXISTS (SELECT 1 FROM event_shift_slots ess WHERE ess.event_id = e.id AND ess.starts_at >= ?)`,
    [toMysqlDatetime(now)],
    conn,
  )
  if (!events.length) return

  const shifts = await loadShiftStaffing(events.map(row => Number(row.id)), conn)

  for (const eventRow of events) {
    const eventId = Number(eventRow.id)
    const eventShifts = shifts.filter(shift => shift.event_id === eventId)

    for (const lead of leadMinutes) {
      const clusters = clusterByLeadTime(eventShifts.map(shift => ({ id: shift.id, start: shift.starts_at, end: shift.ends_at })), lead, 'span')

      for (const cluster of clusters) {
        const dedupeKey = `shift.understaffed:${cluster.leaderId}:${lead}`
        if (planned.has(dedupeKey)) continue

        const entries = understaffedShiftsOfCluster(eventShifts, lead, cluster.leaderId)
        if (!entries?.length) continue

        const leader = eventShifts.find(shift => shift.id === cluster.leaderId)!
        const startsAt = new Date(leader.starts_at.replace(' ', 'T') + 'Z')
        const scheduledFor = new Date(startsAt.getTime() - lead * 60000)
        if (scheduledFor.getTime() < now.getTime() - 15 * 60000) continue

        await enqueueNotification({
          type: 'shift.understaffed',
          payload: {
            shift_id: cluster.leaderId,
            event_id: eventId,
            event_name: eventRow.name,
            location: eventRow.location,
            lead_minutes: lead,
            ...understaffedPayload(entries),
          },
          recipients: { kind: 'eventOrganizers', eventId },
          scheduledFor,
          dedupeKey,
        }, conn)
      }
    }
  }
}

/**
 * Overdue tasks are reported per event, and less often the longer they stay overdue: on day 1, 3
 * and 7, then weekly. A digest goes out whenever one of the event's tasks hits such a day and lists
 * every overdue task of the event, so a new straggler also brings the older ones back to mind.
 */
export function isOverdueReminderDay(daysOverdue: number): boolean {
  if (daysOverdue < 1) return false
  if (daysOverdue === 1 || daysOverdue === 3 || daysOverdue === 7) return true
  return daysOverdue > 7 && daysOverdue % 7 === 0
}

async function sweepTaskOverdue(now: Date, planned: Set<string>, conn?: DbConn) {
  const tasks = await query<Array<{ id: number, event_id: number, title: string, deadline: string | null, event_name: string }>>(
    `SELECT et.id, et.event_id, et.title, et.deadline, e.name AS event_name
     FROM event_tasks et
     JOIN events e ON e.id = et.event_id
     WHERE et.deadline IS NOT NULL AND et.status != 'done'`,
    [],
    conn,
  )

  const today = toMysqlDatetime(now).slice(0, 10)
  const byEvent = new Map<number, { name: string, entries: TaskListEntry[] }>()

  for (const task of tasks) {
    const deadline = normalizeDeadline(task.deadline)
    if (!deadline || deadline.slice(0, 10) >= today) continue

    const eventId = Number(task.event_id)
    const group = byEvent.get(eventId) ?? { name: task.event_name, entries: [] }
    group.entries.push({
      task_id: Number(task.id),
      title: task.title,
      deadline,
      days_overdue: diffLocalDates(deadline.slice(0, 10), today),
    })
    byEvent.set(eventId, group)
  }

  for (const [eventId, group] of byEvent) {
    if (!group.entries.some(entry => isOverdueReminderDay(entry.days_overdue ?? 0))) continue

    const dedupeKey = `task.overdue:event:${eventId}:${today}`
    if (planned.has(dedupeKey)) continue

    const entries = group.entries.sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0))
    const first = entries[0]!

    await enqueueNotification({
      type: 'task.overdue',
      payload: {
        event_id: eventId,
        event_name: group.name,
        task_list: entries,
        task_count: entries.length,
        task_title: first.title,
        task_deadline: first.deadline,
        days_overdue: first.days_overdue,
      },
      recipients: { kind: 'eventOrganizers', eventId },
      scheduledFor: now,
      dedupeKey,
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
  await sweepTaskOverdue(now, planned, conn)
}
