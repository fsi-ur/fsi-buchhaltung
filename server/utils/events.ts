import type * as mariadb from 'mariadb'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'
import { validateSimpleCostCentreSelection } from '~/server/utils/costCentres'
import { query } from '~/server/utils/db'
import { normalizeRelationIds, validateSubdivisionSelection } from '~/server/utils/subdivisions'
import { validateSphereSelection } from '~/server/utils/spheres'
import type {
  EventCostCentreOption,
  EventCostCentreSplit,
  EventMemberOption,
  EventMemberOrganizer,
  EventSphereOption,
  EventSubdivisionOption,
  EventSubdivisionOrganizer,
  SaveEventBody,
  SaveEventCostCentreSplit,
} from '~/types/event'

interface EventMemberOrganizerRow {
  event_id: number
  id: number
  full_name: string
}

interface EventSubdivisionOrganizerRow {
  event_id: number
  id: number
  code: string
  name: string
}

interface EventCostCentreSplitRow {
  id: number
  event_id: number
  sphere_id: number
  sphere_code: string
  sphere_name: string
  cost_centre_id: number
  code: string
  name: string
  allocation_percentage: number
}

interface EventCostCentreSplitLogRow {
  id: number
  sphere_id: number
  cost_centre_id: number
  allocation_percentage: number
}

interface EventRelationMaps {
  memberOrganizers: Map<number, EventMemberOrganizer[]>
  subdivisionOrganizers: Map<number, EventSubdivisionOrganizer[]>
  costCentreSplits: Map<number, EventCostCentreSplit[]>
}

function parsePositiveInteger(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

function normalizeDateTime(value: unknown) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''

  const normalized = trimmed.replace('T', ' ')
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null

  const [, date, hours, minutes, seconds] = match
  return `${date} ${hours}:${minutes}:${seconds ?? '00'}`
}

export function normalizeEventCostCentreSplits(value: unknown): SaveEventCostCentreSplit[] | null {
  if (!Array.isArray(value)) return null

  const normalized: SaveEventCostCentreSplit[] = []
  const seen = new Set<number>()

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const sphereId = Number(raw.sphere_id)
    const costCentreId = Number(raw.cost_centre_id)
    const allocationPercentage = Number(raw.allocation_percentage)

    if (!Number.isInteger(sphereId) || sphereId <= 0) return null
    if (!Number.isInteger(costCentreId) || costCentreId <= 0) return null
    if (!Number.isFinite(allocationPercentage) || allocationPercentage <= 0) return null
    if (seen.has(costCentreId)) return null

    seen.add(costCentreId)
    normalized.push({
      sphere_id: sphereId,
      cost_centre_id: costCentreId,
      allocation_percentage: Number(allocationPercentage.toFixed(2)),
    })
  }

  return normalized
}

export function normalizeEventPayload(value: unknown): SaveEventBody | null {
  if (!value || typeof value !== 'object') return null

  const input = value as Record<string, unknown>
  const memberOrganizerIds = normalizeRelationIds(input.member_organizer_ids)
  const subdivisionOrganizerIds = normalizeRelationIds(input.subdivision_organizer_ids)
  const costCentreSplits = normalizeEventCostCentreSplits(input.cost_centre_splits)
  const startsAt = normalizeDateTime(input.starts_at)
  const endsAt = normalizeDateTime(input.ends_at)

  const guestsRaw = String(input.expected_guests ?? '').trim()
  const expectedGuests: number | null = guestsRaw === '' ? null : parsePositiveInteger(input.expected_guests)

  if (memberOrganizerIds === null || subdivisionOrganizerIds === null || costCentreSplits === null || (guestsRaw !== '' && expectedGuests === null) || startsAt === null || endsAt === null) {
    return null
  }

  const locationRaw = String(input.location ?? '').trim()

  return {
    name: String(input.name ?? '').trim(),
    starts_at: startsAt,
    ends_at: endsAt,
    location: locationRaw || null,
    expected_guests: expectedGuests,
    member_organizer_ids: memberOrganizerIds,
    subdivision_organizer_ids: subdivisionOrganizerIds,
    cost_centre_splits: costCentreSplits,
  }
}

