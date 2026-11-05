import { EXTERNAL_IMAGE_ERROR, renderArticle } from '~/server/utils/wiki/render'
import { query } from '~/server/utils/db'
import type { DbConn } from '~/server/utils/notifications/types'
import type { AppointmentEditScope, SaveAppointmentBody } from '~/types/appointment'
import { parseWallClock, parseWeekdays } from '~/server/utils/appointments/recurrence'

/** 64 KB, matching the agenda column's practical budget. */
const MAX_AGENDA_LENGTH = 65536
const MAX_TITLE_LENGTH = 255
const MAX_LOCATION_LENGTH = 255
const MAX_RECURRENCE_INTERVAL = 52
const MAX_RECURRENCE_COUNT = 500
const MAX_LEAD_ENTRIES = 5
/** 30 days — beyond that a "reminder" stops being one. */
const MAX_LEAD_MINUTES = 43200

export interface ValidateAppointmentContext {
  canManage: boolean
  /** The type currently stored on the appointment — an inactive one may be kept, not newly set. */
  existingTypeId?: number | null
  scope?: AppointmentEditScope
  conn?: DbConn
}

function normalizeIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map(entry => Number(entry))
      .filter(entry => Number.isInteger(entry) && entry > 0),
  ))
}

/** All-day appointments always span whole days; the editor's time inputs are ignored for them. */
export function normalizeAllDayRange(startsAt: string, endsAt: string): { starts_at: string, ends_at: string } {
  return {
    starts_at: `${startsAt.slice(0, 10)} 00:00:00`,
    ends_at: `${endsAt.slice(0, 10)} 23:59:59`,
  }
}

export function parseLeadMinutes(value: string | null | undefined): number[] {
  if (!value) return []
  return String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(minutes => Number.isFinite(minutes) && minutes > 0)
}

/**
 * Returns a German error string, or null when the payload is acceptable. Surfaced client-side
 * through `ValidationSummary`; the client validates the same rules but this is the authority.
 */
