import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { MemberStatus, type MemberListItem } from '~/types/member'
import { parseMemberStatus } from '~/server/utils/members'
import { internalError } from '~/server/utils/api/errors'

interface GetMembersSuccess {
  ok: true
  members: MemberListItem[]
}

interface GetMembersError {
  ok: false
  error: string
}

type GetMembersResponse = GetMembersSuccess | GetMembersError

export default defineEventHandler(async (event): Promise<GetMembersResponse> => {
  const current = await requirePermission(event, 'members.view')
  if (!current.ok) return current

  const canViewUsers = current.user.permissions.includes('users.view') || current.user.permissions.includes('users.manage')

  try {
    const rows: any[] = await query(
      `
      SELECT
        m.id,
        m.first_name,
        m.last_name,
        m.birthdate,
        m.status,
        m.honorary,
        m.joined_at,
        m.left_at,
        s.name AS subject_name,
        ${canViewUsers ? 'CASE WHEN m.account IS NULL THEN 0 ELSE 1 END' : 'NULL'} AS has_account,
        ${canViewUsers ? 'u.is_active' : 'NULL'} AS account_is_active
      FROM members m
      LEFT JOIN subjects s ON s.id = m.subject
      LEFT JOIN users u ON u.id = m.account
      ORDER BY m.last_name ASC, m.first_name ASC
      `
    )

    return {
      ok: true,
      members: rows.map(row => ({
        id: Number(row.id),
        first_name: String(row.first_name),
        last_name: String(row.last_name),
        birthdate: String(row.birthdate),
        status: parseMemberStatus(String(row.status)) as MemberStatus,
        honorary: Boolean(row.honorary),
        subject_name: row.subject_name ? String(row.subject_name) : null,
        joined_at: String(row.joined_at),
        left_at: row.left_at ? String(row.left_at) : null,
        has_account: row.has_account === null || row.has_account === undefined ? null : Boolean(row.has_account),
        account_is_active: row.account_is_active === null || row.account_is_active === undefined ? null : Boolean(row.account_is_active),
      }))
    }
  } catch (err: any) {
    return internalError('Failed to load members', err)
  }
})
