import { isSingleEmailAddress } from '~/shared/email'
import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { getPositionLabels, type PositionAssignmentRow } from '~/server/utils/positions'
import { getSubdivisionLabels, syncSubdivisionAssignments } from '~/server/utils/subdivisions'
import {
  MemberStatus,
  type MemberStatusActionAccountChange,
  type MemberStatusActionPositionClose,
  type MemberStatusActionPositionRemoval,
  type MemberStatusActionSubdivisionChange,
  type MemberStatusActionSummary,
  type SaveMemberBody,
} from '~/types/member'
import { appTodayLocalDate } from '~/server/utils/time'

export function isMemberStatus(value: unknown): value is MemberStatus {
  return value === MemberStatus.Active
    || value === MemberStatus.Passive
    || value === MemberStatus.Hold
    || value === MemberStatus.Left
}

export function parseMemberStatus(value: unknown): MemberStatus {
  return isMemberStatus(value) ? value : MemberStatus.Active
}

/** Column sizes of `members` (db/init.sql); longer values would be cut or rejected by the DB. */
const MEMBER_FIELD_MAX_LENGTH: Record<string, number> = {
  first_name: 127,
  last_name: 127,
  street: 255,
  street_number: 20,
  postal_code: 20,
  city: 127,
  phone: 63,
  email: 254,
}

/** Per-field check shared by the member editor and the members' own self-edit (SEC-28). */
export function memberFieldError(field: string, value: unknown): string | null {
  const max = MEMBER_FIELD_MAX_LENGTH[field]
  if (max === undefined) return null
  if (typeof value !== 'string' || !value.trim()) return `Missing value for ${field}`
  if (value.length > max) return `Der Wert für ${field} ist zu lang (höchstens ${max} Zeichen).`
  if (field === 'email' && !isSingleEmailAddress(value)) return 'Bitte genau eine gültige E-Mail-Adresse angeben.'
  return null
}

export function validateMemberPayload(body: SaveMemberBody) {
  if (!body.first_name || !body.last_name || !body.birthdate || !body.street || !body.street_number || !body.postal_code || !body.city || !body.phone || !body.email || !body.status || !body.applied_at || !body.joined_at || !body.subject_name?.trim()) {
    return 'Missing fields'
  }
  for (const field of Object.keys(MEMBER_FIELD_MAX_LENGTH)) {
    const fieldError = memberFieldError(field, (body as unknown as Record<string, unknown>)[field])
    if (fieldError) return fieldError
  }
  if (!isMemberStatus(body.status)) return 'Invalid status'
  if (body.status === MemberStatus.Left && !body.left_at) return 'Status left requires left_at'
  if (body.status !== MemberStatus.Left && body.left_at) return 'left_at is only allowed with status left'
  return null
}

export async function ensureSubjectId(subjectName: string, conn: mariadb.PoolConnection) {
  const name = subjectName.trim()

  const existing = await query<{ id: number }[]>(
    `SELECT id FROM subjects WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [name],
    conn,
  )

  if (existing.length) return Number(existing[0]!.id)

  const created = await query<any>(
    `INSERT INTO subjects (name) VALUES (?)`,
    [name],
    conn,
  )

  return Number(created.insertId)
}

interface ApplyMemberStatusActionsOptions {
  memberId: number
  accountId: number | null
  previousStatus: MemberStatus
  nextStatus: MemberStatus
  leftAt: string | null
  memberLabel: string
  userId: number
  /**
   * false = the acting user may not deactivate the linked account (SEC-19); the account stays
   * active and the summary reports it as skipped.
   */
  deactivateAccount?: boolean
  conn: mariadb.PoolConnection
}

interface UserAccountStateRow {
  id: number
  username: string
  is_active: number | boolean
}

function isTruthyDbBoolean(value: number | boolean) {
  return value === true || value === 1
}

function memberPositionAssignmentSummary(
  assignment: PositionAssignmentRow,
  positionLabels: Map<number, string>,
) {
  const positionLabel = positionLabels.get(assignment.position_id) ?? String(assignment.position_id)
  const until = assignment.until || '-'

  return `${positionLabel} (${assignment.since} - ${until})`
}

async function deactivateLinkedAccount(
  accountId: number | null,
  userId: number,
  conn: mariadb.PoolConnection,
): Promise<MemberStatusActionAccountChange | null> {
  if (!accountId) return null

  const accountRows = await query<UserAccountStateRow[]>(
    `SELECT id, username, is_active
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [accountId],
    conn,
  )

  const account = accountRows[0]
  if (!account || !isTruthyDbBoolean(account.is_active)) return null

  await query(
    `UPDATE users
     SET is_active = 0
     WHERE id = ?`,
    [account.id],
    conn,
  )
  // A deactivated account loses its push subscriptions — the only automatic removal (SEC-20).
  await query('DELETE FROM notification_push_subscriptions WHERE user_id = ?', [account.id], conn)

  return {
    id: Number(account.id),
    username: String(account.username),
  }
}

async function activeAccountSummary(accountId: number, conn: mariadb.PoolConnection): Promise<MemberStatusActionAccountChange | null> {
  const [account] = await query<UserAccountStateRow[]>(
    `SELECT id, username, is_active FROM users WHERE id = ? LIMIT 1`,
    [accountId],
    conn,
  )
  if (!account || !isTruthyDbBoolean(account.is_active)) return null
  return { id: Number(account.id), username: String(account.username) }
}

