import { beforeEach, describe, expect, it } from 'vitest'
import updateAppointment from '~/server/api/appointments/[id].put'
import cancelAppointment from '~/server/api/appointments/[id]/cancel.post'
import { query, withAuditTransaction } from '~/server/utils/db'
import { loadAppointment } from '~/server/utils/appointments'
import { listScheduledOccurrenceDates } from '~/server/utils/appointments/recurrence'
import { saveAppointmentResponse } from '~/server/utils/appointments/responses'
import type { AppointmentSeries, SaveAppointmentBody } from '~/types/appointment'
import { resetDatabase } from '../helpers/db'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'
import { createMember, resetFixtureCounter } from '../helpers/fixtures'

// Roughly yearly (every 52 weeks) on Tuesdays from 2 Jan 2024: early occurrences are safely in the
// past and late ones safely ahead, whatever day the suite runs on.
const SERIES_START = '2024-01-02 18:00:00'
const SERIES_END = '2024-01-02 20:00:00'

/** Every scheduled date of the 20-occurrence test series (the default horizon stops after 4 years). */
function occurrenceDates(series: AppointmentSeries): string[] {
  return listScheduledOccurrenceDates(series, 366 * 25)
}

interface ResponseState {
  occurrence_date: string
  response: string
  needs_reconfirmation: number
  responded_at: string
}

