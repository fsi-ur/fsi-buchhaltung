import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { getOrganizerEventIds, isAnyEventOrganizer, loadEventRelations } from '~/server/utils/events'
import { buildEventPlanningSummary } from '~/server/utils/eventPlanningSummary'
import { loadCurrentMemberIdForUser, loadEventShiftSlots } from '~/server/utils/eventShifts'
import type { EventRow, EventSpotlight, EventSpotlightStatus } from '~/types/event'
import { appNowLocalDateTime } from '~/server/utils/time'
import { diffLocalDates, normalizeLocalDateTime, type LocalDateTime } from '~/shared/time'

interface GetEventSpotlightSuccess {
  ok: true
  upcoming: EventSpotlight | null
  latest: EventSpotlight | null
}

interface GetEventSpotlightError {
  ok: false
  error: string
}

export type GetEventSpotlightResponse = GetEventSpotlightSuccess | GetEventSpotlightError

function resolveStatus(startsAt: string, endsAt: string, now: LocalDateTime): EventSpotlightStatus {
  const start = normalizeLocalDateTime(startsAt)
  const end = normalizeLocalDateTime(endsAt)
  if (start && start > now) return 'upcoming'
  if (end && end >= now) return 'ongoing'
  return 'past'
}

function daysToStart(startsAt: string, now: LocalDateTime): number | null {
  const start = normalizeLocalDateTime(startsAt)
  if (!start) return null
  return diffLocalDates(now.slice(0, 10), start.slice(0, 10))
}

export default defineEventHandler(async (event): Promise<GetEventSpotlightResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  if (!hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup']) && !await isAnyEventOrganizer(current.user.id)) {
    return { ok: false, error: 'Not authorized' }
  }

  const canOpenAll = hasPermission(current.user, ['events.view', 'events.edit', 'events.shifts.signup'])
  const canViewAll = hasPermission(current.user, 'events.view')
  const canSignup = hasPermission(current.user, 'events.shifts.signup')

  try {
    const now = await appNowLocalDateTime()
    const [upcomingRows, latestRows, organizerEventIds, currentMemberId] = await Promise.all([
      query<EventRow[]>(
        `SELECT id, name, starts_at, ends_at, location, expected_guests
         FROM events
         WHERE ends_at >= ?
         ORDER BY starts_at ASC, ends_at ASC, name ASC
         LIMIT 1`,
        [now],
      ),
      query<EventRow[]>(
        `SELECT id, name, starts_at, ends_at, location, expected_guests
         FROM events
         WHERE ends_at < ?
         ORDER BY ends_at DESC, starts_at DESC, name ASC
         LIMIT 1`,
        [now],
      ),
      // Organizer status also unlocks the planning summary, so it matters for
      // everyone without events.view — not just for users who cannot open events.
      canViewAll ? Promise.resolve<number[]>([]) : getOrganizerEventIds(current.user.id),
      canSignup ? loadCurrentMemberIdForUser(current.user.id) : Promise.resolve(null),
    ])

    const upcomingRow = upcomingRows[0] ?? null
    const latestRow = latestRows[0] ?? null

    const rows = [upcomingRow, latestRow].filter((row): row is EventRow => row !== null)
    if (!rows.length) return { ok: true, upcoming: null, latest: null }

    const organizerSet = new Set(organizerEventIds.map(Number))
    const eventIds = rows.map(row => Number(row.id))
    const relations = await loadEventRelations(eventIds)

    async function toSpotlight(row: EventRow): Promise<EventSpotlight> {
      const id = Number(row.id)
      const memberOrganizers = relations.memberOrganizers.get(id) ?? []
      const subdivisionOrganizers = relations.subdivisionOrganizers.get(id) ?? []
      const costCentreSplits = relations.costCentreSplits.get(id) ?? []
      const canView = canViewAll || organizerSet.has(id)

      const base: EventSpotlight = {
        id,
        name: String(row.name),
        starts_at: String(row.starts_at),
        ends_at: String(row.ends_at),
        location: row.location != null ? String(row.location) : null,
        expected_guests: row.expected_guests != null ? Number(row.expected_guests) : null,
        member_organizers: memberOrganizers,
        subdivision_organizers: subdivisionOrganizers,
        cost_centre_splits: costCentreSplits,
        status: resolveStatus(String(row.starts_at), String(row.ends_at), now),
        daysToStart: daysToStart(String(row.starts_at), now),
        canOpen: canOpenAll || organizerSet.has(id),
        planning: null,
        shiftOverview: null,
      }

      if (canView) {
        base.planning = await buildEventPlanningSummary(id, {
          event: { location: base.location, expected_guests: base.expected_guests },
          organizerCount: memberOrganizers.length + subdivisionOrganizers.length,
          costCentreSplits,
        })
      }
      if (canSignup) {
        const slots = await loadEventShiftSlots(id)
        base.shiftOverview = slots.map(slot => ({
          id: slot.id,
          name: slot.name,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          required_people: slot.required_people,
          member_count: slot.members.length,
          is_signed_up: currentMemberId != null && slot.members.some(member => member.id === currentMemberId),
        }))
      }

      return base
    }

    const [upcoming, latest] = await Promise.all([
      upcomingRow ? toSpotlight(upcomingRow) : Promise.resolve(null),
      latestRow ? toSpotlight(latestRow) : Promise.resolve(null),
    ])

    return { ok: true, upcoming, latest }
  } catch (err: any) {
    return { ok: false, error: `Failed to load event spotlight: ${err}` }
  }
})
