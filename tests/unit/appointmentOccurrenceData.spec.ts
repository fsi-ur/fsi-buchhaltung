import { describe, expect, it } from 'vitest'
import { planOccurrenceDataChanges, type OccurrenceSeriesShape } from '~/server/utils/appointments/occurrenceData'

// Weekly on Tuesdays 18:00–20:00 from 3 Nov 2026; "now" sits between the 2nd and 3rd occurrence.
const NOW = '2026-11-12 12:00:00'

function weekly(overrides: Partial<OccurrenceSeriesShape> = {}): OccurrenceSeriesShape {
  return {
    id: 1,
    title: 'Sitzung',
    starts_at: '2026-11-03 18:00:00',
    ends_at: '2026-11-03 20:00:00',
    recurrence_freq: 'weekly',
    recurrence_interval: 1,
    recurrence_weekdays: 'TU',
    recurrence_count: 6,
    ...overrides,
  }
}

const responses = [
  { id: 1, member_id: 7, occurrence_date: '2026-11-03 18:00:00' }, // past
  { id: 2, member_id: 7, occurrence_date: '2026-11-10 18:00:00' }, // past
  { id: 3, member_id: 7, occurrence_date: '2026-11-17 18:00:00' }, // upcoming
  { id: 4, member_id: 8, occurrence_date: '2026-11-24 18:00:00' }, // upcoming
]

describe('planOccurrenceDataChanges', () => {
  it('changes nothing when the series did not change', () => {
    const plan = planOccurrenceDataChanges({ previous: weekly(), current: weekly(), overrides: [], responses, now: NOW })
    expect(plan).toEqual({ overrideMoves: [], overrideDeletes: [], responseMoves: [], responseDeletes: [], responseReconfirm: [] })
  })

  it('moves answers along with a new start time, flagging only upcoming ones', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ starts_at: '2026-11-03 19:00:00', ends_at: '2026-11-03 21:00:00' }),
      overrides: [],
      responses,
      now: NOW,
    })

    expect(plan.responseMoves).toEqual([
      { id: 1, occurrenceDate: '2026-11-03 19:00:00' },
      { id: 2, occurrenceDate: '2026-11-10 19:00:00' },
      { id: 3, occurrenceDate: '2026-11-17 19:00:00' },
      { id: 4, occurrenceDate: '2026-11-24 19:00:00' },
    ])
    expect(plan.responseDeletes).toEqual([])
    expect(plan.responseReconfirm).toEqual([3, 4])
  })

  it('deletes upcoming answers whose day is gone but never past ones', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ recurrence_weekdays: 'WE' }),
      overrides: [],
      responses,
      now: NOW,
    })

    expect(plan.responseMoves).toEqual([])
    expect(plan.responseDeletes).toEqual([3, 4])
    expect(plan.responseReconfirm).toEqual([])
  })

  it('deletes upcoming answers beyond a shortened series end', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ recurrence_count: 3 }),
      overrides: [],
      responses,
      now: NOW,
    })

    expect(plan.responseDeletes).toEqual([4])
    expect(plan.responseReconfirm).toEqual([])
  })

  it('flags upcoming answers when only the duration changed', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ ends_at: '2026-11-03 22:00:00' }),
      overrides: [],
      responses,
      now: NOW,
    })

    expect(plan.responseMoves).toEqual([])
    expect(plan.responseReconfirm).toEqual([3, 4])
  })

  it('does not flag an occurrence whose own override keeps its times', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ ends_at: '2026-11-03 22:00:00' }),
      overrides: [{ id: 9, occurrence_date: '2026-11-17 18:00:00', starts_at: '2026-11-17 17:00:00', ends_at: '2026-11-17 19:00:00' }],
      responses,
      now: NOW,
    })

    expect(plan.responseReconfirm).toEqual([4])
  })

  it('flags every upcoming answer on request, and none that is flagged already', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ title: 'Andere Sitzung' }),
      overrides: [],
      responses: responses.map(row => row.id === 4 ? { ...row, needs_reconfirmation: true } : row),
      now: NOW,
      reconfirm: 'all',
    })

    expect(plan.responseReconfirm).toEqual([3])
  })

  it('still moves answers but flags none when the organiser switched it off', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ starts_at: '2026-11-03 19:00:00', ends_at: '2026-11-03 21:00:00' }),
      overrides: [],
      responses,
      now: NOW,
      reconfirm: 'none',
    })

    expect(plan.responseMoves).toHaveLength(4)
    expect(plan.responseReconfirm).toEqual([])
  })

  it('moves overrides with the start time, and keeps orphaned past ones', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ starts_at: '2026-11-03 19:00:00', ends_at: '2026-11-03 21:00:00', recurrence_weekdays: 'TU' }),
      overrides: [
        { id: 20, occurrence_date: '2026-11-17 18:00:00', is_cancelled: true },
        { id: 21, occurrence_date: '2026-11-04 18:00:00', is_cancelled: true }, // past, never a scheduled date
        { id: 22, occurrence_date: '2026-11-18 18:00:00', is_cancelled: true }, // upcoming, never a scheduled date
      ],
      responses: [],
      now: NOW,
    })

    expect(plan.overrideMoves).toEqual([{ id: 20, occurrenceDate: '2026-11-17 19:00:00' }])
    expect(plan.overrideDeletes).toEqual([22])
  })

  it('moves the answers of a single appointment to its new date', () => {
    const single = (startsAt: string, endsAt: string): OccurrenceSeriesShape => ({
      id: 2, title: 'Treffen', starts_at: startsAt, ends_at: endsAt, recurrence_freq: null,
    })
    const plan = planOccurrenceDataChanges({
      previous: single('2026-11-20 18:00:00', '2026-11-20 20:00:00'),
      current: single('2026-11-27 10:00:00', '2026-11-27 12:00:00'),
      overrides: [],
      responses: [
        { id: 30, member_id: 7, occurrence_date: '2026-11-20 18:00:00' },
        { id: 31, member_id: 8, occurrence_date: '2026-11-20 18:00:00' },
      ],
      now: NOW,
    })

    expect(plan.responseMoves).toEqual([
      { id: 30, occurrenceDate: '2026-11-27 10:00:00' },
      { id: 31, occurrenceDate: '2026-11-27 10:00:00' },
    ])
    expect(plan.responseReconfirm).toEqual([30, 31])
  })

  it('never lets two answers of one member land on the same occurrence', () => {
    const plan = planOccurrenceDataChanges({
      previous: weekly(),
      current: weekly({ starts_at: '2026-11-03 19:00:00', ends_at: '2026-11-03 21:00:00' }),
      overrides: [],
      responses: [
        { id: 40, member_id: 7, occurrence_date: '2026-11-17 19:00:00' }, // already at the new time
        { id: 41, member_id: 7, occurrence_date: '2026-11-17 18:00:00' },
      ],
      now: NOW,
    })

    expect(plan.responseMoves).toEqual([])
    expect(plan.responseDeletes).toEqual([41])
  })
})
