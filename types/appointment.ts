import type { RecurrenceFreq, RecurrenceMonthlyMode } from '~/server/utils/appointments/recurrence'

export type { RecurrenceFreq, RecurrenceMonthlyMode }

export type AppointmentStatus = 'active' | 'cancelled'
export type AppointmentResponseValue = 'yes' | 'no' | 'maybe'
export type AppointmentEditScope = 'occurrence' | 'following' | 'series'

export interface AppointmentTypeRow {
  id: number
  name: string
  color: string
  icon: string | null
  sort_order: number
  is_active: boolean
  description: string | null
}

export interface SaveAppointmentTypeBody {
  id?: number
  name: string
  color?: string | null
  icon?: string | null
  sort_order?: number | null
  is_active?: boolean
  description?: string | null
}

export interface AppointmentSeries {
  id: number
  type_id: number | null
  title: string
  agenda: string | null
  location: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  status: AppointmentStatus
  recurrence_freq: RecurrenceFreq | null
  recurrence_interval: number
  recurrence_weekdays: string | null
  recurrence_monthly_mode: RecurrenceMonthlyMode | null
  recurrence_until: string | null
  recurrence_count: number | null
  notify_on_create: boolean
  notify_on_change: boolean
  notify_reminder: boolean
  reminder_lead_minutes: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface AppointmentDetail extends AppointmentSeries {
  subdivision_ids: number[]
  member_ids: number[]
  agenda_html: string
  can_edit: boolean
  type: AppointmentTypeRow | null
}

export interface AppointmentOccurrenceOverride {
  id: number
  appointment_id: number
  occurrence_date: string
  is_cancelled: boolean
  title: string | null
  agenda: string | null
  location: string | null
  starts_at: string | null
  ends_at: string | null
}

export interface AppointmentResponseRow {
  member_id: number
  member_name: string
  occurrence_date: string
  response: AppointmentResponseValue
  comment: string | null
  responded_at: string
}

export interface AppointmentResponseSummary {
  yes: number
  no: number
  maybe: number
  pending: number
}

export interface SaveAppointmentBody {
  type_id: number | null
  title: string
  agenda: string | null
  location: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  recurrence_freq: RecurrenceFreq | null
  recurrence_interval: number
  recurrence_weekdays: string | null
  recurrence_monthly_mode: RecurrenceMonthlyMode | null
  recurrence_until: string | null
  recurrence_count: number | null
  notify_on_create: boolean
  notify_on_change: boolean
  notify_reminder: boolean
  reminder_lead_minutes: string | null
  subdivision_ids: number[]
  member_ids: number[]
  restricted?: boolean
  scope?: AppointmentEditScope
  occurrenceDate?: string | null
}

export type CalendarSource = 'appointment' | 'event' | 'shift' | 'task'

export interface CalendarEntry {
  source: CalendarSource
  key: string
  id: number
  occurrenceDate: string | null
  title: string
  startsAt: string
  endsAt: string
  allDay: boolean
  color: string
  icon: string
  typeId: number | null
  typeName: string | null
  location: string | null
  ownResponse: AppointmentResponseValue | null
  canRespond: boolean
  responseSummary: AppointmentResponseSummary | null
  isCancelled: boolean
  canEdit: boolean
  eventId: number | null
  eventTab: string | null
}

/** Whether a series appears on the public website (GET /api/public/appointments). Applies to every occurrence. */
export interface AppointmentWebsiteSettings {
  published: boolean
  /** Wall clock in the app time zone; null = visible as soon as published. */
  visible_from: string | null
}

/** One occurrence as the public API returns it. */
export interface PublicAppointment {
  /** Stable per occurrence: "<appointmentId>-<YYYYMMDDHHmm of the scheduled start>". */
  id: string
  appointmentId: number
  recurring: boolean
  title: string
  /** ISO 8601 with UTC offset, e.g. "2026-11-03T19:00:00+01:00". */
  startsAt: string
  endsAt: string
  /** Wall clock in the app time zone, "YYYY-MM-DD HH:mm:ss". */
  startsAtLocal: string
  endsAtLocal: string
  /** Whole days; then the local fields span 00:00:00 to 23:59:59. */
  allDay: boolean
  location: string | null
  cancelled: boolean
}
