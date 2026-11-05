import { MAX_POSITION_ASSIGNMENTS } from '~/server/utils/api/limits'
import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { getMemberLabels } from '~/server/utils/subdivisions'
import { getPositionPermissionKeys, permissionsBeyond } from '~/server/utils/permissions'
import type { PermissionKey } from '~/config/permissions'

interface NamedRow {
  id: number
  label: string
}

interface PositionStateInfoRow {
  id: number
  is_active: number
}

export interface PositionAssignmentRow {
  id: number
  member_id: number
  position_id: number
  since: string
  until: string | null
}

export interface PositionAssignmentInput {
  id?: number
  member_id: number
  position_id: number
  since: string
  until: string | null
}

interface SyncPositionAssignmentsOptions {
  scope: 'member' | 'position'
  ownerId: number
  existingAssignments: PositionAssignmentRow[]
  incomingAssignments: PositionAssignmentInput[]
  userId: number
  /** Effective permissions of the acting user — changing assignments is privileged (SEC-01). */
  actorPermissions: readonly PermissionKey[]
  conn: mariadb.PoolConnection
}

export function normalizePositionAssignments(
  value: unknown,
  fixed: Partial<Pick<PositionAssignmentInput, 'member_id' | 'position_id'>> = {},
) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_POSITION_ASSIGNMENTS) return null

  const normalized: PositionAssignmentInput[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue

    const source = entry as Record<string, unknown>
    const id = Number(source.id)
    const memberId = Number(source.member_id ?? fixed.member_id ?? 0)
    const positionId = Number(source.position_id ?? fixed.position_id ?? 0)
    const since = String(source.since || '').trim()
    const untilValue = source.until
    const until = untilValue ? String(untilValue).trim() : null

    if (!memberId || !positionId || !since) continue

    normalized.push({
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      member_id: memberId,
      position_id: positionId,
      since,
      until: until || null,
    })
  }

  return normalized
}

function sameDay(left: unknown, right: unknown) {
  return String(left ?? '').slice(0, 10) === String(right ?? '').slice(0, 10)
}

function assignmentChanged(existing: PositionAssignmentRow, incoming: PositionAssignmentInput) {
  return Number(existing.member_id) !== Number(incoming.member_id)
    || Number(existing.position_id) !== Number(incoming.position_id)
    || !sameDay(existing.since, incoming.since)
    || !sameDay(existing.until, incoming.until)
}

export const POSITION_ASSIGN_FORBIDDEN = 'Du hast keine Berechtigung, Positionen zuzuweisen oder zu ändern.'
export const POSITION_ASSIGN_EXCEEDS_OWN = 'Diese Position gewährt Rechte, die du selbst nicht hast. Nur wer Berechtigungen verwalten darf, kann sie zuweisen.'

/**
 * Position assignments grant the position's permissions to the member's linked account, so any
 * change needs `positions.assign`; handing out (or extending) a position whose permissions go
 * beyond the caller's own additionally needs `permissions.manage`. Unchanged rows are free, so
 * member editors can still save the rest of the record.
 */
export async function authorizePositionAssignmentChanges(options: {
  existingAssignments: PositionAssignmentRow[]
  incomingAssignments: PositionAssignmentInput[]
  actorPermissions: readonly PermissionKey[]
  conn?: mariadb.PoolConnection
}): Promise<string | null> {
  const existingById = new Map(options.existingAssignments.map(assignment => [Number(assignment.id), assignment]))
  const grantedPositionIds = new Set<number>()
  const retained = new Set<number>()
  let anyChange = false

  for (const incoming of options.incomingAssignments) {
    const existing = incoming.id ? existingById.get(Number(incoming.id)) : undefined
    if (existing) {
      retained.add(Number(existing.id))
      if (!assignmentChanged(existing, incoming)) continue
    }
    anyChange = true
    grantedPositionIds.add(Number(incoming.position_id))
  }
  if (options.existingAssignments.some(assignment => !retained.has(Number(assignment.id)))) anyChange = true

  if (!anyChange) return null
  if (!options.actorPermissions.includes('positions.assign')) return POSITION_ASSIGN_FORBIDDEN
  if (options.actorPermissions.includes('permissions.manage') || !grantedPositionIds.size) return null

  const permissionsByPosition = await getPositionPermissionKeys(Array.from(grantedPositionIds), options.conn)
  for (const keys of permissionsByPosition.values()) {
    if (permissionsBeyond(keys, options.actorPermissions).length) return POSITION_ASSIGN_EXCEEDS_OWN
  }
  return null
}

function formatAssignmentDateRange(assignment: Pick<PositionAssignmentInput, 'since' | 'until'>) {
  return `${assignment.since} - ${assignment.until || 'open-ended'}`
}

function assignmentOverlapScopeLabel(
  scope: SyncPositionAssignmentsOptions['scope'],
  assignment: PositionAssignmentInput,
  memberLabels: Map<number, string>,
  positionLabels: Map<number, string>,
) {
  if (scope === 'member') {
    return positionLabels.get(assignment.position_id) ?? `#${assignment.position_id}`
  }

  return memberLabels.get(assignment.member_id) ?? `#${assignment.member_id}`
}

function rangesOverlap(left: PositionAssignmentInput, right: PositionAssignmentInput) {
  const leftUntil = left.until || '9999-12-31'
  const rightUntil = right.until || '9999-12-31'

  return left.since <= rightUntil && right.since <= leftUntil
}

