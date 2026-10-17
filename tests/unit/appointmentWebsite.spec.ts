import { describe, expect, it } from 'vitest'
import {
  normalizeAppointmentWebsitePayload,
  parsePublicAppointmentsQuery,
  PUBLIC_APPOINTMENTS_MAX_DAYS,
  toPublicAppointment,
} from '~/server/utils/appointmentWebsite'
import { addDaysToLocalDate } from '~/shared/time'

const BERLIN = 'Europe/Berlin'
const NOW = '2026-10-17 12:00:00'

describe('parsePublicAppointmentsQuery', () => {
  it('defaults to a year ahead from now', () => {
    expect(parsePublicAppointmentsQuery({}, NOW)).toEqual({
      ok: true,
      query: { from: NOW, to: '2027-10-17 23:59:59', limit: 100, order: 'asc' },
    })
  })

  it('keeps the default end a year after today when "from" lies in the past', () => {
    const result = parsePublicAppointmentsQuery({ from: '2026-01-01' }, NOW)
    expect(result.ok && result.query).toMatchObject({ from: '2026-01-01 00:00:00', to: '2027-10-17 23:59:59' })
  })

  it('measures the default end from "from" when that lies in the future', () => {
    const result = parsePublicAppointmentsQuery({ from: '2027-03-01' }, NOW)
    expect(result.ok && result.query.to).toBe('2028-02-29 23:59:59')
  })

  it('treats from/to as inclusive calendar days', () => {
    const result = parsePublicAppointmentsQuery({ from: '2026-01-01', to: '2026-01-31' }, NOW)
    expect(result.ok && result.query).toMatchObject({ from: '2026-01-01 00:00:00', to: '2026-01-31 23:59:59' })
  })

  it('rejects a window longer than the expansion limit', () => {
    const tooFar = addDaysToLocalDate('2026-01-01', PUBLIC_APPOINTMENTS_MAX_DAYS + 1)
    expect(parsePublicAppointmentsQuery({ from: '2026-01-01', to: tooFar }, NOW).ok).toBe(false)
    expect(parsePublicAppointmentsQuery({ from: '2026-01-01', to: addDaysToLocalDate('2026-01-01', PUBLIC_APPOINTMENTS_MAX_DAYS) }, NOW).ok).toBe(true)
  })

  it('rejects an upper bound in the past when "from" defaults to now', () => {
    expect(parsePublicAppointmentsQuery({ to: '2026-01-01' }, NOW).ok).toBe(false)
  })

  it('passes on the shared parameter validation', () => {
    expect(parsePublicAppointmentsQuery({ limit: 'x' }, NOW).ok).toBe(false)
  })
})

describe('normalizeAppointmentWebsitePayload', () => {
  it('normalises the publish window', () => {
    expect(normalizeAppointmentWebsitePayload({ published: true, visible_from: '2026-11-01T18:00' }))
      .toEqual({ published: true, visible_from: '2026-11-01 18:00:00' })
    expect(normalizeAppointmentWebsitePayload({ visible_from: 'soon' })).toBeNull()
  })
})

describe('toPublicAppointment', () => {
  const occurrence = {
    appointmentId: 3,
    occurrenceDate: '2026-11-04 19:00:00',
    startsAt: '2026-11-04 19:30:00',
    endsAt: '2026-11-04 21:00:00',
    title: 'Offene Sitzung',
    agenda: 'TOP 1: interne Finanzen',
    location: 'Raum 1',
    isCancelled: true,
    isOverridden: true,
  }

  it('keys an occurrence by its scheduled start, not the moved one', () => {
    const result = toPublicAppointment({ id: 3, all_day: false, recurrence_freq: 'weekly' }, occurrence, BERLIN)
    expect(result).toEqual({
      id: '3-202611041900',
      appointmentId: 3,
      recurring: true,
      title: 'Offene Sitzung',
      startsAt: '2026-11-04T19:30:00+01:00',
      endsAt: '2026-11-04T21:00:00+01:00',
      startsAtLocal: '2026-11-04 19:30:00',
      endsAtLocal: '2026-11-04 21:00:00',
      allDay: false,
      location: 'Raum 1',
      cancelled: true,
    })
  })

  it('never carries the agenda', () => {
    const result = toPublicAppointment({ id: 3, all_day: false, recurrence_freq: null }, occurrence, BERLIN)
    expect(JSON.stringify(result)).not.toContain('Finanzen')
  })
})