export function validateEventPayload(body: SaveEventBody) {
  if (!body.name || !body.starts_at || !body.ends_at) return 'Missing fields'
  if (body.starts_at > body.ends_at) return 'The start time must be on or before the end time'
  if (!body.cost_centre_splits.length) return 'At least one cost centre split is required'

  const totalAllocation = body.cost_centre_splits.reduce((sum, split) => sum + Number(split.allocation_percentage || 0), 0)
  if (Math.abs(totalAllocation - 100) > 0.01) return 'Cost centre splits must add up to 100%'

  return null
}

export async function validateEventRelations(
  body: SaveEventBody,
  conn: mariadb.PoolConnection,
  existingSubdivisionIds: number[] = [],
  existingCostCentreSplits: Array<{ itemId: number, costCentreId: number, sphereId: number }> = [],
) {
  if (body.member_organizer_ids.length) {
    const rows = await query<{ id: number }[]>(
      `SELECT id
       FROM members
       WHERE id IN (${body.member_organizer_ids.map(() => '?').join(',')})`,
      body.member_organizer_ids,
      conn,
    )
    if (rows.length !== body.member_organizer_ids.length) return 'At least one selected member organizer does not exist'
  }

  if (body.subdivision_organizer_ids.length) {
    const rows = await query<{ id: number }[]>(
      `SELECT id
       FROM subdivisions
       WHERE id IN (${body.subdivision_organizer_ids.map(() => '?').join(',')})`,
      body.subdivision_organizer_ids,
      conn,
    )
    if (rows.length !== body.subdivision_organizer_ids.length) return 'At least one selected subdivision organizer does not exist'

    const subdivisionValidationError = await validateSubdivisionSelection(
      body.subdivision_organizer_ids,
      existingSubdivisionIds,
      conn,
    )
    if (subdivisionValidationError) return subdivisionValidationError
  }

  const costCentreIds = body.cost_centre_splits.map(split => split.cost_centre_id)
  const sphereIds = Array.from(new Set(body.cost_centre_splits.map(split => split.sphere_id)))
  const rows = await query<{ id: number }[]>(
    `SELECT id
     FROM cost_centres
     WHERE id IN (${costCentreIds.map(() => '?').join(',')})`,
    costCentreIds,
    conn,
  )

  if (rows.length !== costCentreIds.length) {
    return 'At least one selected cost centre does not exist'
  }

  const sphereRows = await query<{ id: number }[]>(
    `SELECT id
     FROM spheres
     WHERE id IN (${sphereIds.map(() => '?').join(',')})`,
    sphereIds,
    conn,
  )
  if (sphereRows.length !== sphereIds.length) {
    return 'At least one selected sphere does not exist'
  }

  const costCentreValidationError = await validateSimpleCostCentreSelection(
    costCentreIds,
    existingCostCentreSplits.map(split => split.costCentreId),
    conn,
  )
  if (costCentreValidationError) return costCentreValidationError

  return validateSphereSelection(
    body.cost_centre_splits.map(split => ({
      itemId: existingCostCentreSplits.find(entry => entry.costCentreId === split.cost_centre_id)?.itemId ?? null,
      sphereId: split.sphere_id,
    })),
    existingCostCentreSplits.map(split => ({
      itemId: split.itemId,
      sphereId: split.sphereId,
    })),
    conn,
  )
}

export async function syncEventMemberOrganizers({
  eventId,
  existingIds,
  nextIds,
  conn,
}: {
  eventId: number
  existingIds: number[]
  nextIds: number[]
  conn: mariadb.PoolConnection
}) {
  await syncScalarCollection({
    existing: existingIds,
    incoming: nextIds,
    onRemove: async (memberId) => {
      await query(
        `DELETE FROM event_member_organizers
         WHERE event_id = ? AND member_id = ?`,
        [eventId, memberId],
        conn,
      )
    },
    onAdd: async (memberId) => {
      await query(
        `INSERT INTO event_member_organizers (event_id, member_id)
         VALUES (?, ?)`,
        [eventId, memberId],
        conn,
      )
    },
  })
}

export async function syncEventSubdivisionOrganizers({
  eventId,
  existingIds,
  nextIds,
  conn,
}: {
  eventId: number
  existingIds: number[]
  nextIds: number[]
  conn: mariadb.PoolConnection
}) {
  await syncScalarCollection({
    existing: existingIds,
    incoming: nextIds,
    onRemove: async (subdivisionId) => {
      await query(
        `DELETE FROM event_subdivision_organizers
         WHERE event_id = ? AND subdivision_id = ?`,
        [eventId, subdivisionId],
        conn,
      )
    },
    onAdd: async (subdivisionId) => {
      await query(
        `INSERT INTO event_subdivision_organizers (event_id, subdivision_id)
         VALUES (?, ?)`,
        [eventId, subdivisionId],
        conn,
      )
    },
  })
}

