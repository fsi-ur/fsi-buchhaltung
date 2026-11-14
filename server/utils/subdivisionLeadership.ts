import type * as mariadb from 'mariadb'
import type { H3Event } from 'h3'
import { query } from '~/server/utils/db'
import { appTodayLocalDate } from '~/server/utils/time'
import { requireAuth } from '~/server/utils/api/guards'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import {
  expandSubdivisionPermissions,
  isSubdivisionPermissionKey,
  type SubdivisionPermissionKey,
  type SubdivisionPermissionMap,
} from '~/config/subdivisionPermissions'
import { canViewSubdivisionMembers, resolveSubdivisionAccess, subdivisionPermissionsBeyond, type SubdivisionAccess } from '~/shared/subdivisionAccess'
import { addDaysToLocalDate, isLocalDate, type LocalDate } from '~/shared/time'
import { getPositionPermissionKeys, getPositionSubdivisionPermissionKeys, permissionsBeyond } from '~/server/utils/permissions'
import type { User } from '~/types/user'
import { MemberStatus } from '~/types/member'
import type {
  LeadershipAction,
  LeadershipCandidate,
  LeadershipPositionOption,
  LeadershipSubdivision,
} from '~/types/subdivisionLeadership'

type Conn = mariadb.PoolConnection

export const LEADERSHIP_NOT_AUTHORIZED = 'Not authorized'
export const LEADERSHIP_SELF_FORBIDDEN = 'Du kannst deine eigene Mitgliedschaft oder deine eigenen Positionen in dieser Untergliederung nicht ändern.'

/**
 * Scoped permissions per subdivision from the user's *current* subdivision-bound positions. Only
 * active positions in active subdivisions count, mirroring how global position permissions are read.
 */
export async function getUserSubdivisionPermissions(userId: number, conn?: Conn): Promise<SubdivisionPermissionMap> {
  const today = await appTodayLocalDate(conn)
  const rows = await query<Array<{ subdivision_id: number, permission_key: string }>>(
    `SELECT DISTINCT mp.subdivision_id, pp.permission_key
     FROM members m
     JOIN member_positions mp ON mp.member_id = m.id
     JOIN positions p ON p.id = mp.position_id AND p.is_active = 1 AND p.subdivision_bound = 1
     JOIN subdivisions s ON s.id = mp.subdivision_id AND s.is_active = 1
     JOIN position_permissions pp ON pp.position_id = p.id
     WHERE m.account = ?
       AND mp.subdivision_id IS NOT NULL
       AND mp.since <= ?
       AND (mp.until IS NULL OR mp.until >= ?)`,
    [userId, today, today],
    conn,
  )

  const map: SubdivisionPermissionMap = {}
  for (const row of rows) {
    if (!isSubdivisionPermissionKey(row.permission_key)) continue
    const subdivisionId = Number(row.subdivision_id)
    const bucket = map[subdivisionId] ?? []
    bucket.push(row.permission_key)
    map[subdivisionId] = bucket
  }
  for (const id of Object.keys(map)) map[Number(id)] = expandSubdivisionPermissions(map[Number(id)]!)
  return map
}

export async function getSubdivisionAccess(user: User, subdivisionId: number, conn?: Conn): Promise<SubdivisionAccess> {
  const scoped = await getUserSubdivisionPermissions(Number(user.id), conn)
  return resolveSubdivisionAccess(user.permissions, scoped, subdivisionId)
}

/**
 * Like `requirePermission`, for a permission that only holds inside one subdivision. `null` asks
 * for read access (any scoped permission there, or subdivisions.leadership.view).
 */
