import { query } from '~/server/utils/db'
import { hasPermission } from '~/server/utils/api/guards'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'
import { renderArticle } from '~/server/utils/wiki/render'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import type { DbConn, RecipientRule } from '~/server/utils/notifications/types'
import type { User } from '~/types/user'
import type {
  AppointmentDetail,
  AppointmentOccurrenceOverride,
  AppointmentSeries,
  AppointmentTypeRow,
  SaveAppointmentBody,
} from '~/types/appointment'
import {
  formatWallClock,
  formatWallClockDate,
  listScheduledOccurrenceDates,
  parseWallClock,
} from '~/server/utils/appointments/recurrence'
import { normalizeAllDayRange, normalizeIdList } from '~/server/utils/appointments/validate'
import { loadAppointmentAudience } from '~/server/utils/appointments/visibility'
import { pickChangedFields, type ChangedField } from '~/server/utils/notifications/changeDescription'
import { formatLocalDateTime } from '~/server/utils/notifications/render'

const SERIES_COLUMNS = `
  id, type_id, title, agenda, location, starts_at, ends_at, all_day, status,
  recurrence_freq, recurrence_interval, recurrence_weekdays, recurrence_monthly_mode,
  recurrence_until, recurrence_count, notify_on_create, notify_on_change, notify_reminder,
  reminder_lead_minutes, created_by, created_at, updated_at
`