describe('appointment answers after a change', () => {
  let organiser: Awaited<ReturnType<typeof signIn>>
  let memberId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    organiser = await signIn({ permissions: ['calendar.view', 'calendar.create', 'calendar.manage'] })
    memberId = await createMember()
  })

  async function createSeries(): Promise<AppointmentSeries> {
    const result = await query<any>(
      `INSERT INTO appointments (title, starts_at, ends_at, recurrence_freq, recurrence_interval, recurrence_weekdays, recurrence_count, notify_on_change, created_by)
       VALUES ('Jahrestreffen', ?, ?, 'weekly', 52, 'TU', 20, 0, ?)`,
      [SERIES_START, SERIES_END, organiser.id],
    )
    return (await loadAppointment(Number(result.insertId)))!
  }

  function bodyOf(appointment: AppointmentSeries, changes: Partial<SaveAppointmentBody> = {}): SaveAppointmentBody {
    return {
      type_id: appointment.type_id,
      title: appointment.title,
      agenda: appointment.agenda,
      location: appointment.location,
      starts_at: appointment.starts_at,
      ends_at: appointment.ends_at,
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
      subdivision_ids: [],
      member_ids: [],
      restricted: false,
      ...changes,
    }
  }

  async function answer(appointmentId: number, occurrenceDate: string, response = 'yes') {
    await query(
      `INSERT INTO appointment_responses (appointment_id, member_id, occurrence_date, response, responded_at)
       VALUES (?, ?, ?, ?, '2024-01-01 10:00:00')`,
      [appointmentId, memberId, occurrenceDate, response],
    )
  }

  async function responses(appointmentId: number): Promise<ResponseState[]> {
    const rows = await query<ResponseState[]>(
      `SELECT occurrence_date, response, needs_reconfirmation, responded_at
       FROM appointment_responses WHERE appointment_id = ? ORDER BY occurrence_date`,
      [appointmentId],
    )
    return rows.map(row => ({ ...row, needs_reconfirmation: Number(row.needs_reconfirmation) }))
  }

  async function put(appointmentId: number, body: SaveAppointmentBody) {
    const { result } = await callHandler(updateAppointment, {
      token: organiser.token,
      method: 'PUT',
      params: { id: appointmentId },
      body,
    })
    expect(result).toMatchObject({ ok: true })
    return result
  }

  it('moves answers with a new start time, keeps past ones and flags upcoming ones', async () => {
    const series = await createSeries()
    const dates = occurrenceDates(series)
    const past = dates[0]!
    const upcoming = dates[15]!
    await answer(series.id, past)
    await answer(series.id, upcoming, 'no')

    await put(series.id, bodyOf(series, { starts_at: '2024-01-02 19:00:00', ends_at: '2024-01-02 21:00:00' }))

    const rows = await responses(series.id)
    expect(rows.map(row => [row.occurrence_date, row.response, row.needs_reconfirmation])).toEqual([
      [past.replace('18:00', '19:00'), 'yes', 0],
      [upcoming.replace('18:00', '19:00'), 'no', 1],
    ])
    // Moving or flagging an answer is not answering again.
    expect(rows.every(row => row.responded_at.startsWith('2024-01-01'))).toBe(true)
  })

  it('never deletes answers of past occurrences, even when their day is gone', async () => {
    const series = await createSeries()
    const dates = occurrenceDates(series)
    await answer(series.id, dates[0]!)
    await answer(series.id, dates[15]!)

    await put(series.id, bodyOf(series, { recurrence_weekdays: 'WE', starts_at: '2024-01-03 18:00:00', ends_at: '2024-01-03 20:00:00' }))

    expect((await responses(series.id)).map(row => row.occurrence_date)).toEqual([dates[0]])
  })

  it('asks for reconfirmation on request, without any other change', async () => {
    const series = await createSeries()
    const dates = occurrenceDates(series)
    await answer(series.id, dates[0]!)
    await answer(series.id, dates[15]!)

    await put(series.id, { ...bodyOf(series), request_reconfirmation: true })
    expect((await responses(series.id)).map(row => row.needs_reconfirmation)).toEqual([0, 1])
  })

  it('flags the answers of a single occurrence that moves, and answering again clears it', async () => {
    const series = await createSeries()
    const upcoming = occurrenceDates(series)[15]!
    const other = occurrenceDates(series)[16]!
    await answer(series.id, upcoming)
    await answer(series.id, other)

    await put(series.id, {
      ...bodyOf(series, {
        starts_at: upcoming.replace('18:00', '17:00'),
        ends_at: upcoming.replace('18:00', '19:00'),
      }),
      scope: 'occurrence',
      occurrenceDate: upcoming,
    })

    expect((await responses(series.id)).map(row => [row.occurrence_date, row.needs_reconfirmation])).toEqual([
      [upcoming, 1],
      [other, 0],
    ])

    const saved = await withAuditTransaction(organiser, conn => saveAppointmentResponse({
      appointmentId: series.id,
      memberId,
      occurrenceDate: upcoming,
      response: 'yes',
    }, conn))
    expect(saved).toEqual({ ok: true })
    expect((await responses(series.id))[0]!.needs_reconfirmation).toBe(0)
  })

  it('accepts answers to an occurrence moved away from its scheduled time', async () => {
    const series = await createSeries()
    const dates = occurrenceDates(series)
    const moved = dates[15]!
    await answer(series.id, moved)

    // Three hours later and to the next day: both fall outside the scheduled 18:00–20:00 slot.
    await put(series.id, {
      ...bodyOf(series, { starts_at: moved.replace('18:00', '21:00'), ends_at: moved.replace('18:00', '23:00') }),
      scope: 'occurrence',
      occurrenceDate: moved,
    })
    expect((await responses(series.id))[0]!.needs_reconfirmation).toBe(1)

    const confirm = (applyToSeries: boolean) => withAuditTransaction(organiser, conn => saveAppointmentResponse({
      appointmentId: series.id,
      memberId,
      occurrenceDate: moved,
      response: 'maybe',
      applyToSeries,
    }, conn))

    expect(await confirm(false)).toEqual({ ok: true })
    expect((await responses(series.id))[0]).toMatchObject({ response: 'maybe', needs_reconfirmation: 0 })

    // "For all following" still includes the moved occurrence itself.
    expect(await confirm(true)).toEqual({ ok: true })
    expect((await responses(series.id)).map(row => row.occurrence_date)[0]).toBe(moved)
  })

  it('still refuses answers to a cancelled occurrence or a date the series never had', async () => {
    const series = await createSeries()
    const dates = occurrenceDates(series)
    await query(
      `INSERT INTO appointment_occurrence_overrides (appointment_id, occurrence_date, is_cancelled) VALUES (?, ?, 1)`,
      [series.id, dates[15]],
    )

    for (const occurrenceDate of [dates[15]!, dates[15]!.replace('18:00', '19:00')]) {
      const result = await withAuditTransaction(organiser, conn => saveAppointmentResponse({
        appointmentId: series.id, memberId, occurrenceDate, response: 'yes',
      }, conn))
      expect(result).toEqual({ ok: false, error: 'Dieser Termin gehört nicht zur Serie.' })
    }
  })

  it('flags nothing when the organiser switches the automatic reconfirmation off', async () => {
    const series = await createSeries()
    const upcoming = occurrenceDates(series)[15]!
    await answer(series.id, upcoming)

    await put(series.id, { ...bodyOf(series, { starts_at: '2024-01-02 19:00:00', ends_at: '2024-01-02 21:00:00' }), request_reconfirmation: false })
    expect((await responses(series.id)).map(row => [row.occurrence_date, row.needs_reconfirmation]))
      .toEqual([[upcoming.replace('18:00', '19:00'), 0]])

    const next = (await loadAppointment(series.id))!
    const moved = occurrenceDates(next)[15]!
    await put(series.id, {
      ...bodyOf(next, { starts_at: moved.replace('19:00', '21:00'), ends_at: moved.replace('19:00', '23:00') }),
      scope: 'occurrence',
      occurrenceDate: moved,
      request_reconfirmation: false,
    })
    expect((await responses(series.id))[0]!.needs_reconfirmation).toBe(0)
  })

  it('leaves a single occurrence alone when only its title changes', async () => {
    const series = await createSeries()
    const upcoming = occurrenceDates(series)[15]!
    await answer(series.id, upcoming)

    await put(series.id, {
      ...bodyOf(series, { title: 'Anderer Titel', starts_at: upcoming, ends_at: upcoming.replace('18:00', '20:00') }),
      scope: 'occurrence',
      occurrenceDate: upcoming,
    })

    expect((await responses(series.id))[0]!.needs_reconfirmation).toBe(0)
  })

  it('asks for reconfirmation of upcoming answers when a cancelled series is reactivated', async () => {
    const series = await createSeries()
    const dates = occurrenceDates(series)
    await answer(series.id, dates[0]!)
    await answer(series.id, dates[15]!)
    await query(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, [series.id])

    const { result } = await callHandler(cancelAppointment, {
      token: organiser.token,
      method: 'POST',
      params: { id: series.id },
      body: { cancelled: false },
    })
    expect(result).toEqual({ ok: true })
    expect((await responses(series.id)).map(row => row.needs_reconfirmation)).toEqual([0, 1])
  })
})
