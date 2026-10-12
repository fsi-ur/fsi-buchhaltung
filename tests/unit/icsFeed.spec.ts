import { describe, expect, it } from 'vitest'
import { buildIcsFeed } from '~/server/utils/icsFeed'

function feedFor(startsAt: string, endsAt: string, timeZone = 'Europe/Berlin'): string {
  return buildIcsFeed({
    events: [{ id: 1, name: 'Test', starts_at: startsAt, ends_at: endsAt, location: null, description: '' }],
    shifts: [],
    tasks: [],
    appointments: [],
    calendarName: 'Test',
    host: 'example.org',
    timeZone,
  })
}

function lineValue(ics: string, name: string): string | undefined {
  return ics.split('\r\n').find(line => line.startsWith(`${name}:`) || line.startsWith(`${name};`))
}

describe('buildIcsFeed timezones', () => {
  // Floating local times are read as UTC by Google Calendar, so every timed value has to go out as
  // an absolute UTC instant.
  it('converts summer (CEST, UTC+2) wall-clock times to UTC', () => {
    const ics = feedFor('2026-07-15 18:00:00', '2026-07-15 22:30:00')
    expect(lineValue(ics, 'DTSTART')).toBe('DTSTART:20260715T160000Z')
    expect(lineValue(ics, 'DTEND')).toBe('DTEND:20260715T203000Z')
  })

  it('converts winter (CET, UTC+1) wall-clock times to UTC', () => {
    const ics = feedFor('2026-01-06 00:30:00', '2026-01-06 09:00:00')
    expect(lineValue(ics, 'DTSTART')).toBe('DTSTART:20260105T233000Z')
    expect(lineValue(ics, 'DTEND')).toBe('DTEND:20260106T080000Z')
  })

  it('uses the offset in force on either side of a DST switch', () => {
    // 2026-03-29: 02:00 CET → 03:00 CEST. 2026-10-25: 03:00 CEST → 02:00 CET.
    expect(lineValue(feedFor('2026-03-29 01:30:00', '2026-03-29 03:30:00'), 'DTSTART')).toBe('DTSTART:20260329T003000Z')
    expect(lineValue(feedFor('2026-03-29 01:30:00', '2026-03-29 03:30:00'), 'DTEND')).toBe('DTEND:20260329T013000Z')
    expect(lineValue(feedFor('2026-10-25 00:30:00', '2026-10-25 04:00:00'), 'DTSTART')).toBe('DTSTART:20261024T223000Z')
    expect(lineValue(feedFor('2026-10-25 00:30:00', '2026-10-25 04:00:00'), 'DTEND')).toBe('DTEND:20261025T030000Z')
  })

  it('reads wall clocks in the configured app time zone, not a fixed one', () => {
    const ics = feedFor('2026-07-15 18:00:00', '2026-07-15 22:30:00', 'America/New_York')
    expect(lineValue(ics, 'DTSTART')).toBe('DTSTART:20260715T220000Z')
    expect(ics).toContain('X-WR-TIMEZONE:America/New_York')
  })

  it('keeps all-day appointments and date-only deadlines as floating dates', () => {
    const ics = buildIcsFeed({
      events: [],
      shifts: [],
      tasks: [{ id: 2, eventName: 'E', title: 'Frist', deadline: '2026-07-15', description: '' }],
      appointments: [{
        appointmentId: 3,
        occurrenceDate: '2026-07-20',
        title: 'Ganztägig',
        starts_at: '2026-07-20 00:00:00',
        ends_at: '2026-07-20 23:59:59',
        allDay: true,
        location: null,
        description: '',
      }],
      calendarName: 'Test',
      host: 'example.org',
      timeZone: 'Europe/Berlin',
    })
    expect(ics).toContain('DTSTART;VALUE=DATE:20260715')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260720')
    expect(ics).toContain('DTEND;VALUE=DATE:20260721')
  })

  it('converts timed task deadlines and declares the calendar zone', () => {
    const ics = buildIcsFeed({
      events: [],
      shifts: [],
      tasks: [{ id: 2, eventName: 'E', title: 'Frist', deadline: '2026-07-15T18:00', description: '' }],
      appointments: [],
      calendarName: 'Test',
      host: 'example.org',
      timeZone: 'Europe/Berlin',
    })
    expect(lineValue(ics, 'DTSTART')).toBe('DTSTART:20260715T160000Z')
    expect(ics).toContain('X-WR-TIMEZONE:Europe/Berlin')
  })
})