export async function syncEventCostCentreSplits({
  eventId,
  existingRows,
  nextRows,
  conn,
}: {
  eventId: number
  existingRows: EventCostCentreSplitLogRow[]
  nextRows: SaveEventCostCentreSplit[]
  conn: mariadb.PoolConnection
}) {
  const existingByCostCentreId = new Map(existingRows.map(row => [Number(row.cost_centre_id), row]))
  const nextByCostCentreId = new Map(nextRows.map(row => [Number(row.cost_centre_id), row]))

  for (const row of existingRows) {
    if (nextByCostCentreId.has(Number(row.cost_centre_id))) continue

    await query(
      `DELETE FROM event_cost_centre_splits
       WHERE id = ?`,
      [row.id],
      conn,
    )
  }

  for (const split of nextRows) {
    const existing = existingByCostCentreId.get(Number(split.cost_centre_id))

    if (!existing) {
      await query(
        `INSERT INTO event_cost_centre_splits (event_id, sphere_id, cost_centre_id, allocation_percentage)
         VALUES (?, ?, ?, ?)`,
        [eventId, split.sphere_id, split.cost_centre_id, split.allocation_percentage],
        conn,
      )
      continue
    }

    await query(
      `UPDATE event_cost_centre_splits
       SET sphere_id = ?, allocation_percentage = ?
       WHERE id = ?`,
      [split.sphere_id, split.allocation_percentage, existing.id],
      conn,
    )
  }
}

function groupByEventId<T extends { event_id: number }, U>(
  rows: T[],
  mapRow: (row: T) => U,
) {
  const grouped = new Map<number, U[]>()

  for (const row of rows) {
    const eventId = Number(row.event_id)
    const bucket = grouped.get(eventId) ?? []
    bucket.push(mapRow(row))
    grouped.set(eventId, bucket)
  }

  return grouped
}

export async function loadEventRelations(
  eventIds: number[],
  conn?: mariadb.PoolConnection,
): Promise<EventRelationMaps> {
  if (!eventIds.length) {
    return {
      memberOrganizers: new Map(),
      subdivisionOrganizers: new Map(),
      costCentreSplits: new Map(),
    }
  }

  const placeholders = eventIds.map(() => '?').join(',')

  const memberRows = await query<EventMemberOrganizerRow[]>(
    `SELECT
       emo.event_id,
       m.id,
       TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name
     FROM event_member_organizers emo
     JOIN members m ON m.id = emo.member_id
     WHERE emo.event_id IN (${placeholders})
     ORDER BY m.last_name ASC, m.first_name ASC`,
    eventIds,
    conn,
  )

  const subdivisionRows = await query<EventSubdivisionOrganizerRow[]>(
    `SELECT
       eso.event_id,
       s.id,
       s.code,
       s.name
     FROM event_subdivision_organizers eso
     JOIN subdivisions s ON s.id = eso.subdivision_id
     WHERE eso.event_id IN (${placeholders})
     ORDER BY s.code ASC, s.name ASC`,
    eventIds,
    conn,
  )

  const splitRows = await query<EventCostCentreSplitRow[]>(
    `SELECT
       eccs.id,
       eccs.event_id,
       eccs.sphere_id,
       s.code AS sphere_code,
       s.name AS sphere_name,
       eccs.cost_centre_id,
       cc.code,
       cc.name,
       eccs.allocation_percentage
     FROM event_cost_centre_splits eccs
     JOIN spheres s ON s.id = eccs.sphere_id
     JOIN cost_centres cc ON cc.id = eccs.cost_centre_id
     WHERE eccs.event_id IN (${placeholders})
     ORDER BY s.code ASC, s.name ASC, cc.code ASC, cc.name ASC`,
    eventIds,
    conn,
  )

  return {
    memberOrganizers: groupByEventId(memberRows, row => ({
      id: Number(row.id),
      full_name: String(row.full_name),
    })),
    subdivisionOrganizers: groupByEventId(subdivisionRows, row => ({
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
    })),
    costCentreSplits: groupByEventId(splitRows, row => ({
      sphere_id: Number(row.sphere_id),
      sphere_code: String(row.sphere_code),
      sphere_name: String(row.sphere_name),
      cost_centre_id: Number(row.cost_centre_id),
      code: String(row.code),
      name: String(row.name),
      allocation_percentage: Number(row.allocation_percentage),
    })),
  }
}

