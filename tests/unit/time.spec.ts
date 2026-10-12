import { describe, expect, it } from 'vitest'
import {
  addDaysToLocalDate,
  addMinutesToLocalDateTime,
  castTimestampColumn,
  diffLocalDates,
  instantToLocalDate,
  instantToLocalDateTime,
  instantToSql,
  isInstant,
  isLocalDate,
  isValidTimeZone,
  localDateTimeToInstant,
  normalizeLocalDateTime,
  normalizeQueryParams,
  parseInstant,
  resolveWallClock,
  sqlTimestampToInstant,
  startOfLocalDate,
  timeZoneOffsetMinutes,
  todayLocalDate,
} from '~/shared/time'

const BERLIN = 'Europe/Berlin'

describe('recognising the three kinds', () => {
  it('only calls a string an instant when it carries an offset', () => {
    expect(isInstant('2026-10-12T14:00:00Z')).toBe(true)
    expect(isInstant('2026-10-12T14:00:00.123456Z')).toBe(true)
    expect(isInstant('2026-10-12T16:00:00+02:00')).toBe(true)
    expect(isInstant('2026-10-12 14:00:00')).toBe(false)
    expect(isInstant('2026-10-12')).toBe(false)
  })

  it('refuses to guess the zone of a bare string', () => {
    expect(parseInstant('2026-10-12 14:00:00')).toBeNull()
    expect(parseInstant('2026-10-12T14:00:00Z')?.toISOString()).toBe('2026-10-12T14:00:00.000Z')
  })

  it('normalizes wall clocks and rejects impossible ones', () => {
    expect(normalizeLocalDateTime('2026-10-12T19:00')).toBe('2026-10-12 19:00:00')
    expect(normalizeLocalDateTime('2026-10-12 19:00:30')).toBe('2026-10-12 19:00:30')
    expect(normalizeLocalDateTime('2026-02-30 19:00')).toBeNull()
    expect(normalizeLocalDateTime('2026-10-12 24:00')).toBeNull()
    expect(normalizeLocalDateTime('2026-10-12T19:00:00Z')).toBeNull()
  })

  it('validates calendar days', () => {
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-10-12 00:00:00')).toBe(false)
  })

  it('knows valid IANA zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('converting between instants and the app time zone', () => {
  it('reads the offset in force at that moment', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), BERLIN)).toBe(120)
    expect(timeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), BERLIN)).toBe(60)
    expect(timeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240)
  })

  it('turns an instant into the wall clock and day of the zone', () => {
    expect(instantToLocalDateTime('2026-07-15T16:30:00Z', BERLIN)).toBe('2026-07-15 18:30:00')
    // 23:30 UTC is already the next day in Berlin — the bug class "today is the UTC date".
    expect(instantToLocalDate('2026-07-15T23:30:00Z', BERLIN)).toBe('2026-07-16')
    expect(todayLocalDate(BERLIN, new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
  })

  it('turns a wall clock into the instant it denotes, across DST switches', () => {
    expect(localDateTimeToInstant('2026-07-15 18:00:00', BERLIN).toISOString()).toBe('2026-07-15T16:00:00.000Z')
    expect(localDateTimeToInstant('2026-01-06 00:30:00', BERLIN).toISOString()).toBe('2026-01-05T23:30:00.000Z')
    // Spring forward (02:00 → 03:00): the missing 02:30 is read with the winter offset.
    expect(localDateTimeToInstant('2026-03-29 02:30:00', BERLIN).toISOString()).toBe('2026-03-29T01:30:00.000Z')
    expect(localDateTimeToInstant('2026-03-29 03:30:00', BERLIN).toISOString()).toBe('2026-03-29T01:30:00.000Z')
    // Fall back (03:00 → 02:00): the doubled 02:30 resolves to its first occurrence.
    expect(localDateTimeToInstant('2026-10-25 02:30:00', BERLIN).toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(localDateTimeToInstant('2026-10-25 03:30:00', BERLIN).toISOString()).toBe('2026-10-25T02:30:00.000Z')
  })

  it('round-trips every hour of a DST day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const instant = new Date(Date.UTC(2026, 9, 24, 22) + hour * 3600000)
      const local = instantToLocalDateTime(instant, BERLIN)
      // The repeated hour maps back to its first occurrence; every other hour round-trips exactly.
      if (local.startsWith('2026-10-25 02:')) continue
      expect(localDateTimeToInstant(local, BERLIN).toISOString()).toBe(instant.toISOString())
    }
  })

  it('finds midnight of a day in the zone', () => {
    expect(startOfLocalDate('2026-07-15', BERLIN).toISOString()).toBe('2026-07-14T22:00:00.000Z')
  })
})

