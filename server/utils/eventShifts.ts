import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type { EventShiftMember, EventShiftSlot, EventShiftTemplate, EventShiftTypeDescriptions, SaveEventShiftSlot, SaveEventShiftTemplate } from '~/types/event'
import { dropFutureReminders } from '~/server/utils/notifications/enqueue'
import { queueShiftChanges, type ShiftChangeInput } from '~/server/utils/notifications/changeDigest'
import { pickChangedFields, type ChangedField } from '~/server/utils/notifications/changeDescription'
import { formatLocalDateTime } from '~/server/utils/notifications/render'
import { normalizeLocalDateTime } from '~/shared/time'

interface EventShiftSlotRow {
  id: number
  name: string
  description: string
  starts_at: string
  ends_at: string
  required_people: number
}

interface EventShiftTemplateRow {
  id: number
  name: string
  description: string
  required_people: number
}

interface EventShiftMemberRow {
  shift_id: number
  member_id: number
  full_name: string
}

function normalizeDateTime(value: unknown) {
  return normalizeLocalDateTime(value)
}

function formatDateTimeForClient(value: string) {
  return String(value).trim().replace(' ', 'T').slice(0, 16)
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeMemberIds(value: unknown) {
  if (!Array.isArray(value)) return null

  const ids: number[] = []
  const seen = new Set<number>()

  for (const entry of value) {
    const parsed = Number(entry)
    if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) return null
    seen.add(parsed)
    ids.push(parsed)
  }

  return ids
}

export function normalizeEventShiftSlots(value: unknown): SaveEventShiftSlot[] | null {
  if (!Array.isArray(value)) return null

  const slots: SaveEventShiftSlot[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const id = raw.id === undefined || raw.id === null ? undefined : normalizePositiveInteger(raw.id)
    const startsAt = normalizeDateTime(raw.starts_at ?? raw.startsAt ?? raw.start_time ?? raw.startTime)
    const endsAt = normalizeDateTime(raw.ends_at ?? raw.endsAt ?? raw.end_time ?? raw.endTime)
    const requiredPeople = normalizePositiveInteger(raw.required_people ?? raw.requiredPeople)
    const memberIds = normalizeMemberIds(raw.member_ids ?? raw.memberIds)
    const name = String(raw.name ?? '').trim()
    const description = String(raw.description ?? '').trim()

    if (raw.id !== undefined && raw.id !== null && !id) return null
    if (!startsAt || !endsAt || startsAt >= endsAt || !requiredPeople || !memberIds || !name) return null

    slots.push({
      ...(id ? { id } : {}),
      name,
      description,
      starts_at: startsAt,
      ends_at: endsAt,
      required_people: requiredPeople,
      member_ids: memberIds,
    })
  }

  return slots
}

export function normalizeEventShiftTemplates(value: unknown): SaveEventShiftTemplate[] | null {
  if (!Array.isArray(value)) return null

  const templates: SaveEventShiftTemplate[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const id = raw.id === undefined || raw.id === null ? undefined : normalizePositiveInteger(raw.id)
    const requiredPeople = normalizePositiveInteger(raw.required_people ?? raw.requiredPeople)
    const name = String(raw.name ?? '').trim()
    const description = String(raw.description ?? '').trim()

    if (raw.id !== undefined && raw.id !== null && !id) return null
    if (!name || !requiredPeople) return null

    templates.push({
      ...(id ? { id } : {}),
      name,
      description,
      required_people: requiredPeople,
    })
  }

  return templates
}

export function normalizeShiftTypeKey(name: string) {
  return name.trim().toLocaleLowerCase()
}

export function normalizeEventShiftTypeDescriptions(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const entries: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const nameKey = normalizeShiftTypeKey(key)
    if (!nameKey) return null
    entries[nameKey] = String(rawValue ?? '').trim()
  }

  return entries
}

export async function eventExists(eventId: number, conn?: mariadb.PoolConnection) {
  const rows = await query<{ id: number }[]>(
    `SELECT id
     FROM events
     WHERE id = ?
     LIMIT 1`,
    [eventId],
    conn,
  )

  return Boolean(rows[0])
}

export async function loadCurrentMemberIdForUser(userId: number, conn?: mariadb.PoolConnection) {
  const rows = await query<{ id: number }[]>(
    `SELECT id
     FROM members
     WHERE account = ?
     LIMIT 1`,
    [userId],
    conn,
  )

  return rows[0] ? Number(rows[0].id) : null
}