export async function validateAppointment(
  body: SaveAppointmentBody,
  context: ValidateAppointmentContext,
): Promise<string | null> {
  const title = String(body.title ?? '').trim()
  if (!title) return 'Bitte gib einen Titel für den Termin an.'
  if (title.length > MAX_TITLE_LENGTH) return `Der Titel darf höchstens ${MAX_TITLE_LENGTH} Zeichen lang sein.`

  if (body.location && String(body.location).length > MAX_LOCATION_LENGTH) {
    return `Der Ort darf höchstens ${MAX_LOCATION_LENGTH} Zeichen lang sein.`
  }

  if (body.agenda && String(body.agenda).length > MAX_AGENDA_LENGTH) {
    return 'Die Agenda ist zu lang (maximal 64 KB).'
  }
  if (body.agenda) {
    // Agendas use the wiki renderer; external images (tracking pixels) are refused on save (SEC-27).
    const rendered = renderArticle(String(body.agenda), { rejectExternalImages: true })
    if (!rendered.ok && rendered.error === EXTERNAL_IMAGE_ERROR) return EXTERNAL_IMAGE_ERROR
  }

  const startsAt = parseWallClock(body.starts_at)
  const endsAt = parseWallClock(body.ends_at)
  if (!startsAt) return 'Bitte gib einen gültigen Beginn an.'
  if (!endsAt) return 'Bitte gib ein gültiges Ende an.'

  if (body.all_day) {
    if (endsAt.getTime() < startsAt.getTime()) return 'Das Ende darf nicht vor dem Beginn liegen.'
  } else if (endsAt.getTime() <= startsAt.getTime()) {
    return 'Das Ende muss nach dem Beginn liegen.'
  }

  // A single occurrence carries no rule, no scope and no notification settings of its own; the
  // handler rejects any attempt to change those (rather than silently ignoring them) because it is
  // the only place that can compare the payload against the series it belongs to.
  if (context.scope === 'occurrence') return null

  if (body.recurrence_freq) {
    if (!['daily', 'weekly', 'monthly'].includes(body.recurrence_freq)) {
      return 'Ungültige Wiederholung.'
    }

    const interval = Number(body.recurrence_interval ?? 1)
    if (!Number.isInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) {
      return `Das Wiederholungsintervall muss zwischen 1 und ${MAX_RECURRENCE_INTERVAL} liegen.`
    }

    if (body.recurrence_freq === 'weekly' && !parseWeekdays(body.recurrence_weekdays).length) {
      return 'Bitte wähle mindestens einen Wochentag für die wöchentliche Wiederholung.'
    }

    if (body.recurrence_freq === 'monthly'
      && body.recurrence_monthly_mode
      && !['day_of_month', 'weekday_of_month'].includes(body.recurrence_monthly_mode)) {
      return 'Ungültiger Modus für die monatliche Wiederholung.'
    }

    const hasUntil = Boolean(body.recurrence_until)
    const hasCount = body.recurrence_count != null && Number(body.recurrence_count) > 0

    if (hasUntil && hasCount) {
      return 'Bitte lege entweder ein Enddatum oder eine Anzahl an Terminen fest, nicht beides.'
    }

    if (hasUntil) {
      const until = parseWallClock(`${String(body.recurrence_until).slice(0, 10)} 23:59:59`)
      if (!until) return 'Bitte gib ein gültiges Enddatum für die Wiederholung an.'
      if (until.getTime() < startsAt.getTime()) return 'Das Enddatum der Wiederholung darf nicht vor dem Beginn liegen.'
    }

    if (hasCount) {
      const count = Number(body.recurrence_count)
      if (!Number.isInteger(count) || count < 1 || count > MAX_RECURRENCE_COUNT) {
        return `Die Anzahl der Termine muss zwischen 1 und ${MAX_RECURRENCE_COUNT} liegen.`
      }
    }
  }

  const listsEmpty = !normalizeIdList(body.subdivision_ids).length && !normalizeIdList(body.member_ids).length
  if (body.restricted && listsEmpty) {
    return 'Bitte wähle mindestens eine Abteilung oder ein Mitglied aus.'
  }
  if (!body.restricted && !context.canManage) {
    return 'Für vereinsweite Termine fehlt dir die Berechtigung.'
  }

  if (body.reminder_lead_minutes) {
    const raw = String(body.reminder_lead_minutes).split(',').map(part => part.trim()).filter(Boolean)
    const parsed = parseLeadMinutes(body.reminder_lead_minutes)
    if (parsed.length !== raw.length) return 'Die Vorlaufzeiten müssen positive ganze Zahlen (in Minuten) sein.'
    if (parsed.length > MAX_LEAD_ENTRIES) return `Es sind höchstens ${MAX_LEAD_ENTRIES} Vorlaufzeiten möglich.`
    if (parsed.some(minutes => !Number.isInteger(minutes) || minutes > MAX_LEAD_MINUTES)) {
      return 'Eine Vorlaufzeit darf höchstens 30 Tage (43200 Minuten) betragen.'
    }
  }

  const typeError = await validateTypeSelection(body.type_id, context)
  if (typeError) return typeError

  const scopeError = await validateScopeSelection(body, context)
  if (scopeError) return scopeError

  return null
}

async function validateTypeSelection(typeId: number | null | undefined, context: ValidateAppointmentContext): Promise<string | null> {
  if (typeId == null) return null

  const id = Number(typeId)
  if (!Number.isInteger(id) || id <= 0) return 'Ungültige Terminart.'

  const rows = await query<Array<{ id: number, name: string, is_active: number }>>(
    `SELECT id, name, is_active FROM appointment_types WHERE id = ? LIMIT 1`,
    [id],
    context.conn,
  )

  const type = rows[0]
  if (!type) return 'Die gewählte Terminart existiert nicht.'

  // Keeping an inactive type that is already assigned is fine; newly selecting one is not.
  if (!type.is_active && Number(context.existingTypeId ?? 0) !== id) {
    return `${type.name}: Inaktive Terminarten können nicht neu ausgewählt werden.`
  }

  return null
}

async function validateScopeSelection(body: SaveAppointmentBody, context: ValidateAppointmentContext): Promise<string | null> {
  const subdivisionIds = normalizeIdList(body.subdivision_ids)
  if (subdivisionIds.length) {
    const rows = await query<Array<{ id: number }>>(
      `SELECT id FROM subdivisions WHERE id IN (${subdivisionIds.map(() => '?').join(',')})`,
      subdivisionIds,
      context.conn,
    )
    if (rows.length !== subdivisionIds.length) return 'Eine oder mehrere ausgewählte Abteilungen existieren nicht.'
  }

  const memberIds = normalizeIdList(body.member_ids)
  if (memberIds.length) {
    const rows = await query<Array<{ id: number }>>(
      `SELECT id FROM members WHERE id IN (${memberIds.map(() => '?').join(',')})`,
      memberIds,
      context.conn,
    )
    if (rows.length !== memberIds.length) return 'Ein oder mehrere eingeladene Mitglieder existieren nicht.'
  }

  return null
}

export { normalizeIdList }
