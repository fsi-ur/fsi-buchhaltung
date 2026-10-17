import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction } from '~/server/utils/db'
import {
  copyAppointmentWebsiteSettings,
  loadAppointmentWebsiteSettings,
  loadPublicAppointments,
  parsePublicAppointmentsQuery,
  saveAppointmentWebsiteSettings,
} from '~/server/utils/appointmentWebsite'
import { resetDatabase } from '../helpers/db'
import { createUser, resetFixtureCounter } from '../helpers/fixtures'

const ZONE = 'Europe/Berlin'
const NOW = '2026-10-17 12:00:00'

describe('public appointments', () => {
  let actorId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
  })

  async function createAppointment(options: {
    title: string
    startsAt: string
    endsAt: string
    weekly?: { weekday: string, count?: number }
    published?: boolean
    visibleFrom?: string | null
    status?: 'active' | 'cancelled'
  }) {
    const result = await query<any>(
      `INSERT INTO appointments (title, agenda, starts_at, ends_at, status, recurrence_freq, recurrence_weekdays, recurrence_count, created_by)
       VALUES (?, 'Interne Tagesordnung', ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.title, options.startsAt, options.endsAt, options.status ?? 'active',
        options.weekly ? 'weekly' : null, options.weekly?.weekday ?? null, options.weekly?.count ?? null, actorId,
      ],
    )
    const id = Number(result.insertId)
    if (options.published ?? true) {
      await withAuditTransaction({ id: actorId }, conn => saveAppointmentWebsiteSettings(id, {
        published: true,
        visible_from: options.visibleFrom ?? null,
      }, conn))
    }
    return id
  }

  async function load(params: Record<string, unknown> = {}) {
    const parsed = parsePublicAppointmentsQuery(params, NOW)
    if (!parsed.ok) throw new Error(parsed.error)
    return loadPublicAppointments(parsed.query, NOW, ZONE)
  }

  it('returns only published, already visible appointments that have not ended', async () => {
    await createAppointment({ title: 'Intern', startsAt: '2026-11-01 18:00:00', endsAt: '2026-11-01 20:00:00', published: false })
    await createAppointment({ title: 'Vorbei', startsAt: '2026-10-01 18:00:00', endsAt: '2026-10-01 20:00:00' })
    await createAppointment({ title: 'Später sichtbar', startsAt: '2026-11-02 18:00:00', endsAt: '2026-11-02 20:00:00', visibleFrom: '2026-10-20 00:00:00' })
    await createAppointment({ title: 'Öffentlich', startsAt: '2026-11-03 18:00:00', endsAt: '2026-11-03 20:00:00' })

    expect((await load()).map(row => row.title)).toEqual(['Öffentlich'])
  })

  it('expands a recurring series and flags cancelled dates instead of dropping them', async () => {
    // Wednesdays, four times, starting 21 Oct 2026.
    const id = await createAppointment({ title: 'Sitzung', startsAt: '2026-10-21 19:00:00', endsAt: '2026-10-21 21:00:00', weekly: { weekday: 'WE', count: 4 } })
    await query(
      `INSERT INTO appointment_occurrence_overrides (appointment_id, occurrence_date, is_cancelled) VALUES (?, ?, 1)`,
      [id, '2026-10-28 19:00:00'],
    )

    const rows = await load()
    expect(rows.map(row => [row.startsAtLocal, row.cancelled])).toEqual([
      ['2026-10-21 19:00:00', false],
      ['2026-10-28 19:00:00', true],
      ['2026-11-04 19:00:00', false],
      ['2026-11-11 19:00:00', false],
    ])
    // Across the switch to winter time on 25 Oct.
    expect(rows[0]!.startsAt).toBe('2026-10-21T19:00:00+02:00')
    expect(rows[2]!.startsAt).toBe('2026-11-04T19:00:00+01:00')
    expect(new Set(rows.map(row => row.id)).size).toBe(4)
    expect(JSON.stringify(rows)).not.toContain('Tagesordnung')
  })

  it('reports a cancelled appointment as cancelled', async () => {
    await createAppointment({ title: 'Abgesagt', startsAt: '2026-11-03 18:00:00', endsAt: '2026-11-03 20:00:00', status: 'cancelled' })
    expect((await load()).map(row => row.cancelled)).toEqual([true])
  })

  it('applies limit and order across all series', async () => {
    await createAppointment({ title: 'Sitzung', startsAt: '2026-10-21 19:00:00', endsAt: '2026-10-21 21:00:00', weekly: { weekday: 'WE', count: 4 } })
    await createAppointment({ title: 'Einmalig', startsAt: '2026-10-30 18:00:00', endsAt: '2026-10-30 20:00:00' })

    expect((await load({ limit: '3' })).map(row => row.startsAtLocal)).toEqual(['2026-10-21 19:00:00', '2026-10-28 19:00:00', '2026-10-30 18:00:00'])
    expect((await load({ order: 'desc', limit: '1' })).map(row => row.startsAtLocal)).toEqual(['2026-11-11 19:00:00'])
  })

  it('expands ranges longer than one expansion window without gaps or duplicates', async () => {
    // Every Monday from 5 Jan 2026; three years is several expansion chunks.
    await createAppointment({ title: 'Wöchentlich', startsAt: '2026-01-05 18:00:00', endsAt: '2026-01-05 19:00:00', weekly: { weekday: 'MO' } })

    const rows = await load({ from: '2026-01-01', to: '2028-12-31', limit: '500' })
    expect(rows).toHaveLength(156)
    expect(new Set(rows.map(row => row.id)).size).toBe(156)
    expect(rows[0]!.startsAtLocal).toBe('2026-01-05 18:00:00')
    expect(rows.at(-1)!.startsAtLocal).toBe('2028-12-25 18:00:00')
  })

  it('lets a past "from" reach into the coming year without a "to"', async () => {
    await createAppointment({ title: 'Frühjahr', startsAt: '2026-03-01 18:00:00', endsAt: '2026-03-01 20:00:00' })
    await createAppointment({ title: 'Nächstes Jahr', startsAt: '2027-06-01 18:00:00', endsAt: '2027-06-01 20:00:00' })

    expect((await load({ from: '2026-01-01' })).map(row => row.title)).toEqual(['Frühjahr', 'Nächstes Jahr'])
  })

  it('keeps the publication when a series is split', async () => {
    const original = await createAppointment({ title: 'Sitzung', startsAt: '2026-10-21 19:00:00', endsAt: '2026-10-21 21:00:00', weekly: { weekday: 'WE' }, visibleFrom: '2026-10-01 00:00:00' })
    const tail = await createAppointment({ title: 'Sitzung (neu)', startsAt: '2026-11-04 19:00:00', endsAt: '2026-11-04 21:00:00', weekly: { weekday: 'WE' }, published: false })

    await withAuditTransaction({ id: actorId }, conn => copyAppointmentWebsiteSettings(original, tail, conn))

    expect(await loadAppointmentWebsiteSettings(tail)).toEqual({ published: true, visible_from: '2026-10-01 00:00:00' })
  })
})
