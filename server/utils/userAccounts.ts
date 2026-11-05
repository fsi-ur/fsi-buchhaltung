import type mariadb from 'mariadb'
import { hashPassword } from '~/server/utils/auth'
import { query } from '~/server/utils/db'
import { assignDefaultRoleToUser } from '~/server/utils/roles'
import { MIN_PASSWORD_LENGTH } from '~/config/validation'
import type { PermissionKey } from '~/config/permissions'
import { getPositionPermissionKeys, permissionsBeyond } from '~/server/utils/permissions'
import { appTodayLocalDate } from '~/server/utils/time'

export interface CreateUserAccountInput {
  username: string
  password: string
  is_active?: boolean
  must_change_password?: boolean
}

interface MysqlError extends Error {
  code?: string
}

export class DuplicateUsernameError extends Error {
  constructor() {
    super('Username already exists')
    this.name = 'DuplicateUsernameError'
  }
}

export class MemberAlreadyLinkedError extends Error {
  constructor() {
    super('Member already linked to another user')
    this.name = 'MemberAlreadyLinkedError'
  }
}

export class MemberNotFoundError extends Error {
  constructor() {
    super('Member not found')
    this.name = 'MemberNotFoundError'
  }
}

export async function createUserAccount(input: CreateUserAccountInput, conn?: mariadb.PoolConnection): Promise<number> {
  const username = input.username.trim()
  const password = input.password
  const isActive = input.is_active !== false
  const mustChangePassword = input.must_change_password === true

  if (!username || !password) throw new Error('Missing fields')
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error('Password too short')

  const passwordHash = await hashPassword(password)

  try {
    const result = await query<any>(
      `INSERT INTO users (username, password_hash, is_active, must_change_password) VALUES (?, ?, ?, ?)`,
      [username, passwordHash, isActive ? 1 : 0, mustChangePassword ? 1 : 0],
      conn
    )

    const userId = Number(result.insertId)
    await assignDefaultRoleToUser(userId, conn)

    return userId
  } catch (err: unknown) {
    const error = err as MysqlError
    if (error.code === 'ER_DUP_ENTRY') throw new DuplicateUsernameError()
    throw err
  }
}

export async function assignMemberToUser(
  userId: number,
  memberId: number | null,
  _changedByUserId: number,
  conn?: mariadb.PoolConnection
) {
  if (memberId === null) {
    await query(`UPDATE members SET account = NULL WHERE account = ?`, [userId], conn)
    return
  }

  const memberRows = await query<{ id: number, account: number | null }[]>(
    `SELECT id, account FROM members WHERE id = ? LIMIT 1`,
    [memberId],
    conn
  )
  const member = memberRows[0]
  if (!member) throw new MemberNotFoundError()
  if (member.account !== null && Number(member.account) !== userId) {
    throw new MemberAlreadyLinkedError()
  }

  await query(`UPDATE members SET account = NULL WHERE account = ? AND id <> ?`, [userId, memberId], conn)
  await query(`UPDATE members SET account = ? WHERE id = ?`, [userId, memberId], conn)
}

export const ACCOUNT_LINK_FORBIDDEN = 'Du hast keine Berechtigung, die Verknüpfung mit einem Benutzerkonto zu ändern.'
export const ACCOUNT_ALREADY_LINKED = 'Dieses Benutzerkonto ist bereits mit einem anderen Mitglied verknüpft.'
export const ACCOUNT_NOT_FOUND = 'Das Benutzerkonto wurde nicht gefunden.'
export const ACCOUNT_LINK_EXCEEDS_OWN = 'Die Positionen dieses Mitglieds gewähren Rechte, die du selbst nicht hast. Nur wer Berechtigungen verwalten darf, kann das Konto verknüpfen.'

/** Positions a member currently holds (active position, assignment covering today). */
export async function getMemberActivePositionIds(memberId: number, conn?: mariadb.PoolConnection): Promise<number[]> {
  const today = await appTodayLocalDate(conn)
  const rows = await query<Array<{ position_id: number }>>(
    `SELECT DISTINCT mp.position_id
     FROM member_positions mp
     JOIN positions p ON p.id = mp.position_id
     WHERE mp.member_id = ?
       AND p.is_active = 1
       AND mp.since <= ?
       AND (mp.until IS NULL OR mp.until >= ?)`,
    [memberId, today, today],
    conn,
  )
  return rows.map(row => Number(row.position_id))
}

/**
 * Linking a member to an account hands the member's positions (and so their permissions) to that
 * account (SEC-01). Needs `users.manage`; the account must not be linked to another member, and
 * the member's positions must not grant more than the caller holds unless they have
 * `permissions.manage`. Returns a German error or null.
 */
export async function authorizeMemberAccountLink(options: {
  memberId: number | null
  accountId: number | null
  actorPermissions: readonly PermissionKey[]
  conn?: mariadb.PoolConnection
}): Promise<string | null> {
  const { memberId, accountId, actorPermissions, conn } = options
  if (!actorPermissions.includes('users.manage')) return ACCOUNT_LINK_FORBIDDEN
  if (accountId === null) return null

  const [account] = await query<Array<{ id: number }>>(`SELECT id FROM users WHERE id = ? LIMIT 1`, [accountId], conn)
  if (!account) return ACCOUNT_NOT_FOUND

  const [otherMember] = await query<Array<{ id: number }>>(
    `SELECT id FROM members WHERE account = ? AND (? IS NULL OR id <> ?) LIMIT 1`,
    [accountId, memberId, memberId],
    conn,
  )
  if (otherMember) return ACCOUNT_ALREADY_LINKED

  if (memberId !== null && !actorPermissions.includes('permissions.manage')) {
    const positionIds = await getMemberActivePositionIds(memberId, conn)
    const permissionsByPosition = await getPositionPermissionKeys(positionIds, conn)
    for (const keys of permissionsByPosition.values()) {
      if (permissionsBeyond(keys, actorPermissions).length) return ACCOUNT_LINK_EXCEEDS_OWN
    }
  }
  return null
}
