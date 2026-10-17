import { describe, expect, it } from 'vitest'
import {
  normalizeEventWebsitePayload,
  parsePublicEventsQuery,
  PUBLIC_EVENTS_DEFAULT_LIMIT,
  PUBLIC_EVENTS_MAX_LIMIT,
  toPublicEvent,
  validateEventWebsitePayload,
  WEBSITE_TITLE_MAX_LENGTH,
} from '~/server/utils/eventWebsite'
import { localDateTimeToOffsetIso } from '~/shared/time'

const BERLIN = 'Europe/Berlin'
const NOW = '2026-10-17 12:00:00'

describe('localDateTimeToOffsetIso', () => {
  it('appends the offset in effect at that wall clock', () => {
    expect(localDateTimeToOffsetIso('2026-07-01 19:00:00', BERLIN)).toBe('2026-07-01T19:00:00+02:00')
    expect(localDateTimeToOffsetIso('2026-12-01 19:00:00', BERLIN)).toBe('2026-12-01T19:00:00+01:00')
  })

  it('handles zones west of UTC and UTC itself', () => {
    expect(localDateTimeToOffsetIso('2026-01-15 08:30:00', 'America/New_York')).toBe('2026-01-15T08:30:00-05:00')
    expect(localDateTimeToOffsetIso('2026-01-15 08:30:00', 'UTC')).toBe('2026-01-15T08:30:00+00:00')
  })

  it('moves a wall clock in the spring-forward gap to a moment that exists', () => {
    expect(localDateTimeToOffsetIso('2026-03-29 02:30:00', BERLIN)).toBe('2026-03-29T03:30:00+02:00')
  })
})

describe('parsePublicEventsQuery', () => {
  it('defaults to events that have not ended yet, ascending', () => {
    expect(parsePublicEventsQuery({}, NOW)).toEqual({
      ok: true,
      query: { endsAfter: NOW, startsBefore: null, limit: PUBLIC_EVENTS_DEFAULT_LIMIT, order: 'asc' },
    })
  })

  it('treats from/to as inclusive calendar days', () => {
    const result = parsePublicEventsQuery({ from: '2026-01-01', to: '2026-01-31', order: 'desc' }, NOW)
    expect(result).toEqual({
      ok: true,
      query: { endsAfter: '2026-01-01 00:00:00', startsBefore: '2026-02-01 00:00:00', limit: PUBLIC_EVENTS_DEFAULT_LIMIT, order: 'desc' },
    })
  })

  it('keeps "upcoming only" when just an upper bound is given', () => {
    const result = parsePublicEventsQuery({ to: '2026-12-31' }, NOW)
    expect(result.ok && result.query.endsAfter).toBe(NOW)
  })

  it('caps the limit', () => {
    const result = parsePublicEventsQuery({ limit: '100000' }, NOW)
    expect(result.ok && result.query.limit).toBe(PUBLIC_EVENTS_MAX_LIMIT)
  })

  it('rejects malformed parameters', () => {
    expect(parsePublicEventsQuery({ from: '01.01.2026' }, NOW).ok).toBe(false)
    expect(parsePublicEventsQuery({ to: '2026-02-30' }, NOW).ok).toBe(false)
    expect(parsePublicEventsQuery({ from: '2026-02-01', to: '2026-01-01' }, NOW).ok).toBe(false)
    expect(parsePublicEventsQuery({ limit: '0' }, NOW).ok).toBe(false)
    expect(parsePublicEventsQuery({ limit: '1.5' }, NOW).ok).toBe(false)
    expect(parsePublicEventsQuery({ order: 'random' }, NOW).ok).toBe(false)
  })

  it('uses the first value of a repeated parameter', () => {
    const result = parsePublicEventsQuery({ limit: ['5', '10'] }, NOW)
    expect(result.ok && result.query.limit).toBe(5)
  })
})

describe('normalizeEventWebsitePayload', () => {
  it('normalises the publish window to a canonical wall clock', () => {
    expect(normalizeEventWebsitePayload({ published: true, visible_from: '2026-11-01T18:00', title: '  ', description: '  **Hi**\n' })).toEqual({
      published: true,
      visible_from: '2026-11-01 18:00:00',
      title: null,
      description: '**Hi**',
    })
  })

  it('treats anything but an explicit true as unpublished', () => {
    expect(normalizeEventWebsitePayload({ published: 'yes' })?.published).toBe(false)
    expect(normalizeEventWebsitePayload({})?.published).toBe(false)
  })

  it('rejects an unreadable date and an instant with offset', () => {
    expect(normalizeEventWebsitePayload({ visible_from: 'tomorrow' })).toBeNull()
    expect(normalizeEventWebsitePayload({ visible_from: '2026-11-01T18:00:00Z' })).toBeNull()
    expect(normalizeEventWebsitePayload(null)).toBeNull()
  })

  it('validates the length of the public title', () => {
    const body = normalizeEventWebsitePayload({ title: 'x'.repeat(WEBSITE_TITLE_MAX_LENGTH + 1) })!
    expect(validateEventWebsitePayload(body)).not.toBeNull()
  })
})

describe('toPublicEvent', () => {
  const row = {
    id: 7,
    name: 'Sommerfest – interne Planung',
    website_title: null as string | null,
    website_description: 'Komm vorbei!',
    starts_at: '2026-07-01 18:00:00',
    ends_at: '2026-07-02 01:00:00',
    location: 'Innenhof',
  }

  it('falls back to the internal name without a public title', () => {
    expect(toPublicEvent(row, [], BERLIN).title).toBe('Sommerfest – interne Planung')
    expect(toPublicEvent({ ...row, website_title: 'Sommerfest' }, [], BERLIN).title).toBe('Sommerfest')
  })

  it('returns both offset ISO and the wall clock', () => {
    const event = toPublicEvent(row, [{ code: 'FS', name: 'Fest' }], BERLIN)
    expect(event).toMatchObject({
      startsAt: '2026-07-01T18:00:00+02:00',
      endsAt: '2026-07-02T01:00:00+02:00',
      startsAtLocal: '2026-07-01 18:00:00',
      location: 'Innenhof',
      organizers: [{ code: 'FS', name: 'Fest' }],
    })
  })
})