export async function loadEventShiftSlots(eventId: number, conn?: mariadb.PoolConnection): Promise<EventShiftSlot[]> {
  const slotRows = await query<EventShiftSlotRow[]>(
    `SELECT id, name, description, starts_at, ends_at, required_people
     FROM event_shift_slots
     WHERE event_id = ?
     ORDER BY starts_at, ends_at, name, id`,
    [eventId],
    conn,
  )

  if (!slotRows.length) return []

  const shiftIds = slotRows.map(row => Number(row.id))
  const memberRows = await query<EventShiftMemberRow[]>(
    `SELECT esm.shift_id,
            esm.member_id,
            CONCAT(m.first_name, ' ', m.last_name) AS full_name
     FROM event_shift_members esm
     JOIN members m ON m.id = esm.member_id
     WHERE esm.shift_id IN (${shiftIds.map(() => '?').join(',')})
     ORDER BY m.first_name, m.last_name, esm.member_id`,
    shiftIds,
    conn,
  )

  const membersByShift = new Map<number, EventShiftMember[]>()

  for (const row of memberRows) {
    const shiftId = Number(row.shift_id)
    const members = membersByShift.get(shiftId) ?? []
    members.push({
      id: Number(row.member_id),
      full_name: String(row.full_name),
    })
    membersByShift.set(shiftId, members)
  }

  return slotRows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    starts_at: formatDateTimeForClient(row.starts_at),
    ends_at: formatDateTimeForClient(row.ends_at),
    required_people: Number(row.required_people),
    members: membersByShift.get(Number(row.id)) ?? [],
  }))
}

export async function loadEventShiftTemplates(conn?: mariadb.PoolConnection): Promise<EventShiftTemplate[]> {
  const rows = await query<EventShiftTemplateRow[]>(
    `SELECT id, name, description, required_people
     FROM event_shift_templates
     ORDER BY name, id`,
    [],
    conn,
  )

  return rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    required_people: Number(row.required_people),
  }))
}

export async function replaceEventShiftTemplates({
  templates,
  conn,
}: {
  templates: SaveEventShiftTemplate[]
  conn: mariadb.PoolConnection
}) {
  const existingRows = await query<EventShiftTemplateRow[]>(
    `SELECT id, name, description, required_people
     FROM event_shift_templates`,
    [],
    conn,
  )
  const existingIds = existingRows.map(row => Number(row.id))
  const existingIdSet = new Set(existingIds)
  const incomingIds = templates.flatMap(template => template.id ? [template.id] : [])

  if (incomingIds.some(id => !existingIdSet.has(id))) {
    return 'At least one shift template does not exist'
  }

  const incomingIdSet = new Set(incomingIds)
  for (const id of existingIds) {
    if (incomingIdSet.has(id)) continue
    await query(
      `DELETE FROM event_shift_templates
       WHERE id = ?`,
      [id],
      conn,
    )
  }

  for (const template of templates) {
    if (template.id) {
      const existing = existingRows.find(row => Number(row.id) === template.id)
      if (
        existing
        && (
          String(existing.name) !== template.name
          || String(existing.description) !== template.description
          || Number(existing.required_people) !== template.required_people
        )
      ) {
        await query(
          `UPDATE event_shift_templates
           SET name = ?, description = ?, required_people = ?
           WHERE id = ?`,
          [template.name, template.description, template.required_people, template.id],
          conn,
        )
      }
      continue
    }

    await query(
      `INSERT INTO event_shift_templates (name, description, required_people)
       VALUES (?, ?, ?)`,
      [template.name, template.description, template.required_people],
      conn,
    )
  }

  return null
}

export async function loadEventShiftTypeDescriptions(eventId: number, conn?: mariadb.PoolConnection): Promise<EventShiftTypeDescriptions> {
  const rows = await query<{ name_key: string, description: string }[]>(
    `SELECT name_key, description
     FROM event_shift_type_descriptions
     WHERE event_id = ?`,
    [eventId],
    conn,
  )

  const entries: EventShiftTypeDescriptions = {}
  for (const row of rows) entries[String(row.name_key)] = String(row.description)
  return entries
}