export async function requireSubdivisionPermission(
  event: H3Event,
  key: SubdivisionPermissionKey | null,
  subdivisionId: number,
  options: { touch?: boolean } = {},
) {
  const current = await requireAuth(event, { touch: options.touch })
  if (!current.ok) return current
  if (!Number.isInteger(subdivisionId) || subdivisionId <= 0) return { ok: false as const, error: 'Missing subdivision id' }

  const subdivision = await query<Array<{ id: number, is_active: number }>>(
    `SELECT id, is_active FROM subdivisions WHERE id = ? LIMIT 1`,
    [subdivisionId],
  )
  if (!subdivision.length || !subdivision[0]!.is_active) return { ok: false as const, error: LEADERSHIP_NOT_AUTHORIZED }

  const access = await getSubdivisionAccess(current.user, subdivisionId)
  const allowed = key === null ? access.canView : access.permissions.includes(key)
  if (!allowed) return { ok: false as const, error: LEADERSHIP_NOT_AUTHORIZED }

  return { ok: true as const, user: current.user, access }
}

/** The member record linked to a user account, if any. */
export async function getLinkedMemberIdForUser(userId: number, conn?: Conn): Promise<number | null> {
  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM members WHERE account = ? LIMIT 1`,
    [userId],
    conn,
  )
  return rows.length ? Number(rows[0]!.id) : null
}

export async function isSubdivisionMember(memberId: number, subdivisionId: number, conn?: Conn): Promise<boolean> {
  const rows = await query<Array<{ member_id: number }>>(
    `SELECT member_id FROM subdivision_members WHERE subdivision_id = ? AND member_id = ? LIMIT 1`,
    [subdivisionId, memberId],
    conn,
  )
  return rows.length > 0
}

/** Holding a subdivision-bound position implies membership in that subdivision. */
export async function ensureSubdivisionMembership(memberId: number, subdivisionId: number, conn: Conn) {
  if (await isSubdivisionMember(memberId, subdivisionId, conn)) return false
  await query(
    `INSERT INTO subdivision_members (subdivision_id, member_id) VALUES (?, ?)`,
    [subdivisionId, memberId],
    conn,
  )
  return true
}

/**
 * Leaving a subdivision ends every position the member holds there: running assignments end
 * yesterday (so their permissions are gone today, not at midnight), assignments that would only
 * start today or later are dropped. Past assignments stay as history.
 */
export async function endSubdivisionPositions(memberId: number, subdivisionId: number, conn: Conn, today?: LocalDate) {
  const currentDay = today ?? await appTodayLocalDate(conn)
  const yesterday = addDaysToLocalDate(currentDay, -1)
  const rows = await query<Array<{ id: number, since: string }>>(
    `SELECT id, since
     FROM member_positions
     WHERE member_id = ?
       AND subdivision_id = ?
       AND (until IS NULL OR until >= ?)`,
    [memberId, subdivisionId, currentDay],
    conn,
  )

  for (const row of rows) {
    if (String(row.since).slice(0, 10) > yesterday) {
      await query(`DELETE FROM member_positions WHERE id = ?`, [row.id], conn)
    } else {
      await query(`UPDATE member_positions SET until = ? WHERE id = ?`, [yesterday, row.id], conn)
    }
  }
  return rows.length
}

/** Active users holding `settings.subdivisions.manage` through a direct grant, an active role or a current position. */
export async function getSubdivisionAdminUserIds(conn?: Conn): Promise<number[]> {
  const today = await appTodayLocalDate(conn)
  const rows = await query<Array<{ id: number }>>(
    `SELECT u.id
     FROM users u
     WHERE u.is_active = 1
       AND (
         EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_key = 'settings.subdivisions.manage')
         OR EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.is_active = 1
           JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_key = 'settings.subdivisions.manage'
           WHERE ur.user_id = u.id
         )
         OR EXISTS (
           SELECT 1 FROM members m
           JOIN member_positions mp ON mp.member_id = m.id AND mp.since <= ? AND (mp.until IS NULL OR mp.until >= ?)
           JOIN positions p ON p.id = mp.position_id AND p.is_active = 1
           JOIN position_permissions pp ON pp.position_id = p.id AND pp.permission_key = 'settings.subdivisions.manage'
           WHERE m.account = u.id
         )
       )`,
    [today, today],
    conn,
  )
  return rows.map(row => Number(row.id))
}

/** Name shown as the actor: the linked member's name, else the username. */
export async function getActorName(user: User, conn?: Conn): Promise<string> {
  const rows = await query<Array<{ full_name: string }>>(
    `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS full_name FROM members WHERE account = ? LIMIT 1`,
    [user.id],
    conn,
  )
  return rows[0]?.full_name || user.username
}

const MEMBER_NOTIFICATION_TYPES: Partial<Record<LeadershipAction, 'subdivision.member_added' | 'subdivision.member_removed' | 'subdivision.position_assigned' | 'subdivision.position_ended'>> = {
  member_added: 'subdivision.member_added',
  member_removed: 'subdivision.member_removed',
  position_assigned: 'subdivision.position_assigned',
  position_ended: 'subdivision.position_ended',
}

/**
 * Tells the affected member and the subdivision admins about a change a leader made. Both are
 * ordinary notification types, so the association can switch them off and everyone can opt out in
 * their notification preferences.
 */
export async function notifyLeadershipChange(args: {
  action: LeadershipAction
  actor: User
  subdivisionId: number
  memberId: number
  position?: { name: string, since?: string | null, until?: string | null } | null
}, conn: Conn) {
  const [subdivisionRows, memberRows, actorName, adminIds] = await Promise.all([
    query<Array<{ name: string }>>(`SELECT name FROM subdivisions WHERE id = ? LIMIT 1`, [args.subdivisionId], conn),
    query<Array<{ full_name: string }>>(
      `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS full_name FROM members WHERE id = ? LIMIT 1`,
      [args.memberId],
      conn,
    ),
    getActorName(args.actor, conn),
    getSubdivisionAdminUserIds(conn),
  ])
  const subdivisionName = subdivisionRows[0]?.name ?? ''
  const affectedMember = memberRows[0]?.full_name ?? ''

  const memberType = MEMBER_NOTIFICATION_TYPES[args.action]
  if (memberType) {
    await enqueueNotification({
      type: memberType,
      payload: {
        subdivision_id: args.subdivisionId,
        subdivision_name: subdivisionName,
        actor_name: actorName,
        position_name: args.position?.name ?? null,
        position_since: args.position?.since ?? null,
        position_until: args.position?.until ?? null,
      },
      recipients: { kind: 'members', memberIds: [args.memberId] },
      createdByUserId: args.actor.id,
    }, conn)
  }

  // The acting admin does not need to hear about their own change.
  const recipients = adminIds.filter(id => id !== Number(args.actor.id))
  if (recipients.length) {
    await enqueueNotification({
      type: 'subdivision.leader_change',
      payload: {
        subdivision_id: args.subdivisionId,
        subdivision_name: subdivisionName,
        actor_name: actorName,
        affected_member: affectedMember,
        leader_action: args.action,
        position_name: args.position?.name ?? '',
      },
      recipients: { kind: 'users', userIds: recipients },
      createdByUserId: args.actor.id,
    }, conn)
  }
}


/** Tables the leadership history shows, each scoped by its own `subdivision_id` column. */
export const LEADERSHIP_HISTORY_TABLES = ['subdivision_members:subdivision_id', 'member_positions:subdivision_id']
export const LEADERSHIP_HISTORY_TABLE_NAMES = ['subdivision_members', 'member_positions']

function toMemberStatus(value: unknown): MemberStatus {
  return Object.values(MemberStatus).includes(value as MemberStatus) ? value as MemberStatus : MemberStatus.Active
}

function toDay(value: unknown): string {
  return String(value ?? '').slice(0, 10)
}

/**
 * Subdivisions the leadership page shows for this user, with members, the subdivision-bound
 * assignments and the scoped permissions the user holds in each. `subdivisions.leadership.view`
 * lists every active subdivision; otherwise only those the user leads.
 */
export async function loadLeadershipSubdivisions(user: User, scoped: SubdivisionPermissionMap): Promise<LeadershipSubdivision[]> {
  const seeAll = user.permissions.includes('subdivisions.leadership.view')
  const ledIds = Object.entries(scoped)
    .filter(([, keys]) => keys.length > 0)
    .map(([id]) => Number(id))
  if (!seeAll && !ledIds.length) return []

  const subdivisionRows = await query<Array<{ id: number, code: string, name: string, description: string | null }>>(
    `SELECT id, code, name, description
     FROM subdivisions
     WHERE is_active = 1
       ${seeAll ? '' : `AND id IN (${ledIds.map(() => '?').join(',')})`}
     ORDER BY name ASC, code ASC`,
    seeAll ? [] : ledIds,
  )
  if (!subdivisionRows.length) return []

  const ids = subdivisionRows.map(row => Number(row.id))
  const placeholders = ids.map(() => '?').join(',')
  const [memberRows, assignmentRows] = await Promise.all([
    query<Array<{
      subdivision_id: number
      id: number
      full_name: string
      subject_name: string | null
      email: string | null
      phone: string | null
      status: string
      account: number | null
    }>>(
      `SELECT sm.subdivision_id, m.id, TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name,
              sj.name AS subject_name, m.email, m.phone, m.status, m.account
       FROM subdivision_members sm
       JOIN members m ON m.id = sm.member_id
       LEFT JOIN subjects sj ON sj.id = m.subject
       WHERE sm.subdivision_id IN (${placeholders})
       ORDER BY m.last_name ASC, m.first_name ASC`,
      ids,
    ),
    query<Array<{
      id: number
      subdivision_id: number
      member_id: number
      member_name: string
      position_id: number
      position_name: string
      assignable_by_leaders: number
      since: string
      until: string | null
      account: number | null
    }>>(
      `SELECT mp.id, mp.subdivision_id, mp.member_id, TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS member_name,
              mp.position_id, p.name AS position_name, p.assignable_by_leaders, mp.since, mp.until, m.account
       FROM member_positions mp
       JOIN positions p ON p.id = mp.position_id
       JOIN members m ON m.id = mp.member_id
       WHERE mp.subdivision_id IN (${placeholders})
       ORDER BY mp.since DESC, m.last_name ASC, m.first_name ASC`,
      ids,
    ),
  ])

  const isSelf = (account: number | null) => account !== null && account !== undefined && Number(account) === Number(user.id)

  return subdivisionRows.map((row) => {
    const access = resolveSubdivisionAccess(user.permissions, scoped, Number(row.id))
    return {
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      permissions: access.permissions,
      // The member list (with contact data) needs subdivision.members.view; it is not sent otherwise.
      members: memberRows
        .filter(member => canViewSubdivisionMembers(user.permissions, access) && Number(member.subdivision_id) === Number(row.id))
        .map(member => ({
          id: Number(member.id),
          full_name: String(member.full_name),
          subject_name: member.subject_name ? String(member.subject_name) : null,
          email: member.email ? String(member.email) : null,
          phone: member.phone ? String(member.phone) : null,
          status: toMemberStatus(member.status),
          is_self: isSelf(member.account),
        })),
      assignments: assignmentRows
        .filter(assignment => Number(assignment.subdivision_id) === Number(row.id))
        .map(assignment => ({
          id: Number(assignment.id),
          member_id: Number(assignment.member_id),
          member_name: String(assignment.member_name),
          position_id: Number(assignment.position_id),
          position_name: String(assignment.position_name),
          since: toDay(assignment.since),
          until: assignment.until ? toDay(assignment.until) : null,
          assignable_by_leaders: Boolean(assignment.assignable_by_leaders),
          is_self: isSelf(assignment.account),
        })),
    }
  })
}

/** Active subdivision-bound positions that leaders may hand out. */
export async function loadLeaderAssignablePositions(): Promise<LeadershipPositionOption[]> {
  const rows = await query<Array<{ id: number, code: string, name: string }>>(
    `SELECT id, code, name
     FROM positions
     WHERE is_active = 1 AND subdivision_bound = 1 AND assignable_by_leaders = 1
     ORDER BY name ASC`,
  )
  return rows.map(row => ({ id: Number(row.id), code: String(row.code), name: String(row.name) }))
}

/** Members (not left) who are not yet in the subdivision — with what a leader needs to tell them apart. */
export async function loadLeadershipCandidates(subdivisionId: number): Promise<LeadershipCandidate[]> {
  const rows = await query<Array<{ id: number, full_name: string, subject_name: string | null, email: string | null, phone: string | null }>>(
    `SELECT m.id, TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name, sj.name AS subject_name, m.email, m.phone
     FROM members m
     LEFT JOIN subjects sj ON sj.id = m.subject
     WHERE m.status != 'left'
       AND NOT EXISTS (
         SELECT 1 FROM subdivision_members sm WHERE sm.subdivision_id = ? AND sm.member_id = m.id
       )
     ORDER BY m.last_name ASC, m.first_name ASC`,
    [subdivisionId],
  )
  return rows.map(row => ({
    id: Number(row.id),
    full_name: String(row.full_name),
    subject_name: row.subject_name ? String(row.subject_name) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
  }))
}

export const LEADERSHIP_ERRORS = {
  memberNotFound: 'Das Mitglied wurde nicht gefunden.',
  alreadyMember: 'Das Mitglied gehört der Untergliederung bereits an.',
  notMember: 'Das Mitglied gehört der Untergliederung nicht an.',
  memberLeft: 'Ausgetretene Mitglieder können nicht hinzugefügt werden.',
  protectedPosition: 'Dieses Mitglied hat in der Untergliederung eine Position, die nur die Verwaltung ändern kann. Es kann daher hier nicht entfernt werden.',
  positionNotAssignable: 'Diese Position kann von Leitungen nicht vergeben werden.',
  assignmentNotFound: 'Die Zuweisung wurde nicht gefunden.',
  assignmentEnded: 'Die Zuweisung ist bereits beendet.',
  invalidDates: 'Bitte gib ein gültiges Beginndatum an; das Ende darf nicht vor dem Beginn liegen.',
  overlap: 'Das Mitglied hat diese Position in diesem Zeitraum bereits.',
  exceedsOwn: 'Diese Position gewährt Rechte, die du selbst nicht hast.',
  memberChange: 'Eine bestehende Zuweisung kann nicht auf ein anderes Mitglied übertragen werden.',
} as const

export type LeadershipResult = { ok: true } | { ok: false, error: string }

export async function addLeadershipMember(actor: User, subdivisionId: number, memberId: number, conn: Conn): Promise<LeadershipResult> {
  const rows = await query<Array<{ status: string }>>(`SELECT status FROM members WHERE id = ? LIMIT 1`, [memberId], conn)
  if (!rows.length) return { ok: false, error: LEADERSHIP_ERRORS.memberNotFound }
  if (rows[0]!.status === MemberStatus.Left) return { ok: false, error: LEADERSHIP_ERRORS.memberLeft }
  if (await isSubdivisionMember(memberId, subdivisionId, conn)) return { ok: false, error: LEADERSHIP_ERRORS.alreadyMember }

  await query(`INSERT INTO subdivision_members (subdivision_id, member_id) VALUES (?, ?)`, [subdivisionId, memberId], conn)
  await notifyLeadershipChange({ action: 'member_added', actor, subdivisionId, memberId }, conn)
  return { ok: true }
}

export async function removeLeadershipMember(actor: User, subdivisionId: number, memberId: number, conn: Conn): Promise<LeadershipResult> {
  if (await getLinkedMemberIdForUser(Number(actor.id), conn) === memberId) return { ok: false, error: LEADERSHIP_SELF_FORBIDDEN }
  if (!await isSubdivisionMember(memberId, subdivisionId, conn)) return { ok: false, error: LEADERSHIP_ERRORS.notMember }

  // A leader must not push a co-leader out: removal would end a position only the admins hand out.
  const today = await appTodayLocalDate(conn)
  const protectedRows = await query<Array<{ id: number }>>(
    `SELECT mp.id
     FROM member_positions mp
     JOIN positions p ON p.id = mp.position_id
     WHERE mp.member_id = ? AND mp.subdivision_id = ?
       AND p.assignable_by_leaders = 0
       AND (mp.until IS NULL OR mp.until >= ?)
     LIMIT 1`,
    [memberId, subdivisionId, today],
    conn,
  )
  if (protectedRows.length) return { ok: false, error: LEADERSHIP_ERRORS.protectedPosition }

  await query(`DELETE FROM subdivision_members WHERE subdivision_id = ? AND member_id = ?`, [subdivisionId, memberId], conn)
  await endSubdivisionPositions(memberId, subdivisionId, conn, today)
  await notifyLeadershipChange({ action: 'member_removed', actor, subdivisionId, memberId }, conn)
  return { ok: true }
}

interface LeaderPositionRow {
  id: number
  name: string
  is_active: number
  subdivision_bound: number
  assignable_by_leaders: number
}

async function loadLeaderPosition(positionId: number, conn: Conn): Promise<LeaderPositionRow | null> {
  const rows = await query<LeaderPositionRow[]>(
    `SELECT id, name, is_active, subdivision_bound, assignable_by_leaders FROM positions WHERE id = ? LIMIT 1`,
    [positionId],
    conn,
  )
  return rows[0] ?? null
}

/**
 * A leader may only hand out what they hold themselves: the position's global permissions must be
 * covered by the leader's own, its scoped ones by what the leader holds in this subdivision.
 */
async function leaderMayGrantPosition(actor: User, access: SubdivisionAccess, positionId: number, conn: Conn): Promise<boolean> {
  if (actor.permissions.includes('permissions.manage')) return true
  const [globalKeys, scopedKeys] = await Promise.all([
    getPositionPermissionKeys([positionId], conn),
    getPositionSubdivisionPermissionKeys([positionId], conn),
  ])
  if (permissionsBeyond(globalKeys.get(positionId) ?? [], actor.permissions).length) return false
  // Each scoped key (implications included) must be held here already, or be covered by the
  // leader's global permissions.
  return subdivisionPermissionsBeyond(scopedKeys.get(positionId) ?? [], actor.permissions, access.permissions).length === 0
}

function rangesOverlap(left: { since: string, until: string | null }, right: { since: string, until: string | null }) {
  return left.since <= (right.until || '9999-12-31') && right.since <= (left.until || '9999-12-31')
}

export interface LeadershipAssignmentInput {
  id?: number | null
  member_id: number
  position_id: number
  since: unknown
  until: unknown
}

export async function saveLeadershipAssignment(
  actor: User,
  access: SubdivisionAccess,
  subdivisionId: number,
  input: LeadershipAssignmentInput,
  conn: Conn,
): Promise<LeadershipResult> {
  const since = isLocalDate(input.since) ? String(input.since).trim() : null
  const untilRaw = input.until === null || input.until === undefined || input.until === '' ? null : input.until
  const until = untilRaw === null ? null : (isLocalDate(untilRaw) ? String(untilRaw).trim() : undefined)
  if (!since || until === undefined || (until && until < since)) return { ok: false, error: LEADERSHIP_ERRORS.invalidDates }

  if (await getLinkedMemberIdForUser(Number(actor.id), conn) === input.member_id) return { ok: false, error: LEADERSHIP_SELF_FORBIDDEN }

  let existing: { id: number, position_id: number, since: string, until: string | null } | null = null
  if (input.id) {
    const rows = await query<Array<{ id: number, member_id: number, position_id: number, since: string, until: string | null, assignable_by_leaders: number }>>(
      `SELECT mp.id, mp.member_id, mp.position_id, mp.since, mp.until, p.assignable_by_leaders
       FROM member_positions mp
       JOIN positions p ON p.id = mp.position_id
       WHERE mp.id = ? AND mp.subdivision_id = ?
       LIMIT 1`,
      [input.id, subdivisionId],
      conn,
    )
    const row = rows[0]
    if (!row) return { ok: false, error: LEADERSHIP_ERRORS.assignmentNotFound }
    if (!row.assignable_by_leaders) return { ok: false, error: LEADERSHIP_ERRORS.positionNotAssignable }
    if (Number(row.member_id) !== Number(input.member_id)) return { ok: false, error: LEADERSHIP_ERRORS.memberChange }
    existing = {
      id: Number(row.id),
      position_id: Number(row.position_id),
      since: toDay(row.since),
      until: row.until ? toDay(row.until) : null,
    }
  }

  const position = await loadLeaderPosition(input.position_id, conn)
  if (!position || !position.subdivision_bound || !position.assignable_by_leaders) {
    return { ok: false, error: LEADERSHIP_ERRORS.positionNotAssignable }
  }
  const positionChanged = !existing || existing.position_id !== Number(input.position_id)
  if (positionChanged && !position.is_active) return { ok: false, error: LEADERSHIP_ERRORS.positionNotAssignable }

  if (!await isSubdivisionMember(input.member_id, subdivisionId, conn)) return { ok: false, error: LEADERSHIP_ERRORS.notMember }
  if (!await leaderMayGrantPosition(actor, access, input.position_id, conn)) return { ok: false, error: LEADERSHIP_ERRORS.exceedsOwn }

  const others = await query<Array<{ since: string, until: string | null }>>(
    `SELECT since, until
     FROM member_positions
     WHERE member_id = ? AND position_id = ? AND subdivision_id = ? AND id != ?`,
    [input.member_id, input.position_id, subdivisionId, existing?.id ?? 0],
    conn,
  )
  const candidate = { since, until }
  if (others.some(other => rangesOverlap(candidate, { since: toDay(other.since), until: other.until ? toDay(other.until) : null }))) {
    return { ok: false, error: LEADERSHIP_ERRORS.overlap }
  }

  const position_ = { name: String(position.name), since, until }
  if (existing) {
    if (!positionChanged && existing.since === since && existing.until === until) return { ok: true }
    await query(
      `UPDATE member_positions SET position_id = ?, since = ?, until = ? WHERE id = ?`,
      [input.position_id, since, until, existing.id],
      conn,
    )
    await notifyLeadershipChange({ action: 'position_changed', actor, subdivisionId, memberId: input.member_id, position: position_ }, conn)
    return { ok: true }
  }

  await query(
    `INSERT INTO member_positions (member_id, position_id, since, until, subdivision_id) VALUES (?, ?, ?, ?, ?)`,
    [input.member_id, input.position_id, since, until, subdivisionId],
    conn,
  )
  await notifyLeadershipChange({ action: 'position_assigned', actor, subdivisionId, memberId: input.member_id, position: position_ }, conn)
  return { ok: true }
}

/** Ends a running assignment (until = yesterday) or drops one that has not started yet. */
export async function endLeadershipAssignment(actor: User, subdivisionId: number, assignmentId: number, conn: Conn): Promise<LeadershipResult> {
  const rows = await query<Array<{ id: number, member_id: number, since: string, until: string | null, assignable_by_leaders: number, position_name: string }>>(
    `SELECT mp.id, mp.member_id, mp.since, mp.until, p.assignable_by_leaders, p.name AS position_name
     FROM member_positions mp
     JOIN positions p ON p.id = mp.position_id
     WHERE mp.id = ? AND mp.subdivision_id = ?
     LIMIT 1`,
    [assignmentId, subdivisionId],
    conn,
  )
  const row = rows[0]
  if (!row) return { ok: false, error: LEADERSHIP_ERRORS.assignmentNotFound }
  if (!row.assignable_by_leaders) return { ok: false, error: LEADERSHIP_ERRORS.positionNotAssignable }
  const memberId = Number(row.member_id)
  if (await getLinkedMemberIdForUser(Number(actor.id), conn) === memberId) return { ok: false, error: LEADERSHIP_SELF_FORBIDDEN }

  const today = await appTodayLocalDate(conn)
  const until = row.until ? toDay(row.until) : null
  if (until && until < today) return { ok: false, error: LEADERSHIP_ERRORS.assignmentEnded }

  const yesterday = addDaysToLocalDate(today, -1)
  if (toDay(row.since) > yesterday) {
    await query(`DELETE FROM member_positions WHERE id = ?`, [assignmentId], conn)
  } else {
    await query(`UPDATE member_positions SET until = ? WHERE id = ?`, [yesterday, assignmentId], conn)
  }

  await notifyLeadershipChange({
    action: 'position_ended',
    actor,
    subdivisionId,
    memberId,
    position: { name: String(row.position_name) },
  }, conn)
  return { ok: true }
}
