import { query } from '~/server/utils/db'
import { loadAppointmentAudience } from '~/server/utils/appointments/visibility'
import type { RecipientRule, ResolvedRecipient, DbConn } from '~/server/utils/notifications/types'

interface MemberRow {
  id: number
  account: number | null
  first_name: string
  last_name: string
  email: string
}

interface UserRow {
  id: number
  username: string
  member_id: number | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

const ACTIVE_MEMBER_FILTER = `m.status != 'left'`

function toRecipient(row: MemberRow): ResolvedRecipient {
  return {
    memberId: row.id,
    userId: row.account,
    email: row.email || null,
    displayName: `${row.first_name} ${row.last_name}`.trim(),
    firstName: row.first_name || null,
    locale: 'de',
  }
}

function toRecipientFromUser(row: UserRow): ResolvedRecipient {
  return {
    memberId: row.member_id,
    userId: row.id,
    email: row.email || null,
    displayName: row.member_id ? `${row.first_name} ${row.last_name}`.trim() : row.username,
    firstName: row.member_id ? row.first_name : row.username,
    locale: 'de',
  }
}

async function membersByIds(memberIds: number[], conn?: DbConn): Promise<MemberRow[]> {
  if (!memberIds.length) return []
  return await query<MemberRow[]>(
    `SELECT m.id, m.account, m.first_name, m.last_name, m.email
     FROM members m
     WHERE m.id IN (${memberIds.map(() => '?').join(',')}) AND ${ACTIVE_MEMBER_FILTER}`,
    memberIds,
    conn,
  )
}

// Accounts without a member record (e.g. the bootstrap admin) must still be reachable via in_app,
// so this resolves through `users` with a LEFT JOIN rather than requiring a members row to exist.
async function recipientsByUserIds(userIds: number[], conn?: DbConn): Promise<ResolvedRecipient[]> {
  if (!userIds.length) return []
  const rows = await query<UserRow[]>(
    `SELECT u.id, u.username, m.id AS member_id, m.first_name, m.last_name, m.email
     FROM users u
     LEFT JOIN members m ON m.account = u.id AND m.status != 'left'
     WHERE u.id IN (${userIds.map(() => '?').join(',')})`,
    userIds,
    conn,
  )
  return rows.map(toRecipientFromUser)
}

async function membersBySubdivisions(subdivisionIds: number[], conn?: DbConn): Promise<MemberRow[]> {
  if (!subdivisionIds.length) return []
  return await query<MemberRow[]>(
    `SELECT m.id, m.account, m.first_name, m.last_name, m.email
     FROM members m
     JOIN subdivision_members sm ON sm.member_id = m.id
     WHERE sm.subdivision_id IN (${subdivisionIds.map(() => '?').join(',')}) AND ${ACTIVE_MEMBER_FILTER}`,
    subdivisionIds,
    conn,
  )
}

async function membersByShift(shiftId: number, conn?: DbConn): Promise<MemberRow[]> {
  return await query<MemberRow[]>(
    `SELECT m.id, m.account, m.first_name, m.last_name, m.email
     FROM members m
     JOIN event_shift_members esm ON esm.member_id = m.id
     WHERE esm.shift_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
    [shiftId],
    conn,
  )
}

async function membersByTask(taskId: number, conn?: DbConn): Promise<MemberRow[]> {
  const [direct, viaSubdivision] = await Promise.all([
    query<MemberRow[]>(
      `SELECT m.id, m.account, m.first_name, m.last_name, m.email
       FROM members m
       JOIN event_task_members etm ON etm.member_id = m.id
       WHERE etm.task_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
      [taskId],
      conn,
    ),
    query<MemberRow[]>(
      `SELECT m.id, m.account, m.first_name, m.last_name, m.email
       FROM members m
       JOIN subdivision_members sm ON sm.member_id = m.id
       JOIN event_task_subdivisions ets ON ets.subdivision_id = sm.subdivision_id
       WHERE ets.task_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
      [taskId],
      conn,
    ),
  ])
  return [...direct, ...viaSubdivision]
}

async function organizersByEvent(eventId: number, conn?: DbConn): Promise<MemberRow[]> {
  const [direct, viaSubdivision] = await Promise.all([
    query<MemberRow[]>(
      `SELECT m.id, m.account, m.first_name, m.last_name, m.email
       FROM members m
       JOIN event_member_organizers emo ON emo.member_id = m.id
       WHERE emo.event_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
      [eventId],
      conn,
    ),
    query<MemberRow[]>(
      `SELECT m.id, m.account, m.first_name, m.last_name, m.email
       FROM members m
       JOIN subdivision_members sm ON sm.member_id = m.id
       JOIN event_subdivision_organizers eso ON eso.subdivision_id = sm.subdivision_id
       WHERE eso.event_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
      [eventId],
      conn,
    ),
  ])
  return [...direct, ...viaSubdivision]
}

async function participantsByEvent(eventId: number, conn?: DbConn): Promise<MemberRow[]> {
  const [organizers, shiftMembers, taskMembers] = await Promise.all([
    organizersByEvent(eventId, conn),
    query<MemberRow[]>(
      `SELECT m.id, m.account, m.first_name, m.last_name, m.email
       FROM members m
       JOIN event_shift_members esm ON esm.member_id = m.id
       JOIN event_shift_slots ess ON ess.id = esm.shift_id
       WHERE ess.event_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
      [eventId],
      conn,
    ),
    query<MemberRow[]>(
      `SELECT m.id, m.account, m.first_name, m.last_name, m.email
       FROM members m
       JOIN event_task_members etm ON etm.member_id = m.id
       JOIN event_tasks et ON et.id = etm.task_id
       WHERE et.event_id = ? AND ${ACTIVE_MEMBER_FILTER}`,
      [eventId],
      conn,
    ),
  ])
  return [...organizers, ...shiftMembers, ...taskMembers]
}