export async function replaceEventShiftTypeDescriptions({
  eventId,
  entries,
  conn,
}: {
  eventId: number
  entries: Record<string, string>
  conn: mariadb.PoolConnection
}) {
  const existingRows = await query<{ name_key: string, description: string }[]>(
    `SELECT name_key, description
     FROM event_shift_type_descriptions
     WHERE event_id = ?`,
    [eventId],
    conn,
  )
  const existingByKey = new Map(existingRows.map(row => [String(row.name_key), String(row.description)]))

  const incomingEntries = Object.entries(entries)
    .map(([nameKey, description]) => [nameKey, description.trim()] as const)
    .filter(([, description]) => description)
  const incomingKeySet = new Set(incomingEntries.map(([nameKey]) => nameKey))

  for (const existingKey of existingByKey.keys()) {
    if (incomingKeySet.has(existingKey)) continue
    await query(
      `DELETE FROM event_shift_type_descriptions
       WHERE event_id = ? AND name_key = ?`,
      [eventId, existingKey],
      conn,
    )
  }

  for (const [nameKey, description] of incomingEntries) {
    const existingDescription = existingByKey.get(nameKey)

    if (existingDescription === undefined) {
      await query(
        `INSERT INTO event_shift_type_descriptions (event_id, name_key, description)
         VALUES (?, ?, ?)`,
        [eventId, nameKey, description],
        conn,
      )
      continue
    }

    if (existingDescription === description) continue

    await query(
      `UPDATE event_shift_type_descriptions
       SET description = ?
       WHERE event_id = ? AND name_key = ?`,
      [description, eventId, nameKey],
      conn,
    )
  }

  return null
}

export async function validateShiftMembers(memberIds: number[], conn: mariadb.PoolConnection) {
  if (!memberIds.length) return null

  const rows = await query<{ id: number }[]>(
    `SELECT id
     FROM members
     WHERE id IN (${memberIds.map(() => '?').join(',')})`,
    memberIds,
    conn,
  )

  return rows.length === memberIds.length ? null : 'At least one selected shift member does not exist'
}

async function syncShiftMembers({
  shiftId,
  existingIds,
  nextIds,
  conn,
}: {
  shiftId: number
  existingIds: number[]
  nextIds: number[]
  conn: mariadb.PoolConnection
}) {
  const nextSet = new Set(nextIds)
  const existingSet = new Set(existingIds)

  for (const memberId of existingIds) {
    if (nextSet.has(memberId)) continue
    await query(
      `DELETE FROM event_shift_members
       WHERE shift_id = ? AND member_id = ?`,
      [shiftId, memberId],
      conn,
    )
  }

  for (const memberId of nextIds) {
    if (existingSet.has(memberId)) continue
    await query(
      `INSERT INTO event_shift_members (shift_id, member_id)
       VALUES (?, ?)`,
      [shiftId, memberId],
      conn,
    )
  }
}

