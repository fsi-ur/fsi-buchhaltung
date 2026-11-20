import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import {
  buildAppointmentDetail,
  loadAppointment,
  loadOverrides,
  renderAgendaHtml,
} from '~/server/utils/appointments'
import { isAppointmentVisible, resolveAppointmentViewer } from '~/server/utils/appointments/visibility'
import type {
  AppointmentDetail,
  AppointmentOccurrenceOverride,
  AppointmentResponseRow,
} from '~/types/appointment'

interface GetAppointmentSuccess {
  ok: true
  appointment: AppointmentDetail
  overrides: AppointmentOccurrenceOverride[]
  responses: AppointmentResponseRow[]
  /** Members in the appointment's audience, so the modal can list who has not answered. */
  participants: Array<{ id: number, name: string }>
}

interface GetAppointmentError {
  ok: false
  error: string
}

export type GetAppointmentResponse = GetAppointmentSuccess | GetAppointmentError

export default defineEventHandler(async (event): Promise<GetAppointmentResponse> => {
  const current = await requirePermission(event, 'calendar.view')
  if (!current.ok) return current

  const appointmentId = getNumericRouteParam(event)
  if (!appointmentId) return { ok: false, error: 'Ungültige Termin-ID.' }

  const viewer = await resolveAppointmentViewer(current.user)

  if (!await isAppointmentVisible(appointmentId, viewer)) {
    return { ok: false, error: 'Der Termin wurde nicht gefunden.' }
  }

  const appointment = await loadAppointment(appointmentId)
  if (!appointment) return { ok: false, error: 'Der Termin wurde nicht gefunden.' }

  const detail = await buildAppointmentDetail(appointment, current.user)
  const overrides = (await loadOverrides([appointmentId])).get(appointmentId) ?? []

  const responseRows = await query<Array<Record<string, any>>>(
    `SELECT ar.member_id, TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS member_name,
            ar.occurrence_date, ar.response, ar.comment, ar.responded_at, ar.needs_reconfirmation
     FROM appointment_responses ar
     JOIN members m ON m.id = ar.member_id
     WHERE ar.appointment_id = ?
     ORDER BY ar.occurrence_date, m.last_name, m.first_name`,
    [appointmentId],
  )

  const participants = await loadParticipants(appointmentId)

  return {
    ok: true,
    appointment: { ...detail, agenda_html: renderAgendaHtml(appointment.agenda) },
    overrides,
    responses: responseRows.map(row => ({
      member_id: Number(row.member_id),
      member_name: String(row.member_name),
      occurrence_date: String(row.occurrence_date),
      response: row.response,
      comment: row.comment == null ? null : String(row.comment),
      responded_at: String(row.responded_at),
      needs_reconfirmation: Boolean(Number(row.needs_reconfirmation)),
    })),
    participants,
  }
})

async function loadParticipants(appointmentId: number) {
  const scopeRows = await query<Array<{ found: number }>>(
    `SELECT 1 AS found FROM appointment_subdivisions WHERE appointment_id = ?
     UNION ALL
     SELECT 1 FROM appointment_members WHERE appointment_id = ?
     LIMIT 1`,
    [appointmentId, appointmentId],
  )

  if (!scopeRows.length) {
    const rows = await query<Array<{ id: number, name: string }>>(
      `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name
       FROM members
       WHERE status != 'left'
       ORDER BY last_name, first_name`,
    )
    return rows.map(row => ({ id: Number(row.id), name: String(row.name) }))
  }

  const rows = await query<Array<{ id: number, name: string }>>(
    `SELECT DISTINCT m.id, TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS name, m.last_name, m.first_name
     FROM members m
     LEFT JOIN subdivision_members sm ON sm.member_id = m.id
     LEFT JOIN appointment_subdivisions asub ON asub.subdivision_id = sm.subdivision_id AND asub.appointment_id = ?
     LEFT JOIN appointment_members am ON am.member_id = m.id AND am.appointment_id = ?
     WHERE m.status != 'left' AND (asub.appointment_id IS NOT NULL OR am.appointment_id IS NOT NULL)
     ORDER BY m.last_name, m.first_name`,
    [appointmentId, appointmentId],
  )
  return rows.map(row => ({ id: Number(row.id), name: String(row.name) }))
}