async function removeMemberFromAllSubdivisions(
  memberId: number,
  memberLabel: string,
  userId: number,
  conn: mariadb.PoolConnection,
): Promise<MemberStatusActionSubdivisionChange[]> {
  const subdivisionRows = await query<{ subdivision_id: number }[]>(
    `SELECT subdivision_id
     FROM subdivision_members
     WHERE member_id = ?`,
    [memberId],
    conn,
  )

  const subdivisionIds = subdivisionRows.map(row => Number(row.subdivision_id))
  if (!subdivisionIds.length) return []

  const subdivisionLabels = await getSubdivisionLabels(subdivisionIds, conn)

  await syncSubdivisionAssignments({
    existingIds: subdivisionIds,
    nextIds: [],
    getAssignment: (subdivisionId) => ({
      subdivisionId,
      memberId,
      memberLabel,
    }),
    userId,
    conn,
  })

  return subdivisionIds.map((subdivisionId) => ({
    id: subdivisionId,
    label: subdivisionLabels.get(subdivisionId) ?? String(subdivisionId),
  }))
}

async function closeMemberPositionsAfterLeftDate(
  memberId: number,
  leftAt: string,
  userId: number,
  conn: mariadb.PoolConnection,
): Promise<{
  closed_positions: MemberStatusActionPositionClose[]
  removed_positions: MemberStatusActionPositionRemoval[]
}> {
  const positionsToRemove = await query<PositionAssignmentRow[]>(
    `SELECT id, member_id, position_id, since, until
     FROM member_positions
     WHERE member_id = ?
       AND since > ?`,
    [memberId, leftAt],
    conn,
  )

  const positionsToTruncate = await query<PositionAssignmentRow[]>(
    `SELECT id, member_id, position_id, since, until
     FROM member_positions
     WHERE member_id = ?
       AND since <= ?
       AND (until IS NULL OR until > ?)`,
    [memberId, leftAt, leftAt],
    conn,
  )

  const positionIds = Array.from(new Set([
    ...positionsToRemove.map(position => Number(position.position_id)),
    ...positionsToTruncate.map(position => Number(position.position_id)),
  ]))
  const positionLabels = await getPositionLabels(positionIds, conn)
  const removedPositions: MemberStatusActionPositionRemoval[] = positionsToRemove.map(position => ({
    id: Number(position.id),
    label: positionLabels.get(Number(position.position_id)) ?? String(position.position_id),
    since: String(position.since),
    until: position.until ? String(position.until) : null,
  }))
  const closedPositions: MemberStatusActionPositionClose[] = positionsToTruncate.map(position => ({
    id: Number(position.id),
    label: positionLabels.get(Number(position.position_id)) ?? String(position.position_id),
    since: String(position.since),
    previous_until: position.until ? String(position.until) : null,
    until: leftAt,
  }))

  if (positionsToRemove.length) {
    await query(
      `DELETE FROM member_positions
       WHERE member_id = ?
         AND since > ?`,
      [memberId, leftAt],
      conn,
    )
  }

  if (!positionsToTruncate.length) {
    return {
      closed_positions: closedPositions,
      removed_positions: removedPositions,
    }
  }

  await query(
    `UPDATE member_positions
     SET until = ?
     WHERE member_id = ?
       AND since <= ?
       AND (until IS NULL OR until > ?)`,
    [leftAt, memberId, leftAt, leftAt],
    conn,
  )

  return {
    closed_positions: closedPositions,
    removed_positions: removedPositions,
  }
}

export async function applyMemberLeftStatusActions({
  memberId,
  accountId,
  leftAt,
  memberLabel,
  userId,
  deactivateAccount = true,
  conn,
}: Omit<ApplyMemberStatusActionsOptions, 'previousStatus' | 'nextStatus'> & { leftAt: string }): Promise<MemberStatusActionSummary> {
  const accountDeactivated = deactivateAccount ? await deactivateLinkedAccount(accountId, userId, conn) : null
  const accountDeactivationSkipped = !deactivateAccount && accountId ? await activeAccountSummary(accountId, conn) : null
  const removedSubdivisions = await removeMemberFromAllSubdivisions(memberId, memberLabel, userId, conn)
  const positionChanges = await closeMemberPositionsAfterLeftDate(memberId, leftAt, userId, conn)

  return {
    left_at: leftAt,
    account_deactivated: accountDeactivated,
    account_deactivation_skipped: accountDeactivationSkipped,
    removed_subdivisions: removedSubdivisions,
    closed_positions: positionChanges.closed_positions,
    removed_positions: positionChanges.removed_positions,
  }
}

async function isLeftDateDue(leftAt: string, conn?: mariadb.PoolConnection) {
  return String(leftAt).slice(0, 10) <= await appTodayLocalDate(conn)
}

export async function applyMemberStatusActions({
  memberId,
  accountId,
  previousStatus,
  nextStatus,
  leftAt,
  memberLabel,
  userId,
  deactivateAccount = true,
  conn,
}: ApplyMemberStatusActionsOptions): Promise<MemberStatusActionSummary | null> {
  if (previousStatus === MemberStatus.Left || nextStatus !== MemberStatus.Left || !leftAt) {
    return null
  }

  if (!await isLeftDateDue(leftAt, conn)) {
    return null
  }

  return applyMemberLeftStatusActions({
    memberId,
    accountId,
    leftAt,
    memberLabel,
    userId,
    deactivateAccount,
    conn,
  })
}