export async function replaceEventShiftSlots({
  eventId,
  slots,
  conn,
  actingUserId,
}: {
  eventId: number
  slots: SaveEventShiftSlot[]
  conn: mariadb.PoolConnection
  actingUserId?: number | null
}) {
  const [eventRow] = await query<Array<{ name: string, location: string | null }>>(
    `SELECT name, location FROM events WHERE id = ?`,
    [eventId],
    conn,
  )

  const existingRows = await query<EventShiftSlotRow[]>(
    `SELECT id, name, description, starts_at, ends_at, required_people
     FROM event_shift_slots
     WHERE event_id = ?`,
    [eventId],
    conn,
  )
  const existingIds = existingRows.map(row => Number(row.id))
  const existingIdSet = new Set(existingIds)
  const incomingIds = slots.flatMap(slot => slot.id ? [slot.id] : [])

  if (incomingIds.some(id => !existingIdSet.has(id))) {
    return 'At least one shift does not belong to this event'
  }

  const relationError = await validateShiftMembers(
    Array.from(new Set(slots.flatMap(slot => slot.member_ids))),
    conn,
  )
  if (relationError) return relationError

  const shiftChanges: ShiftChangeInput[] = []
  const shiftEntry = (id: number, slot: { name: string, starts_at: string, ends_at: string }) => ({
    shift_id: id,
    name: String(slot.name),
    start: String(slot.starts_at),
    end: String(slot.ends_at),
  })

  const incomingIdSet = new Set(incomingIds)
  for (const id of existingIds) {
    if (incomingIdSet.has(id)) continue

    // A deleted shift takes its members with it (ON DELETE CASCADE) — tell them it is gone.
    const existing = existingRows.find(row => Number(row.id) === id)!
    const deletedMembers = await query<{ member_id: number }[]>(
      `SELECT member_id FROM event_shift_members WHERE shift_id = ?`,
      [id],
      conn,
    )
    for (const row of deletedMembers) {
      shiftChanges.push({ memberId: Number(row.member_id), entry: { ...shiftEntry(id, existing), change: 'removed' } })
    }

    await query(
      `DELETE FROM event_shift_slots
       WHERE id = ? AND event_id = ?`,
      [id, eventId],
      conn,
    )
  }

  for (const slot of slots) {
    let shiftId = slot.id ?? null
    let timingOrNameChanged = false
    let changedFields: ChangedField[] = []

    if (shiftId) {
      const existing = existingRows.find(row => Number(row.id) === shiftId)
      if (
        existing
        && (
          String(existing.name) !== slot.name
          || String(existing.description ?? '') !== slot.description
          || String(existing.starts_at) !== slot.starts_at
          || String(existing.ends_at) !== slot.ends_at
          || Number(existing.required_people) !== slot.required_people
        )
      ) {
        timingOrNameChanged = String(existing.starts_at) !== slot.starts_at
          || String(existing.ends_at) !== slot.ends_at
          || String(existing.name) !== slot.name

        changedFields = pickChangedFields([
          { field: 'name', from: existing.name, to: slot.name },
          { field: 'start', from: formatLocalDateTime(existing.starts_at), to: formatLocalDateTime(slot.starts_at) },
          { field: 'end', from: formatLocalDateTime(existing.ends_at), to: formatLocalDateTime(slot.ends_at) },
        ])

        await query(
          `UPDATE event_shift_slots
           SET name = ?, description = ?, starts_at = ?, ends_at = ?, required_people = ?
           WHERE id = ? AND event_id = ?`,
          [
            slot.name,
            slot.description,
            slot.starts_at,
            slot.ends_at,
            slot.required_people,
            shiftId,
            eventId,
          ],
          conn,
        )
      }
    } else {
      const result: any = await query(
        `INSERT INTO event_shift_slots (event_id, name, description, starts_at, ends_at, required_people)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          slot.name,
          slot.description,
          slot.starts_at,
          slot.ends_at,
          slot.required_people,
        ],
        conn,
      )
      shiftId = Number(result.insertId)
    }

    const memberRows = await query<{ member_id: number }[]>(
      `SELECT member_id
       FROM event_shift_members
       WHERE shift_id = ?`,
      [shiftId],
      conn,
    )

    const existingMemberIds = memberRows.map(row => Number(row.member_id))
    const addedMemberIds = slot.member_ids.filter(id => !existingMemberIds.includes(id))
    const removedMemberIds = existingMemberIds.filter(id => !slot.member_ids.includes(id))
    const keptMemberIds = slot.member_ids.filter(id => existingMemberIds.includes(id))

    const entry = shiftEntry(shiftId, slot)
    for (const memberId of addedMemberIds) shiftChanges.push({ memberId, entry: { ...entry, change: 'added' } })
    for (const memberId of removedMemberIds) shiftChanges.push({ memberId, entry: { ...entry, change: 'removed' } })

    if (timingOrNameChanged) {
      for (const memberId of keptMemberIds) shiftChanges.push({ memberId, entry: { ...entry, change: 'changed', changes: changedFields } })
      await dropFutureReminders({ type: 'shift.reminder', entityId: shiftId }, conn)
    }

    await syncShiftMembers({
      shiftId,
      existingIds: existingMemberIds,
      nextIds: slot.member_ids,
      conn,
    })
  }

  await queueShiftChanges({
    event: { id: eventId, name: eventRow?.name ?? '', location: eventRow?.location ?? null },
    changes: shiftChanges,
    actingUserId: actingUserId ?? null,
    conn,
  })

  return null
}

export async function addSelfToShift({
  eventId,
  shiftId,
  memberId,
  conn,
}: {
  eventId: number
  shiftId: number
  memberId: number
  conn: mariadb.PoolConnection
}) {
  const rows = await query<{ id: number }[]>(
    `SELECT id
     FROM event_shift_slots
     WHERE id = ? AND event_id = ?
     LIMIT 1`,
    [shiftId, eventId],
    conn,
  )
  if (!rows[0]) return 'Shift not found'

  await query(
    `INSERT IGNORE INTO event_shift_members (shift_id, member_id)
     VALUES (?, ?)`,
    [shiftId, memberId],
    conn,
  )

  return null
}

export async function removeSelfFromShift({
  eventId,
  shiftId,
  memberId,
  conn,
}: {
  eventId: number
  shiftId: number
  memberId: number
  conn: mariadb.PoolConnection
}) {
  const rows = await query<{ id: number }[]>(
    `SELECT id
     FROM event_shift_slots
     WHERE id = ? AND event_id = ?
     LIMIT 1`,
    [shiftId, eventId],
    conn,
  )
  if (!rows[0]) return 'Shift not found'

  await query(
    `DELETE FROM event_shift_members
     WHERE shift_id = ? AND member_id = ?`,
    [shiftId, memberId],
    conn,
  )

  return null
}