describe('calendar arithmetic on wall clocks', () => {
  it('moves wall clocks by calendar minutes, unaffected by DST', () => {
    expect(addMinutesToLocalDateTime('2026-03-29 01:30:00', 60)).toBe('2026-03-29 02:30:00')
    expect(addMinutesToLocalDateTime('2026-12-31 23:30:00', 45)).toBe('2027-01-01 00:15:00')
  })

  it('counts and shifts calendar days', () => {
    expect(addDaysToLocalDate('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysToLocalDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(diffLocalDates('2026-10-12', '2026-10-15')).toBe(3)
    expect(diffLocalDates('2026-03-28', '2026-03-30')).toBe(2)
  })
})

describe('resolving any API value to the wall clock it shows', () => {
  it('converts instants, keeps wall clocks and days', () => {
    expect(resolveWallClock('2026-07-15T16:00:00Z', BERLIN)).toEqual({ wallClock: '2026-07-15 18:00:00', hasTime: true })
    expect(resolveWallClock('2026-07-15 16:00:00', BERLIN)).toEqual({ wallClock: '2026-07-15 16:00:00', hasTime: true })
    expect(resolveWallClock('2026-07-15', BERLIN)).toEqual({ wallClock: '2026-07-15 00:00:00', hasTime: false })
    expect(resolveWallClock('soon', BERLIN)).toBeNull()
    expect(resolveWallClock(null, BERLIN)).toBeNull()
  })
})

describe('the SQL boundary for instants', () => {
  it('marks TIMESTAMP values as instants and leaves everything else alone', () => {
    expect(castTimestampColumn({ type: 'TIMESTAMP' }, () => '2026-10-12 14:00:00')).toBe('2026-10-12T14:00:00Z')
    expect(castTimestampColumn({ type: 'TIMESTAMP' }, () => '2026-10-12 14:00:00.123456')).toBe('2026-10-12T14:00:00.123456Z')
    expect(castTimestampColumn({ type: 'TIMESTAMP' }, () => null)).toBeNull()
    expect(castTimestampColumn({ type: 'DATETIME' }, () => '2026-10-12 19:00:00')).toBe('2026-10-12 19:00:00')
    expect(castTimestampColumn({ type: 'DATE' }, () => '2026-10-12')).toBe('2026-10-12')
  })

  it('turns instants back into the UTC literal a TIMESTAMP expects', () => {
    expect(instantToSql('2026-10-12T14:00:00Z')).toBe('2026-10-12 14:00:00')
    expect(instantToSql('2026-10-12T14:00:00.123456Z')).toBe('2026-10-12 14:00:00.123456')
    expect(instantToSql('2026-10-12T16:00:00+02:00')).toBe('2026-10-12 14:00:00')
    expect(instantToSql(new Date('2026-10-12T14:00:00.250Z'))).toBe('2026-10-12 14:00:00.250')
    expect(sqlTimestampToInstant(instantToSql('2026-10-12T14:00:00Z'))).toBe('2026-10-12T14:00:00Z')
  })

  it('normalizes only instant params', () => {
    expect(normalizeQueryParams(['2026-10-12T14:00:00Z', '2026-10-12 19:00:00', '2026-10-12', 5, null]))
      .toEqual(['2026-10-12 14:00:00', '2026-10-12 19:00:00', '2026-10-12', 5, null])
    expect(normalizeQueryParams(undefined)).toBeUndefined()
  })

  it('refuses to turn a wall clock into an instant', () => {
    expect(() => instantToSql('2026-10-12 14:00:00')).toThrow()
  })
})