async function membersWhoDeclinedOccurrence(appointmentId: number, occurrenceDate: string, conn?: DbConn): Promise<Set<number>> {
  const rows = await query<Array<{ member_id: number }>>(
    `SELECT member_id FROM appointment_responses
     WHERE appointment_id = ? AND occurrence_date = ? AND response = 'no'`,
    [appointmentId, occurrenceDate],
    conn,
  )
  return new Set(rows.map(row => Number(row.member_id)))
}

/**
 * Everyone in an appointment's scope, plus its creator. The scope itself is resolved by the shared
 * helper in server/utils/appointments/visibility.ts so this can never disagree with what the
 * calendar page and the ICS feed show. When `occurrenceDate` is given, members who responded "no"
 * to that specific occurrence are excluded
 */
async function recipientsByAppointment(appointmentId: number, occurrenceDate?: string, conn?: DbConn): Promise<ResolvedRecipient[]> {
  const audience = await loadAppointmentAudience(appointmentId, conn)

  const [members, creator, declined] = await Promise.all([
    membersByIds(audience.memberIds, conn),
    audience.createdByUserId != null ? recipientsByUserIds([audience.createdByUserId], conn) : Promise.resolve([]),
    occurrenceDate ? membersWhoDeclinedOccurrence(appointmentId, occurrenceDate, conn) : Promise.resolve(new Set<number>()),
  ])

  return [...members.filter(row => !declined.has(Number(row.id))).map(toRecipient), ...creator]
}

async function recipientsByPermission(permission: string, conn?: DbConn): Promise<ResolvedRecipient[]> {
  const rows = await query<Array<{ id: number }>>(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_key = ?
     LEFT JOIN user_permissions up ON up.user_id = u.id AND up.permission_key = ?
     WHERE u.is_active = 1 AND (rp.permission_key IS NOT NULL OR up.permission_key IS NOT NULL)`,
    [permission, permission],
    conn,
  )
  return await recipientsByUserIds(rows.map(row => row.id), conn)
}

async function allActiveMembers(conn?: DbConn): Promise<MemberRow[]> {
  return await query<MemberRow[]>(
    `SELECT m.id, m.account, m.first_name, m.last_name, m.email
     FROM members m
     WHERE ${ACTIVE_MEMBER_FILTER}`,
    [],
    conn,
  )
}

async function resolveRuleRecipients(rule: RecipientRule, conn?: DbConn): Promise<ResolvedRecipient[]> {
  switch (rule.kind) {
    case 'members': return (await membersByIds(rule.memberIds, conn)).map(toRecipient)
    case 'users': return await recipientsByUserIds(rule.userIds, conn)
    case 'subdivisions': return (await membersBySubdivisions(rule.subdivisionIds, conn)).map(toRecipient)
    case 'shiftAssignees': return (await membersByShift(rule.shiftId, conn)).map(toRecipient)
    case 'taskAssignees': return (await membersByTask(rule.taskId, conn)).map(toRecipient)
    case 'eventOrganizers': return (await organizersByEvent(rule.eventId, conn)).map(toRecipient)
    case 'eventParticipants': return (await participantsByEvent(rule.eventId, conn)).map(toRecipient)
    case 'appointmentParticipants': return await recipientsByAppointment(rule.appointmentId, rule.occurrenceDate, conn)
    case 'permission': return await recipientsByPermission(rule.permission, conn)
    case 'allActiveMembers': return (await allActiveMembers(conn)).map(toRecipient)
    case 'composite': {
      const results = await Promise.all(rule.rules.map(sub => resolveRuleRecipients(sub, conn)))
      return results.flat()
    }
  }
}

export async function resolveRecipients(rule: RecipientRule, conn?: DbConn): Promise<ResolvedRecipient[]> {
  const rows = await resolveRuleRecipients(rule, conn)

  const seen = new Set<string>()
  const recipients: ResolvedRecipient[] = []
  for (const recipient of rows) {
    const key = recipient.memberId !== null ? `m:${recipient.memberId}` : `u:${recipient.userId}`
    if (seen.has(key)) continue
    seen.add(key)
    recipients.push(recipient)
  }
  return recipients
}