function validatePositionAssignmentRanges(
  assignments: PositionAssignmentInput[],
  scope: SyncPositionAssignmentsOptions['scope'],
  memberLabels: Map<number, string>,
  positionLabels: Map<number, string>,
) {
  const groupedAssignments = new Map<string, PositionAssignmentInput[]>()

  for (const assignment of assignments) {
    if (assignment.until && assignment.until < assignment.since) {
      const label = assignmentOverlapScopeLabel(scope, assignment, memberLabels, positionLabels)
      return `${label}: end date cannot be before start date`
    }

    const key = `${assignment.member_id}:${assignment.position_id}`
    const bucket = groupedAssignments.get(key) ?? []
    bucket.push(assignment)
    groupedAssignments.set(key, bucket)
  }

  for (const bucket of groupedAssignments.values()) {
    const sortedAssignments = bucket
      .slice()
      .sort((left, right) => {
        if (left.since !== right.since) return left.since.localeCompare(right.since)
        return (left.until || '9999-12-31').localeCompare(right.until || '9999-12-31')
      })

    for (let index = 1; index < sortedAssignments.length; index += 1) {
      const previous = sortedAssignments[index - 1]!
      const current = sortedAssignments[index]!
      if (!rangesOverlap(previous, current)) continue

      const label = assignmentOverlapScopeLabel(scope, current, memberLabels, positionLabels)
      return `${label}: assignment periods must not overlap (${formatAssignmentDateRange(previous)} and ${formatAssignmentDateRange(current)})`
    }
  }

  return null
}

export async function getPositionLabels(
  positionIds: number[],
  conn: mariadb.PoolConnection,
) {
  if (!positionIds.length) return new Map<number, string>()

  const rows = await query<NamedRow[]>(
    `SELECT id, TRIM(CONCAT(code, ' - ', name)) AS label
     FROM positions
     WHERE id IN (${positionIds.map(() => '?').join(',')})`,
    positionIds,
    conn,
  )

  return new Map(rows.map(row => [Number(row.id), String(row.label)]))
}

export async function syncPositionAssignments({
  scope,
  ownerId,
  existingAssignments,
  incomingAssignments,
  userId,
  actorPermissions,
  conn,
}: SyncPositionAssignmentsOptions) {
  const authorizationError = await authorizePositionAssignmentChanges({
    existingAssignments,
    incomingAssignments,
    actorPermissions,
    conn,
  })
  if (authorizationError) return { ok: false as const, error: authorizationError }

  const memberIds = Array.from(new Set([
    ...existingAssignments.map(assignment => Number(assignment.member_id)),
    ...incomingAssignments.map(assignment => Number(assignment.member_id)),
  ]))
  const positionIds = Array.from(new Set([
    ...existingAssignments.map(assignment => Number(assignment.position_id)),
    ...incomingAssignments.map(assignment => Number(assignment.position_id)),
  ]))

  const [memberLabels, positionLabels] = await Promise.all([
    getMemberLabels(memberIds, conn),
    getPositionLabels(positionIds, conn),
  ])

  if (memberLabels.size !== memberIds.length) {
    return { ok: false as const, error: 'One or more selected members do not exist' }
  }

  if (positionLabels.size !== positionIds.length) {
    return { ok: false as const, error: 'One or more selected positions do not exist' }
  }

  const rangeValidationError = validatePositionAssignmentRanges(
    incomingAssignments,
    scope,
    memberLabels,
    positionLabels,
  )
  if (rangeValidationError) {
    return { ok: false as const, error: rangeValidationError }
  }

  const existingById = new Map(existingAssignments.map(assignment => [assignment.id, assignment]))
  const retainedIds = new Set<number>()
  const positionStateRows = positionIds.length
    ? await query<PositionStateInfoRow[]>(
        `SELECT id, is_active
         FROM positions
         WHERE id IN (${positionIds.map(() => '?').join(',')})`,
        positionIds,
        conn,
      )
    : []
  const activePositionIds = new Set(
    positionStateRows
      .filter(row => Boolean(row.is_active))
      .map(row => Number(row.id))
      .filter(id => Number.isFinite(id)),
  )

  const inactiveAssignment = incomingAssignments.find((assignment) => {
    if (activePositionIds.has(Number(assignment.position_id))) return false
    return !assignment.id || !existingById.has(assignment.id)
  })
  if (inactiveAssignment) {
    const positionLabel = positionLabels.get(Number(inactiveAssignment.position_id))
      ?? `#${inactiveAssignment.position_id}`
    return { ok: false as const, error: `${positionLabel}: inactive positions cannot receive new assignments` }
  }

  for (const incoming of incomingAssignments) {
    if (!incoming.id || !existingById.has(incoming.id)) continue

    const existing = existingById.get(incoming.id)!
    retainedIds.add(existing.id)

    await query(
      `UPDATE member_positions
       SET member_id = ?, position_id = ?, since = ?, until = ?
       WHERE id = ?`,
      [incoming.member_id, incoming.position_id, incoming.since, incoming.until || null, existing.id],
      conn,
    )
  }

  for (const existing of existingAssignments) {
    if (retainedIds.has(existing.id)) continue

    await query(
      `DELETE FROM member_positions
       WHERE id = ?`,
      [existing.id],
      conn,
    )
  }

  for (const incoming of incomingAssignments) {
    if (incoming.id && existingById.has(incoming.id)) continue

    await query(
      `INSERT INTO member_positions (member_id, position_id, since, until)
       VALUES (?, ?, ?, ?)`,
      [incoming.member_id, incoming.position_id, incoming.since, incoming.until || null],
      conn,
    )
  }

  return { ok: true as const }
}