export async function isAnyEventOrganizer(
  userId: number,
  conn?: mariadb.PoolConnection,
): Promise<boolean> {
  const rows = await query<{ found: number }[]>(
    `SELECT 1 AS found
     FROM event_member_organizers emo
     JOIN members m ON m.id = emo.member_id
     WHERE m.account = ?
     UNION
     SELECT 1 AS found
     FROM event_subdivision_organizers eso
     JOIN subdivision_members sm ON sm.subdivision_id = eso.subdivision_id
     JOIN members m ON m.id = sm.member_id
     WHERE m.account = ?
     LIMIT 1`,
    [userId, userId],
    conn,
  )
  return rows.length > 0
}

export async function isEventOrganizer(
  userId: number,
  eventId: number,
  conn?: mariadb.PoolConnection,
): Promise<boolean> {
  const rows = await query<{ found: number }[]>(
    `SELECT 1 AS found
     FROM event_member_organizers emo
     JOIN members m ON m.id = emo.member_id
     WHERE emo.event_id = ? AND m.account = ?
     UNION
     SELECT 1 AS found
     FROM event_subdivision_organizers eso
     JOIN subdivision_members sm ON sm.subdivision_id = eso.subdivision_id
     JOIN members m ON m.id = sm.member_id
     WHERE eso.event_id = ? AND m.account = ?
     LIMIT 1`,
    [eventId, userId, eventId, userId],
    conn,
  )
  return rows.length > 0
}

export async function getOrganizerEventIds(
  userId: number,
  conn?: mariadb.PoolConnection,
): Promise<number[]> {
  const rows = await query<{ event_id: number }[]>(
    `SELECT DISTINCT emo.event_id
     FROM event_member_organizers emo
     JOIN members m ON m.id = emo.member_id
     WHERE m.account = ?
     UNION
     SELECT DISTINCT eso.event_id
     FROM event_subdivision_organizers eso
     JOIN subdivision_members sm ON sm.subdivision_id = eso.subdivision_id
     JOIN members m ON m.id = sm.member_id
     WHERE m.account = ?`,
    [userId, userId],
    conn,
  )
  return rows.map(row => Number(row.event_id))
}

export async function loadEventOptions(conn?: mariadb.PoolConnection) {
  const [members, subdivisions, costCentres, spheres] = await Promise.all([
    query<EventMemberOption[]>(
      `SELECT
         id,
         TRIM(CONCAT(first_name, ' ', last_name)) AS full_name
       FROM members
       ORDER BY last_name ASC, first_name ASC`,
      undefined,
      conn,
    ),
    query<EventSubdivisionOption[]>(
      `SELECT id, code, name, is_active
       FROM subdivisions
       ORDER BY is_active DESC, code ASC, name ASC`,
      undefined,
      conn,
    ),
    query<EventCostCentreOption[]>(
      `SELECT id, code, name, is_active
       FROM cost_centres
       ORDER BY is_active DESC, code ASC, name ASC`,
      undefined,
      conn,
    ),
    query<EventSphereOption[]>(
      `SELECT id, code, name, is_active
       FROM spheres
       ORDER BY is_active DESC, code ASC, name ASC`,
      undefined,
      conn,
    ),
  ])

  return {
    members: members.map(member => ({
      id: Number(member.id),
      full_name: String(member.full_name),
    })),
    subdivisions: subdivisions.map(subdivision => ({
      id: Number(subdivision.id),
      code: String(subdivision.code),
      name: String(subdivision.name),
      is_active: Boolean(subdivision.is_active),
    })),
    costCentres: costCentres.map(costCentre => ({
      id: Number(costCentre.id),
      code: String(costCentre.code),
      name: String(costCentre.name),
      is_active: Boolean(costCentre.is_active),
    })),
    spheres: spheres.map(sphere => ({
      id: Number(sphere.id),
      code: String(sphere.code),
      name: String(sphere.name),
      is_active: Boolean(sphere.is_active),
    })),
  }
}