export function toAppointmentSeries(row: Record<string, any>): AppointmentSeries {
  return {
    id: Number(row.id),
    type_id: row.type_id == null ? null : Number(row.type_id),
    title: String(row.title),
    agenda: row.agenda == null ? null : String(row.agenda),
    location: row.location == null ? null : String(row.location),
    starts_at: String(row.starts_at),
    ends_at: String(row.ends_at),
    all_day: Boolean(row.all_day),
    status: row.status,
    recurrence_freq: row.recurrence_freq ?? null,
    recurrence_interval: Number(row.recurrence_interval ?? 1),
    recurrence_weekdays: row.recurrence_weekdays == null ? null : String(row.recurrence_weekdays),
    recurrence_monthly_mode: row.recurrence_monthly_mode ?? null,
    recurrence_until: row.recurrence_until == null ? null : String(row.recurrence_until).slice(0, 10),
    recurrence_count: row.recurrence_count == null ? null : Number(row.recurrence_count),
    notify_on_create: Boolean(row.notify_on_create),
    notify_on_change: Boolean(row.notify_on_change),
    notify_reminder: Boolean(row.notify_reminder),
    reminder_lead_minutes: row.reminder_lead_minutes == null ? null : String(row.reminder_lead_minutes),
    created_by: row.created_by == null ? null : Number(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function toOccurrenceOverride(row: Record<string, any>): AppointmentOccurrenceOverride {
  return {
    id: Number(row.id),
    appointment_id: Number(row.appointment_id),
    occurrence_date: String(row.occurrence_date),
    is_cancelled: Boolean(row.is_cancelled),
    title: row.title == null ? null : String(row.title),
    agenda: row.agenda == null ? null : String(row.agenda),
    location: row.location == null ? null : String(row.location),
    starts_at: row.starts_at == null ? null : String(row.starts_at),
    ends_at: row.ends_at == null ? null : String(row.ends_at),
    website_published: row.website_published == null ? null : Boolean(Number(row.website_published)),
  }
}

export function toAppointmentType(row: Record<string, any>): AppointmentTypeRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    color: String(row.color ?? '#3b82f6'),
    icon: row.icon == null ? null : String(row.icon),
    sort_order: Number(row.sort_order ?? 0),
    is_active: Boolean(row.is_active),
    description: row.description == null ? null : String(row.description),
  }
}

export async function loadAppointment(appointmentId: number, conn?: DbConn): Promise<AppointmentSeries | null> {
  const rows = await query<Array<Record<string, any>>>(
    `SELECT ${SERIES_COLUMNS} FROM appointments WHERE id = ? LIMIT 1`,
    [appointmentId],
    conn,
  )
  return rows[0] ? toAppointmentSeries(rows[0]) : null
}

export async function loadOverrides(appointmentIds: number[], conn?: DbConn): Promise<Map<number, AppointmentOccurrenceOverride[]>> {
  const byAppointment = new Map<number, AppointmentOccurrenceOverride[]>()
  if (!appointmentIds.length) return byAppointment

  const rows = await query<Array<Record<string, any>>>(
    `SELECT id, appointment_id, occurrence_date, is_cancelled, title, agenda, location, starts_at, ends_at, website_published
     FROM appointment_occurrence_overrides
     WHERE appointment_id IN (${appointmentIds.map(() => '?').join(',')})`,
    appointmentIds,
    conn,
  )

  for (const row of rows) {
    const override = toOccurrenceOverride(row)
    const list = byAppointment.get(override.appointment_id) ?? []
    list.push(override)
    byAppointment.set(override.appointment_id, list)
  }

  return byAppointment
}

export async function loadScopeIds(appointmentId: number, conn?: DbConn) {
  const [subdivisionRows, memberRows] = await Promise.all([
    query<Array<{ subdivision_id: number }>>(
      `SELECT subdivision_id FROM appointment_subdivisions WHERE appointment_id = ?`,
      [appointmentId],
      conn,
    ),
    query<Array<{ member_id: number }>>(
      `SELECT member_id FROM appointment_members WHERE appointment_id = ?`,
      [appointmentId],
      conn,
    ),
  ])

  return {
    subdivisionIds: subdivisionRows.map(row => Number(row.subdivision_id)),
    memberIds: memberRows.map(row => Number(row.member_id)),
  }
}

/**
 * Write authorisation. `calendar.manage` may touch anything; `calendar.create` only its own
 * appointments. Applied in every mutating handler, never only on the client.
 */
export function canEditAppointment(user: User, appointment: Pick<AppointmentSeries, 'created_by'>): boolean {
  if (hasPermission(user, 'calendar.manage')) return true
  if (!hasPermission(user, 'calendar.create')) return false
  return appointment.created_by != null && Number(appointment.created_by) === Number(user.id)
}

export function renderAgendaHtml(agenda: string | null): string {
  if (!agenda) return ''
  const outcome = renderArticle(agenda)
  return outcome.ok ? outcome.html : ''
}

/** Markdown markers stripped, for the ICS description and notification payloads. */
export function agendaPlainText(agenda: string | null, maxLength = 500): string {
  if (!agenda) return ''
  const outcome = renderArticle(agenda)
  const text = outcome.ok ? outcome.text : agenda.replace(/[#*_`>[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text
}

export async function buildAppointmentDetail(
  appointment: AppointmentSeries,
  user: User,
  conn?: DbConn,
): Promise<AppointmentDetail> {
  const scope = await loadScopeIds(appointment.id, conn)

  let type: AppointmentTypeRow | null = null
  if (appointment.type_id != null) {
    const rows = await query<Array<Record<string, any>>>(
      `SELECT id, name, color, icon, sort_order, is_active, description FROM appointment_types WHERE id = ? LIMIT 1`,
      [appointment.type_id],
      conn,
    )
    type = rows[0] ? toAppointmentType(rows[0]) : null
  }

  return {
    ...appointment,
    subdivision_ids: scope.subdivisionIds,
    member_ids: scope.memberIds,
    agenda_html: renderAgendaHtml(appointment.agenda),
    can_edit: canEditAppointment(user, appointment),
    type,
  }
}

/** Values written to `appointments`, normalised for all-day and non-recurring appointments. */
export function buildSeriesValues(body: SaveAppointmentBody) {
  const allDay = Boolean(body.all_day)
  const range = allDay
    ? normalizeAllDayRange(body.starts_at, body.ends_at)
    : { starts_at: body.starts_at, ends_at: body.ends_at }

  const hasRecurrence = Boolean(body.recurrence_freq)
  const hasCount = hasRecurrence && body.recurrence_count != null && Number(body.recurrence_count) > 0

  return {
    type_id: body.type_id == null ? null : Number(body.type_id),
    title: String(body.title).trim(),
    agenda: body.agenda ? String(body.agenda) : null,
    location: body.location ? String(body.location).trim() : null,
    starts_at: range.starts_at,
    ends_at: range.ends_at,
    all_day: allDay ? 1 : 0,
    recurrence_freq: hasRecurrence ? body.recurrence_freq : null,
    recurrence_interval: hasRecurrence ? Math.max(1, Number(body.recurrence_interval ?? 1)) : 1,
    recurrence_weekdays: hasRecurrence && body.recurrence_freq === 'weekly' ? (body.recurrence_weekdays || null) : null,
    recurrence_monthly_mode: hasRecurrence && body.recurrence_freq === 'monthly'
      ? (body.recurrence_monthly_mode ?? 'day_of_month')
      : null,
    // Exactly one of until/count survives; validation already rejects both being set.
    recurrence_until: hasRecurrence && !hasCount && body.recurrence_until ? String(body.recurrence_until).slice(0, 10) : null,
    recurrence_count: hasCount ? Number(body.recurrence_count) : null,
    notify_on_create: body.notify_on_create ? 1 : 0,
    notify_on_change: body.notify_on_change ? 1 : 0,
    notify_reminder: body.notify_reminder ? 1 : 0,
    reminder_lead_minutes: body.reminder_lead_minutes ? String(body.reminder_lead_minutes) : null,
  }
}

export async function insertAppointment(body: SaveAppointmentBody, createdByUserId: number, conn: DbConn): Promise<number> {
  const values = buildSeriesValues(body)

  const result = await query<{ insertId: number }>(
    `INSERT INTO appointments
       (type_id, title, agenda, location, starts_at, ends_at, all_day, status,
        recurrence_freq, recurrence_interval, recurrence_weekdays, recurrence_monthly_mode,
        recurrence_until, recurrence_count, notify_on_create, notify_on_change, notify_reminder,
        reminder_lead_minutes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.type_id, values.title, values.agenda, values.location, values.starts_at, values.ends_at,
      values.all_day, values.recurrence_freq, values.recurrence_interval,
      values.recurrence_weekdays, values.recurrence_monthly_mode, values.recurrence_until,
      values.recurrence_count, values.notify_on_create, values.notify_on_change, values.notify_reminder,
      values.reminder_lead_minutes, createdByUserId,
    ],
    conn,
  )

  return Number(result.insertId)
}

export async function updateAppointment(appointmentId: number, body: SaveAppointmentBody, conn: DbConn): Promise<void> {
  const values = buildSeriesValues(body)

  await query(
    `UPDATE appointments
       SET type_id = ?, title = ?, agenda = ?, location = ?, starts_at = ?, ends_at = ?, all_day = ?,
           recurrence_freq = ?, recurrence_interval = ?, recurrence_weekdays = ?,
           recurrence_monthly_mode = ?, recurrence_until = ?, recurrence_count = ?,
           notify_on_create = ?, notify_on_change = ?, notify_reminder = ?, reminder_lead_minutes = ?
     WHERE id = ?`,
    [
      values.type_id, values.title, values.agenda, values.location, values.starts_at, values.ends_at,
      values.all_day, values.recurrence_freq, values.recurrence_interval,
      values.recurrence_weekdays, values.recurrence_monthly_mode, values.recurrence_until,
      values.recurrence_count, values.notify_on_create, values.notify_on_change, values.notify_reminder,
      values.reminder_lead_minutes, appointmentId,
    ],
    conn,
  )
}

export async function syncAppointmentScope(
  appointmentId: number,
  body: Pick<SaveAppointmentBody, 'subdivision_ids' | 'member_ids'>,
  conn: DbConn,
): Promise<void> {
  const existing = await loadScopeIds(appointmentId, conn)

  const incomingSubdivisions = normalizeIdList(body.subdivision_ids)
  const incomingMembers = normalizeIdList(body.member_ids)

  await syncScalarCollection({
    existing: existing.subdivisionIds,
    incoming: incomingSubdivisions,
    onRemove: async (subdivisionId) => {
      await query(
        `DELETE FROM appointment_subdivisions WHERE appointment_id = ? AND subdivision_id = ?`,
        [appointmentId, subdivisionId],
        conn,
      )
    },
    onAdd: async (subdivisionId) => {
      await query(
        `INSERT IGNORE INTO appointment_subdivisions (appointment_id, subdivision_id) VALUES (?, ?)`,
        [appointmentId, subdivisionId],
        conn,
      )
    },
  })

  await syncScalarCollection({
    existing: existing.memberIds,
    incoming: incomingMembers,
    onRemove: async (memberId) => {
      await query(
        `DELETE FROM appointment_members WHERE appointment_id = ? AND member_id = ?`,
        [appointmentId, memberId],
        conn,
      )
    },
    onAdd: async (memberId) => {
      await query(
        `INSERT IGNORE INTO appointment_members (appointment_id, member_id) VALUES (?, ?)`,
        [appointmentId, memberId],
        conn,
      )
    },
  })
}

export async function copyAppointmentScope(fromId: number, toId: number, conn: DbConn): Promise<void> {
  await query(
    `INSERT IGNORE INTO appointment_subdivisions (appointment_id, subdivision_id)
     SELECT ?, subdivision_id FROM appointment_subdivisions WHERE appointment_id = ?`,
    [toId, fromId],
    conn,
  )
  await query(
    `INSERT IGNORE INTO appointment_members (appointment_id, member_id)
     SELECT ?, member_id FROM appointment_members WHERE appointment_id = ?`,
    [toId, fromId],
    conn,
  )
}

export async function truncateSeriesBefore(appointmentId: number, occurrenceDate: string, conn: DbConn): Promise<void> {
  const splitPoint = parseWallClock(occurrenceDate)
  if (!splitPoint) return

  const untilDate = new Date(splitPoint.getTime() - 86400000)

  await query(
    `UPDATE appointments
       SET recurrence_until = ?, recurrence_count = NULL
     WHERE id = ?`,
    [formatWallClockDate(untilDate), appointmentId],
    conn,
  )
}

export async function moveOccurrenceDataFrom(
  fromAppointmentId: number,
  toAppointmentId: number,
  occurrenceDate: string,
  conn: DbConn,
): Promise<void> {
  await query(
    `UPDATE appointment_occurrence_overrides
       SET appointment_id = ?
     WHERE appointment_id = ? AND occurrence_date >= ?`,
    [toAppointmentId, fromAppointmentId, occurrenceDate],
    conn,
  )
  await query(
    `UPDATE appointment_responses
       SET appointment_id = ?
     WHERE appointment_id = ? AND occurrence_date >= ?`,
    [toAppointmentId, fromAppointmentId, occurrenceDate],
    conn,
  )
}

export async function dropOrphanedOccurrenceData(appointmentId: number, conn: DbConn): Promise<number> {
  const appointment = await loadAppointment(appointmentId, conn)
  if (!appointment) return 0

  const valid = new Set(listScheduledOccurrenceDates(appointment))

  const [overrideRows, responseRows] = await Promise.all([
    query<Array<{ id: number, occurrence_date: string }>>(
      `SELECT id, occurrence_date FROM appointment_occurrence_overrides WHERE appointment_id = ?`,
      [appointmentId],
      conn,
    ),
    query<Array<{ id: number, occurrence_date: string }>>(
      `SELECT id, occurrence_date FROM appointment_responses WHERE appointment_id = ?`,
      [appointmentId],
      conn,
    ),
  ])

  const isOrphan = (value: string) => {
    const parsed = parseWallClock(value)
    return !parsed || !valid.has(formatWallClock(parsed))
  }

  const orphanOverrides = overrideRows.filter(row => isOrphan(String(row.occurrence_date))).map(row => Number(row.id))
  const orphanResponses = responseRows.filter(row => isOrphan(String(row.occurrence_date))).map(row => Number(row.id))

  if (orphanOverrides.length) {
    await query(
      `DELETE FROM appointment_occurrence_overrides WHERE id IN (${orphanOverrides.map(() => '?').join(',')})`,
      orphanOverrides,
      conn,
    )
  }

  if (orphanResponses.length) {
    await query(
      `DELETE FROM appointment_responses WHERE id IN (${orphanResponses.map(() => '?').join(',')})`,
      orphanResponses,
      conn,
    )
  }

  return orphanOverrides.length + orphanResponses.length
}

export async function withdrawOccurrenceReminders(
  appointmentId: number,
  occurrenceDate: string | null,
  conn: DbConn,
): Promise<void> {
  const prefix = occurrenceDate
    ? `appointment.reminder:${appointmentId}:${occurrenceDate}:`
    : `appointment.reminder:${appointmentId}:`

  await query(
    `DELETE FROM notifications
     WHERE status = 'scheduled' AND dedupe_key LIKE CONCAT(?, '%')`,
    [prefix],
    conn,
  )
}

interface AppointmentNotificationArgs {
  type: 'appointment.invited' | 'appointment.changed' | 'appointment.cancelled'
  appointment: AppointmentSeries
  typeName: string | null
  occurrenceDate?: string | null
  startsAt?: string | null
  endsAt?: string | null
  changes?: ChangedField[] | string
  createdByUserId: number
  recipients?: RecipientRule
  conn: DbConn
}

export async function notifyAppointment(args: AppointmentNotificationArgs): Promise<void> {
  const { appointment } = args

  if (args.type === 'appointment.invited' && !appointment.notify_on_create) return
  if (args.type === 'appointment.changed' && !appointment.notify_on_change) return
  if (args.type === 'appointment.cancelled' && !appointment.notify_on_change) return

  await enqueueNotification({
    type: args.type,
    payload: {
      appointment_id: appointment.id,
      appointment_title: appointment.title,
      appointment_type: args.typeName ?? '',
      appointment_start: args.startsAt ?? appointment.starts_at,
      appointment_end: args.endsAt ?? appointment.ends_at,
      occurrence_date: args.occurrenceDate ?? appointment.starts_at,
      location: appointment.location ?? '',
      changes: args.changes ?? [],
    },
    recipients: args.recipients ?? { kind: 'appointmentParticipants', appointmentId: appointment.id },
    createdByUserId: args.createdByUserId,
  }, args.conn)
}

export async function resolveExplicitAudienceRule(appointmentId: number, conn?: DbConn): Promise<RecipientRule> {
  const audience = await loadAppointmentAudience(appointmentId, conn)

  return {
    kind: 'composite',
    rules: [
      { kind: 'members', memberIds: audience.memberIds },
      ...(audience.createdByUserId != null ? [{ kind: 'users' as const, userIds: [audience.createdByUserId] }] : []),
    ],
  }
}

export async function loadTypeName(typeId: number | null, conn?: DbConn): Promise<string | null> {
  if (typeId == null) return null
  const rows = await query<Array<{ name: string }>>(
    `SELECT name FROM appointment_types WHERE id = ? LIMIT 1`,
    [typeId],
    conn,
  )
  return rows[0] ? String(rows[0].name) : null
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Täglich',
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
}

function recurrenceLabel(freq: string | null): string {
  return freq ? (RECURRENCE_LABELS[freq] ?? freq) : 'Einmalig'
}

export function describeAppointmentChanges(before: AppointmentSeries, after: AppointmentSeries): ChangedField[] {
  return pickChangedFields([
    { field: 'name', from: before.title, to: after.title },
    { field: 'start', from: formatLocalDateTime(before.starts_at), to: formatLocalDateTime(after.starts_at) },
    { field: 'end', from: formatLocalDateTime(before.ends_at), to: formatLocalDateTime(after.ends_at) },
    { field: 'location', from: before.location, to: after.location },
    { field: 'recurrence', from: recurrenceLabel(before.recurrence_freq), to: recurrenceLabel(after.recurrence_freq) },
  ])
}

export { SERIES_COLUMNS }
